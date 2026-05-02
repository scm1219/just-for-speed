import * as CANNON from 'cannon-es';
import { Updatable } from '../game/GameLoop';

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
