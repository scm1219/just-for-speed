# 03 — AI 对手

> 本篇记录 AI 车辆的驾驶行为与橡皮筋（Rubber Band）难度调节机制。
>
> 涉及文件：`src/ai/AIDriver.ts`、`src/ai/RubberBanding.ts`

## 1. AI 设计取舍

街机赛车的 AI 设计面临一个经典矛盾：

- **拟真方案**：让 AI 走和玩家一样的物理驾驶（寻路 + 避障 + 物理碰撞）。代价是需要完整的路径规划、碰撞规避、恢复逻辑，工程复杂，且 AI 容易卡墙、互相碰撞。
- **纯贴曲线方案**：位置每帧直接写到曲线点上。最简单，但碰撞、道具、翻车全是假的。

**本项目采用混合方案**：AI 车辆是**真正的物理车辆**——与玩家共用同一个 `Vehicle` 类，靠「假输入」（永远满油门 + 算法转向）驱动，位置、碰撞、翻车、被道具命中全走物理。在此基础上**并行挂一个理想进度参数** `waypointProgress ∈ [0,1)`，它按固定速率独立推进，**不直接决定车辆位置**，只承担三个角色：

```mermaid
flowchart LR
    subgraph "物理层（权威位置）"
        F1["假输入<br/>forward=true + steerX"] --> F2["Vehicle.updateFromInput<br/>与玩家同一套物理"] --> F3["真实位置/碰撞/翻车<br/>渲染与排名用这里"]
    end
    subgraph "理想进度层（waypointProgress）"
        W1["固定速率递增<br/>baseSpeed × 橡皮筋 × 难度"] --> W2["前瞻点 lookAheadT<br/>转向目标（§3）"]
        W1 --> W3["橡皮筋比较基准<br/>aiProgress（§5）"]
        W1 --> W4["翻车/卡死回位锚点<br/>setPosition（02 §6.4/6.5）"]
    end
    W2 -.转向目标.-> F1
```

1. **前瞻点**：`waypointProgress + 0.02` 处的曲线点作为转向目标（见 §3）；
2. **橡皮筋基准**：作为 aiProgress 与玩家进度比较（见 §5）；
3. **回位锚点**：翻车/卡死自动恢复时，`setPosition(waypointProgress)` 把车传送回曲线（见 [02 §6.4 / §6.5](./02-physics.md)）。

> **两层会漂移**：物理车的实际快慢由物理决定（满油门、碰撞、手刹），`waypointProgress` 按自己的速率走，二者没有硬同步。漂移的可见后果：前瞻点可能落到车辆后方（角差接近 π，转向饱和并触发手刹），以及卡死/翻车回位时的传送距离。也正因为如此，橡皮筋**不直接改变车速**——详见 §5.4 的已知局限。

## 2. 赛道曲线参数化

AI 的世界模型是赛道曲线上的一个标量 `trackT ∈ [0,1)`：

- `t = 0`：起跑线
- `t = 0.5`：赛道中点（参数化中点；因采样非弧长均匀，只是近似，见 [04 §2](./04-track-system.md) 的精度提示）
- `t = 1`：回到起跑（闭合曲线，`% 1` 循环）

曲线本身是 `THREE.CatmullRomCurve3`（详见 [04 赛道系统 §2](./04-track-system.md)），提供：
- `getPointAt(t)` → 曲线上的世界坐标点
- `getTangentAt(t)` → 该点的切线方向（单位向量）

AI 用 `t` 表示「我跑到赛道哪里了」，玩家进度也通过 `getPlayerApproxProgress()`（见 [06 §3](./06-game-flow.md)）转成同样的 `t`，二者可比较——这是橡皮筋机制的基础。

## 3. 转向控制算法

AI 的转向目标：**让车头朝向前方一个「前瞻点」**。

### 3.1 算法流程

```mermaid
flowchart TD
    A["当前 waypointProgress"] --> B["前瞻点:<br/>lookAheadT = progress + 0.02"]
    B --> C["取目标点坐标<br/>getPointAt(lookAheadT)"]
    C --> D["计算目标朝向角<br/>targetAngle = atan2(dx, dz)"]
    D --> E["从车辆四元数提取当前 yaw"]
    E --> F["角差 = targetAngle - currentAngle<br/>(归一化到 -π..π)"]
    F --> G["steerValue = clamp(角差×2, -1, 1)"]
    G --> H["构造假输入喂给 Vehicle"]
```

### 3.2 关键实现细节

**① 前瞻（look-ahead）0.02**：AI 不看「当前点」（否则会原地打转），而是看前方 2% 进度处的点。这让转向更平滑、有「预见性」。前瞻太小→转向迟钝；太大→切弯激进。

**② 角度归一化（关键防错）：**

```ts
let angleDiff = targetAngle - currentAngle;
while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
```

`atan2` 返回 `[-π, π]`。若 target = 3.1，current = -3.1，朴素差值 = 6.2，AI 会以为「要转 354°」而乱打方向。归一化到 `[-π, π]` 后差值 = -0.08（只需小幅左转）。**这是角度运算的必做步骤。**

**③ 从四元数提取 yaw：**

```ts
const plusZYaw = Math.atan2(
  2 * (q.w * q.y + q.x * q.z),
  1 - 2 * (q.y * q.y + q.z * q.z)
);
const currentAngle = plusZYaw + Math.PI;  // +Z 角 + π = -Z(前向)的 yaw
```

提取的是底盘 **+Z 轴的偏航角**，再加 π 转成 **-Z（前向）的偏航角**——与 [02 §4 的 -Z 约定](./02-physics.md) 一致。

**④ 角差线性映射到转向：**

```ts
const steerValue = Math.max(-1, Math.min(1, angleDiff * 2));
```

角差（弧度）× 2 后 clamp 到 `[-1, 1]`。系数 2 意味着约 28°（0.5 rad）的偏差就达到满打方向。这是一种简化的比例控制（P 控制），没有积分/微分项，但配合前瞻点已足够平滑。

## 4. 速度自适应（弯道减速的真相 ⚠️）

代码按角差绝对值分档，意图是「直线全速、急弯减速」：

```ts
const curvature = Math.abs(angleDiff);        // 角差绝对值近似曲率
const turnBrake = curvature > 0.5 ? 0.6 : 1.0; // 意图：急弯收到 60% 油门
const fakeInput = {
  forward: true,
  left: steerValue < -0.1,
  right: steerValue > 0.1,
  handbrake: curvature > 1.0,                  // 极急弯拉手刹
  steerX: steerValue,
  accel: turnBrake,
  // ...
};
```

| `|angleDiff|`（rad） | `|angleDiff|`（度） | 设计意图 | 实际效果（以代码为准） |
|---------------------|---------------------|---------|----------------------|
| < 0.5 | < 28° | 全速 | 全速（`forward` 恒真，满油门） |
| 0.5 ~ 1.0 | 28°~57° | 收油到 60% | **无效果**——`accel` 是死输入（见下） |
| > 1.0 | > 57° | 收油 + 手刹 | **手刹生效**：后轮摩擦圆收缩 + 后轮制动力，物理减速甩尾 |

> **⚠️ 已知局限：`turnBrake` 是死输入**。`Vehicle.updateFromInput` 只消费 `forward / backward / left / right / steerX / handbrake`，**不读取 `accel` / `brake` 模拟量**——`turnBrake` 赋给 `fakeInput.accel` 后没有任何代码使用它（手柄玩家的模拟油门量同理不参与车辆物理）。因此 AI 的弯道减速实际只有手刹一档生效。若要恢复分档减速，需在 `Vehicle.updateFromInput` 中用 `input.accel` 缩放推力。

## 5. 橡皮筋（Rubber Band）机制 ⭐

这是街机赛车「让比赛永远胶着」的核心技巧，也是本项目 AI 的灵魂。

### 5.1 设计动机

真实赛车里，技术差距会让领先者越拉越远，落后者毫无希望——这**不好玩**。橡皮筋机制动态调整 AI 速度：

- **玩家领先**→ AI **加速**追上来（橡皮筋被拉伸，回弹）；
- **玩家落后**→ AI **减速**等一等（橡皮筋松弛）。

效果是比赛始终紧张，无论玩家水平如何。代价是「不真实」，但街机游戏优先趣味。

### 5.2 分段线性公式详解

`RubberBanding.update(playerProgress, aiProgress)` 每帧由 `AIDriver` 调用：

```ts
const diff = playerProgress - aiProgress;  // 正：玩家领先；负：AI领先
if (diff > 0.3) {
  // 玩家大幅领先 → AI 加速
  const t = Math.min((diff - 0.3) / 0.4, 1);
  this.currentMultiplier = 1 + behindBoostMin + t * (behindBoostMax - behindBoostMin);
} else if (diff < -0.2) {
  // AI 大幅领先 → AI 减速
  const t = Math.min((-diff - 0.2) / 0.4, 1);
  this.currentMultiplier = 1 - aheadReductionMin - t * (aheadReductionMax - aheadReductionMin);
} else {
  // 势均力敌 → 不调节
  this.currentMultiplier = 1.0;
}
```

**三个区间（以 normal 难度为例）：**

```mermaid
graph LR
    A["AI 领先 > 0.2<br/>减速区"] -->|"-0.2..0"| B["中性区<br/>×1.0"]
    B -->|"0..0.3"| B
    B -->|"0.3..0.7"| C["玩家领先 > 0.3<br/>加速区"]
    C -->|"> 0.7"| D["封顶 ×1.15"]
    style A fill:#ffd6d6;
    style B fill:#d6ffd6;
    style C fill:#fff4d6;
    style D fill:#ffe0aa;
```

| 区间 | `diff`（player−ai） | 归一化 t | 倍率（normal） | 含义 |
|------|---------------------|----------|---------------|------|
| AI 领先 | `[-0.6, -0.2]` | `(−diff−0.2)/0.4` | `1 − 0.05 ~ 0.10` → **0.95 ~ 0.90** | AI 减速 5%~10% |
| 中性 | `[-0.2, 0.3]` | — | **1.0** | 不调节 |
| 玩家领先 | `[0.3, 0.7]` | `(diff−0.3)/0.4` | `1 + 0.10 ~ 0.15` → **1.10 ~ 1.15** | AI 加速 10%~15% |
| 封顶 | `> 0.7` | `t=1` | **1.15** | 防止 AI 过快失真 |

**关键设计点：**
- **死区（中性区）`[-0.2, 0.3]`**：差距不大时完全不调节，避免 AI 速度抖动。死区对玩家领先更宽容（0.3）对 AI 领先更敏感（0.2）——轻微偏向「让 AI 不要甩开玩家」。
- **线性插值 + 封顶**：调节幅度随差距线性增长但有上限，防止极端情况下 AI 倍速飙车或原地爬行。
- **`diff` 单位是 progress（0~1 的赛道比例）**，不是时间或距离。0.3 ≈ 30% 圈长。

### 5.3 三档难度配置

```ts
const DIFFICULTY_CONFIGS: Record<Difficulty, RubberBandConfig> = {
  easy:   { behindBoostMin: 0,    behindBoostMax: 0,    aheadReductionMin: 0,    aheadReductionMax: 0,    enabled: false },
  normal: { behindBoostMin: 0.10, behindBoostMax: 0.15, aheadReductionMin: 0.05, aheadReductionMax: 0.10, enabled: true  },
  hard:   { behindBoostMin: 0.15, behindBoostMax: 0.20, aheadReductionMin: 0.08, aheadReductionMax: 0.15, enabled: true  },
};
```

| 难度 | 橡皮筋 | AI 追赶倍率 | AI 等待减速 | 基础速度系数 | 体验 |
|------|--------|------------|------------|-------------|------|
| easy | **关闭** | ×1.0 | ×1.0 | ×0.8 | AI 慢且不追赶，轻松 |
| normal | 开 | +10%~15% | −5%~10% | ×1.0 | 标准胶着 |
| hard | 开 | +15%~20% | −8%~15% | ×1.1 | AI 又快又紧咬 |

**两个独立的难度维度：**
1. **`enabled`**：easy 关闭橡皮筋（纯靠基础速度让玩家）。
2. **基础速度系数 `speedFactor`**（在 AIDriver 构造时设定）：easy=0.8、normal=1.0、hard=1.1。这是「天生快慢」，与橡皮筋的「动态调节」相乘。

### 5.4 倍率的合成与已知局限 ⚠️

`waypointProgress` 的推进速率由两个因子相乘：

```ts
// AIDriver.update()
this.rubberBanding.update(playerProgress, this.waypointProgress);
const speedMult = this.rubberBanding.getSpeedMultiplier() * this.speedFactor;
const baseSpeed = 0.08;                          // 理想推进速率（progress/秒）
const advanceSpeed = baseSpeed * speedMult * dt;
this.waypointProgress = (this.waypointProgress + advanceSpeed) % 1;
```

> **⚠️ 橡皮筋不直接改变车速（以代码为准）**：`speedMult` 只缩放 `waypointProgress` 的推进速率，**不进入引擎力计算**——AI 车辆的物理推力永远是满油门（`fakeInput.forward = true`，见 [02 §5.2](./02-physics.md)）。倍率影响实际运动的路径是间接的：
> 1. **前瞻点步调**：理想进度推进更快/更慢，转向目标点相对车辆的远近随之变化；
> 2. **回位传送**：翻车/卡死触发 `setPosition(waypointProgress)` 时，更超前的理想进度意味着被传送得更远。
>
> 同理，三档难度的 `speedFactor`（0.8/1.0/1.1）也只作用于理想进度，**不改变 AI 的物理极速或推力**。`baseSpeed = 0.08`（progress/秒）是与满油门物理圈速大致匹配的调参值，**不是**圈速的来源。若要让橡皮筋真正调节车速，需把 `speedMult` 接入推力缩放（与 §4 的 `accel` 接入是同一处改造）。

## 6. AI 与玩家的统一接口

AI 车辆复用玩家的 `Vehicle` 类，通过构造「假输入」驱动：

```ts
const fakeInput = {
  forward: true, backward: false,
  left: steerValue < -0.1, right: steerValue > 0.1,
  handbrake: curvature > 1.0,
  useItem: false, pause: false, resetVehicle: false,
  steerX: steerValue, accel: turnBrake, brake: 0,
};
this.vehicle.updateFromInput(fakeInput, dt);
```

好处：AI 和玩家走**同一套物理代码**，手感一致；AI 车辆同样会漂移、有引擎声效、被道具影响。区别只在于「输入从哪来」——玩家来自 InputManager，AI 来自算法。

> AI 当前**不使用道具**（`useItem: false`），也没有道具拾取逻辑——这是已知的功能边界。

## 7. 起跑位置错峰

AI 车队（数量由菜单选择：无 0 / 少量 2 / 满 5，默认 5）不堆在起跑线，而是**沿赛道往后错开**：

```ts
const startT = ((1 - (i + 1) * 0.03) + 1) % 1;  // i=0..aiCount-1，满编 5 辆 → t≈0.97,0.94,0.91,0.88,0.85
```

- `t` 从 0.97 开始，每往后 0.03（即约 3% 圈长），满编共 5 辆。
- 由于曲线闭合，`t=0.97` 实际在起跑线（t=0）**稍后方**。
- `% 1` 防止负值越界。
- 注意 `main.ts` 的 `aiColors` 只准备了 5 种配色，AI 数量超过 5 会取到 `undefined`——当前菜单上限恰好是 5，属于隐性约束。

这让发车时 AI 呈梯队排列，避免首弯全部挤在一起。

## 8. 小结

| 机制 | 实现要点 |
|------|---------|
| AI 运动模型 | 真实物理车辆 + 假输入驱动；waypointProgress 是并行理想进度（前瞻/橡皮筋/回位锚点） |
| 转向控制 | 前瞻点 + 角差归一化 + 线性 P 控制 |
| 转弯减速 | 仅手刹档（角差 >1）物理生效；收油档 `accel` 为死输入（§4） |
| 橡皮筋 | 分段线性，玩家领先加速、AI 领先减速，带死区与封顶；只调理想进度速率，不直接改车速（§5.4） |
| 难度 | 基础速度系数（0.8/1.0/1.1）× 橡皮筋倍率，easy 关闭橡皮筋；同样只作用于理想进度 |
| 统一接口 | 假输入复用 Vehicle，AI 与玩家手感一致 |

AI 依赖的赛道曲线见 [04 赛道系统](./04-track-system.md)；玩家进度的计算见 [06 游戏流程 §3](./06-game-flow.md)。
