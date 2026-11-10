import type { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { hash } from './geometry';
import type { Scenery } from './scenery';

/** Roadside objects are a handful of painted primitives merged into one mesh each. */
function paint(mesh: Mesh, color: string, shade = 1) {
  const c = Color3.FromHexString(color), count = mesh.getTotalVertices(), colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) colors.set([c.r * shade, c.g * shade, c.b * shade, 1], i * 4);
  mesh.setVerticesData(VertexBuffer.ColorKind, colors);
  return mesh;
}
export function box(scene: Scene, size: [number, number, number], at: [number, number, number], color: string, shade = 1) {
  const mesh = CreateBox('part', { width: size[0], height: size[1], depth: size[2] }, scene);
  mesh.position.set(...at);
  return paint(mesh, color, shade);
}
export function merged(parts: Mesh[], name: string) {
  const mesh = Mesh.MergeMeshes(parts, true, true)!;
  mesh.name = name; mesh.isPickable = false;
  return mesh;
}

const WALLS = ['#efe9da', '#e4d8bd', '#d6c7a6', '#f3efe6'], ROOFS = ['#b05a3e', '#9d4c36', '#bb6a47'];
/** A village house: whitewashed or stone walls under a gabled roof, with a door and windows facing the road. */
export function house(scene: Scene, seed: number, scenery: Scenery) {
  const w = 6.5 + hash(seed, 21) * 3, d = 7.5 + hash(seed, 22) * 3.5, h = 3.1 + hash(seed, 23) * 2.6, rise = 1.7 + hash(seed, 24) * 0.8;
  const wall = WALLS[Math.floor(hash(seed, 25) * WALLS.length)], dark = '#4a3b2f';
  const tile = scenery === 'alpine' ? '#646a70' : ROOFS[Math.floor(hash(seed, 26) * ROOFS.length)];
  // Walls go a little below ground so a house on a slope never floats.
  const parts = [box(scene, [w, h + 2, d], [0, h / 2 - 1, 0], wall)];
  const roof = new Mesh('part', scene), e = 0.45, x = w / 2 + e, z = d / 2 + e, top = h + rise;
  const data = new VertexData();
  // Two slopes with their own vertices for flat shading, and the two gable ends.
  data.positions = [-x, h, -z, -x, h, z, 0, top, z, 0, top, -z, x, h, z, x, h, -z, 0, top, -z, 0, top, z,
    -w / 2, h, -d / 2, w / 2, h, -d / 2, 0, top - 0.12, -d / 2, w / 2, h, d / 2, -w / 2, h, d / 2, 0, top - 0.12, d / 2];
  data.indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 11, 12, 13];
  data.uvs = new Array(28).fill(0); data.normals = [];
  VertexData.ComputeNormals(data.positions, data.indices, data.normals);
  data.applyToMesh(roof);
  parts.push(paint(roof, tile), box(scene, [w * 0.14, 1.3, w * 0.14], [w * 0.22, top - 0.3, d * 0.18], wall, 0.86));
  // The front is the −z side: a door and windows towards the road.
  parts.push(box(scene, [1.1, 2.1, 0.12], [(hash(seed, 27) - 0.5) * w * 0.4, 1.05, -d / 2 - 0.02], dark));
  for (const sx of [-1, 1]) {
    parts.push(box(scene, [0.95, 1.05, 0.12], [sx * w * 0.32, Math.min(h - 0.9, 1.8), -d / 2 - 0.02], '#2e3a40'));
    if (h > 4.4) parts.push(box(scene, [0.95, 1.05, 0.12], [sx * w * 0.32, h - 0.95, -d / 2 - 0.02], '#2e3a40'));
    parts.push(box(scene, [0.12, 1.0, 0.9], [sx * (w / 2 + 0.02), 1.8, d * 0.15], '#2e3a40'));
  }
  // Double-sided roof planes are cheaper than closing the attic.
  return merged(parts, 'house');
}
/** A sheep: a woolly body, a dark face and four thin legs. Its nose points to +z. */
export function sheep(scene: Scene) {
  const wool = paint(CreateSphere('part', { diameter: 1, segments: 6 }, scene), '#eee8da');
  wool.scaling.set(0.55, 0.52, 0.95); wool.position.y = 0.6;
  const head = paint(CreateSphere('part', { diameter: 0.3, segments: 5 }, scene), '#3b3531');
  head.scaling.set(0.8, 0.9, 1.25); head.position.set(0, 0.68, 0.52);
  const legs = [[-0.15, 0.3], [0.15, 0.3], [-0.15, -0.3], [0.15, -0.3]].map(([x, z]) => box(scene, [0.07, 0.42, 0.07], [x, 0.2, z], '#3b3531'));
  return merged([wool, head, ...legs], 'sheep');
}
/** A round hay bale lying on its side. */
export function bale(scene: Scene) {
  const roll = paint(CreateCylinder('part', { height: 1.25, diameter: 1.45, tessellation: 14 }, scene), '#d7c179');
  roll.rotation.z = Math.PI / 2; roll.position.y = 0.7;
  return merged([roll], 'hay-bale');
}
/** Unit post and rail; instances scale them to a wooden fence or a steel barrier. */
export function post(scene: Scene, color: string) { return merged([box(scene, [1, 1, 1], [0, 0.5, 0], color)], 'post'); }
export function rail(scene: Scene, color: string) { return merged([box(scene, [1, 1, 1], [0, 0, 0], color)], 'rail'); }

/** A wind turbine: the tower is the mesh; `rotor` is its child and turns about its own z axis. */
export function turbine(scene: Scene) {
  const tower = paint(CreateCylinder('part', { height: 64, diameterBottom: 3.2, diameterTop: 1.8, tessellation: 12 }, scene), '#eef0ee');
  tower.position.y = 31;
  const mesh = merged([tower, box(scene, [2.4, 2.6, 7], [0, 64, -0.6], '#eef0ee')], 'turbine');
  const blades = [0, 1, 2].map(i => {
    const blade = paint(CreateCylinder('part', { height: 27, diameterBottom: 1.5, diameterTop: 0.25, tessellation: 6 }, scene), '#f6f7f5');
    blade.scaling.z = 0.25; blade.position.y = 14.5;
    const arm = merged([blade], 'blade'); arm.rotation.z = i * Math.PI * 2 / 3; arm.bakeCurrentTransformIntoVertices();
    return arm;
  });
  const hub = paint(CreateSphere('part', { diameter: 2.4, segments: 6 }, scene), '#eef0ee');
  const rotor = merged([hub, ...blades], 'turbine-rotor');
  rotor.parent = mesh; rotor.position.set(0, 64, -4.4);
  return { mesh, rotor };
}
/** A bird as two wings hinged along its body; flap by rotating each about z. */
export function bird(scene: Scene) {
  const wing = (side: number) => {
    const mesh = new Mesh('bird-wing', scene), data = new VertexData();
    data.positions = [0, 0, 0.28, side * 0.95, 0.05, -0.05, 0, 0, -0.3];
    data.indices = side > 0 ? [0, 1, 2] : [0, 2, 1]; data.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0]; data.uvs = [0, 0, 0, 0, 0, 0];
    data.applyToMesh(mesh); mesh.isPickable = false;
    return mesh;
  };
  return [wing(-1), wing(1)];
}

/** Text on a small canvas texture: banners, name boards and kilometre signs. */
export function label(scene: Scene, lines: string[], width: number, height: number, background: string, color: string) {
  const texture = new DynamicTexture('label', { width, height }, scene, true), ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  lines.forEach((line, i) => {
    let size = Math.round(height / lines.length * (i === 0 ? 0.62 : 0.5));
    ctx.font = `700 ${size}px Poppins, sans-serif`;
    // Long names shrink to fit instead of running off the board.
    while (size > 10 && ctx.measureText(line).width > width * 0.9) ctx.font = `700 ${--size}px Poppins, sans-serif`;
    ctx.fillText(line, width / 2, height * (i + 0.5) / lines.length + size * 0.04);
  });
  texture.update();
  const material = new StandardMaterial('label', scene);
  material.diffuseTexture = texture; material.specularColor.set(0, 0, 0); material.emissiveColor.set(0.2, 0.2, 0.2);
  material.backFaceCulling = false;
  return material;
}
/** A flat board showing a label, readable from the −z side. Disposing it frees its texture. */
export function board(scene: Scene, material: StandardMaterial, width: number, height: number) {
  const mesh = CreatePlane('board', { width, height }, scene);
  mesh.material = material; mesh.isPickable = false;
  mesh.onDisposeObservable.add(() => material.dispose(true, true));
  return mesh;
}

/** Far ranges on the horizon. They travel with the camera like the sky, so they never get nearer. */
export function backdrop(scene: Scene, scenery: Scenery, haze: Color3) {
  const height = { meadow: 150, lake: 230, river: 300, alpine: 430, reservoir: 260, chapel: 210 }[scenery];
  const tone = Color3.FromHexString({ meadow: '#6f8f86', lake: '#5f8490', river: '#557a72', alpine: '#77808c', reservoir: '#8a8674', chapel: '#8f8468' }[scenery]);
  const data = new VertexData(), positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const segments = 160, layers = [{ radius: 1740, scale: 1, mix: 0.5, seed: 3 }, { radius: 1660, scale: 0.55, mix: 0.22, seed: 17 }];
  for (const layer of layers) {
    const base = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
      const a = i / segments * Math.PI * 2, n = i % segments;
      // Three octaves of ridge line; the seam closes because the noise is indexed by segment.
      const ridge = 0.35 + 0.65 * (hash(Math.floor(n / 16), layer.seed) * 0.5 + hash(Math.floor(n / 5), layer.seed + 1) * 0.32 + hash(n, layer.seed + 2) * 0.18);
      const smooth = 0.35 + 0.65 * (hash(Math.floor(((n + 8) % segments) / 16), layer.seed) * 0.5 + hash(Math.floor(((n + 2) % segments) / 5), layer.seed + 1) * 0.32 + hash((n + 1) % segments, layer.seed + 2) * 0.18);
      const top = height * layer.scale * (ridge + smooth) / 2, x = Math.cos(a) * layer.radius, z = Math.sin(a) * layer.radius;
      const peak = Color3.Lerp(tone.scale(0.62), haze, layer.mix), snow = scenery === 'alpine' && layer.scale === 1 && top > height * 0.62;
      positions.push(x, -60, z, x, top * 0.55, z, x, top, z);
      colors.push(...Color3.Lerp(peak, haze, 0.55).asArray(), 1, ...Color3.Lerp(peak, haze, 0.2).asArray(), 1, ...(snow ? [0.93, 0.95, 0.97] : peak.asArray()), 1);
      if (i < segments) for (const row of [0, 1]) {
        const p = base + i * 3 + row;
        indices.push(p, p + 1, p + 3, p + 1, p + 4, p + 3);
      }
    }
  }
  data.positions = positions; data.indices = indices; data.colors = colors;
  data.normals = new Array(positions.length).fill(0); data.uvs = new Array(positions.length / 3 * 2).fill(0);
  const mesh = new Mesh('backdrop', scene); data.applyToMesh(mesh);
  const material = new StandardMaterial('backdrop', scene);
  material.disableLighting = true; material.emissiveColor = Color3.White(); material.fogEnabled = false; material.backFaceCulling = false;
  mesh.material = material; mesh.infiniteDistance = true; mesh.isPickable = false; mesh.applyFog = false;
  mesh.onDisposeObservable.add(() => material.dispose());
  return mesh;
}
