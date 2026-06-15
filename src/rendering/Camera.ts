import * as THREE from 'three';
import { Vec3, Quaternion } from 'cannon-es';

// Third-person chase camera
// The car drives toward local -Z (see Vehicle.ts), so forward is -Z. The
// camera sits behind the car (+Z) and looks ahead toward -Z.
const OFFSET = new THREE.Vector3(0, 4, 10);
const LOOK_AHEAD_DISTANCE = 15;
const SMOOTH_FACTOR = 8;

export class Camera {
  private camera: THREE.PerspectiveCamera;
  private currentPosition = new THREE.Vector3();
  private currentLookAt = new THREE.Vector3();
  private firstFrame = true;
  private readonly forwardDir = new THREE.Vector3();
  private readonly targetPosition = new THREE.Vector3();
  private readonly targetLookAt = new THREE.Vector3();
  private readonly tmpQuaternion = new THREE.Quaternion();

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
  }

  update(chassisPosition: Vec3, chassisQuaternion: Quaternion, dt: number): void {
    this.tmpQuaternion.set(
      chassisQuaternion.x,
      chassisQuaternion.y,
      chassisQuaternion.z,
      chassisQuaternion.w,
    );

    // Forward direction (cannon drives -Z in this project)
    this.forwardDir.set(0, 0, -1).applyQuaternion(this.tmpQuaternion);

    // Camera behind and above the car
    const offset = OFFSET.clone().applyQuaternion(this.tmpQuaternion);
    this.targetPosition.set(
      chassisPosition.x + offset.x,
      chassisPosition.y + offset.y,
      chassisPosition.z + offset.z,
    );

    // Look ahead of the car
    this.targetLookAt.set(
      chassisPosition.x + this.forwardDir.x * LOOK_AHEAD_DISTANCE,
      chassisPosition.y + this.forwardDir.y * LOOK_AHEAD_DISTANCE,
      chassisPosition.z + this.forwardDir.z * LOOK_AHEAD_DISTANCE,
    );

    if (this.firstFrame) {
      this.currentPosition.copy(this.targetPosition);
      this.currentLookAt.copy(this.targetLookAt);
      this.firstFrame = false;
    } else {
      const alpha = 1 - Math.exp(-SMOOTH_FACTOR * dt);
      this.currentPosition.lerp(this.targetPosition, alpha);
      this.currentLookAt.lerp(this.targetLookAt, alpha);
    }

    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(this.currentLookAt);
  }
}
