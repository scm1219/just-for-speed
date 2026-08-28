import * as CANNON from 'cannon-es';
import { InputState } from '../input/InputManager';
import { VEHICLE_MATERIAL } from './PhysicsWorld';

export interface VehicleConfig {
  mass: number;
  maxSpeed: number;          // m/s
  acceleration: number;
  brakeForce: number;
  steerSpeed: number;
  driftFactor: number;
  boostMultiplier: number;
}

export const DEFAULT_VEHICLE_CONFIG: VehicleConfig = {
  mass: 1200,
  maxSpeed: 200 / 3.6,      // ~55.56 m/s
  acceleration: 25,
  brakeForce: 40,
  steerSpeed: 2.5,
  driftFactor: 0.3,
  boostMultiplier: 1.5,
};

const FLIP_THRESHOLD = -0.5;
const FLIP_RESET_DELAY = 5;

const WHEEL_RADIUS = 0.35;
const SUSPENSION_STIFFNESS = 30;
const SUSPENSION_REST_LENGTH = 0.4;
const FRICTION_SLIP = 2.5;
const DAMPING_RELAXATION = 2.3;
const DAMPING_COMPRESSION = 4.4;
const MAX_SUSPENSION_FORCE = 100000;
const ROLL_INFLUENCE = 0.01;
const MAX_SUSPENSION_TRAVEL = 0.5;

// --- Handling tuning ---------------------------------------------------------
// Front-wheel steer angle shrinks with speed: full lock at a standstill for
// tight low-speed cornering, a small angle at top speed so a full key press
// no longer spins the car. (Angle in radians; cannon steer values are angles.)
const MAX_STEER_LOW = 0.55;
const MAX_STEER_HIGH = 0.16;

// Engine impulse coefficient. Thrust is applied at the CENTER OF MASS (see
// updateFromInput) instead of cannon's contact-patch engine impulse, so full
// throttle produces no pitch (wheelie) torque at all — measured on the old
// contact-patch path, 0.3 s of full throttle had the front wheels off the
// ground and the car somersaulting backward (suspension droop margin is only
// ~0.08 m, so once the nose pitches a few degrees the front rays miss the
// road and nothing counters the torque). 0.4 ≈ 1 g of acceleration.
const DRIVE_COEFF = 0.4;
const REVERSE_COEFF = 0.12;

// Service brake (S/↓ while rolling forward) impulse per wheel, N·s. The
// friction circle caps the usable deceleration (~1g), so anything well above
// `suspensionForce × dt` just locks toward full grip — 90 gives a firm stop.
const SERVICE_BRAKE = 90;
// Front-biased service braking keeps the car straight; rear wheels get less
// so braking into a corner does not destabilize the tail.
const SERVICE_BRAKE_REAR_RATIO = 0.7;
// Below this forward speed (m/s) S/↓ switches from braking to reverse drive.
const BRAKE_TO_REVERSE_SPEED = 0.5;

// Downforce ∝ v², applied along body-down while any wheel has contact. It
// compensates the grip loss / floatiness at high speed and suppresses both
// wheelies and rollovers, which is what allowed angularDamping to drop from
// the old 0.8 hack to 0.5 (the car now keeps natural body motion and lands
// jumps without the rigid "gyro" feel).
const DOWNFORCE_COEFF = 3.0;
// Yaw authority while airborne (N·m): lets the player straighten the car for
// landing. Subtle on purpose — pitch/roll stay physical in the air.
const AIR_YAW_TORQUE = 1500;

// Drift detection from the actual side-slip angle (angle between velocity and
// the nose direction), not from "handbrake pressed". High-speed cornering that
// breaks the rear loose now triggers drift smoke/audio too.
const SLIP_DRIFT_ANGLE = 0.35; // rad (~20°)
const SLIP_DRIFT_SPEED = 8;    // m/s
// Handbrake keeps its legacy detection floor (below this speed it is a brake).
const HANDBRAKE_DRIFT_SPEED = 5;

// Scratch axis used for downforce / air-torque directions.
const UP = new CANNON.Vec3(0, 1, 0);
// Local forward (nose direction, see getSpeed).
const FORWARD = new CANNON.Vec3(0, 0, -1);

// Chassis-local position + rotation of one wheel for rendering. Updated from
// the raycast vehicle every frame via getWheelVisuals(): the position tracks
// the live suspension length (wheels visibly compress over bumps and dangle
// in the air) and the rotation carries both the steering angle and the
// accumulated rolling angle, so wheel meshes spin/steer like real wheels.
export interface WheelVisual {
  position: CANNON.Vec3;
  quaternion: CANNON.Quaternion;
}

const WHEEL_OPTIONS: CANNON.WheelInfoOptions = {
  radius: WHEEL_RADIUS,
  directionLocal: new CANNON.Vec3(0, -1, 0),
  suspensionStiffness: SUSPENSION_STIFFNESS,
  suspensionRestLength: SUSPENSION_REST_LENGTH,
  frictionSlip: FRICTION_SLIP,
  dampingRelaxation: DAMPING_RELAXATION,
  dampingCompression: DAMPING_COMPRESSION,
  maxSuspensionForce: MAX_SUSPENSION_FORCE,
  rollInfluence: ROLL_INFLUENCE,
  axleLocal: new CANNON.Vec3(-1, 0, 0),
  maxSuspensionTravel: MAX_SUSPENSION_TRAVEL,
  customSlidingRotationalSpeed: -30,
  useCustomSlidingRotationalSpeed: true,
};

// The nose points toward local -Z (see VehicleMesh / Camera / getSpeed), so the
// STEERING wheels (index 0=FL, 1=FR) must sit on the -Z end (the nose), and the
// DRIVE wheels (index 2=RL, 3=RR) on the +Z end (the tail). setSteeringValue() is
// only applied to index 0/1 (see updateFromInput), so those two wheels have to be
// the ones at the front or the car cannot turn. (Earlier these were swapped,
// which left the steering wheels at the tail and the car unable to corner.)
const WHEEL_POSITIONS = [
  new CANNON.Vec3(-0.8, 0, -1.2),  // FL (nose = -Z, steered)
  new CANNON.Vec3(0.8, 0, -1.2),   // FR (nose = -Z, steered)
  new CANNON.Vec3(-0.8, 0, 1.2),   // RL (tail = +Z, driven)
  new CANNON.Vec3(0.8, 0, 1.2),    // RR (tail = +Z, driven)
];

export class Vehicle {
  readonly chassisBody: CANNON.Body;
  readonly raycastVehicle: CANNON.RaycastVehicle;
  private config: VehicleConfig;

  private currentSteer: number = 0;
  private currentMaxSpeed: number;
  private isDrifting: boolean = false;
  private boostEndTime: number = 0;
  private speedReductionTimer: ReturnType<typeof setTimeout> | null = null;
  private flipStartTime: number | null = null;

  // Preallocated per-wheel visual state (see getWheelVisuals) and scratch
  // vectors so the per-frame sync does not allocate.
  private readonly wheelVisuals: WheelVisual[] = WHEEL_POSITIONS.map(() => ({
    position: new CANNON.Vec3(),
    quaternion: new CANNON.Quaternion(),
  }));
  private readonly tmpVecA = new CANNON.Vec3();
  private readonly tmpVecB = new CANNON.Vec3();
  private readonly tmpQuatA = new CANNON.Quaternion();

  // Per-physics-step force commands. updateFromInput (render frame) writes
  // them; the world 'preStep' listener applies them EVERY physics step —
  // world.step() clears body forces after each step, so applying directly
  // from the render loop would scale thrust with the frame rate.
  private pendingThrust: number = 0;
  private readonly preStepCallback = (): void => {
    this.applyDriveThrust(this.pendingThrust);
    this.applyAeroForces();
  };

  constructor(config: VehicleConfig, world: CANNON.World) {
    this.config = { ...config };
    this.currentMaxSpeed = config.maxSpeed;

    // Create chassis body. The box matches the visible body (1.36 × 0.8 × 3.1
    // m vs the old 1.0 × 0.5 × 2.0) so collisions hit what you see — the old
    // box let the visual nose/rear pass through walls — and the longer box
    // raises pitch/yaw inertia enough to tame the rear-drive wheelie torque.
    const chassisShape = new CANNON.Box(new CANNON.Vec3(0.68, 0.4, 1.55));
    this.chassisBody = new CANNON.Body({
      mass: config.mass,
      shape: chassisShape,
      material: VEHICLE_MATERIAL,
      position: new CANNON.Vec3(0, 1.5, 0),
    });
    // Moderate angular damping: high-frequency suspension chatter is damped,
    // while body pitch/roll stay expressive. The wheelie that used to require
    // 0.8 is now handled by chassis inertia + downforce (see DRIVE_COEFF /
    // DOWNFORCE_COEFF); 0.8 made the body feel rigid and killed mid-air control.
    this.chassisBody.angularDamping = 0.6;
    world.addBody(this.chassisBody);
    world.addEventListener('preStep', this.preStepCallback);

    // Create raycast vehicle
    this.raycastVehicle = new CANNON.RaycastVehicle({
      chassisBody: this.chassisBody,
      indexRightAxis: 0,
      indexUpAxis: 1,
      indexForwardAxis: 2,
    });

    // Add 4 wheels
    for (const pos of WHEEL_POSITIONS) {
      this.raycastVehicle.addWheel({
        ...WHEEL_OPTIONS,
        chassisConnectionPointLocal: pos,
      });
    }

    this.raycastVehicle.addToWorld(world);
  }

  updateFromInput(input: InputState, dt: number): void {
    const now = performance.now() / 1000;
    const isBoosted = now < this.boostEndTime;
    const effectiveMaxSpeed = isBoosted
      ? this.currentMaxSpeed * this.config.boostMultiplier
      : this.currentMaxSpeed;

    const speed = this.getSpeed();

    // --- Steering (smoothed input in [-1, 1]) ---
    let targetSteer = 0;
    if (input.left) targetSteer -= 1;
    if (input.right) targetSteer += 1;

    // Apply analog steer if present
    if (Math.abs(input.steerX) > 0.01) {
      targetSteer = input.steerX;
    }

    const steerMultiplier = input.handbrake ? 1.4 : 1.0;
    const steerRate = this.config.steerSpeed * steerMultiplier;
    if (targetSteer > this.currentSteer) {
      this.currentSteer = Math.min(this.currentSteer + steerRate * dt, targetSteer);
    } else if (targetSteer < this.currentSteer) {
      this.currentSteer = Math.max(this.currentSteer - steerRate * dt, targetSteer);
    }

    // Speed-sensitive steering: the normalized input maps to a wheel angle
    // that shrinks from MAX_STEER_LOW at a standstill to MAX_STEER_HIGH at top
    // speed. Same key press = gentle lane change at 200 km/h, full lock in a
    // parking maneuver — removes the old high-speed spin-out twitchiness.
    const speedNorm = Math.min(Math.abs(speed) / this.currentMaxSpeed, 1);
    const maxSteer = MAX_STEER_LOW + (MAX_STEER_HIGH - MAX_STEER_LOW) * speedNorm;

    // Apply steering to front wheels only (index 0=FL, 1=FR). Rear wheels
    // (2=RL, 3=RR) are fixed and only carry drive/brake force — conventional
    // front-wheel steering. The sign is NEGATED: with axleLocal=(-1,0,0) and the
    // steering wheels sitting at the nose (-Z, z=-1.2), cannon's setFromAxisAngle
    // (around +Y) yields a yaw torque opposite to our input convention
    // (left input -> steerX=-1 must visibly turn the car LEFT). Negating restores
    // the correct direction for the front-mounted steering wheels.
    this.raycastVehicle.setSteeringValue(-this.currentSteer * maxSteer, 0); // FL
    this.raycastVehicle.setSteeringValue(-this.currentSteer * maxSteer, 1); // FR

    // --- Engine force (drive thrust) ---
    // In this cannon-es config (indexForwardAxis=2, axleLocal=(-1,0,0)) the
    // nose points toward local -Z (see getSpeed / VehicleMesh / Camera). We
    // compute the signed drive force, then apply it at the center of mass in
    // applyDriveThrust() — NOT via applyEngineForce, whose contact-patch
    // impulse creates the wheelie torque described at DRIVE_COEFF.
    let engineForce = 0;
    let serviceBrake = 0;
    if (input.forward) {
      if (speed < -BRAKE_TO_REVERSE_SPEED) {
        // Rolling backward: W brakes first instead of fighting the momentum.
        serviceBrake = SERVICE_BRAKE;
      } else if (speed < effectiveMaxSpeed) {
        // Taper the engine force near the top speed instead of the old hard
        // cut at maxSpeed, so the last 25% of the speedo builds progressively.
        const speedRatio = Math.max(speed, 0) / effectiveMaxSpeed;
        const taper = Math.min((1 - speedRatio) / 0.25, 1);
        engineForce = this.config.acceleration * this.config.mass * DRIVE_COEFF * taper;
        if (isBoosted) {
          engineForce *= this.config.boostMultiplier;
        }
      }
    }
    const maxReverseSpeed = effectiveMaxSpeed * 0.3;
    if (input.backward) {
      if (speed > BRAKE_TO_REVERSE_SPEED) {
        // Moving forward: S brakes (front-biased), then reverses once slow.
        serviceBrake = SERVICE_BRAKE;
      } else if (speed > -maxReverseSpeed) {
        engineForce = -this.config.acceleration * this.config.mass * REVERSE_COEFF;
      }
    }

    this.pendingThrust = engineForce;
    // Wheels carry no engine impulse; their rolling animation comes from the
    // actual ground velocity (deltaRotation in cannon's updateFriction).
    this.raycastVehicle.applyEngineForce(0, 2);
    this.raycastVehicle.applyEngineForce(0, 3);

    // --- Braking ---
    // Service brake (S/↓) is front-biased for stable straight-line stops.
    // Handbrake (Space) keeps the rear-biased lock that provokes oversteer.
    const handbrakeBrake = input.handbrake ? this.config.brakeForce : 0;
    this.raycastVehicle.setBrake(Math.max(serviceBrake, handbrakeBrake * 0.6), 0); // FL
    this.raycastVehicle.setBrake(Math.max(serviceBrake, handbrakeBrake * 0.6), 1); // FR
    this.raycastVehicle.setBrake(Math.max(serviceBrake * SERVICE_BRAKE_REAR_RATIO, handbrakeBrake), 2); // RL
    this.raycastVehicle.setBrake(Math.max(serviceBrake * SERVICE_BRAKE_REAR_RATIO, handbrakeBrake), 3); // RR

    // --- Handbrake drift: cut rear tire grip ---
    // Dropping the rear frictionSlip shrinks the rear friction circle
    // (maximp = suspensionForce * dt * frictionSlip in cannon's updateFriction),
    // so the tail steps out as soon as lateral load builds — the classic
    // handbrake drift, finally using the previously unused driftFactor.
    const rearGrip = input.handbrake
      ? FRICTION_SLIP * Math.max(0.15, this.config.driftFactor)
      : FRICTION_SLIP;
    this.raycastVehicle.wheelInfos[2].frictionSlip = rearGrip;
    this.raycastVehicle.wheelInfos[3].frictionSlip = rearGrip;

    // --- Drift detection (real side-slip angle, no friction change) ---
    const lateralSpeed = this.getLocalLateralSpeed();
    const slipAngle = Math.atan2(Math.abs(lateralSpeed), Math.abs(speed));
    this.isDrifting =
      (input.handbrake && Math.abs(speed) > HANDBRAKE_DRIFT_SPEED) ||
      (Math.abs(speed) > SLIP_DRIFT_SPEED && slipAngle > SLIP_DRIFT_ANGLE);
  }

  // Apply drive thrust at the center of mass along the nose direction, scaled
  // by grounded-wheel count (landing on two wheels gives partial traction).
  // Airborne cars get no thrust, matching the raycast vehicle's behavior.
  private applyDriveThrust(engineForce: number): void {
    if (engineForce === 0) return;
    const groundedWheels = this.raycastVehicle.numWheelsOnGround;
    if (groundedWheels === 0) return;
    const scale = engineForce * (groundedWheels / 4);
    this.chassisBody.quaternion.vmult(FORWARD, this.tmpVecA);
    this.chassisBody.applyForce(this.tmpVecA.scale(scale, this.tmpVecB));
  }

  // Speed-squared downforce while grounded (keeps the car planted at high
  // speed), and a small yaw torque while airborne (straighten up for landing).
  // Runs once per physics step via preStepCallback.
  private applyAeroForces(): void {
    const groundedWheels = this.raycastVehicle.numWheelsOnGround;
    if (groundedWheels > 0) {
      const v = this.chassisBody.velocity.length();
      if (v > 1) {
        // Partial ground contact scales the effect, so landing wheels dig in
        // progressively rather than snapping the chassis flat.
        const down = DOWNFORCE_COEFF * v * v * (groundedWheels / 4);
        this.chassisBody.quaternion.vmult(UP, this.tmpVecA);
        // Skip while heavily tilted (>60°): past that the car is crashing and
        // a body-axis "down" force would push sideways and feed the roll.
        if (this.tmpVecA.y > 0.5) {
          this.chassisBody.applyForce(this.tmpVecA.scale(-down, this.tmpVecB));
        }
      }
    } else if (this.currentSteer !== 0) {
      // Air yaw authority follows the steering input (same sign convention as
      // the ground steering negation: left input -> +Y torque -> nose left).
      this.chassisBody.quaternion.vmult(UP, this.tmpVecA);
      this.chassisBody.applyTorque(this.tmpVecA.scale(-this.currentSteer * AIR_YAW_TORQUE, this.tmpVecB));
    }
  }

  // Chassis-frame lateral (X) velocity — the side-slip component used for
  // drift detection.
  private getLocalLateralSpeed(): number {
    this.tmpQuatA.copy(this.chassisBody.quaternion);
    this.tmpQuatA.conjugate(this.tmpQuatA);
    this.tmpQuatA.vmult(this.chassisBody.velocity, this.tmpVecA);
    return this.tmpVecA.x;
  }

  applyBoost(duration: number): void {
    this.boostEndTime = performance.now() / 1000 + duration;
  }

  applySpeedReduction(factor: number, duration: number): void {
    this.currentMaxSpeed = this.config.maxSpeed * factor;
    if (this.speedReductionTimer !== null) {
      clearTimeout(this.speedReductionTimer);
    }
    this.speedReductionTimer = setTimeout(() => {
      this.currentMaxSpeed = this.config.maxSpeed;
      this.speedReductionTimer = null;
    }, duration * 1000);
  }

  getSpeed(): number {
    const vel = this.chassisBody.velocity;
    // Forward is local -Z (matches mesh nose + camera). Driving forward (toward
    // -Z) returns a positive value, so W -> +speed, S -> -speed.
    const forward = new CANNON.Vec3(0, 0, -1);
    const worldQuat = this.chassisBody.quaternion;
    worldQuat.vmult(forward, forward);
    return vel.dot(forward);
  }

  getSpeedKmh(): number {
    return Math.abs(this.getSpeed()) * 3.6;
  }

  getPosition(): CANNON.Vec3 {
    return this.chassisBody.position;
  }

  getQuaternion(): CANNON.Quaternion {
    return this.chassisBody.quaternion;
  }

  // Refresh and return per-wheel chassis-local transforms for rendering.
  // updateWheelTransform() writes the WORLD transform (connection point +
  // suspensionLength along the ray, quaternion = chassis × steering × roll);
  // here it is converted into chassis-local space so VehicleMesh can apply it
  // to wheel meshes parented under the car group.
  getWheelVisuals(): readonly WheelVisual[] {
    this.tmpQuatA.copy(this.chassisBody.quaternion);
    this.tmpQuatA.conjugate(this.tmpQuatA);
    for (let i = 0; i < this.raycastVehicle.wheelInfos.length; i++) {
      this.raycastVehicle.updateWheelTransform(i);
      const wheel = this.raycastVehicle.wheelInfos[i];
      const visual = this.wheelVisuals[i];
      // Local position: connection point + ray direction * suspension length.
      wheel.directionLocal.scale(wheel.suspensionLength, this.tmpVecA);
      visual.position.copy(wheel.chassisConnectionPointLocal);
      visual.position.vadd(this.tmpVecA, visual.position);
      // Local rotation: inverse(chassis) * world.
      this.tmpQuatA.mult(wheel.worldTransform.quaternion, visual.quaternion);
    }
    return this.wheelVisuals;
  }

  getIsDrifting(): boolean {
    return this.isDrifting;
  }

  getIsBoosted(): boolean {
    return performance.now() / 1000 < this.boostEndTime;
  }

  checkFlipState(): void {
    const upLocal = new CANNON.Vec3(0, 1, 0);
    const upWorld = new CANNON.Vec3();
    this.chassisBody.quaternion.vmult(upLocal, upWorld);
    const dot = upWorld.dot(new CANNON.Vec3(0, 1, 0));
    const flipped = dot < FLIP_THRESHOLD;

    if (flipped && this.flipStartTime === null) {
      this.flipStartTime = performance.now() / 1000;
    } else if (!flipped && this.flipStartTime !== null) {
      this.flipStartTime = null;
    }
  }

  getFlipStatus(): { flipped: boolean; elapsed: number } {
    if (this.flipStartTime === null) {
      return { flipped: false, elapsed: 0 };
    }
    return { flipped: true, elapsed: performance.now() / 1000 - this.flipStartTime };
  }

  clearFlipState(): void {
    this.flipStartTime = null;
  }

  destroy(world: CANNON.World): void {
    world.removeEventListener('preStep', this.preStepCallback);
    this.raycastVehicle.removeFromWorld(world);
    world.removeBody(this.chassisBody);
    if (this.speedReductionTimer !== null) {
      clearTimeout(this.speedReductionTimer);
    }
  }
}
