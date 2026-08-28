import * as CANNON from 'cannon-es';
import { TrackMesh } from '../rendering/TrackMesh';
import { WALL_MATERIAL } from './PhysicsWorld';

export class TrackCollider {
  build(trackMesh: TrackMesh, world: CANNON.World): void {
    // Global ground plane (prevents vehicles from falling forever)
    const groundBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
      position: new CANNON.Vec3(0, -0.3, 0),
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(groundBody);

    const points = trackMesh.curve.getPoints(200);
    const roadHalfWidth = trackMesh.trackData.roadWidth / 2;
    const barrierOffset = roadHalfWidth + 0.5;

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      const nextPoint = points[(i + 1) % points.length];
      const dist = point.distanceTo(nextPoint);

      const tangent = trackMesh.curve.getTangent(i / points.length);
      const angle = Math.atan2(tangent.x, tangent.z);

      // Road surface collider (fixed: use point.y instead of hardcoded -0.05)
      const roadBody = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(roadHalfWidth + 1.5, 0.1, dist / 2 + 0.5)),
        position: new CANNON.Vec3(point.x, point.y - 0.05, point.z),
        quaternion: new CANNON.Quaternion().setFromEuler(0, angle, 0),
      });
      world.addBody(roadBody);

      // Perpendicular direction (right side, in XZ plane)
      const rx = -tangent.z;
      const rz = tangent.x;
      const rLen = Math.sqrt(rx * rx + rz * rz);
      const rnx = rLen > 0.001 ? rx / rLen : 0;
      const rnz = rLen > 0.001 ? rz / rLen : 1;

      const wallShape = new CANNON.Box(new CANNON.Vec3(0.3, 1.0, dist / 2 + 0.5));
      const wallQuat = new CANNON.Quaternion().setFromEuler(0, angle, 0);

      // Left barrier wall (low-friction vs chassis so hits slide, not roll)
      const leftWall = new CANNON.Body({
        mass: 0,
        shape: wallShape,
        material: WALL_MATERIAL,
        position: new CANNON.Vec3(
          point.x + rnx * (-barrierOffset),
          point.y + 1.0,
          point.z + rnz * (-barrierOffset),
        ),
        quaternion: wallQuat,
      });
      world.addBody(leftWall);

      // Right barrier wall
      const rightWall = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(0.3, 1.0, dist / 2 + 0.5)),
        material: WALL_MATERIAL,
        position: new CANNON.Vec3(
          point.x + rnx * barrierOffset,
          point.y + 1.0,
          point.z + rnz * barrierOffset,
        ),
        quaternion: wallQuat,
      });
      world.addBody(rightWall);
    }
  }
}
