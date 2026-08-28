import * as CANNON from 'cannon-es';
import { Updatable } from '../game/GameLoop';

// Shared contact materials. Walls and the chassis get a dedicated low-friction
// pair (registered below): with the default 0.3 friction a wall hit "bites"
// the side of the car and trips it into a roll; at ~0 the car scrubs along
// the barrier and keeps racing.
export const WALL_MATERIAL = new CANNON.Material('wall');
export const VEHICLE_MATERIAL = new CANNON.Material('vehicle');

export class PhysicsWorld implements Updatable {
  world: CANNON.World;

  constructor() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.82, 0),
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = false;
    this.world.defaultContactMaterial.friction = 0.3;
    this.world.defaultContactMaterial.restitution = 0.1;
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(WALL_MATERIAL, VEHICLE_MATERIAL, {
        friction: 0.05,
        restitution: 0.1,
      }),
    );
  }

  addBody(body: CANNON.Body): void {
    this.world.addBody(body);
  }

  removeBody(body: CANNON.Body): void {
    this.world.removeBody(body);
  }

  update(_dt: number, _totalTime: number): void {
    // Variable timestep updates handled by fixedUpdate
  }

  fixedUpdate(dt: number): void {
    this.world.step(dt);
  }
}
