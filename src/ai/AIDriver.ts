import * as CANNON from 'cannon-es';
import { Vehicle, VehicleConfig, DEFAULT_VEHICLE_CONFIG } from '../physics/Vehicle';
import { TrackMesh } from '../rendering/TrackMesh';
import { RubberBanding, Difficulty } from './RubberBanding';

// How long the AI stays flipped before auto-resetting (seconds). Shorter than the
// player's 5s: AI has no recovery skill, so let it snap back quickly to keep the
// race flowing.
const AI_FLIP_RESET_DELAY = 2;
// Throttle is always held, so "waypoint speed but zero ground speed" means the
// car wedged itself into a barrier. Snap it back onto its waypoint like a flip.
const AI_STUCK_RESET_DELAY = 1.5;

export class AIDriver {
  vehicle: Vehicle;
  private trackMesh: TrackMesh;
  private rubberBanding: RubberBanding;
  private waypointProgress: number = 0;
  private speedFactor: number = 1.0;
  private stuckTime: number = 0;

  constructor(
    world: CANNON.World,
    trackMesh: TrackMesh,
    difficulty: Difficulty,
    config?: Partial<VehicleConfig>,
  ) {
    this.trackMesh = trackMesh;
    this.rubberBanding = new RubberBanding(difficulty);
    const aiConfig = { ...DEFAULT_VEHICLE_CONFIG, ...config };
    this.vehicle = new Vehicle(aiConfig, world);

    const difficultyFactors: Record<Difficulty, number> = { easy: 0.8, normal: 1.0, hard: 1.1 };
    this.speedFactor = difficultyFactors[difficulty];
  }

  setPosition(trackT: number): void {
    const point = this.trackMesh.getPointAt(trackT);
    const tangent = this.trackMesh.getTangentAt(trackT);
    this.vehicle.chassisBody.position.set(point.x, point.y + 0.5, point.z);
    // Forward is local -Z (see Vehicle.ts), so align the chassis -Z axis with
    // the track tangent by adding PI to the +Z yaw.
    const angle = Math.atan2(tangent.x, tangent.z) + Math.PI;
    this.vehicle.chassisBody.quaternion.setFromEuler(0, angle, 0);
    // Clear motion so a reset (e.g. after a flip) doesn't carry leftover momentum.
    this.vehicle.chassisBody.velocity.set(0, 0, 0);
    this.vehicle.chassisBody.angularVelocity.set(0, 0, 0);
    this.waypointProgress = trackT;
  }

  update(playerProgress: number, dt: number): void {
    this.rubberBanding.update(playerProgress, this.waypointProgress);
    const speedMult = this.rubberBanding.getSpeedMultiplier() * this.speedFactor;

    const baseSpeed = 0.08;
    const advanceSpeed = baseSpeed * speedMult * dt;
    this.waypointProgress = (this.waypointProgress + advanceSpeed) % 1;

    const lookAheadT = (this.waypointProgress + 0.02) % 1;
    const targetPoint = this.trackMesh.getPointAt(lookAheadT);

    const currentPos = this.vehicle.getPosition();
    const dx = targetPoint.x - currentPos.x;
    const dz = targetPoint.z - currentPos.z;
    const targetAngle = Math.atan2(dx, dz);

    const q = this.vehicle.getQuaternion();
    // Yaw of the chassis +Z axis (from quaternion). Forward is -Z, so the
    // forward-pointing yaw is the +Z yaw plus PI.
    const plusZYaw = Math.atan2(
      2 * (q.w * q.y + q.x * q.z),
      1 - 2 * (q.y * q.y + q.z * q.z)
    );
    const currentAngle = plusZYaw + Math.PI;

    let angleDiff = targetAngle - currentAngle;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    const steerValue = Math.max(-1, Math.min(1, angleDiff * 2));
    const curvature = Math.abs(angleDiff);
    const turnBrake = curvature > 0.5 ? 0.6 : 1.0;

    const fakeInput = {
      forward: true, backward: false,
      left: steerValue < -0.1, right: steerValue > 0.1,
      handbrake: curvature > 1.0,
      useItem: false, pause: false, resetVehicle: false,
      steerX: steerValue, accel: turnBrake, brake: 0,
    };

    this.vehicle.updateFromInput(fakeInput, dt);

    // --- Flip auto-reset ---
    // The AI is now a real physics vehicle (it drives via input like the player),
    // so it can roll over on bad cornering. Unlike the player (5s), AI resets
    // faster so one car flipping doesn't stall the race. Vehicle.checkFlipState /
    // getFlipState / clearFlipState are reused for consistency with the player.
    // On reset, snap the body back to its own waypointProgress via setPosition
    // (the AI's authoritative progress source) so it resumes along the curve
    // instead of stuck against a wall.
    this.vehicle.checkFlipState();
    const flipStatus = this.vehicle.getFlipStatus();
    if (flipStatus.flipped && flipStatus.elapsed >= AI_FLIP_RESET_DELAY) {
      this.setPosition(this.waypointProgress);
      this.vehicle.clearFlipState();
      this.stuckTime = 0;
      return;
    }

    // --- Stuck auto-reset (wedged upright against a barrier) ---
    if (Math.abs(this.vehicle.getSpeed()) < 0.5) {
      this.stuckTime += dt;
    } else {
      this.stuckTime = 0;
    }
    if (this.stuckTime >= AI_STUCK_RESET_DELAY) {
      this.setPosition(this.waypointProgress);
      this.stuckTime = 0;
    }
  }

  getProgress(): number {
    return this.waypointProgress;
  }
}
