import * as THREE from 'three';

export class Effects {
  private scene: THREE.Scene;
  private particles: { mesh: THREE.Mesh; velocity: THREE.Vector3; life: number }[] = [];
  private boxGeo: THREE.BoxGeometry;
  private mat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.boxGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xcccccc, transparent: true, opacity: 0.6 });
  }

  emitSmoke(position: THREE.Vector3): void {
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(this.boxGeo, this.mat.clone());
      mesh.position.copy(position);
      mesh.position.x += (Math.random() - 0.5) * 0.5;
      mesh.position.z += (Math.random() - 0.5) * 0.5;
      this.scene.add(mesh);
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 2, 2 + Math.random(), (Math.random() - 0.5) * 2
      );
      this.particles.push({ mesh, velocity: vel, life: 1.0 });
    }
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt * 1.5;
      p.mesh.position.add(p.velocity.clone().multiplyScalar(dt));
      p.mesh.scale.setScalar(1 + (1 - p.life) * 2);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = p.life * 0.6;
      if (p.life <= 0) {
        this.scene.remove(p.mesh);
        this.particles.splice(i, 1);
      }
    }
  }
}
