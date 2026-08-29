import * as THREE from 'three';
import { Vec3, Quaternion } from 'cannon-es';
import {
  mergeGeometries,
  mergeVertices,
} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WheelVisual } from '../physics/Vehicle';

/**
 * Streamlined (流线型) vehicle model built from procedural geometry.
 *
 * Design: a low wedge body (beltline ~0.7 m above the road) with a separate
 * extruded glass canopy forming the whole greenhouse (raked windshield ->
 * flat roof -> fastback rear glass). The canopy is slightly narrower than the
 * body, so its side walls read as inset side windows above the beltline.
 *
 * The four wheels are SEPARATE meshes driven by the physics raycast vehicle
 * every frame (see updateWheels): they roll with speed, steer with the front
 * wheels, and ride the live suspension length. Each wheel is an open-rim
 * design (tire ring + hub + 5 spokes merged with vertex colors), so the
 * rotation is actually visible while driving.
 *
 * Vertical alignment: the chassis body origin sits ~0.67 m above the road at
 * rest (connection height 0 + suspension rest 0.4 − equilibrium compression
 * ~0.08 + wheel radius 0.35). Every body-part Y coordinate below is authored
 * relative to the ROAD surface (0 = ground) and shifted down by
 * GROUND_TO_ORIGIN when placed, so the car sits ON the road instead of
 * hovering.
 *
 * Public surface (used by main.ts):
 *   - `new VehicleMesh(color)`
 *   - `mesh.group` (added to the scene)
 *   - `mesh.updateFromPhysics(pos, quat)` (chassis)
 *   - `mesh.updateWheels(wheelVisuals)` (per-wheel, from Vehicle.getWheelVisuals)
 *
 * NOTE: nose points toward -Z (see Vehicle.ts RaycastVehicle config). The
 * steering wheels sit at the nose (-Z) end, drive wheels at the tail (+Z).
 */
export class VehicleMesh {
  readonly group: THREE.Group;
  // One mesh per wheel, indexed like Vehicle.WHEEL_POSITIONS (0=FL, 1=FR,
  // 2=RL, 3=RR). Parented under `wheelsGroup`.
  private readonly wheelMeshes: THREE.Mesh[] = [];

  // Chassis-body-origin height above the road at suspension rest. See the
  // class doc: all part Y coordinates are authored with 0 = road surface.
  private static readonly GROUND_TO_ORIGIN = 0.67;

  // Body footprint (kept compatible with the physics chassis box 1.36 wide ×
  // 3.1 long): width 1.62, length 3.4, height 0.15..0.72 above the road.
  private static readonly BODY_WIDTH = 1.62;
  private static readonly BODY_HALF_WIDTH = VehicleMesh.BODY_WIDTH / 2;

  // Canopy footprint: narrower than the body for a tumblehome greenhouse.
  private static readonly CANOPY_WIDTH = 1.2;

  // Named parts so the debug page (debug-vehicle.html) and other tooling can
  // look up individual meshes via group.getObjectByName(...).
  public static readonly BODY_NAME = 'body';
  public static readonly SPOILER_NAME = 'spoiler';
  public static readonly CABIN_NAME = 'cabin';
  public static readonly WHEELS_NAME = 'wheels';
  public static readonly LIGHTS_NAME = 'lights';
  public static readonly TRIM_NAME = 'trim';

  constructor(color: number = 0xe94560) {
    this.group = new THREE.Group();

    // One shared car-paint material for body + spoiler so color tweaks stay
    // in sync automatically. Clearcoat gives a glossy paint highlight even
    // without an environment map (the game scene has none).
    const paintMat = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.35,
      metalness: 0.3,
      clearcoat: 1.0,
      clearcoatRoughness: 0.12,
    });

    this.buildBody(paintMat);
    this.buildSpoiler(paintMat);
    this.buildCabin();
    this.buildWheels();
    this.buildLights();
    this.buildTrim();
  }

  // -------------------------------------------------------------------------
  // Body: extruded low wedge profile with a ~0.7 m beltline. The greenhouse
  // is NOT part of the profile -- the glass canopy (buildCabin) provides it.
  // The profile is drawn in the XY plane (X = car length axis, Y = car height
  // axis) and extruded along Z (car width), then remapped to car space.
  // -------------------------------------------------------------------------
  private buildBody(paintMat: THREE.MeshPhysicalMaterial): void {
    // Side profile, road-relative heights. Nose (low front) at -X, tail +X.
    const profile = new THREE.Shape();
    const halfLen = 3.4 / 2;
    profile.moveTo(-halfLen, 0.15);            // front bumper bottom (nose)
    profile.lineTo(-halfLen + 0.1, 0.44);      // front bumper top
    profile.quadraticCurveTo(-halfLen + 0.5, 0.52, -halfLen + 0.9, 0.56); // hood
    profile.quadraticCurveTo(-halfLen + 1.35, 0.62, -halfLen + 1.8, 0.68); // cowl rise
    profile.quadraticCurveTo(-halfLen + 2.4, 0.72, -halfLen + 2.85, 0.7);  // beltline / rear haunch
    profile.quadraticCurveTo(-halfLen + 3.2, 0.66, halfLen, 0.52);         // deck -> tail
    profile.lineTo(halfLen, 0.15);             // tail bumper bottom
    profile.closePath();

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: VehicleMesh.BODY_WIDTH,
      bevelEnabled: true,
      bevelThickness: 0.08,
      bevelSize: 0.08,
      bevelSegments: 3,
      steps: 1,
      curveSegments: 16,
    };
    // Extrude along +Z by `depth`. Profile axes before remap:
    //   profile.X = length (nose at -X), profile.Y = height, extrude.Z = width.
    const bodyGeom = new THREE.ExtrudeGeometry(profile, extrudeSettings);
    this.remapExtrudedAxes(bodyGeom, VehicleMesh.BODY_HALF_WIDTH);

    // Taper the nose (front) narrower than the tail for a sportier plan view,
    // and add a subtle coke-bottle waist. Operates on the position attribute.
    this.applyTaper(bodyGeom);

    // Weld duplicated vertices so smoothed normals give a glossy curve
    // instead of per-face faceting.
    const merged = mergeVertices(bodyGeom, 1e-4);
    merged.computeVertexNormals();

    const body = new THREE.Mesh(merged, paintMat);
    body.name = VehicleMesh.BODY_NAME;
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);
  }

  // Remap ExtrudeGeometry vertices from profile space to car space.
  // Profile drawn in Shape: X=length(nose at -X/-halfLen), Y=height(road
  // relative). ExtrudeGeometry adds Z=extrude depth in [0, +depth].
  // Car space: X=width(centered on 0), Y=height(shifted down by
  // GROUND_TO_ORIGIN so 0 = chassis origin), Z=length(nose at -Z).
  private remapExtrudedAxes(geom: THREE.BufferGeometry, halfWidth: number): void {
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const px = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      px.fromBufferAttribute(pos, i);
      // (profileX=length, profileY=height, profileZ=extrudeZ) -> (carX,carY,carZ)
      // Width must map extrudeZ MIRRORED (half - z, not z - half). Mapping
      // width straight through (det -1 reflection) flips triangle winding,
      // so every face normal ends up pointing INTO the car and the shell is
      // back-face culled from outside -- the body renders as "no shell".
      const carX = halfWidth - px.z;                    // width: [0,depth] -> [+half,-half]
      const carY = px.y - VehicleMesh.GROUND_TO_ORIGIN; // road-relative -> body-local
      const carZ = px.x;                                // length (nose -X -> -Z)
      pos.setXYZ(i, carX, carY, carZ);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();
  }

  // Taper the nose narrower than the tail (sportier plan view) with a subtle
  // mid-body waist. t=0 is the nose (-Z), t=1 the tail (+Z).
  private applyTaper(geom: THREE.BufferGeometry): void {
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const halfLen = 3.4 / 2;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const t = THREE.MathUtils.clamp((v.z + halfLen) / (2 * halfLen), 0, 1);
      // Nose (t~0): ~0.88 width -- wide enough that the body side reaches the
      // wheels' inner edge (wheels sit at x=±0.8). Tail (t~1): ~0.96. A slight
      // mid-car dip keeps the coke-bottle waist.
      const widthScale = 0.88 + 0.08 * t + 0.04 * Math.sin(t * Math.PI);
      v.x *= widthScale;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
  }

  // Spoiler (rear wing) + supports, merged into one geometry on the shared
  // paint material. Heights are road-relative: wing 0.98, supports span the
  // deck (~0.62) up to the wing.
  private buildSpoiler(paintMat: THREE.MeshPhysicalMaterial): void {
    const wingY = 0.98 - VehicleMesh.GROUND_TO_ORIGIN;
    const supportY = 0.79 - VehicleMesh.GROUND_TO_ORIGIN;
    const wingGeom = new THREE.BoxGeometry(1.4, 0.05, 0.32);
    wingGeom.translate(0, wingY, 1.55);

    const supportGeom = new THREE.BoxGeometry(0.06, 0.36, 0.06);
    const leftSupport = supportGeom.clone();
    leftSupport.translate(-0.55, supportY, 1.52);
    const rightSupport = supportGeom.clone();
    rightSupport.translate(0.55, supportY, 1.52);

    const spoilerGeom = mergeGeometries([wingGeom, leftSupport, rightSupport], false);
    if (!spoilerGeom) return;

    const spoiler = new THREE.Mesh(spoilerGeom, paintMat);
    spoiler.name = VehicleMesh.SPOILER_NAME;
    spoiler.castShadow = true;
    this.group.add(spoiler);
  }

  // -------------------------------------------------------------------------
  // Canopy: extruded glass greenhouse -- the whole cockpit volume. Profile is
  // drawn in the (length, height) plane like the body: raked windshield up to
  // a low roof crown, then a fastback rear glass down to the rear deck. Its
  // bottom edge is buried in the body so the joint is hidden. Kept as its own
  // mesh because transparent objects should not be merged into opaque
  // geometry.
  // -------------------------------------------------------------------------
  private buildCabin(): void {
    const profile = new THREE.Shape();
    profile.moveTo(-0.75, 0.56);               // windshield base (buried in cowl)
    profile.quadraticCurveTo(-0.38, 0.94, 0.0, 1.0);  // raked windshield
    profile.quadraticCurveTo(0.28, 1.04, 0.5, 1.0);   // roof crown
    profile.quadraticCurveTo(0.8, 0.9, 1.02, 0.64);   // fastback rear glass
    profile.lineTo(1.02, 0.56);                // rear deck seam (buried)
    profile.closePath();

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: VehicleMesh.CANOPY_WIDTH,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.05,
      bevelSegments: 2,
      steps: 1,
      curveSegments: 14,
    };
    const canopyGeom = new THREE.ExtrudeGeometry(profile, extrudeSettings);
    this.remapExtrudedAxes(canopyGeom, VehicleMesh.CANOPY_WIDTH / 2);

    const merged = mergeVertices(canopyGeom, 1e-4);
    merged.computeVertexNormals();

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x0c1622,
      roughness: 0.08,
      metalness: 0.0,
      transparent: true,
      opacity: 0.55,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
    });
    const canopy = new THREE.Mesh(merged, glassMat);
    canopy.name = VehicleMesh.CABIN_NAME;
    canopy.castShadow = true;
    this.group.add(canopy);
  }

  // -------------------------------------------------------------------------
  // Wheels: four SEPARATE meshes (open-rim design merged with vertex colors
  // = one draw call per wheel) under a `wheels` group. Torus tire ring +
  // center hub + 5 wide spokes, sized so the spokes are actually VISIBLE in
  // the rim opening (torus inner hole 0.17 > hub 0.06): the rolling rotation
  // shows while driving. Geometry is centered on the wheel axle so
  // updateWheels() can place them from the physics raycast vehicle.
  // -------------------------------------------------------------------------
  private buildWheels(): void {
    // Tire: torus (outer radius 0.35 ≈ physics WHEEL_RADIUS), axis Z by
    // default -> rotate so the axis runs along X (the wheel spans the car's
    // width), matching cannon's axleLocal=(-1,0,0) wheel frame.
    const tireGeom = new THREE.TorusGeometry(0.27, 0.08, 10, 20);
    tireGeom.rotateY(Math.PI / 2);

    const hubGeom = new THREE.CylinderGeometry(0.08, 0.08, 0.14, 12);
    hubGeom.rotateZ(Math.PI / 2);

    // Five THIN spokes crossing from the hub out to the tire ring, rotated
    // around the axle (X). Thin (0.06) is deliberate: wide spokes overlap
    // near the hub and read as a solid disk instead of a 5-spoke rim.
    const spokeGeoms: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const spoke = new THREE.BoxGeometry(0.08, 0.4, 0.06);
      spoke.rotateX((i * Math.PI) / 5);
      spokeGeoms.push(spoke);
    }

    const wheelsGroup = new THREE.Group();
    wheelsGroup.name = VehicleMesh.WHEELS_NAME;

    // Parts with their vertex colors (merged into one geometry per wheel).
    // Light, low-metalness rim colors: the scene has no environment map, so
    // high metalness renders near-black.
    const parts: Array<{ geom: THREE.BufferGeometry; color: THREE.Color }> = [
      { geom: tireGeom, color: new THREE.Color(0x151515) },
      { geom: hubGeom, color: new THREE.Color(0xe0e0e0) },
      ...spokeGeoms.map((geom) => ({ geom, color: new THREE.Color(0xd0d0d0) })),
    ];
    const wheelGeom = mergeGeometries(
      parts.map((p) => p.geom),
      false,
    );
    if (!wheelGeom) return;

    const count = wheelGeom.attributes.position.count;
    const colors = new Float32Array(count * 3);
    let offset = 0;
    for (const part of parts) {
      const partCount = part.geom.attributes.position.count;
      for (let j = 0; j < partCount; j++) {
        colors[(offset + j) * 3 + 0] = part.color.r;
        colors[(offset + j) * 3 + 1] = part.color.g;
        colors[(offset + j) * 3 + 2] = part.color.b;
      }
      offset += partCount;
    }
    wheelGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const wheelMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.5,
      metalness: 0.15,
    });

    for (let i = 0; i < 4; i++) {
      const wheel = new THREE.Mesh(wheelGeom, wheelMat);
      wheel.castShadow = true;
      wheelsGroup.add(wheel);
      this.wheelMeshes.push(wheel);
    }

    this.group.add(wheelsGroup);
  }

  // -------------------------------------------------------------------------
  // Lights: emissive headlights (nose) + taillights (tail), grouped under
  // 'lights' so the debug page can toggle them as one part.
  // -------------------------------------------------------------------------
  private buildLights(): void {
    const lightsGroup = new THREE.Group();
    lightsGroup.name = VehicleMesh.LIGHTS_NAME;

    // Body caps sit at |z| = 1.7 + 0.08 bevel; put the lamps just proud of
    // them so they are visible from the front/rear.
    const headlightGeom = new THREE.BoxGeometry(0.34, 0.12, 0.06);
    const headlightMat = new THREE.MeshStandardMaterial({
      color: 0xfff8dd,
      emissive: 0xfff2b0,
      emissiveIntensity: 0.7,
      roughness: 0.3,
    });
    for (const x of [-0.45, 0.45]) {
      const lamp = new THREE.Mesh(headlightGeom, headlightMat);
      lamp.position.set(x, 0.3 - VehicleMesh.GROUND_TO_ORIGIN, -1.8);
      lightsGroup.add(lamp);
    }

    const taillightGeom = new THREE.BoxGeometry(0.4, 0.1, 0.06);
    const taillightMat = new THREE.MeshStandardMaterial({
      color: 0x550000,
      emissive: 0xff2020,
      emissiveIntensity: 1.0,
      roughness: 0.3,
    });
    for (const x of [-0.45, 0.45]) {
      const lamp = new THREE.Mesh(taillightGeom, taillightMat);
      lamp.position.set(x, 0.38 - VehicleMesh.GROUND_TO_ORIGIN, 1.8);
      lightsGroup.add(lamp);
    }

    this.group.add(lightsGroup);
  }

  // -------------------------------------------------------------------------
  // Trim: dark details -- front grille + twin exhaust pipes, merged into one
  // mesh on a matte dark material.
  // -------------------------------------------------------------------------
  private buildTrim(): void {
    const grilleGeom = new THREE.BoxGeometry(0.9, 0.1, 0.06);
    grilleGeom.translate(0, 0.24 - VehicleMesh.GROUND_TO_ORIGIN, -1.8);

    const exhaustGeom = new THREE.CylinderGeometry(0.05, 0.05, 0.12, 10);
    exhaustGeom.rotateX(Math.PI / 2); // axis along Z
    const leftPipe = exhaustGeom.clone();
    leftPipe.translate(-0.28, 0.24 - VehicleMesh.GROUND_TO_ORIGIN, 1.78);
    const rightPipe = exhaustGeom.clone();
    rightPipe.translate(0.28, 0.24 - VehicleMesh.GROUND_TO_ORIGIN, 1.78);

    const trimGeom = mergeGeometries([grilleGeom, leftPipe, rightPipe], false);
    if (!trimGeom) return;

    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a1a,
      roughness: 0.6,
      metalness: 0.4,
    });
    const trim = new THREE.Mesh(trimGeom, trimMat);
    trim.name = VehicleMesh.TRIM_NAME;
    this.group.add(trim);
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

  // Sync the four wheel meshes with the physics raycast vehicle. `visuals`
  // comes from Vehicle.getWheelVisuals() (chassis-local transforms that carry
  // the live suspension length, steering angle and rolling angle), so the
  // wheels roll with speed, turn when steering and ride the suspension.
  updateWheels(visuals: readonly WheelVisual[]): void {
    for (let i = 0; i < this.wheelMeshes.length && i < visuals.length; i++) {
      const mesh = this.wheelMeshes[i];
      const v = visuals[i];
      mesh.position.set(v.position.x, v.position.y, v.position.z);
      mesh.quaternion.set(v.quaternion.x, v.quaternion.y, v.quaternion.z, v.quaternion.w);
    }
  }
}
