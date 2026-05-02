import { ItemType } from '../items/ItemEffects';

const ITEM_ICONS: Record<ItemType, string> = {
  [ItemType.BOOST]: '\u{1F680}',
  [ItemType.BOMB]: '\u{1F4A3}',
  [ItemType.SHIELD]: '\u{1F6E1}️',
  [ItemType.LIGHTNING]: '⚡',
};

export class HUD {
  private container: HTMLElement;
  private positionEl: HTMLElement;
  private lapEl: HTMLElement;
  private timeEl: HTMLElement;
  private speedEl: HTMLElement;
  private speedBarEl: HTMLElement;
  private itemEl: HTMLElement;
  private notificationContainer: HTMLElement;

  constructor() {
    this.container = document.getElementById('hud') || this.createContainer();
    this.container.innerHTML = `
      <div class="hud-top">
        <div class="hud-box"><div class="label">Position</div><div class="value" id="hud-position">1<span class="dim">/6</span></div></div>
        <div class="hud-box"><div class="label">Lap</div><div class="value" id="hud-lap">1<span class="dim">/3</span></div></div>
        <div class="hud-box"><div class="label">Time</div><div class="value" id="hud-time" style="font-size:20px;">0:00.0</div></div>
      </div>
      <div class="hud-item">
        <div class="hud-item-box" id="hud-item"></div>
        <div class="hud-item-key">SHIFT</div>
      </div>
      <div class="hud-speed">
        <div class="hud-speed-box">
          <div class="number" id="hud-speed">0</div>
          <div class="unit">KM/H</div>
          <div class="hud-speed-bar"><div class="hud-speed-bar-fill" id="hud-speed-bar" style="width:0%"></div></div>
        </div>
      </div>
      <div class="hud-minimap">
        <div class="hud-minimap-box" id="hud-minimap"></div>
      </div>
      <div id="hud-notifications"></div>
    `;
    this.positionEl = document.getElementById('hud-position')!;
    this.lapEl = document.getElementById('hud-lap')!;
    this.timeEl = document.getElementById('hud-time')!;
    this.speedEl = document.getElementById('hud-speed')!;
    this.speedBarEl = document.getElementById('hud-speed-bar')!;
    this.itemEl = document.getElementById('hud-item')!;
    this.notificationContainer = document.getElementById('hud-notifications')!;
  }

  updatePosition(position: number, total: number): void {
    this.positionEl.innerHTML = `${position}<span class="dim">/${total}</span>`;
  }

  updateLap(current: number, total: number): void {
    this.lapEl.innerHTML = `${current}<span class="dim">/${total}</span>`;
  }

  updateTime(seconds: number): void {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    this.timeEl.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs.toFixed(1)}`;
  }

  updateSpeed(kmh: number, maxSpeed: number): void {
    this.speedEl.textContent = Math.round(kmh).toString();
    const pct = Math.min((kmh / maxSpeed) * 100, 100);
    this.speedBarEl.style.width = `${pct}%`;
  }

  updateItem(item: ItemType | null): void {
    this.itemEl.textContent = item ? ITEM_ICONS[item] : '';
    this.itemEl.style.borderColor = item ? '#f5a623' : '#333';
  }

  showNotification(message: string): void {
    const el = document.createElement('div');
    el.className = 'hud-notification';
    el.textContent = message;
    this.notificationContainer.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }

  show(): void {
    this.container.style.display = 'block';
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  private createContainer(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'hud';
    document.body.appendChild(el);
    return el;
  }
}
