import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Curve3 } from '@babylonjs/core/Maths/math.path';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { CreateTube } from '@babylonjs/core/Meshes/Builders/tubeBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Rival } from '../domain/rivals';

export interface RiderModel { root: TransformNode; pose(crankAngle: number, wheelAngle: number): void }
export interface RiderMaterials { body: StandardMaterial; spokes: StandardMaterial; shadow: StandardMaterial }

// Metres, in the bike's own frame: origin on the road between the wheels, +z forwards.
export const WHEEL_RADIUS = 0.335;
const REAR = -0.5, FRONT = 0.5;
const BOTTOM_BRACKET = { y: 0.27, z: -0.06 }, CRANK = 0.17, PEDAL_X = 0.13;
const HIP = { y: 0.98, z: -0.23 }, THIGH = 0.43, SHIN = 0.43, LEG_X = 0.1;
const SKIN = ['#e3b08c', '#c48a62', '#8d5a3d'], FRAMES = ['#23282c', '#c9ccd0', '#8f2d2a', '#1f3f6b', '#2d5a40'];
const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** One lit material serves every rider; parts carry their colour in the vertices. */
function paint(mesh: Mesh, color: string, alpha = 1) {
  const c = Color3.FromHexString(color), count = mesh.getTotalVertices(), colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b, alpha], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  return mesh;
}
function tube(scene: Scene, a: Vector3, b: Vector3, radius: number, color: string, endRadius = radius) {
  const mesh = CreateCylinder('part', { height: Vector3.Distance(a, b), diameterBottom: radius * 2, diameterTop: endRadius * 2, tessellation: 10 }, scene);
  mesh.position = Vector3.Center(a, b);
  mesh.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Up(), b.subtract(a).normalize(), new Quaternion());
  return paint(mesh, color);
}
/** A rounded limb along a smooth line, its thickness set at each of the given points. */
function limb(scene: Scene, points: Vector3[], radii: number[], color: string) {
  const path = points.length > 2 ? Curve3.CreateCatmullRomSpline(points, 5).getPoints() : points;
  const mesh = CreateTube('part', { path, tessellation: 12, cap: Mesh.CAP_ALL, radiusFunction: i => {
    const t = i / (path.length - 1) * (radii.length - 1), k = Math.min(radii.length - 2, Math.floor(t));
    return radii[k] + (radii[k + 1] - radii[k]) * (t - k);
  } }, scene);
  return paint(mesh, color);
}
function ball(scene: Scene, at: Vector3, diameter: number, color: string, scaling = v(1, 1, 1)) {
  const mesh = CreateSphere('part', { diameter, segments: 10 }, scene);
  mesh.position = at; mesh.scaling = scaling;
  return paint(mesh, color);
}
function merge(parts: Mesh[], name: string, parent: TransformNode, material: StandardMaterial) {
  const mesh = Mesh.MergeMeshes(parts, true, true)!;
  mesh.name = name; mesh.parent = parent; mesh.material = material; mesh.isPickable = false;
  return mesh;
}

/** Materials shared by the whole peloton. The spokes are drawn once and spin with each wheel. */
export function riderMaterials(scene: Scene): RiderMaterials {
  const body = new StandardMaterial('rider', scene);
  body.specularColor.set(0.14, 0.14, 0.14); body.specularPower = 28; body.maxSimultaneousLights = 2;
  const texture = new DynamicTexture('spokes', 256, scene, true), ctx = texture.getContext();
  ctx.clearRect(0, 0, 256, 256); ctx.strokeStyle = '#d7dadc'; ctx.lineWidth = 2.2;
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * Math.PI * 2, skew = (i % 2 ? 1 : -1) * 0.12;
    ctx.beginPath(); ctx.moveTo(128 + Math.cos(a + skew) * 14, 128 + Math.sin(a + skew) * 14);
    ctx.lineTo(128 + Math.cos(a) * 124, 128 + Math.sin(a) * 124); ctx.stroke();
  }
  ctx.fillStyle = '#3a3f43'; ctx.beginPath(); ctx.arc(128, 128, 15, 0, Math.PI * 2); ctx.fill();
  texture.hasAlpha = true; texture.update();
  const spokes = new StandardMaterial('rider-spokes', scene);
  spokes.diffuseTexture = texture; spokes.useAlphaFromDiffuseTexture = true;
  spokes.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST; spokes.alphaCutOff = 0.35;
  spokes.backFaceCulling = false; spokes.specularColor.set(0, 0, 0); spokes.emissiveColor.set(0.25, 0.25, 0.25);
  const shadow = new StandardMaterial('rider-shadow', scene);
  shadow.diffuseColor.set(0, 0, 0); shadow.specularColor.set(0, 0, 0);
  shadow.disableLighting = true; shadow.backFaceCulling = false; shadow.zOffset = -2;
  return { body, spokes, shadow };
}

/** A cyclist built from rounded limbs. Bike and upper body are one mesh; legs, cranks and wheels move. */
export function createRider(scene: Scene, rival: Rival, index: number, parent: TransformNode, materials: RiderMaterials): RiderModel {
  const root = new TransformNode(`rider-${index}`, scene); root.parent = parent;
  const frame = FRAMES[index % FRAMES.length], tyre = '#17191a', kit = '#1c2124', skin = SKIN[index % SKIN.length];
  const trim = rival.helmet, sock = '#f2f0e8';
  const rear = v(0, WHEEL_RADIUS, REAR), front = v(0, WHEEL_RADIUS, FRONT), bracket = v(0, BOTTOM_BRACKET.y, BOTTOM_BRACKET.z);
  const seatTop = v(0, 0.9, -0.22), saddle = v(0, 0.955, -0.235), headTop = v(0, 0.92, 0.33), headBottom = v(0, 0.72, 0.385);
  const stem = v(0, 0.96, 0.41);
  const parts: Mesh[] = [];
  for (const axle of [rear, front]) {
    const outer = paint(CreateTorus('part', { diameter: WHEEL_RADIUS * 2 - 0.03, thickness: 0.032, tessellation: 28 }, scene), tyre);
    const rim = paint(CreateTorus('part', { diameter: WHEEL_RADIUS * 2 - 0.085, thickness: 0.022, tessellation: 28 }, scene), '#aeb3b7');
    for (const ring of [outer, rim]) { ring.rotation.z = Math.PI / 2; ring.position = axle; }
    parts.push(outer, rim, tube(scene, axle.add(v(-0.05, 0, 0)), axle.add(v(0.05, 0, 0)), 0.02, '#8d9296'));
  }
  // Frame: two triangles, a fork and a seat post.
  for (const [a, b, r] of [[bracket, seatTop, 0.02], [seatTop, headTop, 0.019], [bracket, headBottom, 0.024], [headTop, headBottom, 0.022],
    [seatTop, saddle, 0.014], [headTop, stem, 0.016]] as [Vector3, Vector3, number][]) parts.push(tube(scene, a, b, r, frame));
  for (const side of [-1, 1]) {
    const x = v(side * 0.045, 0, 0);
    parts.push(tube(scene, rear.add(x), bracket.add(x.scale(0.6)), 0.012, frame), tube(scene, rear.add(x), seatTop.add(x.scale(0.4)), 0.011, frame),
      tube(scene, headBottom.add(x.scale(0.5)), front.add(x), 0.014, frame));
    // Drop bars: the tops, then the hooks curling forwards and down.
    const end = v(side * 0.2, 0.96, 0.41);
    parts.push(limb(scene, [v(side * 0.03, 0.96, 0.41), end, v(side * 0.205, 0.955, 0.49), v(side * 0.205, 0.9, 0.53), v(side * 0.205, 0.83, 0.5), v(side * 0.205, 0.81, 0.43)],
      [0.013, 0.013], tyre), tube(scene, v(side * 0.205, 0.96, 0.47), v(side * 0.205, 1.0, 0.53), 0.016, tyre));
  }
  const seat = paint(CreateSphere('part', { diameter: 0.27, segments: 8 }, scene), tyre);
  seat.position = saddle.add(v(0, 0.012, 0.01)); seat.scaling.set(0.5, 0.16, 1);
  const ring = paint(CreateCylinder('part', { height: 0.006, diameter: 0.19, tessellation: 20 }, scene), '#8d9296');
  ring.rotation.z = Math.PI / 2; ring.position = bracket.add(v(0.05, 0, 0));
  const cogs = paint(CreateCylinder('part', { height: 0.03, diameter: 0.1, tessellation: 14 }, scene), '#8d9296');
  cogs.rotation.z = Math.PI / 2; cogs.position = rear.add(v(0.045, 0, 0));
  const bottle = tube(scene, v(0, 0.42, 0.06), v(0, 0.58, 0.2), 0.032, trim);
  parts.push(seat, ring, cogs, bottle);

  // Upper body: low over the bars, back gently arched.
  const torso = limb(scene, [v(0, 0.99, -0.25), v(0, 1.13, -0.13), v(0, 1.27, 0.05), v(0, 1.35, 0.2), v(0, 1.4, 0.28)],
    [0.125, 0.145, 0.155, 0.14, 0.06], rival.jersey);
  torso.scaling.x = 1.22;
  const seatPad = ball(scene, v(0, 0.99, -0.24), 0.3, kit, v(1.1, 0.85, 1));
  const neck = tube(scene, v(0, 1.4, 0.27), v(0, 1.46, 0.31), 0.048, skin);
  const head = ball(scene, v(0, 1.52, 0.335), 0.2, skin, v(0.92, 1.08, 1));
  const helmet = ball(scene, v(0, 1.565, 0.32), 0.25, rival.helmet, v(0.9, 0.72, 1.28));
  const visor = ball(scene, v(0, 1.535, 0.42), 0.16, '#101315', v(1.05, 0.34, 0.6));
  parts.push(torso, seatPad, neck, head, helmet, visor);
  for (const side of [-1, 1]) {
    const shoulder = v(side * 0.185, 1.33, 0.19), elbow = v(side * 0.235, 1.15, 0.31), wrist = v(side * 0.205, 1.02, 0.49);
    parts.push(ball(scene, shoulder, 0.125, rival.jersey), limb(scene, [shoulder, v(side * 0.215, 1.24, 0.25), elbow], [0.054, 0.05, 0.043], trim),
      limb(scene, [elbow, v(side * 0.225, 1.08, 0.4), wrist], [0.042, 0.037, 0.03], skin), ball(scene, wrist, 0.075, kit, v(1, 0.9, 1.25)));
  }
  merge(parts, 'rider-body', root, materials.body);

  const legs = [-1, 1].map(side => {
    const top = THIGH / 2, bottom = -THIGH / 2;
    const thigh = merge([limb(scene, [v(0, top, 0), v(0, bottom + THIGH * 0.28, 0)], [0.083, 0.068], kit),
      limb(scene, [v(0, bottom + THIGH * 0.3, 0), v(0, bottom, 0)], [0.066, 0.055], skin), ball(scene, v(0, top, 0), 0.165, kit)], 'rider-thigh', root, materials.body);
    const shoe = ball(scene, v(0, -SHIN / 2 - 0.035, 0.065), 0.27, trim, v(0.36, 0.26, 1));
    const shin = merge([ball(scene, v(0, SHIN / 2, 0), 0.112, skin), limb(scene, [v(0, SHIN / 2, 0), v(0, 0.05, -0.012), v(0, -SHIN / 2 + 0.09, 0)], [0.052, 0.058, 0.036], skin),
      limb(scene, [v(0, -SHIN / 2 + 0.1, 0), v(0, -SHIN / 2, 0)], [0.038, 0.036], sock), shoe], 'rider-shin', root, materials.body);
    thigh.position.x = side * LEG_X; shin.position.x = side * (LEG_X + 0.02);
    return { thigh, shin, phase: side > 0 ? 0 : Math.PI };
  });
  // Cranks and pedals turn about the bottom bracket.
  const cranks = new TransformNode('rider-cranks', scene); cranks.parent = root;
  cranks.position.set(0, BOTTOM_BRACKET.y, BOTTOM_BRACKET.z);
  merge([-1, 1].flatMap(side => {
    const pedal = paint(CreateBox('part', { width: 0.09, height: 0.018, depth: 0.07 }, scene), '#2b2f33');
    pedal.position.set(side * PEDAL_X, side * CRANK, 0);
    return [tube(scene, v(side * 0.075, 0, 0), v(side * 0.085, side * CRANK, 0), 0.012, '#8d9296'), pedal];
  }), 'rider-crankset', cranks, materials.body);
  const wheels = [rear, front].map(axle => {
    const disc = CreateDisc('rider-spokes', { radius: WHEEL_RADIUS - 0.04, tessellation: 20 }, scene);
    disc.rotation.y = Math.PI / 2; disc.material = materials.spokes; disc.isPickable = false;
    const hub = new TransformNode('rider-wheel', scene); hub.parent = root; hub.position = axle; disc.parent = hub;
    return hub;
  });

  // No real-time shadows: a soft dark patch is enough to sit the bike on the road.
  const shadow = CreateDisc('rider-shadow', { radius: 0.5, tessellation: 16 }, scene);
  paint(shadow, '#000000', 0);
  const colors = shadow.getVerticesData(VertexBuffer.ColorKind)!; colors[3] = 0.9;
  shadow.setVerticesData(VertexBuffer.ColorKind, colors); shadow.hasVertexAlpha = true;
  shadow.rotation.x = Math.PI / 2; shadow.scaling.set(0.9, 2.5, 1); shadow.position.y = 0.012;
  shadow.parent = root; shadow.material = materials.shadow; shadow.isPickable = false;

  return { root, pose(crankAngle, wheelAngle) {
    cranks.rotation.x = crankAngle;
    for (const wheel of wheels) wheel.rotation.x = wheelAngle;
    for (const leg of legs) {
      const a = crankAngle + leg.phase;
      // The ankle rides just above the pedal; the knee is where thigh and shin can both reach.
      const ankle = { y: BOTTOM_BRACKET.y + CRANK * Math.cos(a) + 0.105, z: BOTTOM_BRACKET.z + CRANK * Math.sin(a) - 0.035 };
      const dy = ankle.y - HIP.y, dz = ankle.z - HIP.z, reach = Math.min(THIGH + SHIN - 0.001, Math.hypot(dy, dz));
      const along = (THIGH * THIGH - SHIN * SHIN + reach * reach) / (2 * reach);
      const bend = Math.sqrt(Math.max(0, THIGH * THIGH - along * along));
      const ny = dy / reach, nz = dz / reach;
      // Of the two solutions, a cyclist's knee is the one in front.
      const knee = { y: HIP.y + ny * along + nz * bend, z: HIP.z + nz * along - ny * bend };
      leg.thigh.position.y = (HIP.y + knee.y) / 2; leg.thigh.position.z = (HIP.z + knee.z) / 2;
      leg.thigh.rotation.x = Math.atan2(HIP.z - knee.z, HIP.y - knee.y);
      leg.shin.position.y = (knee.y + ankle.y) / 2; leg.shin.position.z = (knee.z + ankle.z) / 2;
      leg.shin.rotation.x = Math.atan2(knee.z - ankle.z, knee.y - ankle.y);
    }
  } };
}
