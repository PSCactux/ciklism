import { Scene } from '@babylonjs/core/scene';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

/** Photographic atmosphere: one texture lookup, no runtime HDR or postprocessing pass. */
export function createSky(scene: Scene, horizon: Color3, panorama: Texture,
  sunDirection = new Vector3(0.6, 0.8, -0.3).normalize(), sunColor = Color3.White(), warmth = 0) {
  const material = new ShaderMaterial('atmosphere', scene, {
    vertexSource: `precision highp float;
      attribute vec3 position; attribute vec2 uv; uniform mat4 worldViewProjection; uniform vec3 sunDirection;
      varying vec2 skyUV; varying float height; varying float glow;
      void main(){skyUV=vec2(uv.x,1.0-uv.y);height=position.y/1800.0;
        glow=pow(max(0.0,dot(normalize(position),sunDirection)),24.0);
        gl_Position=worldViewProjection*vec4(position,1.0);}`,
    fragmentSource: `precision highp float;
      varying vec2 skyUV; varying float height; varying float glow;
      uniform vec3 horizon; uniform vec3 sunColor; uniform float warmth;
      uniform sampler2D panorama;
      void main(){float h=max(height,0.0);
        // Keep the photographed ground below the horizon out of the 3D world.
        vec2 uv=vec2(skyUV.x,max(skyUV.y,0.508));
        vec3 photo=texture2D(panorama,uv).rgb;
        vec3 tint=mix(horizon,vec3(1.0),0.82);
        vec3 graded=photo*tint*mix(vec3(1.0),vec3(1.10,0.84,0.72),warmth);
        float luminance=dot(graded,vec3(0.2126,0.7152,0.0722));
        graded=mix(vec3(luminance),graded,1.12)*1.08;
        vec3 c=mix(horizon,graded,smoothstep(0.0,0.12,h));
        c=mix(c,sunColor,glow*(0.22+warmth*0.25));
        gl_FragColor=vec4(c,1.0);}`,
  }, { attributes: ['position', 'uv'], uniforms: ['worldViewProjection', 'horizon', 'sunDirection', 'sunColor', 'warmth'], samplers: ['panorama'] });
  material.setTexture('panorama', panorama);
  material.setColor3('horizon', horizon);
  material.setVector3('sunDirection', sunDirection); material.setColor3('sunColor', sunColor); material.setFloat('warmth', warmth);
  material.backFaceCulling = false; material.disableDepthWrite = true;
  const dome = CreateSphere('sky-dome', { diameter: 3600, segments: 24 }, scene);
  dome.material = material; dome.infiniteDistance = true; dome.isPickable = false;
  dome.onDisposeObservable.add(() => material.dispose());
  return dome;
}
