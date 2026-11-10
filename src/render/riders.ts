import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Rival } from '../domain/rivals';

export interface RiderModel { root: TransformNode; pose(crankAngle: number): void }

// Metres, in the bike's own frame: origin on the road between the wheels, +z forwards.
const WHEEL = 0.335, REAR = -0.5, FRONT = 0.5;
const BOTTOM_BRACKET = { y: 0.27, z: -0.06 }, CRANK = 0.17;
const HIP = { y: 0.99, z: -0.22 }, THIGH = 0.43, SHIN = 0.43, LEG_X = 0.1;
const SKIN = ['#e0ac86', '#b98058', '#8c5a3c'];
const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** One white lit material serves every rider; parts carry their colour in the vertices. */
function paint(mesh: Mesh, color: string, alpha = 1) {
  const c = Color3.FromHexString(color), count = mesh.getTotalVertices(), colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b, alpha], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  return mesh;
}
function tube(scene: Scene, a: Vector3, b: Vector3, radius: number, color: string) {
  const mesh = CreateCylinder('part', { height: Vector3.Distance(a, b), diameter: radius * 2, tessellation: 8 }, scene);
  mesh.position = Vector3.Center(a, b);
  mesh.rotationQuaternion = Quaternion.FromUnitVectorsToRef(Vector3.Up(), b.subtract(a).normalize(), new Quaternion());
  return paint(mesh, color);
}
function ball(scene: Scene, at: Vector3, diameter: number, color: string, scaling = v(1, 1, 1)) {
  const mesh = CreateSphere('part', { diameter, segments: 8 }, scene);
  mesh.position = at; mesh.scaling = scaling;
  return paint(mesh, color);
}
function merge(parts: Mesh[], name: string, parent: TransformNode, material: StandardMaterial) {
  const mesh = Mesh.MergeMeshes(parts, true, true)!;
  mesh.name = name; mesh.parent = parent; mesh.material = material; mesh.isPickable = false;
  return mesh;
}

/** A low-poly cyclist: bike and upper body are one mesh, and each leg is two that follow the cranks. */
export function createRider(scene: Scene, rival: Rival, index: number, parent: TransformNode,
  material: StandardMaterial, shadowMaterial: StandardMaterial): RiderModel {
  const root = new TransformNode(`rider-${index}`, scene); root.parent = parent;
  const frame = '#2c3135', tyre = '#1a1c1d', kit = '#1e2327', skin = SKIN[index % SKIN.length];
  const rear = v(0, WHEEL, REAR), front = v(0, WHEEL, FRONT), bracket = v(0, BOTTOM_BRACKET.y, BOTTOM_BRACKET.z);
  const saddle = v(0, 0.95, -0.24), headTop = v(0, 0.93, 0.34), headBottom = v(0, 0.7, 0.39);
  const hips = v(0, 1.0, -0.2), shoulders = v(0, 1.35, 0.2);
  const parts: Mesh[] = [];
  for (const axle of [rear, front]) {
    const wheel = paint(CreateTorus('part', { diameter: WHEEL * 2 - 0.04, thickness: 0.045, tessellation: 20 }, scene), tyre);
    wheel.rotation.z = Math.PI / 2; wheel.position = axle;
    parts.push(wheel, tube(scene, axle.add(v(-0.04, 0, 0)), axle.add(v(0.04, 0, 0)), 0.03, frame));
  }
  for (const [a, b] of [[bracket, saddle], [saddle, headTop], [bracket, headBottom], [headTop, headBottom],
    [rear, bracket], [rear, saddle], [headBottom, front]]) parts.push(tube(scene, a, b, 0.019, frame));
  parts.push(tube(scene, v(-0.2, 0.95, 0.42), v(0.2, 0.95, 0.42), 0.016, tyre), tube(scene, headTop, v(0, 0.95, 0.42), 0.017, frame));
  const seat = paint(CreateBox('part', { width: 0.13, height: 0.04, depth: 0.25 }, scene), tyre); seat.position = saddle.add(v(0, 0.02, 0));
  parts.push(seat, tube(scene, hips, shoulders, 0.15, rival.jersey), ball(scene, hips, 0.31, kit, v(1, 0.85, 1)),
    ball(scene, shoulders, 0.33, rival.jersey, v(1.15, 0.85, 0.9)),
    ball(scene, v(0, 1.5, 0.33), 0.2, skin), ball(scene, v(0, 1.535, 0.32), 0.24, rival.helmet, v(1, 0.75, 1.2)));
  for (const side of [-1, 1]) {
    const shoulder = v(side * 0.18, 1.33, 0.2), elbow = v(side * 0.23, 1.14, 0.3), hand = v(side * 0.2, 0.97, 0.42);
    parts.push(tube(scene, shoulder, elbow, 0.045, rival.jersey), tube(scene, elbow, hand, 0.036, skin), ball(scene, hand, 0.08, kit));
  }
  merge(parts, 'rider-body', root, material);

  const legs = [-1, 1].map(side => {
    const thigh = merge([paint(CreateCylinder('part', { height: THIGH, diameterTop: 0.13, diameterBottom: 0.095, tessellation: 8 }, scene), kit)],
      'rider-thigh', root, material);
    const calf = paint(CreateCylinder('part', { height: SHIN, diameterTop: 0.09, diameterBottom: 0.06, tessellation: 8 }, scene), skin);
    const shoe = paint(CreateBox('part', { width: 0.085, height: 0.06, depth: 0.25 }, scene), rival.helmet);
    shoe.position.set(0, -SHIN / 2 - 0.03, 0.06);
    const shin = merge([calf, shoe], 'rider-shin', root, material);
    thigh.position.x = shin.position.x = side * LEG_X;
    return { thigh, shin, phase: side > 0 ? 0 : Math.PI };
  });

  // No real-time shadows: a soft dark patch is enough to sit the bike on the road.
  const shadow = CreateDisc('rider-shadow', { radius: 0.5, tessellation: 16 }, scene);
  paint(shadow, '#000000', 0);
  const colors = shadow.getVerticesData(VertexBuffer.ColorKind)!; colors[3] = 0.9;
  shadow.setVerticesData(VertexBuffer.ColorKind, colors); shadow.hasVertexAlpha = true;
  shadow.rotation.x = Math.PI / 2; shadow.scaling.set(0.9, 2.5, 1); shadow.position.y = 0.012;
  shadow.parent = root; shadow.material = shadowMaterial; shadow.isPickable = false;

  return { root, pose(crankAngle) {
    for (const leg of legs) {
      const a = crankAngle + leg.phase;
      // The ankle rides just above the pedal; the knee is where thigh and shin can both reach.
      const ankle = { y: BOTTOM_BRACKET.y + CRANK * Math.cos(a) + 0.1, z: BOTTOM_BRACKET.z + CRANK * Math.sin(a) - 0.03 };
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
