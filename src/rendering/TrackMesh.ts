import * as THREE from 'three';

export interface TrackData {
  name: string;
  id: string;
  difficulty: string;
  totalLaps: number;
  roadWidth: number;
  splinePoints: number[][];
  startPosition: number[];
  startRotation: number[];
  checkpoints: number[];
  itemBoxPositions: number[];
  environment: {
    groundColor: number;
    roadColor: number;
    skyTopColor: number;
    skyBottomColor: number;
    decorations: string;
  };
}

export class TrackMesh {
  readonly trackData: TrackData;
  readonly curve: THREE.CatmullRomCurve3;
  private group: THREE.Group;

  constructor(trackData: TrackData) {
    this.trackData = trackData;

    const points = trackData.splinePoints.map(
      (p) => new THREE.Vector3(p[0], p[1], p[2])
    );

    this.curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
    this.group = new THREE.Group();
  }

  build(): THREE.Group {
    this.buildRoad();
    this.buildGround();
    this.buildBarriers();
    return this.group;
  }

  getPointAt(t: number): THREE.Vector3 {
    return this.curve.getPoint(t);
  }

  getTangentAt(t: number): THREE.Vector3 {
    return this.curve.getTangent(t);
  }

  private buildRoad(): void {
    const numSamples = 200;
    const halfWidth = this.trackData.roadWidth / 2;
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3();

    const positions: number[] = [];
    const indices: number[] = [];

    // Generate vertices
    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      const point = this.curve.getPoint(t);
      const tangent = this.curve.getTangent(t);

      right.crossVectors(tangent, up).normalize();

      const leftPt = point.clone().add(right.clone().multiplyScalar(-halfWidth));
      const rightPt = point.clone().add(right.clone().multiplyScalar(halfWidth));

      positions.push(leftPt.x, leftPt.y, leftPt.z);
      positions.push(rightPt.x, rightPt.y, rightPt.z);
    }

    // Generate triangle indices
    for (let i = 0; i < numSamples; i++) {
      const base = i * 2;
      const next = (i + 1) * 2;

      indices.push(base, next, base + 1);
      indices.push(base + 1, next, next + 1);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshLambertMaterial({
      color: this.trackData.environment.roadColor,
    });

    const mesh = new THREE.Mesh(geometry, material);
    this.group.add(mesh);
  }

  private buildGround(): void {
    const geometry = new THREE.PlaneGeometry(500, 500);
    const material = new THREE.MeshLambertMaterial({
      color: this.trackData.environment.groundColor,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = -0.05;
    this.group.add(mesh);
  }

  private buildBarriers(): void {
    const numSamples = 200;
    const halfWidth = this.trackData.roadWidth / 2 + 0.5;
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3();

    const leftPoints: THREE.Vector3[] = [];
    const rightPoints: THREE.Vector3[] = [];

    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      const point = this.curve.getPoint(t);
      const tangent = this.curve.getTangent(t);

      right.crossVectors(tangent, up).normalize();

      const leftPt = point.clone().add(right.clone().multiplyScalar(-halfWidth));
      const rightPt = point.clone().add(right.clone().multiplyScalar(halfWidth));

      leftPoints.push(leftPt);
      rightPoints.push(rightPt);
    }

    const barrierMaterial = new THREE.MeshLambertMaterial({ color: 0xff0000 });

    const leftCurve = new THREE.CatmullRomCurve3(leftPoints, true, 'catmullrom', 0.5);
    const leftTubeGeo = new THREE.TubeGeometry(leftCurve, numSamples, 0.3, 8, true);
    const leftBarrier = new THREE.Mesh(leftTubeGeo, barrierMaterial);
    this.group.add(leftBarrier);

    const rightCurve = new THREE.CatmullRomCurve3(rightPoints, true, 'catmullrom', 0.5);
    const rightTubeGeo = new THREE.TubeGeometry(rightCurve, numSamples, 0.3, 8, true);
    const rightBarrier = new THREE.Mesh(rightTubeGeo, barrierMaterial);
    this.group.add(rightBarrier);
  }
}
