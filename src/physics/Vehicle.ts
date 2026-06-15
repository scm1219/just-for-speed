import * as CANNON from 'cannon-es';
import { InputState } from '../input/InputManager';

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

const WHEEL_POSITIONS = [
  new CANNON.Vec3(-0.8, 0, 1.2),   // FL
  new CANNON.Vec3(0.8, 0, 1.2),    // FR
  new CANNON.Vec3(-0.8, 0, -1.2),  // RL
  new CANNON.Vec3(0.8, 0, -1.2),   // RR
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

  constructor(config: VehicleConfig, world: CANNON.World) {
    this.config = { ...config };
    this.currentMaxSpeed = config.maxSpeed;

    // Create chassis body
    const chassisShape = new CANNON.Box(new CANNON.Vec3(0.5, 0.25, 1));
    this.chassisBody = new CANNON.Body({
      mass: config.mass,
      shape: chassisShape,
      position: new CANNON.Vec3(0, 1.5, 0),
    });
    this.chassisBody.angularDamping = 0.5;
    world.addBody(this.chassisBody);

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

    // --- Steering ---
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

    // Apply steering to all 4 wheels
    for (let i = 0; i < 4; i++) {
      this.raycastVehicle.setSteeringValue(this.currentSteer * 0.5, i);
    }

    // --- Engine force (rear wheels: index 2, 3) ---
    // In this cannon-es config (indexForwardAxis=2, axleLocal=(-1,0,0)), a
    // POSITIVE engineForce is the only value that effectively drives the wheels
    // (negative force barely overcomes rolling friction), and it pushes the
    // chassis toward local -Z. The whole project therefore treats -Z as forward
    // (see VehicleMesh nose + Camera). W(accelerate) -> +force (drives -Z =
    // nose direction), S(reverse) -> -force. getSpeed() returns a positive
    // value when moving along -Z, so the speed guards below work as written.
    let engineForce = 0;
    if (input.forward && speed < effectiveMaxSpeed) {
      engineForce = this.config.acceleration * this.config.mass * 0.5;
      if (isBoosted) {
        engineForce *= this.config.boostMultiplier;
      }
    }
    const maxReverseSpeed = effectiveMaxSpeed * 0.3;
    if (input.backward && speed > -maxReverseSpeed) {
      engineForce = -this.config.acceleration * this.config.mass * 0.15;
    }

    this.raycastVehicle.applyEngineForce(engineForce, 2);
    this.raycastVehicle.applyEngineForce(engineForce, 3);

    // --- Braking (Space = brake all wheels) ---
    let brakeForce = 0;
    if (input.handbrake) {
      brakeForce = this.config.brakeForce;
    }
    this.raycastVehicle.setBrake(brakeForce * 0.6, 0); // FL
    this.raycastVehicle.setBrake(brakeForce * 0.6, 1); // FR
    this.raycastVehicle.setBrake(brakeForce, 2);        // RL
    this.raycastVehicle.setBrake(brakeForce, 3);        // RR

    // --- Drift detection (speed + sideways motion, no friction change) ---
    if (input.handbrake && Math.abs(speed) > 5) {
      this.isDrifting = true;
    } else {
      this.isDrifting = false;
    }
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
    this.raycastVehicle.removeFromWorld(world);
    world.removeBody(this.chassisBody);
    if (this.speedReductionTimer !== null) {
      clearTimeout(this.speedReductionTimer);
    }
  }
}
