import * as CANNON from 'cannon-es';
import { Vehicle, VehicleConfig, DEFAULT_VEHICLE_CONFIG } from '../physics/Vehicle';
import { TrackMesh } from '../rendering/TrackMesh';
import { RubberBanding, Difficulty } from './RubberBanding';

export class AIDriver {
  vehicle: Vehicle;
  private trackMesh: TrackMesh;
  private rubberBanding: RubberBanding;
  private waypointProgress: number = 0;
  private speedFactor: number = 1.0;

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
  }

  getProgress(): number {
    return this.waypointProgress;
  }
}
