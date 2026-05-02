export enum ItemType {
  BOOST = 'boost',
  BOMB = 'bomb',
  SHIELD = 'shield',
  LIGHTNING = 'lightning',
}

export interface ItemDrop {
  type: ItemType;
  weight: number;
}

export const ITEM_TABLE: ItemDrop[] = [
  { type: ItemType.BOOST, weight: 40 },
  { type: ItemType.BOMB, weight: 30 },
  { type: ItemType.SHIELD, weight: 20 },
  { type: ItemType.LIGHTNING, weight: 10 },
];

export function rollItem(): ItemType {
  const totalWeight = ITEM_TABLE.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const item of ITEM_TABLE) {
    roll -= item.weight;
    if (roll <= 0) return item.type;
  }
  return ItemType.BOOST;
}

import * as CANNON from 'cannon-es';
import { Vehicle } from '../physics/Vehicle';

export function applyItemEffect(
  itemType: ItemType,
  self: Vehicle,
  targets: Vehicle[]
): { message: string; affectedTargets: Vehicle[] } {
  switch (itemType) {
    case ItemType.BOOST:
      self.applyBoost(3);
      return { message: 'BOOST!', affectedTargets: [] };

    case ItemType.BOMB: {
      const target = findTargetAhead(self, targets);
      if (target) {
        target.applySpeedReduction(0.5, 2);
        return { message: 'BOMB HIT!', affectedTargets: [target] };
      }
      return { message: 'BOMB MISS!', affectedTargets: [] };
    }

    case ItemType.SHIELD:
      return { message: 'SHIELD ON!', affectedTargets: [] };

    case ItemType.LIGHTNING: {
      const ahead = targets.filter(t => isAhead(self, t));
      if (ahead.length > 0) {
        const target = ahead[Math.floor(Math.random() * ahead.length)];
        applySpinEffect(target, 1.5);
        return { message: 'LIGHTNING!', affectedTargets: [target] };
      }
      return { message: 'LIGHTNING MISS!', affectedTargets: [] };
    }

    default:
      return { message: '', affectedTargets: [] };
  }
}

function findTargetAhead(self: Vehicle, targets: Vehicle[]): Vehicle | null {
  let closest: Vehicle | null = null;
  let minDist = Infinity;
  for (const target of targets) {
    if (!isAhead(self, target)) continue;
    const dx = target.getPosition().x - self.getPosition().x;
    const dz = target.getPosition().z - self.getPosition().z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < minDist) {
      minDist = dist;
      closest = target;
    }
  }
  return closest;
}

function isAhead(self: Vehicle, target: Vehicle): boolean {
  const selfPos = self.getPosition();
  const targetPos = target.getPosition();
  const forward = new CANNON.Vec3(0, 0, 1);
  self.chassisBody.quaternion.vmult(forward, forward);
  const toTarget = new CANNON.Vec3(targetPos.x - selfPos.x, 0, targetPos.z - selfPos.z);
  return forward.dot(toTarget) > 0;
}

function applySpinEffect(vehicle: Vehicle, duration: number): void {
  const body = vehicle.chassisBody;
  body.angularVelocity.set(0, 5, 0);
  setTimeout(() => {
    body.angularVelocity.set(0, 0, 0);
  }, duration * 1000);
}
