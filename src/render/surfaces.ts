import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { Scene } from '@babylonjs/core/scene';

/** Reuse the gravel detail for limestone without its warm soil pigment. */
export class LimestoneSurface extends MaterialPluginBase {
  constructor(material: StandardMaterial) { super(material, 'limestone-surface', 200, {}, true, true); }
  getClassName() { return 'LimestoneSurface'; }
  getCustomCode(shaderType: string) {
    return shaderType === 'fragment' ? { CUSTOM_FRAGMENT_UPDATE_ALPHA:
      'baseColor.rgb = vec3(0.60) + mix(vec3(dot(baseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), baseColor.rgb, 0.12) * 0.35;' } : null;
  }
}

/** A shared 256² numerical texture replaces per-pixel procedural noise stacks. */
abstract class FieldSurface extends MaterialPluginBase {
  phase = 0;
  constructor(material: StandardMaterial, name: string, protected field: Texture, protected grass?: Texture) {
    super(material, name, 200, {}, true, true);
  }
  getSamplers(samplers: string[]) { samplers.push('surfaceField'); if (this.grass) samplers.push('surfaceGrass'); }
  getActiveTextures(textures: Texture[]) { textures.push(this.field); if (this.grass) textures.push(this.grass); }
  hasTexture(texture: Texture) { return texture === this.field || texture === this.grass; }
  isReadyForSubMesh() { return this.field.isReady() && (!this.grass || this.grass.isReady()); }
  getUniforms() { return { ubo: [{ name: 'surfacePhase', size: 1, type: 'float' }], fragment: 'uniform float surfacePhase;' }; }
  bindForSubMesh(buffer: UniformBuffer) {
    buffer.setTexture('surfaceField', this.field); if (this.grass) buffer.setTexture('surfaceGrass', this.grass);
    buffer.updateFloat('surfacePhase', this.phase);
  }
  protected vertexCode() { return { CUSTOM_VERTEX_DEFINITIONS: 'varying vec2 vSurfaceUV;', CUSTOM_VERTEX_MAIN_BEGIN: 'vSurfaceUV = uv;' }; }
  protected get declarations() { return 'varying vec2 vSurfaceUV; uniform sampler2D surfaceField;' + (this.grass ? 'uniform sampler2D surfaceGrass;' : ''); }
}

export class AsphaltSurface extends FieldSurface {
  constructor(material: StandardMaterial, field: Texture) { super(material, 'asphalt-surface', field); }
  getClassName() { return 'AsphaltSurface'; }
  getCustomCode(type: string) {
    if (type === 'vertex') return this.vertexCode();
    return { CUSTOM_FRAGMENT_DEFINITIONS: this.declarations, CUSTOM_FRAGMENT_UPDATE_ALPHA: `
      float lateral = abs(vSurfaceUV.x * 8.0);
      float variation = texture2D(surfaceField, vSurfaceUV * vec2(0.8, 0.12)).r;
      float wheelTrack = 1.0 - smoothstep(0.18, 0.60, abs(lateral - 1.35));
      baseColor.rgb *= (0.78 + variation * 0.40) * (1.0 - wheelTrack * 0.065);
      float grit = smoothstep(2.45, 3.05, lateral + (variation - 0.5) * 0.16);
      baseColor.rgb = mix(baseColor.rgb, vec3(0.28, 0.275, 0.25), grit * 0.45);
    `, CUSTOM_FRAGMENT_BEFORE_FOG: `
      // Approximate rough sky reflection at grazing angles: no reflection texture/pass.
      float grazing = pow(1.0 - max(0.0, dot(normalW, viewDirectionW)), 5.0);
      #ifdef FOG
        vec3 roadSky = vFogColor * 0.085;
      #else
        vec3 roadSky = vec3(0.06, 0.07, 0.08);
      #endif
      color.rgb = color.rgb * (1.0 - grazing * 0.08) + roadSky * grazing;
    ` };
  }
}

/** Two incommensurate, rotated samples hide the tile without a costly noise shader. */
export class MeadowSurface extends FieldSurface {
  constructor(material: StandardMaterial, field: Texture, private dry = 0) { super(material, 'meadow-surface', field); }
  getClassName() { return 'MeadowSurface'; }
  getCustomCode(type: string) {
    if (type === 'vertex') return this.vertexCode();
    return { CUSTOM_FRAGMENT_DEFINITIONS: this.declarations, CUSTOM_FRAGMENT_UPDATE_ALPHA: `
      float blend = smoothstep(0.25, 0.75, texture2D(surfaceField, vPositionW.xz * 0.007).r);
      vec3 rotatedGrass = texture2D(diffuseSampler, vec2(-vDiffuseUV.y, vDiffuseUV.x) * 0.731 + vec2(0.19, 0.63)).rgb;
      baseColor.rgb = mix(baseColor.rgb, rotatedGrass, blend);
      // Colour variation lives at meadow scale; never magnify individual blades.
      baseColor.rgb *= 0.86 + blend * 0.16;
      baseColor.rgb = mix(baseColor.rgb, vec3(dot(baseColor.rgb, vec3(0.3, 0.5, 0.2))) * vec3(1.18, 1.06, 0.75), ${(this.dry ?? 0).toFixed(3)});
    ` };
  }
}

/** Gravel feathers into the same meadow texture, without transparent overlay geometry. */
export class ShoulderSurface extends FieldSurface {
  constructor(material: StandardMaterial, field: Texture, grass: Texture, private dry = 0, private rocky = false) { super(material, 'shoulder-surface', field, grass); }
  getClassName() { return 'ShoulderSurface'; }
  getCustomCode(type: string) {
    if (type === 'vertex') return this.vertexCode();
    return { CUSTOM_FRAGMENT_DEFINITIONS: this.declarations, CUSTOM_FRAGMENT_UPDATE_ALPHA: `
      float flecks = texture2D(surfaceField, vPositionW.xz * 0.12).r;
      float grassCover = smoothstep(3.3, 4.8, abs(vSurfaceUV.x * 8.0) + (flecks - 0.5) * 1.8);
      vec2 grassUV = vPositionW.xz * ${this.rocky ? '0.375' : '0.75'};
      float blend = smoothstep(0.25, 0.75, texture2D(surfaceField, vPositionW.xz * 0.007).r);
      vec3 meadow = mix(texture2D(surfaceGrass, grassUV).rgb,
        texture2D(surfaceGrass, vec2(-grassUV.y, grassUV.x) * 0.731 + vec2(0.19, 0.63)).rgb, blend);
      ${this.rocky ? 'meadow = vec3(0.60) + mix(vec3(dot(meadow, vec3(0.2126, 0.7152, 0.0722))), meadow, 0.12) * 0.35;' :
        `meadow = mix(meadow, vec3(dot(meadow, vec3(0.3, 0.5, 0.2))) * vec3(1.18, 1.06, 0.75), ${(this.dry ?? 0).toFixed(3)});`}
      baseColor.rgb = mix(baseColor.rgb * 0.8, meadow * 0.89, grassCover);
    ` };
  }
}

/** Depth tint, bank shade and distorted sky reflection in the existing water pass. */
export class WaterSurface extends FieldSurface {
  constructor(material: StandardMaterial, field: Texture, private kind: 'river' | 'lake' | 'reservoir' = 'river') { super(material, 'water-surface', field); }
  getClassName() { return 'WaterSurface'; }
  getCustomCode(type: string) {
    if (type === 'vertex') return this.vertexCode();
    return { CUSTOM_FRAGMENT_DEFINITIONS: this.declarations, CUSTOM_FRAGMENT_UPDATE_ALPHA: `
      vec2 flowUV = vPositionW.xz * vec2(0.16, 0.46) + vec2(surfacePhase, -surfacePhase * 0.6);
      vec4 flow = texture2D(surfaceField, flowUV);
      vec4 fineFlow = texture2D(surfaceField, flowUV * 2.71 + vec2(-surfacePhase, 0.31));
      float detail = 1.0 / (1.0 + length(vEyePosition.xyz - vPositionW) * 0.008);
      vec2 slope = (flow.gb + fineFlow.gb - 1.0) * detail;
      normalW = normalize(normalW + vec3(slope.x * 0.38, 0.0, slope.y * 0.24));
      float riverEdge = ${this.kind === 'river' ? 'abs(vSurfaceUV.x * 2.0 - 1.0)' : 'length(vSurfaceUV * 2.0 - 1.0)'};
      float shallows = smoothstep(0.60, 1.0, riverEdge + (flow.r - 0.5) * 0.2);
      baseColor.rgb = mix(vec3(${this.kind === 'lake' ? '0.065, 0.18, 0.16' : this.kind === 'reservoir' ? '0.08, 0.14, 0.16' : '0.085, 0.135, 0.12'}), vec3(0.24, 0.25, 0.18), shallows);
      baseColor.rgb *= 0.87 + flow.r * 0.23;
    `, CUSTOM_FRAGMENT_BEFORE_FOG: `
      float bankShade = smoothstep(0.3, 1.0, riverEdge) * (0.35 + flow.r * 0.5);
      color.rgb *= mix(vec3(1.0), vec3(0.46, 0.60, 0.47), bankShade);
    ` };
  }
}

/** Grass fades by shrinking into the ground, keeping opaque depth writes and no idle animation. */
export class GrassSurface extends MaterialPluginBase {
  constructor(material: StandardMaterial) { super(material, 'grass-distance', 200, {}, true, true); }
  getClassName() { return 'GrassSurface'; }
  getUniforms() { return { ubo: [{ name: 'grassEye', size: 3, type: 'vec3' }], vertex: 'uniform vec3 grassEye;' }; }
  bindForSubMesh(buffer: UniformBuffer, scene: Scene) {
    const eye = scene.activeCamera!.globalPosition;
    buffer.updateFloat3('grassEye', eye.x, eye.y, eye.z);
  }
  getCustomCode(type: string) {
    return type === 'vertex' ? { CUSTOM_VERTEX_UPDATE_WORLDPOS: `
      float grassDistance = length(worldPos.xz - grassEye.xz);
      float grassScale = 1.0 - smoothstep(15.0, 28.0, grassDistance);
      worldPos.y -= max(0.0, positionUpdated.y) * (1.0 - grassScale) * length(finalWorld[1].xyz);
    ` } : null;
  }
}
