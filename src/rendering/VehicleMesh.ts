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
 * The body is an extruded wedge profile with smoothed normals for a glossy
 * car-paint look. The four wheels are SEPARATE meshes driven by the physics
 * raycast vehicle every frame (see updateWheels): they roll with speed, steer
 * with the front wheels, and ride the live suspension length — the old
 * single merged static wheel mesh could not do any of that.
 *
 * Vertical alignment: the chassis body origin sits ~0.67 m above the road at
 * rest (connection height 0 + suspension rest 0.4 − equilibrium compression
 * ~0.08 + wheel radius 0.35). Every body-part Y coordinate below is authored
 * relative to the ROAD surface (0 = ground) and shifted down by
 * GROUND_TO_ORIGIN when placed, so the car sits ON the road instead of
 * hovering (the previous mesh drew the tires a full body-height too high).
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
  // 3.1 long): width 1.5, length 3.4, height 0.15..1.0 above the road.
  private static readonly BODY_WIDTH = 1.5;
  private static readonly BODY_HALF_WIDTH = VehicleMesh.BODY_WIDTH / 2;

  // Named parts so the debug page (debug-vehicle.html) and other tooling can
  // look up individual meshes via group.getObjectByName(...).
  public static readonly BODY_NAME = 'body';
  public static readonly SPOILER_NAME = 'spoiler';
  public static readonly CABIN_NAME = 'cabin';
  public static readonly WHEELS_NAME = 'wheels';
  public static readonly LIGHTS_NAME = 'lights';

  constructor(color: number = 0xe94560) {
    this.group = new THREE.Group();

    this.buildBody(color);
    this.buildCabin();
    this.buildWheels();
    this.buildLights();
  }

  // -------------------------------------------------------------------------
  // Body: extruded wedge profile, smoothed normals for a streamlined look.
  // The profile is drawn in the XY plane (X = car height axis mapped later,
  // Y = car length axis) and extruded along Z, then reoriented so length runs
  // along the car's Z axis and height along Y.
  // -------------------------------------------------------------------------
  private buildBody(color: number): void {
    // Side profile in the XY plane, drawn with smooth curves so the extruded
    // body has a continuous flowing surface (not flat panels).
    //   X -> height (will become car Y after rotation)
    //   Y -> length (will become car -Z nose / +Z tail after rotation)
    // Nose (low front) is at -Y, tail at +Y.
    const profile = new THREE.Shape();
    const length = 3.4;
    const halfLen = length / 2;
    profile.moveTo(-halfLen, 0.15);            // front bumper bottom (nose)
    profile.lineTo(-halfLen + 0.15, 0.45);     // front bumper top
    profile.quadraticCurveTo(-halfLen + 0.5, 0.48, -halfLen + 0.95, 0.55); // hood (gentle rise)
    profile.quadraticCurveTo(-halfLen + 1.3, 0.62, -halfLen + 1.6, 0.88);  // windshield base -> raked climb
    profile.quadraticCurveTo(-halfLen + 1.9, 1.0, -halfLen + 2.2, 1.0);    // roof front
    profile.quadraticCurveTo(-halfLen + 2.6, 1.0, -halfLen + 2.85, 0.85);  // roof -> rear window start
    profile.quadraticCurveTo(-halfLen + 3.1, 0.65, -halfLen + 3.25, 0.5);  // rear window / trunk slope
    profile.quadraticCurveTo(halfLen - 0.05, 0.46, halfLen, 0.42);         // tail bumper top
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
    // Extrude along +Z by `depth`. Profile axes before reorientation:
    //   profile.X = height, profile.Y = length (nose at -Y), extrude.Z = width.
    // We need car axes: X=width, Y=height, Z=length (nose at -Z). Remap each
    // vertex explicitly -- a single rotateX was mapping width onto Y (car
    // ended up on its side) and height onto X, which is the bug being fixed.
    const bodyGeom = new THREE.ExtrudeGeometry(profile, extrudeSettings);
    this.remapBodyAxes(bodyGeom);

    // Taper the nose (front) narrower than the tail for a sportier plan view,
    // and add a subtle coke-bottle waist. Operates on the position attribute.
    this.applyTaper(bodyGeom);

    // Weld duplicated vertices so smoothed normals give a glossy curve
    // instead of per-face faceting.
    const merged = mergeVertices(bodyGeom, 1e-4);
    merged.computeVertexNormals();

    const bodyMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.35,
      metalness: 0.6,
    });
    const body = new THREE.Mesh(merged, bodyMat);
    body.name = VehicleMesh.BODY_NAME;
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);

    this.buildSpoiler(color);
  }

  // Remap ExtrudeGeometry vertices from profile space to car space.
  // Profile drawn in Shape: X=length(nose at -X/-halfLen), Y=height(0.15..1.0
  // above the road). ExtrudeGeometry adds Z=extrude depth in [0, +depth].
  // Car space: X=width(centered on 0), Y=height(shifted down by
  // GROUND_TO_ORIGIN so 0 = chassis origin), Z=length(nose at -Z).
  private remapBodyAxes(geom: THREE.BufferGeometry): void {
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const px = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      px.fromBufferAttribute(pos, i);
      // (profileX=length, profileY=height, profileZ=extrudeZ) -> (carX,carY,carZ)
      const carX = px.z - VehicleMesh.BODY_HALF_WIDTH; // width: [0,depth] -> [-half,+half]
      const carY = px.y - VehicleMesh.GROUND_TO_ORIGIN; // road-relative -> body-local
      const carZ = px.x;                               // length (nose -X -> -Z)
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
      // Nose (t~0): ~0.80 width. Tail (t~1): ~0.96 width. Slight dip mid-car.
      const widthScale = 0.80 + 0.16 * t + 0.04 * Math.sin(t * Math.PI);
      v.x *= widthScale;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
  }

  // Spoiler (rear wing) + supports, merged into one geometry, one material.
  // Wing/support Y values are road-relative (authored heights 1.05 / 0.88).
  private buildSpoiler(color: number): void {
    const wingY = 1.05 - VehicleMesh.GROUND_TO_ORIGIN;
    const supportY = 0.88 - VehicleMesh.GROUND_TO_ORIGIN;
    const wingGeom = new THREE.BoxGeometry(1.4, 0.05, 0.3);
    wingGeom.translate(0, wingY, 1.55);

    const supportGeom = new THREE.BoxGeometry(0.06, 0.3, 0.06);
    const leftSupport = supportGeom.clone();
    leftSupport.translate(-0.55, supportY, 1.55);
    const rightSupport = supportGeom.clone();
    rightSupport.translate(0.55, supportY, 1.55);

    const spoilerGeom = mergeGeometries([wingGeom, leftSupport, rightSupport], false);
    if (!spoilerGeom) return;

    const spoilerMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0.6,
    });
    const spoiler = new THREE.Mesh(spoilerGeom, spoilerMat);
    spoiler.name = VehicleMesh.SPOILER_NAME;
    spoiler.castShadow = true;
    this.group.add(spoiler);
  }

  // -------------------------------------------------------------------------
  // Cabin: translucent glass canopy sitting on top of the body.
  // Kept as its own mesh because transparent objects should not be merged
  // into opaque geometry.
  // -------------------------------------------------------------------------
  private buildCabin(): void {
    const cabinGeom = new THREE.BoxGeometry(1.1, 0.42, 1.5);
    // Taper the top into a shallow trapezoid for a greenhouse look.
    this.taperTop(cabinGeom, 0.78);
    const cabinMat = new THREE.MeshStandardMaterial({
      color: 0x223344,
      transparent: true,
      opacity: 0.45,
      roughness: 0.1,
      metalness: 0.3,
    });
    const cabin = new THREE.Mesh(cabinGeom, cabinMat);
    cabin.name = VehicleMesh.CABIN_NAME;
    cabin.position.set(0, 0.98 - VehicleMesh.GROUND_TO_ORIGIN, -0.1); // toward nose (-Z)
    cabin.castShadow = true;
    this.group.add(cabin);
  }

  // Narrow the top face of a box geometry by the given factor (centered).
  private taperTop(geom: THREE.BufferGeometry, topFactor: number): void {
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    // BoxGeometry(1.1,0.42,1.5) has y in [-0.21, 0.21]; treat y>0 as "top".
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (v.y > maxY) maxY = v.y;
    }
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      if (Math.abs(v.y - maxY) < 1e-4) {
        v.x *= topFactor;
        v.z *= topFactor;
        pos.setXYZ(i, v.x, v.y, v.z);
      }
    }
    pos.needsUpdate = true;
  }

  // -------------------------------------------------------------------------
  // Wheels: four SEPARATE meshes (one per wheel, tire + hub merged with
  // vertex colors = one draw call per wheel) under a `wheels` group. The
  // geometry of each wheel is centered on the wheel axle so updateWheels()
  // can place them from the physics raycast vehicle every frame: rolling,
  // steering and suspension travel are all driven by the simulation.
  // -------------------------------------------------------------------------
  private buildWheels(): void {
    const tireGeom = new THREE.CylinderGeometry(0.35, 0.35, 0.25, 20);
    const hubGeom = new THREE.CylinderGeometry(0.2, 0.2, 0.27, 16);

    // Cylinder axis is Y by default; rotate so the axis runs along X (the
    // wheel spans the car's width), matching cannon's axleLocal=(-1,0,0) wheel
    // frame used by WheelInfo.worldTransform.
    tireGeom.rotateZ(Math.PI / 2);
    hubGeom.rotateZ(Math.PI / 2);

    const wheelsGroup = new THREE.Group();
    wheelsGroup.name = VehicleMesh.WHEELS_NAME;

    for (let i = 0; i < 4; i++) {
      const parts = [tireGeom, hubGeom];
      const wheelGeom = mergeGeometries(parts, false);
      if (!wheelGeom) continue;

      // Vertex colors: tire dark rubber, hub metallic silver.
      const count = wheelGeom.attributes.position.count;
      const colors = new Float32Array(count * 3);
      const tireColor = new THREE.Color(0x111111);
      const hubColor = new THREE.Color(0xcccccc);
      let offset = 0;
      for (let p = 0; p < parts.length; p++) {
        const partCount = parts[p].attributes.position.count;
        const c = p % 2 === 0 ? tireColor : hubColor;
        for (let j = 0; j < partCount; j++) {
          colors[(offset + j) * 3 + 0] = c.r;
          colors[(offset + j) * 3 + 1] = c.g;
          colors[(offset + j) * 3 + 2] = c.b;
        }
        offset += partCount;
      }
      wheelGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const wheelMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        metalness: 0.0,
      });
      const wheel = new THREE.Mesh(wheelGeom, wheelMat);
      wheel.castShadow = true;
      wheelsGroup.add(wheel);
      this.wheelMeshes.push(wheel);
    }

    this.group.add(wheelsGroup);
  }

  // -------------------------------------------------------------------------
  // Lights: headlights (nose) + taillights (tail), merged into one mesh.
  // -------------------------------------------------------------------------
  private buildLights(): void {
    const headY = 0.5 - VehicleMesh.GROUND_TO_ORIGIN;
    const tailY = 0.55 - VehicleMesh.GROUND_TO_ORIGIN;
    const headlightGeom = new THREE.BoxGeometry(0.22, 0.12, 0.05);
    const leftHead = headlightGeom.clone();
    leftHead.translate(-0.45, headY, -1.66);
    const rightHead = headlightGeom.clone();
    rightHead.translate(0.45, headY, -1.66);

    const taillightGeom = new THREE.BoxGeometry(0.3, 0.1, 0.05);
    const leftTail = taillightGeom.clone();
    leftTail.translate(-0.45, tailY, 1.66);
    const rightTail = taillightGeom.clone();
    rightTail.translate(0.45, tailY, 1.66);

    const parts = [leftHead, rightHead, leftTail, rightTail];
    const lightsGeom = mergeGeometries(parts, false);
    if (!lightsGeom) return;

    // Vertex colors: first half (headlights) warm white, second half red.
    const count = lightsGeom.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const warm = new THREE.Color(0xfff2cc);
    const red = new THREE.Color(0xff2222);
    let offset = 0;
    for (let p = 0; p < parts.length; p++) {
      const partCount = parts[p].attributes.position.count;
      const c = p < 2 ? warm : red;
      for (let i = 0; i < partCount; i++) {
        colors[(offset + i) * 3 + 0] = c.r;
        colors[(offset + i) * 3 + 1] = c.g;
        colors[(offset + i) * 3 + 2] = c.b;
      }
      offset += partCount;
    }
    lightsGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const lightsMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      emissive: 0xffffff,
      emissiveIntensity: 0.0, // color driven by vertex colors + emissive
      roughness: 0.3,
      metalness: 0.1,
    });
    // Use emissive via vertex colors workaround: set emissive to white and
    // multiply by vertex color (MeshStandardMaterial emissive doesn't read
    // vertex colors directly, but the lit base color will glow via the warm
    // tones). For a stronger glow, keep base bright.
    const lights = new THREE.Mesh(lightsGeom, lightsMat);
    lights.name = VehicleMesh.LIGHTS_NAME;
    this.group.add(lights);
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
