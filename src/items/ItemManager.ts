import * as THREE from 'three';
import { TrackMesh } from '../rendering/TrackMesh';
import { ItemType, rollItem } from './ItemEffects';

export class ItemManager {
  private itemBoxes: { mesh: THREE.Mesh; tValue: number; active: boolean }[] = [];
  private respawnTimers: Map<number, number> = new Map();
  private readonly respawnDelay: number = 5;

  constructor(trackMesh: TrackMesh, tValues: number[]) {
    const boxGeo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    const boxMat = new THREE.MeshLambertMaterial({ color: 0xffd700, flatShading: true });

    for (let i = 0; i < tValues.length; i++) {
      const point = trackMesh.getPointAt(tValues[i]);
      const mesh = new THREE.Mesh(boxGeo.clone(), boxMat.clone());
      mesh.position.set(point.x, 1.5, point.z);
      mesh.castShadow = true;
      this.itemBoxes.push({ mesh, tValue: tValues[i], active: true });
    }
  }

  getMeshes(): THREE.Mesh[] {
    return this.itemBoxes.map(b => b.mesh);
  }

  update(currentTime: number, playerPos: { x: number; y: number; z: number }, heldItem: ItemType | null): ItemType | null {
    let pickedUp: ItemType | null = null;

    for (const [idx, respawnTime] of this.respawnTimers) {
      if (currentTime >= respawnTime) {
        this.itemBoxes[idx].active = true;
        this.itemBoxes[idx].mesh.visible = true;
        this.respawnTimers.delete(idx);
      }
    }

    for (const box of this.itemBoxes) {
      if (box.active) {
        box.mesh.rotation.y += 0.02;
        box.mesh.position.y = 1.5 + Math.sin(currentTime * 3) * 0.2;
      }
    }

    if (heldItem === null) {
      for (let i = 0; i < this.itemBoxes.length; i++) {
        const box = this.itemBoxes[i];
        if (!box.active) continue;
        const dx = playerPos.x - box.mesh.position.x;
        const dz = playerPos.z - box.mesh.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 3) {
          box.active = false;
          box.mesh.visible = false;
          this.respawnTimers.set(i, currentTime + this.respawnDelay);
          pickedUp = rollItem();
          break;
        }
      }
    }

    return pickedUp;
  }
}
