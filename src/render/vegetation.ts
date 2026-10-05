import { hash, type Geometry } from './geometry';

/** Crossed photographic cutouts retain a readable crown from every heading.
 * Six triangles near the rider, four in the distance; bark remains 3D nearby. */
export function pineCrown(detailed: boolean): Geometry {
  const data: Geometry = { positions: [], indices: [], uvs: [], colors: [] };
  const planes = detailed ? 3 : 2;
  for (let plane = 0; plane < planes; plane++) {
    const yaw = plane * Math.PI / planes, x = Math.cos(yaw) / 3, z = Math.sin(yaw) / 3;
    const i = data.positions.length / 3;
    // The generated source has a small clear border. Its trunk base is at v=.016.
    data.positions.push(-x,-0.018,-z, x,-0.018,z, x,1.018,z, -x,1.018,-z);
    data.uvs.push(0,0,1,0,1,1,0,1);
    data.indices.push(i,i+1,i+2,i,i+2,i+3);
    for (let n = 0; n < 4; n++) data.colors.push(1,1,1,1);
  }
  return data;
}

export function forestCrown(detailed: boolean, kind: 'spruce' | 'alder'): Geometry {
  const data = pineCrown(detailed), column = kind === 'spruce' ? 0 : 1;
  // Each tree occupies one half of the landscape atlas. Match its 3:4 aspect.
  for (let i = 0; i < data.positions.length; i += 3) {
    data.positions[i] *= 1.125; data.positions[i + 2] *= 1.125;
  }
  for (let i = 0; i < data.uvs.length; i += 2) data.uvs[i] = (data.uvs[i] + column) / 2;
  return data;
}

/** Nearby blades need no alpha texture, sorting or shadow pass. */
export function meadowClump(dry = 0): Geometry {
  const data: Geometry = { positions: [], indices: [], uvs: [], colors: [], normals: [] };
  for (let blade = 0; blade < 22; blade++) {
    const yaw = hash(blade, 304) * Math.PI * 2, sx = Math.cos(yaw), sz = Math.sin(yaw);
    const radius = Math.sqrt(hash(blade, 19)) * 0.6, angle = hash(blade, 12) * Math.PI * 2;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    const h = 0.16 + hash(blade, 80) * 0.27, w = 0.009 + hash(blade, 81) * 0.010;
    const bend = 0.05 + hash(blade, 13) * 0.12, i = data.positions.length / 3;
    data.positions.push(x-sz*w,0,z+sx*w, x+sz*w,0,z-sx*w,
      x+sx*bend*0.35-sz*w*0.65,h*0.57,z+sz*bend*0.35+sx*w*0.65,
      x+sx*bend*0.35+sz*w*0.65,h*0.57,z+sz*bend*0.35-sx*w*0.65,
      x+sx*bend,h,z+sz*bend);
    data.indices.push(i,i+1,i+2, i+1,i+3,i+2, i+2,i+3,i+4);
    const tint = 0.85 + hash(blade, 53) * 0.22;
    for (let v = 0; v < 5; v++) {
      const light = v < 2 ? 0.62 : v < 4 ? 0.87 : 1.0;
      data.colors.push((0.43+dry*0.18)*light*tint,(0.51+dry*0.03)*light*tint,(0.26+dry*0.09)*light*tint,1);
      data.normals!.push(0,1,0); data.uvs.push(0,0);
    }
  }
  return data;
}

/** Small, opaque tufts cost six triangles each and need no texture or sorting. */
export function grassTuft(): Geometry {
  const data: Geometry = { positions: [], indices: [], uvs: [], colors: [] };
  for (let blade = 0; blade < 6; blade++) {
    const angle = blade * 2.399, x = Math.cos(angle), z = Math.sin(angle);
    const height = 0.4 + hash(blade, 8) * 0.6, i = data.positions.length / 3;
    data.positions.push(-z*0.025,0,x*0.025, z*0.025,0,-x*0.025, x*0.22,height,z*0.22);
    data.indices.push(i,i+1,i+2); data.uvs.push(0,0,1,0,0.5,1);
    data.colors.push(0.48,0.53,0.32,1, 0.48,0.53,0.32,1, 0.85,0.88,0.55,1);
  }
  return data;
}
