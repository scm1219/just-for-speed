import * as THREE from 'three';
import { Vec3, Quaternion } from 'cannon-es';

export class VehicleMesh {
  readonly group: THREE.Group;
  private readonly wheels: THREE.Mesh[] = [];
  private readonly wheelLocalPositions: THREE.Vector3[] = [
    new THREE.Vector3(-0.8, 0, 1.2),   // FL
    new THREE.Vector3(0.8, 0, 1.2),    // FR
    new THREE.Vector3(-0.8, 0, -1.2),  // RL
    new THREE.Vector3(0.8, 0, -1.2),   // RR
  ];

  constructor(color: number = 0xe94560) {
    this.group = new THREE.Group();

    // --- Body ---
    const bodyGeom = new THREE.BoxGeometry(1.6, 0.6, 3.5);
    const bodyMat = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
    });
    const body = new THREE.Mesh(bodyGeom, bodyMat);
    body.position.y = 0.3;
    body.castShadow = true;
    this.group.add(body);

    // --- Cabin ---
    const cabinGeom = new THREE.BoxGeometry(1.2, 0.5, 1.5);
    const cabinMat = new THREE.MeshStandardMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.4,
      flatShading: true,
    });
    const cabin = new THREE.Mesh(cabinGeom, cabinMat);
    cabin.position.set(0, 0.75, 0.2);
    cabin.castShadow = true;
    this.group.add(cabin);

    // --- Wheels ---
    const wheelGeom = new THREE.CylinderGeometry(0.35, 0.35, 0.2, 8);
    const wheelMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      flatShading: true,
    });

    for (const pos of this.wheelLocalPositions) {
      const wheel = new THREE.Mesh(wheelGeom, wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.copy(pos);
      wheel.castShadow = true;
      this.group.add(wheel);
      this.wheels.push(wheel);
    }

    // --- Spoiler ---
    const spoilerGeom = new THREE.BoxGeometry(1.4, 0.05, 0.3);
    const spoilerMat = new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
    });
    const spoiler = new THREE.Mesh(spoilerGeom, spoilerMat);
    spoiler.position.set(0, 0.9, -1.6);
    this.group.add(spoiler);

    // --- Spoiler supports ---
    const supportGeom = new THREE.BoxGeometry(0.05, 0.3, 0.05);
    const supportMat = new THREE.MeshStandardMaterial({
      color: 0x444444,
      flatShading: true,
    });

    const leftSupport = new THREE.Mesh(supportGeom, supportMat);
    leftSupport.position.set(-0.5, 0.75, -1.6);
    this.group.add(leftSupport);

    const rightSupport = new THREE.Mesh(supportGeom, supportMat);
    rightSupport.position.set(0.5, 0.75, -1.6);
    this.group.add(rightSupport);
  }

  updateFromPhysics(position: Vec3, quaternion: Quaternion): void {
    this.group.position.set(position.x, position.y, position.z);
    this.group.quaternion.set(
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w,
    );
  }
}
