import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3, Quaternion, Matrix } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { FresnelParameters } from '@babylonjs/core/Materials/fresnelParameters';
import { Curve3 } from '@babylonjs/core/Maths/math.path';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { ColorCurves } from '@babylonjs/core/Materials/colorCurves';
import { previewPose, type PreviewView } from './preview';
import { landscape, lakeFor, lakeRadius, riverProfile } from './scenery';
import { surfaceLook } from './surface-look';
import { AsphaltSurface, GrassSurface, LimestoneSurface, WaterSurface, MeadowSurface, ShoulderSurface } from './surfaces';
import { createSky } from './sky';
import { LIGHTING, lightingKey, lightmapUV, surfaceIrradiance, treeLayout, type Daylight } from './lighting';
import { pineCrown, forestCrown, grassTuft, meadowClump, flowerClump } from './vegetation';
import { AdaptiveResolution, frameLimit, type Quality } from './budget';
import { createRider, riderMaterials, WHEEL_RADIUS, type RiderModel } from './riders';
import { PELOTON } from '../domain/rivals';
import { backdrop, bale, bird, board, box, house, label, merged, post, rail, sheep, turbine } from './props';
import { barriers, bales, flocks, turbines, villages, type Rail, type Spot, type Village } from './places';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTube } from '@babylonjs/core/Meshes/Builders/tubeBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/core/Materials/standardMaterial';
import { RoutePath, type Vec3 } from '../domain/route';
import { bendLean, cameraPose, type RideState } from '../domain/ride';
import { distantHill, groundAt, groundNoise, terrainHeightAt, hash, markings, roadSurface, roadRepairs, roadHeight, riverRibbon, roadside, shoulderBanks, terrainCells, terrainStep, terrainTile, TILE_SIZE, type Geometry } from './geometry';

export type { Daylight } from './lighting';
export type { Quality } from './budget';
const PALETTES = {
  dia: { sky: '#598dc0', fog: '#b9cad6', grass: '#94c28a' },
  amanecer: { sky: '#7f9daf', fog: '#d8bda9', grass: '#abc89b' },
  atardecer: { sky: '#738ca6', fog: '#d8b9a0', grass: '#b1c38b' },
};
const vec = (p: Vec3) => new Vector3(p.x, p.y, p.z);
/** A piece of scenery shown only near the camera. With `build`, its mesh exists only while it is
 * near, so memory follows what is in view and not the length of the course. */
interface Zone {
  mesh: Mesh | null; build: (() => Mesh) | null; x: number; z: number; radius: number;
  range: number; minRange: number; distance: number; wanted: boolean; queued: boolean;
}
/** Metres past its range a built zone is kept, so turning round does not rebuild it. */
const ZONE_KEEP = 500;

export class RideScene {
  private engine: Engine;
  private scene: Scene;
  private camera: FreeCamera;
  private content: TransformNode | null = null;
  private materials: StandardMaterial[] = [];
  private textures = new Map<string, Texture>();
  private lightmap: Texture | null = null;
  private sunlight: DirectionalLight | null = null;
  private waterSurface: WaterSurface | null = null;
  private ghost: TransformNode | null = null;
  private riders: RiderModel[] = [];
  private rotors: Mesh[] = [];
  private flock: { node: TransformNode; wings: Mesh[] }[] = [];
  private gateGroup: TransformNode | null = null;
  private cockpitGroup: TransformNode | null = null;
  private path: RoutePath | null = null;
  private bakingRoute: RoutePath | null = null;
  private daylight: Daylight = 'dia';
  private staticMaterials = new Set<StandardMaterial>();
  private motion = true;
  private observer: ResizeObserver;
  private quality: Quality = 'auto';
  private budget = new AdaptiveResolution();
  private lastPresented = 0;
  private lastFrame = 0;
  private zones: Zone[] = [];
  private pending: Zone[] = [];
  private lastZoneX = Infinity;
  private lastZoneZ = Infinity;
  private needsRender = true;
  private loadedKey = '';
  private failedTextures = new Set<string>();
  private contextUnavailable = false;
  private preparing = false;
  private diagnostic(stage: string, pending: Scene['meshes'] = []) {
    if (!import.meta.env.DEV || !import.meta.hot) return;
    import.meta.hot.send('megabici:render-diagnostic', {
      stage, agent: navigator.userAgent, route: this.bakingRoute?.route.nombre,
      renderSize: [this.engine.getRenderWidth(), this.engine.getRenderHeight()],
      clientSize: [this.canvas.clientWidth, this.canvas.clientHeight],
      camera: this.camera.position.asArray(), projection: Array.from(this.camera.getProjectionMatrix().m),
      active: this.scene.getActiveMeshes().length, meshes: this.scene.meshes.length,
      contextUnavailable: this.contextUnavailable,
      pending: pending.slice(0, 8).map(mesh => ({ mesh: mesh.name, material: mesh.material?.name,
        effects: mesh.subMeshes?.map(sub => ({ ready: sub.effect?.isReady(), error: sub.effect?.getCompilationError() })) })),
    });
  }
  onFrame: (now: number) => void = () => {};
  onContextLost: () => void = () => {};
  onCompatibilityMode: () => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true,
      powerPreference: 'low-power', adaptToDeviceRatio: false });
    this.scene = new Scene(this.engine);
    if (import.meta.env.DEV) (window as unknown as { megabiciScene: Scene }).megabiciScene = this.scene;
    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.00125;
    this.scene.imageProcessingConfiguration.toneMappingEnabled = true;
    this.scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    this.scene.imageProcessingConfiguration.exposure = 1.1;
    this.scene.imageProcessingConfiguration.contrast = 1.0;
    const curves = new ColorCurves();
    curves.globalSaturation = 3; curves.shadowsExposure = 8;
    this.scene.imageProcessingConfiguration.colorCurves = curves;
    this.scene.imageProcessingConfiguration.colorCurvesEnabled = true;
    this.scene.skipPointerMovePicking = true;
    this.camera = new FreeCamera('rider', new Vector3(0, 2, 0), this.scene);
    this.camera.minZ = 0.04; this.camera.maxZ = 2200;
    this.camera.fov = 1.05; this.camera.inputs.clear();
    this.scene.activeCamera = this.camera;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.engine.onContextLostObservable.add(() => { this.contextUnavailable = true; this.onContextLost(); });
    this.engine.onContextRestoredObservable.add(() => {
      this.contextUnavailable = false;
      this.needsRender = true;
    });
    this.engine.runRenderLoop(() => {
      if (document.hidden || !this.path || this.contextUnavailable || this.preparing) { this.lastFrame = 0; this.lastPresented = 0; this.budget.idle(); return; }
      const now = performance.now();
      // A single clock still advances physics; presentation has a bounded budget.
      const interval = 1000 / this.targetFps;
      if (now - this.lastFrame < interval - 1) return;
      this.lastFrame = now;
      this.onFrame(now);
      if (this.pending.length) this.buildZones(5);
      if (!this.needsRender) { this.budget.idle(); this.lastPresented = 0; return; }
      const started = performance.now();
      this.scene.render();
      this.needsRender = false;
      if (this.quality === 'auto' && this.lastPresented &&
        this.budget.sample(performance.now() - started, now - this.lastPresented, this.targetFps)) this.resize();
      this.lastPresented = now;
    });
  }

  private get targetFps() { return frameLimit(this.quality, matchMedia('(pointer: coarse)').matches); }
  setOptions(quality: Quality, motion: boolean) {
    this.quality = quality; this.motion = motion; this.budget.reset();
    this.lastFrame = 0; this.lastPresented = 0; this.resize();
  }
  private resize() {
    this.needsRender = true;
    const ratio = Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 1.5 : 1.25);
    this.engine.setHardwareScalingLevel(this.quality === 'low' ? 1.5 : this.budget.scale / ratio);
    this.engine.resize();
    for (const mat of this.materials) {
      if (mat.name === 'asphalt') mat.bumpTexture = this.quality === 'low' ? null : this.photo('road-normal', 4);
    }
    this.lastZoneX = Infinity;
    if (this.path) this.updateZones();
  }

  private material(name: string, color: string) {
    const mat = new StandardMaterial(name, this.scene);
    mat.diffuseColor = Color3.FromHexString(color); mat.specularColor = Color3.Black();
    mat.backFaceCulling = true; mat.maxSimultaneousLights = 2;
    this.materials.push(mat); return mat;
  }
  private mesh(name: string, data: Geometry, mat: StandardMaterial) {
    const mesh = new Mesh(name, this.scene);
    const vertices = new VertexData(), normals: number[] = [];
    if (!data.normals) VertexData.ComputeNormals(data.positions, data.indices, normals);
    vertices.positions = data.positions; vertices.indices = data.indices; vertices.normals = data.normals ?? normals;
    vertices.uvs = data.uvs;
    if (mat.lightmapTexture && this.bakingRoute) vertices.uvs2 = lightmapUV(this.bakingRoute.route, data.positions);
    vertices.colors = data.colors;
    if (this.staticMaterials.has(mat)) {
      const colors = [...data.colors], tint = mat.diffuseColor;
      for (let i = 0; i < data.positions.length / 3; i++) {
        const n = vertices.normals!;
        const light = surfaceIrradiance({ x: n[i * 3], y: n[i * 3 + 1], z: n[i * 3 + 2] }, this.daylight);
        colors[i * 4] *= Math.min(1, light[0] * tint.r);
        colors[i * 4 + 1] *= Math.min(1, light[1] * tint.g);
        colors[i * 4 + 2] *= Math.min(1, light[2] * tint.b);
      }
      vertices.colors = colors;
    }
    vertices.applyToMesh(mesh);
    mesh.material = mat; mesh.parent = this.content; mesh.isPickable = false; mesh.freezeWorldMatrix();
    return mesh;
  }

  async load(path: RoutePath, daylight: Daylight, onProgress: (text: string) => void, preview?: PreviewView) {
    this.diagnostic('load-start');
    for (const key of this.failedTextures) { this.textures.get(key)?.dispose(); this.textures.delete(key); }
    this.failedTextures.clear();
    const key = lightingKey(path.route, daylight), ridePath = path;
    if (this.loadedKey === key) {
      this.path = ridePath; this.gates(ridePath); this.showPreview(preview); this.resize();
      await this.prepareVisibleScene();
      this.canvas.dataset.ready = 'true'; return;
    }
    this.loadedKey = '';
    this.canvas.dataset.renderMode = 'full';
    // Scenery is canonical. Reversing only changes the rider and preview camera.
    path = new RoutePath(path.route);
    this.path = null;
    delete this.canvas.dataset.ready;
    this.bakingRoute = path;
    this.daylight = daylight; this.staticMaterials.clear();
    this.waterSurface = null;
    this.zones = []; this.pending = []; this.lastZoneX = Infinity; this.lastZoneZ = Infinity;
    this.content?.dispose(); this.content = null; this.ghost = null; this.riders = [];
    this.rotors = []; this.flock = []; this.gateGroup = null;
    for (const mat of this.materials) mat.dispose(false, false);
    this.materials = [];
    this.lightmap?.dispose(); this.lightmap = null;
    for (const light of [...this.scene.lights]) light.dispose();
    this.content = new TransformNode('route', this.scene);
    const palette = PALETTES[daylight], lighting = LIGHTING[daylight];
    this.scene.fogDensity = path.route.scenery === 'river' ? 0.00072 : 0.00105;
    this.scene.imageProcessingConfiguration.exposure = daylight === 'dia' ? 1.6 : 2.0;
    onProgress('Cargando la iluminación preparada…');
    this.lightmap = await new Promise<Texture>((resolve, reject) => {
      const fail = () => {
        clearTimeout(timer); texture.dispose();
        reject(new Error('No se ha podido cargar la iluminación guardada. Pulsa Reintentar.'));
      };
      const timer = setTimeout(fail, 15000);
      const texture = new Texture(`${import.meta.env.BASE_URL}lighting/${lightingKey(path.route, daylight)}.webp`, this.scene, false, true,
        Texture.TRILINEAR_SAMPLINGMODE, () => { clearTimeout(timer); resolve(texture); }, fail);
    });
    this.lightmap.coordinatesIndex = 1; this.lightmap.gammaSpace = false;
    this.lightmap.wrapU = this.lightmap.wrapV = Texture.CLAMP_ADDRESSMODE;
    // Soft lighting needs no anisotropic taps; reserve those for the road detail.
    this.lightmap.anisotropicFilteringLevel = 1;
    this.scene.shadowsEnabled = false;
    const sky = Color3.FromHexString(palette.sky);
    this.scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
    this.scene.fogColor = Color3.FromHexString(palette.fog);
    const ambient = new HemisphericLight('sky', new Vector3(0.2, 1, 0.3), this.scene);
    ambient.intensity = lighting.ambient; ambient.diffuse = Color3.FromHexString('#d8e6ff');
    ambient.groundColor = Color3.FromHexString('#4b4933');
    const sun = new DirectionalLight('sun', vec(lighting.direction).normalize(), this.scene);
    this.sunlight = sun;
    sun.diffuse = Color3.FromHexString(lighting.sun); sun.intensity = lighting.intensity;
    const skyDome = createSky(this.scene, this.scene.fogColor, this.photo('sky'), sun.direction.scale(-1), sun.diffuse, lighting.warmth);
    // Babylon only follows the camera for infiniteDistance meshes without a parent.
    // A route parent pinned the sky at the origin and exposed its edge on long routes.
    this.content.onDisposeObservable.add(() => skyDome.dispose());
    onProgress('Trazando la carretera…');
    await new Promise(resolve => setTimeout(resolve, 0));
    const field = this.photo('surface-field'); field.gammaSpace = false; field.anisotropicFilteringLevel = 1;
    const asphalt = this.material('asphalt', '#d4d7d5');
    asphalt.diffuseTexture = this.photo('road-grain', 4);
    new AsphaltSurface(asphalt, field);
    if (this.quality !== 'low') asphalt.bumpTexture = this.photo('road-normal', 4);
    asphalt.specularColor.set(0.12, 0.13, 0.14); asphalt.specularPower = 48;
    const biome = landscape(path.route);
    const look = surfaceLook(path.route);
    const grass = this.material('meadow', look.tint);
    const groundTexture = this.photo(path.route.scenery === 'alpine' ? 'gravel-Diffuse' : 'meadow-summer', path.route.scenery === 'alpine' ? 3 : 6);
    grass.diffuseTexture = groundTexture;
    grass.diffuseTexture.anisotropicFilteringLevel = 4;
    if (path.route.scenery !== 'alpine') new MeadowSurface(grass, field, look.dry);
    if (path.route.scenery === 'alpine') new LimestoneSurface(grass);
    const shoulder = this.material('shoulder', look.tint); shoulder.diffuseTexture = this.photo('verge-gravel', 5);
    new ShoulderSurface(shoulder, field, groundTexture, look.dry, path.route.scenery === 'alpine');
    const paint = this.material('paint', '#eee9ce');
    for (const material of [asphalt, grass, shoulder, paint]) {
      material.lightmapTexture = this.lightmap; material.useLightmapAsShadowmap = true;
    }
    for (const material of [grass, shoulder, paint]) this.staticSurface(material);
    for (const cell of terrainCells(path)) {
      const x = cell.x + TILE_SIZE / 2, z = cell.z + TILE_SIZE / 2;
      this.lazyZone(x, z, 140, 1050, () => this.mesh('terrain', terrainTile(path, cell.x, cell.z, terrainStep(path, cell.x, cell.z)), grass));
    }
    for (let from = 0; from < path.totalLength; from += TILE_SIZE) {
      const to = Math.min(path.totalLength, from + TILE_SIZE), middle = path.sample((from + to) / 2).position;
      const radius = (to - from) / 2 + 8;
      this.lazyZone(middle.x, middle.z, radius, 850, () => this.mesh('shoulders', shoulderBanks(path, from, to), shoulder));
      this.lazyZone(middle.x, middle.z, radius, 850, () => {
        const surface = roadSurface(path, [-3, -1.5, 0, 1.5, 3], from, to);
        roadRepairs(path, from, to, surface);
        return this.mesh('road', surface, asphalt);
      });
      this.lazyZone(middle.x, middle.z, radius, 850, () => {
        const lines = markings(path, from, to);
        for (const side of [-1, 1]) {
          const edge = roadSurface(path, [side * 2.76 - 0.05, side * 2.76 + 0.05], from, to, 0.02);
          const base = lines.positions.length / 3;
          lines.positions.push(...edge.positions); lines.indices.push(...edge.indices.map(n => n + base));
          lines.uvs.push(...edge.uvs); lines.colors.push(...edge.colors);
        }
        return this.mesh('paint', lines, paint);
      });
    }
    onProgress('Plantando el paisaje…');
    await new Promise(resolve => setTimeout(resolve, 0));
    const towns = villages(path.route);
    this.trees(path, towns);
    this.verges(path);
    this.flowers(path);
    this.life(path, towns);
    this.gates(ridePath);
    const range = backdrop(this.scene, path.route.scenery ?? 'meadow', this.scene.fogColor);
    this.content.onDisposeObservable.add(() => range.dispose());
    this.hills(path, biome.grass);
    this.landmarks(path);
    this.roadFurniture(path);
    this.cockpit();
    this.ghost = this.ghostBike();
    this.peloton();
    this.path = ridePath;
    this.showPreview(preview, false);
    this.resize();
    onProgress('Abriendo la vista previa…');
    await this.settleZones();
    try { await this.prepareVisibleScene(); }
    catch (error) { this.path = null; throw error; }
    this.loadedKey = key;
    this.needsRender = true;
    this.canvas.dataset.ready = 'true';
  }

  private async prepareVisibleScene() {
    const started = performance.now(), deadline = started + 15000;
    let simplified = false;
    this.preparing = true;
    delete this.canvas.dataset.loadError;
    try {
      while (true) {
        if (this.contextUnavailable) {
          if (performance.now() >= deadline) throw new Error('El navegador ha perdido la conexión con la GPU. Pulsa Reintentar cuando se recupere.');
          await new Promise(resolve => setTimeout(resolve, 32)); continue;
        }
        if (this.failedTextures.size) throw new Error('No se han podido cargar los materiales. Pulsa Reintentar.');
        this.scene.render();
        // Enabled terrain can still be behind the camera. Checking those meshes
        // starts extra shader compilations and can block an already complete view.
        const active = this.scene.getActiveMeshes();
        const visible = active.data.slice(0, active.length);
        const pending = visible.filter(mesh => !mesh.isReady(true));
        if (visible.length && !pending.length) { this.scene.render(); this.diagnostic('ready'); return; }
        const shaderError = pending.some(mesh => mesh.subMeshes?.some(sub => sub.effect?.getCompilationError()));
        if (!simplified && pending.length && (shaderError || performance.now() - started > 4000)) {
          this.diagnostic('simplify', pending);
          this.simplifyMaterials(pending);
          simplified = true; this.canvas.dataset.renderMode = 'compatible'; this.onCompatibilityMode();
        }
        if (performance.now() >= deadline) {
          const names = [...new Set(pending.map(mesh => mesh.material?.name ?? mesh.name))];
          this.canvas.dataset.loadError = names.join(', ');
          console.error('MegaBici: materiales pendientes', names);
          this.diagnostic('timeout', pending);
          throw new Error('La vista 3D no ha podido abrirse. Pulsa Reintentar.');
        }
        await new Promise(resolve => setTimeout(resolve, 32));
      }
    } finally { this.preparing = false; }
  }

  private simplifyMaterials(pending: Scene['meshes']) {
    // Keep route geometry and baked shadows. Only replace materials this GPU
    // cannot prepare; no bump map, custom shader or dynamic lighting is required.
    for (const original of new Set(pending.map(mesh => mesh.material).filter(mat => mat !== null))) {
      const fallback = this.material(`compatible-${original.name}`, '#a5b6a0');
      fallback.disableLighting = true; fallback.emissiveColor = Color3.White();
      fallback.backFaceCulling = original.backFaceCulling;
      fallback.disableDepthWrite = original.disableDepthWrite;
      if (original instanceof StandardMaterial) {
        fallback.diffuseColor = original.diffuseColor.clone();
        fallback.diffuseTexture = original.diffuseTexture;
        fallback.lightmapTexture = original.lightmapTexture;
        fallback.useLightmapAsShadowmap = original.useLightmapAsShadowmap;
        fallback.useAlphaFromDiffuseTexture = original.useAlphaFromDiffuseTexture;
        fallback.transparencyMode = original.transparencyMode; fallback.alphaCutOff = original.alphaCutOff;
        if (original.disableLighting) fallback.emissiveColor = original.emissiveColor.clone();
        else fallback.emissiveColor = original.diffuseColor.clone();
        if (fallback.diffuseTexture instanceof Texture) {
          fallback.diffuseTexture.isBlocking = false;
          fallback.diffuseTexture.onLoadObservable.addOnce(() => { this.needsRender = true; });
        }
      } else {
        // The photographic sky is optional while its shader/texture is unavailable.
        fallback.emissiveColor = this.scene.fogColor.clone();
      }
      for (const mesh of this.scene.meshes) if (mesh.material === original) mesh.material = fallback;
    }
  }

  private photo(name: string, repeat = 1) {
    const key = `${name}:${repeat}`;
    if (this.failedTextures.delete(key)) { this.textures.get(key)?.dispose(); this.textures.delete(key); }
    const cached = this.textures.get(key);
    if (cached) return cached;
    const texture = new Texture(`${import.meta.env.BASE_URL}textures/${name}.webp`, this.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE,
      undefined, () => this.failedTextures.add(key));
    texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.uScale = texture.vScale = repeat;
    texture.anisotropicFilteringLevel = 8;
    if (name === 'asphalt-nor_gl') texture.level = 0.24;
    if (name === 'grass-nor_gl') texture.level = 0.35;
    if (name === 'road-normal') { texture.level = 0.42; texture.gammaSpace = false; }
    this.textures.set(key, texture);
    return texture;
  }
  private staticSurface(material: StandardMaterial) {
    material.disableLighting = true; material.emissiveColor = Color3.White();
    this.staticMaterials.add(material);
  }
  private zone(mesh: Mesh, range: number, minRange = 0) {
    const bounds = mesh.getBoundingInfo().boundingSphere;
    this.zones.push({ mesh, build: null, x: bounds.centerWorld.x, z: bounds.centerWorld.z, radius: bounds.radiusWorld,
      range, minRange, distance: 0, wanted: true, queued: false });
    return mesh;
  }
  private lazyZone(x: number, z: number, radius: number, range: number, build: () => Mesh, minRange = 0) {
    this.zones.push({ mesh: null, build, x, z, radius, range, minRange, distance: 0, wanted: false, queued: false });
  }
  private updateZones(x = this.camera.position.x, z = this.camera.position.z) {
    if (Math.hypot(x - this.lastZoneX, z - this.lastZoneZ) < 16) return;
    this.lastZoneX = x; this.lastZoneZ = z;
    let queued = false;
    for (const zone of this.zones) {
      const distance = zone.distance = Math.hypot(x - zone.x, z - zone.z);
      const nearRange = this.quality === 'low' ? 90 : 180;
      const range = zone.range === 180 ? nearRange : zone.range === 28 && this.quality === 'low' ? 18 : zone.range;
      const minRange = zone.minRange === 180 ? nearRange : zone.minRange;
      zone.wanted = distance < range + zone.radius && (minRange === 0 || distance >= minRange + zone.radius);
      if (zone.mesh) {
        if (zone.build && !zone.wanted && distance > range + zone.radius + ZONE_KEEP) { zone.mesh.dispose(); zone.mesh = null; }
        else zone.mesh.setEnabled(zone.wanted);
      } else if (zone.wanted && !zone.queued) { zone.queued = queued = true; this.pending.push(zone); }
    }
    // Nearest last: the builder takes zones from the end.
    if (queued) this.pending.sort((a, b) => b.distance - a.distance);
  }
  /** Builds queued zones, nearest first, until the time allowed for this frame runs out. */
  private buildZones(budgetMs: number) {
    const started = performance.now();
    while (this.pending.length) {
      const zone = this.pending.pop()!;
      zone.queued = false;
      if (!zone.wanted || zone.mesh) continue;
      zone.mesh = zone.build!(); zone.mesh.setEnabled(true);
      this.needsRender = true;
      if (performance.now() - started > budgetMs) break;
    }
  }
  private async settleZones() {
    while (this.pending.length) {
      this.buildZones(12);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  /** Builds the scenery around a point before the camera gets there, e.g. the start line. */
  async warm(position: Vec3) {
    if (!this.path) return;
    const render = this.needsRender;
    this.lastZoneX = Infinity; this.updateZones(position.x, position.z);
    await this.settleZones();
    // The camera has not moved yet: do not present a frame with the old view half switched off.
    this.needsRender = render;
  }
  /** `tints` holds four colour values per transform; each instance is multiplied by its own. */
  private instances(mesh: Mesh, transforms: Matrix[], range = 650, minRange = 0, cellSize = TILE_SIZE, tints?: number[]) {
    const cells = new Map<string, Matrix[]>(), shades = new Map<string, number[]>();
    transforms.forEach((transform, n) => {
      const key = `${Math.floor(transform.m[12] / cellSize)},${Math.floor(transform.m[14] / cellSize)}`;
      if (!cells.has(key)) { cells.set(key, []); shades.set(key, []); }
      cells.get(key)!.push(transform);
      if (tints) shades.get(key)!.push(...tints.slice(n * 4, n * 4 + 4));
    });
    const local = mesh.getBoundingInfo().boundingSphere, reach = local.center.length() + local.radius;
    // The template stays hidden and is cloned per batch while that batch is near.
    mesh.parent = this.content; mesh.setEnabled(false);
    // Thin-instance matrix attributes belong to the geometry in Babylon. Each
    // spatial batch needs its own geometry to avoid overwriting another batch.
    for (const [key, matrices] of cells) {
      const buffer = new Float32Array(matrices.length * 16);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, size = 0;
      matrices.forEach((m, i) => {
        m.copyToArray(buffer, i * 16);
        const v = m.m;
        minX = Math.min(minX, v[12]); maxX = Math.max(maxX, v[12]); minZ = Math.min(minZ, v[14]); maxZ = Math.max(maxZ, v[14]);
        size = Math.max(size, Math.hypot(v[0], v[1], v[2]), Math.hypot(v[4], v[5], v[6]), Math.hypot(v[8], v[9], v[10]));
      });
      const colors = new Float32Array(shades.get(key)!);
      this.lazyZone((minX + maxX) / 2, (minZ + maxZ) / 2, Math.hypot(maxX - minX, maxZ - minZ) / 2 + size * reach, range, () => {
        const part = mesh.clone(`${mesh.name}-${key}`, this.content)!;
        part.makeGeometryUnique();
        part.thinInstanceSetBuffer('matrix', buffer, 16, true);
        if (tints) part.thinInstanceSetBuffer('color', colors, 4, true);
        part.isPickable = false; part.freezeWorldMatrix();
        return part;
      }, minRange);
    }
  }
  private trees(path: RoutePath, towns: Village[]) {
    const houses = towns.flatMap(town => town.houses);
    const bark = this.material('bark', '#b6afa0'); bark.diffuseTexture = this.photo('bark_diff', 1);
    const river = path.route.scenery === 'river';
    const foliage = (name: string, photo: string) => {
      const leaves = this.material(name, '#edf0d1');
      leaves.diffuseTexture = this.photo(photo); leaves.diffuseTexture.hasAlpha = true;
      leaves.useAlphaFromDiffuseTexture = true;
      leaves.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST; leaves.alphaCutOff = 0.4;
      leaves.backFaceCulling = false; leaves.twoSidedLighting = true;
      // The cutout already contains soft lighting. Relighting each crossed plane
      // separately exposes its flat shape and makes back-facing foliage black.
      leaves.disableLighting = true;
      leaves.emissiveColor = this.sunlight!.diffuse.scale(0.9);
      return leaves;
    };
    const kinds = { pine: { matrices: [] as Matrix[], tints: [] as number[] }, spruce: { matrices: [] as Matrix[], tints: [] as number[] },
      alder: { matrices: [] as Matrix[], tints: [] as number[] } };
    const trunks: Matrix[] = [];
    // No two trees are quite the same green: some darker, some yellower, a few already turning.
    const tinted = (x: number, z: number, into: number[]) => {
      const n = Math.imul(Math.round(x * 3), 73856093) ^ Math.imul(Math.round(z * 3), 19349663);
      const light = 0.78 + hash(n, 61) * 0.3, warm = (hash(n, 62) - 0.45) * 0.2, turning = hash(n, 63) > 0.94 ? 0.22 : 0;
      into.push(light * (1 + warm + turning), light * (1 - turning * 0.25), light * (1 - warm * 0.8 - turning), 1);
    };
    for (const tree of treeLayout(path.route)) {
      // The baked shade of a tree that gives way to a house simply reads as the house's own.
      if (houses.some(house => Math.hypot(house.x - tree.x, house.z - tree.z) < 9)) continue;
      const h = tree.height;
      const q = Quaternion.RotationYawPitchRoll(tree.yaw, tree.lean, 0);
      trunks.push(Matrix.Compose(new Vector3(h * 0.035, h * 0.27, h * 0.035), q, new Vector3(tree.x, tree.y + h * 0.135, tree.z)));
      kinds[tree.kind].matrices.push(Matrix.Compose(new Vector3(h, h, h), q, new Vector3(tree.x, tree.y, tree.z)));
      tinted(tree.x, tree.z, kinds[tree.kind].tints);
    }
    // Undergrowth: low bushes fill the ground between the road and the trees. They cast no baked shade.
    const bushes = { matrices: [] as Matrix[], tints: [] as number[] }, lake = lakeFor(path.route);
    const cover = { meadow: 0.3, lake: 0.4, river: 0.45, alpine: 0.12, reservoir: 0.2, chapel: 0.22 }[path.route.scenery ?? 'meadow'];
    for (let i = 0, d = 0; d < path.totalLength; i++, d += 9) for (const side of [-1, 1]) for (let n = 0; n < 2; n++) {
      const seed = i * 23 + side + n * 4099;
      if (hash(seed, 801) > cover) continue;
      const p = roadside(path, d + hash(seed, 802) * 9, side * (7 + hash(seed, 803) ** 1.6 * 60));
      if (groundNoise(p.x, p.z, 230, 77) < 0.3 || houses.some(house => Math.hypot(house.x - p.x, house.z - p.z) < 9)) continue;
      const ground = groundAt(path, p.x, p.z);
      if (ground.distance < 6.5 || (lake && lakeRadius(lake, p.x, p.z) < 1.18)) continue;
      if (river) { const bed = riverProfile(ground.along); if (Math.abs(ground.lateral - bed.center) < bed.halfWidth + 5) continue; }
      const h = 1.3 + hash(seed, 804) * 2.2;
      bushes.matrices.push(Matrix.Compose(new Vector3(h * 1.5, h, h * 1.5), Quaternion.RotationYawPitchRoll(hash(seed, 805) * 6.28, 0, 0),
        new Vector3(p.x, terrainHeightAt(path, p.x, p.z) - h * 0.12, p.z)));
      tinted(p.x, p.z, bushes.tints);
    }
    const trunk = CreateCylinder('trunks', { height: 1, diameterBottom: 1, diameterTop: 0.08, tessellation: 7 }, this.scene);
    trunk.material = bark; this.instances(trunk, trunks, 180);
    const far = river ? 1100 : 800;
    const plant = (name: string, crown: (detailed: boolean) => Geometry, leaves: StandardMaterial, group: { matrices: Matrix[]; tints: number[] }) => {
      if (!group.matrices.length) return;
      this.instances(this.mesh(`${name}-near`, crown(true), leaves), group.matrices, 180, 0, TILE_SIZE, group.tints);
      this.instances(this.mesh(`${name}-far`, crown(false), leaves), group.matrices, far, 180, TILE_SIZE, group.tints);
    };
    if (kinds.pine.matrices.length) plant('pine', pineCrown, foliage('pine-needles', 'pine-tree'), kinds.pine);
    if (kinds.spruce.matrices.length || kinds.alder.matrices.length || bushes.matrices.length) {
      const broadleaf = foliage('valley-leaves', 'valley-trees');
      plant('spruce', detailed => forestCrown(detailed, 'spruce'), broadleaf, kinds.spruce);
      plant('alder', detailed => forestCrown(detailed, 'alder'), broadleaf, kinds.alder);
      if (bushes.matrices.length) this.instances(this.mesh('bushes', forestCrown(false, 'alder'), broadleaf), bushes.matrices, 300, 0, TILE_SIZE, bushes.tints);
    }
  }
  private verges(path: RoutePath) {
    const look = surfaceLook(path.route);
    const meadow = this.material('meadow-clumps', '#ffffff');
    meadow.backFaceCulling = false;
    meadow.disableLighting = true; meadow.emissiveColor = this.sunlight!.diffuse;
    new GrassSurface(meadow);
    const patches: Matrix[] = [];
    for (let i = 0, d = 0; d < path.totalLength; i++, d += look.step) for (const side of [-1, 1]) for (let row = 0; row < look.rows; row++) {
      const seed = i * 13 + row * 7901 + side;
      if (hash(seed, 113) < 0.12) continue;
      const p = roadside(path, Math.min(path.totalLength, d + hash(seed, 51) * 1.5), side * (3.8 + row * 2.5 + hash(seed, 43) * 1.8));
      const ground = groundAt(path, p.x, p.z);
      if (ground.distance < 3.6) continue;
      let y = terrainHeightAt(path, p.x, p.z);
      if (ground.distance < 5.3) {
        const blend = Math.max(0, (ground.distance - 3.4) / 1.9);
        y = (p.y + roadHeight(3)) * (1-blend) + (y + 0.015) * blend;
      }
      const width = 0.8 + hash(seed, 64) * 0.8, height = (0.65 + hash(seed, 67) * 0.65) * look.height;
      patches.push(Matrix.Compose(new Vector3(width, height, width), Quaternion.RotationYawPitchRoll(hash(seed, 62) * 6.28, 0, 0), new Vector3(p.x, y, p.z)));
    }
    this.instances(this.mesh('meadow-patches', meadowClump(look.dry), meadow), patches, 28, 0, 24);
  }
  private flowers(path: RoutePath) {
    const density = { meadow: 0.5, lake: 0.45, river: 0.5, alpine: 0.14, reservoir: 0.22, chapel: 0.28 }[path.route.scenery ?? 'meadow'];
    const palettes: [number, number, number][][] = [[[0.86, 0.2, 0.16], [0.95, 0.42, 0.2]], [[0.96, 0.82, 0.22], [0.97, 0.95, 0.88]], [[0.58, 0.44, 0.84], [0.93, 0.6, 0.78]]];
    const petals = this.material('flowers', '#ffffff');
    petals.backFaceCulling = false; petals.disableLighting = true; petals.emissiveColor = this.sunlight!.diffuse;
    const patches: Matrix[][] = palettes.map(() => []);
    for (let i = 0, d = 0; d < path.totalLength; i++, d += 3.5) for (const side of [-1, 1]) {
      const seed = i * 17 + side;
      if (hash(seed, 601) > density) continue;
      // Flowers come in drifts: thick for a while, then none.
      if (Math.sin(d / 90 + side) + Math.sin(d / 37) < -0.2) continue;
      const p = roadside(path, d, side * (5.8 + hash(seed, 602) ** 2 * 16));
      if (groundAt(path, p.x, p.z).distance < 5.6) continue;
      const size = 0.9 + hash(seed, 603) * 0.9;
      patches[Math.floor(hash(Math.floor(d / 60), 604) * palettes.length)].push(Matrix.Compose(new Vector3(size, size, size),
        Quaternion.RotationYawPitchRoll(hash(seed, 605) * 6.28, 0, 0), new Vector3(p.x, terrainHeightAt(path, p.x, p.z), p.z)));
    }
    palettes.forEach((palette, n) => this.instances(this.mesh(`flowers-${n}`, flowerClump(palette), petals), patches[n], 70, 0, 48));
  }
  /** Villages, animals, fences, turbines and birds: the things that make a road somewhere. */
  private life(path: RoutePath, towns: Village[]) {
    const scenery = path.route.scenery ?? 'meadow';
    const props = this.material('props', '#ffffff'); props.backFaceCulling = false; props.twoSidedLighting = true;
    const settle = (mesh: Mesh, spot: Spot, sink = 0) => {
      mesh.parent = this.content; mesh.material = props;
      mesh.position.set(spot.x, spot.y - sink, spot.z); mesh.rotation.y = spot.yaw; mesh.scaling.setAll(spot.size);
      mesh.freezeWorldMatrix();
      return mesh;
    };
    for (const town of towns) {
      for (const spot of town.houses) this.lazyZone(spot.x, spot.z, 12, 750, () => settle(house(this.scene, spot.seed, scenery), spot, 0.4));
      for (const sign of town.signs) this.lazyZone(sign.x, sign.z, 3, 260, () => {
        const name = board(this.scene, label(this.scene, [town.name], 512, 160, '#e9e5d6', '#1d3a2f'), 2.3, 0.72);
        const pole = box(this.scene, [0.09, 1.5, 0.09], [0, -1.1, 0.06], '#7d8387'); pole.parent = name; pole.material = props;
        name.parent = this.content; name.position.set(sign.x, sign.y + 1.9, sign.z); name.rotation.y = sign.yaw;
        return name;
      });
    }
    const compose = (spot: Spot, scale: Vector3, lift = 0, pitch = 0) => Matrix.Compose(scale,
      Quaternion.RotationYawPitchRoll(spot.yaw, pitch, 0), new Vector3(spot.x, spot.y + lift, spot.z));
    const scatter = (mesh: Mesh, matrices: Matrix[], range: number) => { mesh.material = props; if (matrices.length) this.instances(mesh, matrices, range); else mesh.dispose(); };
    scatter(sheep(this.scene), flocks(path.route).map(s => compose(s, new Vector3(s.size, s.size, s.size))), 320);
    scatter(bale(this.scene), bales(path.route).map(s => compose(s, new Vector3(s.size, s.size, s.size))), 420);
    const { fences, guards } = barriers(path.route);
    const rails = (list: Rail[], thick: number, tall: number, heights: number[]) => list.flatMap(r =>
      heights.map(h => compose(r, new Vector3(thick, tall, r.length), h, r.pitch)));
    scatter(post(this.scene, '#8c6d4c'), fences.posts.map(p => compose(p, new Vector3(0.13, 1.15, 0.13), -0.1)), 260);
    scatter(rail(this.scene, '#9a7a56'), rails(fences.rails, 0.06, 0.11, [0.45, 0.88]), 260);
    scatter(post(this.scene, '#7f858a'), guards.posts.map(p => compose(p, new Vector3(0.09, 0.72, 0.09), -0.12)), 320);
    scatter(rail(this.scene, '#b9bec2'), rails(guards.rails, 0.05, 0.31, [0.46]), 320);
    for (const spot of turbines(path.route)) this.lazyZone(spot.x, spot.z, 45, 1500, () => {
      const { mesh, rotor } = turbine(this.scene);
      rotor.material = props; rotor.isPickable = false; this.rotors.push(rotor);
      return settle(mesh, spot, 2);
    });
    const feathers = this.material('birds', '#000000');
    feathers.disableLighting = true; feathers.emissiveColor = Color3.FromHexString('#22272b'); feathers.backFaceCulling = false;
    this.flock = Array.from({ length: 7 }, (_, i) => {
      const node = new TransformNode(`bird-${i}`, this.scene); node.parent = this.content;
      const wings = bird(this.scene);
      for (const wing of wings) { wing.parent = node; wing.material = feathers; }
      node.setEnabled(false);
      return { node, wings };
    });
  }
  /** What depends on the direction ridden: start and finish arches, sector banners and kilometre boards. */
  private gates(path: RoutePath) {
    this.gateGroup?.dispose();
    const group = this.gateGroup = new TransformNode('gates', this.scene); group.parent = this.content;
    const props = this.materials.find(m => m.name === 'props')!;
    const frame = (distance: number) => {
      const node = new TransformNode('gate', this.scene), s = path.sample(distance);
      node.parent = group; node.position.set(s.position.x, s.position.y, s.position.z); node.rotation.y = Math.atan2(s.forward.x, s.forward.z);
      return node;
    };
    const arch = (distance: number, text: string) => {
      const node = frame(distance), green = '#193f32';
      const body = merged([box(this.scene, [0.55, 6.6, 0.55], [-4.1, 2.9, 0], green), box(this.scene, [0.55, 6.6, 0.55], [4.1, 2.9, 0], green),
        box(this.scene, [8.75, 1.25, 0.6], [0, 5.6, 0], green), box(this.scene, [8.75, 0.12, 0.66], [0, 6.28, 0], '#d4ef9c')], 'arch');
      body.parent = node; body.material = props;
      for (const turn of [0, Math.PI]) {
        const banner = board(this.scene, label(this.scene, [text], 1024, 128, green, '#d4ef9c'), 7.4, 0.95);
        banner.parent = node; banner.position.set(0, 5.6, turn ? 0.32 : -0.32); banner.rotation.y = turn;
      }
    };
    if (path.isCircuit) arch(0, 'META');
    else { arch(Math.min(14, path.totalLength / 4), 'SALIDA'); arch(path.totalLength - 1, 'META'); }
    for (const n of [1, 2]) {
      const node = frame(path.totalLength * n / 3);
      for (const side of [-1, 1]) {
        const banner = board(this.scene, label(this.scene, ['SECTOR', String(n + 1)], 160, 400, '#7d4bc4', '#ffffff'), 1.0, 2.5);
        banner.parent = node; banner.position.set(side * 4.5, 2.6, 0);
        const pole = box(this.scene, [0.08, 4.2, 0.08], [side * (4.5 + 0.56), 2.0, 0], '#e7e9ea'); pole.parent = node; pole.material = props;
      }
    }
    // Every kilometre board shares one texture and one mesh.
    const count = Math.floor((path.totalLength - 150) / 1000);
    if (count < 1) return;
    const columns = 8, rows = Math.ceil((count + 1) / columns), atlas = label(this.scene, [], columns * 128, rows * 64, '#f4f1e6', '#1d3a2f');
    const texture = atlas.diffuseTexture as DynamicTexture, ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 34px Poppins, sans-serif';
    const data = new VertexData(), positions: number[] = [], uvs: number[] = [], normals: number[] = [], indices: number[] = [];
    const quad = (center: Vec3, right: Vec3, face: Vec3, width: number, height: number, cell: number) => {
      const base = positions.length / 3, col = cell % columns, row = Math.floor(cell / columns);
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        positions.push(center.x + right.x * sx * width / 2, center.y + sy * height / 2, center.z + right.z * sx * width / 2);
        uvs.push((col + (sx + 1) / 2) / columns, 1 - (row + (1 - sy) / 2) / rows); normals.push(face.x, 0, face.z);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    // The cell after the last number is plain grey: it paints the posts.
    ctx.fillStyle = '#7d8387'; ctx.fillRect(count % columns * 128, Math.floor(count / columns) * 64, 128, 64);
    for (let k = 1; k <= count; k++) {
      const cell = k - 1, s = path.sample(k * 1000), f = s.forward, flat = Math.hypot(f.x, f.z) || 1;
      const right = { x: f.z / flat, y: 0, z: -f.x / flat }, face = { x: -f.x / flat, y: 0, z: -f.z / flat };
      const foot = roadside(path, k * 1000, 4.8);
      ctx.fillStyle = '#1d3a2f'; ctx.fillText(`KM ${k}`, cell % columns * 128 + 64, Math.floor(cell / columns) * 64 + 34);
      quad({ x: foot.x, y: foot.y + 1.55, z: foot.z }, right, face, 1.15, 0.58, cell);
      quad({ x: foot.x, y: foot.y + 0.62, z: foot.z }, right, face, 0.08, 1.3, count);
    }
    texture.update();
    data.positions = positions; data.indices = indices; data.uvs = uvs; data.normals = normals;
    const boards = new Mesh('km-boards', this.scene); data.applyToMesh(boards);
    boards.material = atlas; boards.parent = group; boards.isPickable = false;
    boards.onDisposeObservable.add(() => atlas.dispose(true, true));
  }
  private landmarks(path: RoutePath) {
    const lake = lakeFor(path.route);
    if (lake || path.route.scenery === 'river') {
      const water = this.material('water', '#b1bdba');
      water.diffuseTexture = this.photo('surface-field');
      this.waterSurface = new WaterSurface(water, this.photo('surface-field'), lake ? path.route.scenery === 'reservoir' ? 'reservoir' : 'lake' : 'river');
      water.specularColor.set(0.22, 0.27, 0.28); water.specularPower = 96;
      water.emissiveColor = Color3.FromHexString('#050f13');
      {
        const reflection = this.photo('sky').clone();
        reflection.coordinatesMode = Texture.EQUIRECTANGULAR_MODE;
        reflection.level = 0.72;
        water.reflectionTexture = reflection;
        water.reflectionFresnelParameters = new FresnelParameters({ bias: 0.12, power: 3,
          leftColor: new Color3(0.22, 0.25, 0.26), rightColor: Color3.White() });
        this.content!.onDisposeObservable.add(() => reflection.dispose());
      }
      // Opaque water: animated normals reuse this pass and stop when the ride pauses.
      if (lake) {
        const data: Geometry = { positions: [lake.x, lake.level, lake.z], indices: [], uvs: [0.5, 0.5], colors: [0.78, 0.88, 0.95, 1] };
        for (let i = 0; i <= 96; i++) {
          const a = i / 96 * Math.PI * 2, x = Math.cos(a), z = Math.sin(a);
          data.positions.push(lake.x + x * lake.rx * 1.16, lake.level, lake.z + z * lake.rz * 1.16);
          data.uvs.push(x * 0.5 + 0.5, z * 0.5 + 0.5); data.colors.push(1, 1, 1, 1);
          if (i < 96) data.indices.push(0, i + 1, i + 2);
        }
        this.zone(this.mesh('lake-water', data, water), 1500);
        this.lakeBanks(path);
      } else {
        for (let from = 0; from < path.totalLength; from += TILE_SIZE) {
          const to = Math.min(from + TILE_SIZE, path.totalLength), bank = roadside(path, (from + to) / 2, riverProfile((from + to) / 2).center);
          this.lazyZone(bank.x, bank.z, (to - from) / 2 + 30, 1250, () => this.mesh('river-water', riverRibbon(path, from, to), water));
        }
        this.riverBanks(path);
      }
    }
    if (['alpine', 'reservoir', 'chapel'].includes(path.route.scenery ?? '')) {
      const stone = this.material('limestone', '#c2bdb0'); stone.diffuseTexture = this.photo('gravel-Diffuse', 3);
      new LimestoneSurface(stone);
      const transforms: Matrix[] = [];
      const alpine = path.route.scenery === 'alpine';
      for (let i = 0, d = 0; d < path.totalLength; i++, d += alpine ? 65 : 140) {
        for (const side of [-1, 1]) {
          const p = roadside(path, d, side * (18 + hash(i, 810 + side) * 110));
          const ground = groundAt(path, p.x, p.z);
          if (ground.distance < 12 || (lake && ground.height < lake.level + 2)) continue;
          const size = (alpine ? 6 : 3) + hash(i, 316) * (alpine ? 16 : 7);
          transforms.push(Matrix.Compose(new Vector3(size * 1.5, size, size * 0.85),
            Quaternion.RotationYawPitchRoll(hash(i, 61) * 6.28, 0.25, 0.2), new Vector3(p.x, terrainHeightAt(path, p.x, p.z) - size * 0.2, p.z)));
        }
      }
      const rock = CreateSphere('rock-outcrops', { diameter: 1, segments: 3 }, this.scene);
      rock.material = stone; this.instances(rock, transforms, 650);
    }
    if (path.route.scenery === 'chapel') {
      const d = path.totalLength * 0.72, p = roadside(path, d, 26), f = path.sample(d).forward;
      const group = new TransformNode('hill-chapel', this.scene); group.parent = this.content;
      group.position.set(p.x, groundAt(path, p.x, p.z).height, p.z); group.rotation.y = Math.atan2(f.x, f.z);
      const wall = this.material('chapel-stone', '#ece0c2'), roof = this.material('terracotta', '#a85d40');
      const dark = this.material('chapel-door', '#514335');
      const box = (name: string, size: Vec3, position: Vec3, material: StandardMaterial) => {
        const mesh = CreateBox(name, { width: size.x, height: size.y, depth: size.z }, this.scene);
        mesh.parent = group; mesh.position = vec(position); mesh.material = material; mesh.isPickable = false;
        mesh.computeWorldMatrix(true); this.zone(mesh, 850); return mesh;
      };
      box('chapel-base', { x: 14, y: 3, z: 19 }, { x: 0, y: 0, z: 0 }, wall);
      box('chapel-nave', { x: 9, y: 6, z: 14 }, { x: 0, y: 4, z: 0 }, wall);
      for (const side of [-1, 1]) {
        const r = box('chapel-roof', { x: 5.8, y: 0.45, z: 15 }, { x: side * 2.35, y: 7.6, z: 0 }, roof);
        r.rotation.z = side * -0.42;
      }
      box('chapel-bell-tower', { x: 3, y: 10, z: 3 }, { x: -3, y: 6, z: -5 }, wall);
      box('chapel-entrance', { x: 2.2, y: 3.4, z: 0.12 }, { x: 0, y: 2.7, z: -7.07 }, dark);
      box('chapel-bell-opening', { x: 1.3, y: 2, z: 0.12 }, { x: -3, y: 9.2, z: -6.57 }, dark);
    }
  }
  private lakeBanks(path: RoutePath) {
    const lake = lakeFor(path.route)!;
    const stones: Matrix[] = [];
    // Find the actual mesh/water intersection once, then instance a modest shore fringe.
    for (let i = 0; i < 160; i++) {
      if (hash(i, 902) < 0.38) continue;
      const angle = (i + hash(i, 903) * 0.7) / 160 * Math.PI * 2;
      const dx = Math.cos(angle) * lake.rx, dz = Math.sin(angle) * lake.rz;
      const height = (r: number) => terrainHeightAt(path, lake.x + dx * r, lake.z + dz * r);
      let lo = 0.92, hi = 1.16;
      if (height(lo) > lake.level || height(hi) < lake.level + 0.3) continue;
      for (let n = 0; n < 9; n++) {
        const mid = (lo + hi) / 2;
        if (height(mid) < lake.level + 0.25) lo = mid; else hi = mid;
      }
      const x = lake.x + dx * hi, z = lake.z + dz * hi;
      if (groundAt(path, x, z).distance < 9) continue;
      const size = 0.4 + hash(i, 904) * 1.5;
      stones.push(Matrix.Compose(new Vector3(size * 1.6, size * 0.7, size),
        Quaternion.RotationYawPitchRoll(hash(i, 905) * 6.28, 0.2, 0.1),
        new Vector3(x, height(hi) - size * 0.1, z)));
    }
    const stone = this.material('lake-shore-stone', '#b3b4a8');
    stone.diffuseTexture = this.photo('verge-gravel', 5);
    const rock = CreateSphere('lake-shore-rocks', { diameter: 1, segments: 3 }, this.scene);
    rock.material = stone; this.instances(rock, stones, 550);
  }
  private riverBanks(path: RoutePath) {
    const stone = this.material('river-stone', '#b0b4a6');
    stone.diffuseTexture = this.photo('verge-gravel', 5);
    const rocks: Matrix[] = [], reeds: Matrix[] = [];
    for (let i = 0, d = 0; d < path.totalLength; i++, d += 7) {
      const profile = riverProfile(d);
      for (const side of [-1, 1]) {
        if (hash(i, 26 + side) < 0.32) continue;
        const p = roadside(path, d, profile.center + side * (profile.halfWidth + 2 + hash(i, 51 + side) * 4));
        const size = 0.35 + hash(i, 81 + side) * 1.3;
        const q = Quaternion.RotationYawPitchRoll(hash(i, 61 + side) * 6.28, 0.15, 0.1);
        rocks.push(Matrix.Compose(new Vector3(size * 1.8, size, size * 1.2), q,
          new Vector3(p.x, terrainHeightAt(path, p.x, p.z) - size * 0.08, p.z)));
        for (let n = 0; n < 3; n++) {
          const r = roadside(path, d + n * 1.5, profile.center + side * (profile.halfWidth + 6 + hash(i + n, 18) * 3));
          const y = terrainHeightAt(path, r.x, r.z);
          reeds.push(Matrix.Compose(new Vector3(2, 1.3 + hash(i + n, 21), 2), q, new Vector3(r.x, y, r.z)));
        }
      }
    }
    const rock = CreateSphere('river-rocks', { diameter: 1, segments: 3 }, this.scene);
    rock.material = stone; this.instances(rock, rocks, 550);
    const rush = this.material('river-rushes', '#888b54'); rush.backFaceCulling = false;
    this.instances(this.mesh('river-reeds', grassTuft(), rush), reeds, 450);
  }
  private hills(path: RoutePath, color: string) {
    const material = this.material('hills', color);
    material.diffuseColor = material.diffuseColor.scale(0.79);
    const lake = lakeFor(path.route);
    const transforms: Matrix[] = [];
    for (let i = 0, d = 0; d < path.totalLength; i++, d += 450) {
      for (const side of [-1, 1]) {
        const p = roadside(path, d, side * (650 + hash(i, 50) * 200));
        if (groundAt(path, p.x, p.z).distance < 450) continue;
        if (lake && lakeRadius(lake, p.x, p.z) < 1.7) continue;
        transforms.push(Matrix.Compose(new Vector3(950 + hash(i, 4) * 350, (100 + hash(i, 7) * 150) * Math.sqrt(landscape(path.route).relief), 850),
          Quaternion.Identity(), new Vector3(p.x, p.y - 60, p.z)));
      }
    }
    this.instances(this.mesh('distant-hills', distantHill(), material), transforms);
  }
  private roadFurniture(path: RoutePath) {
    const white = this.material('posts', '#eee8d3'), black = this.material('post-tops', '#3f4940');
    const posts: Matrix[] = [], tops: Matrix[] = [];
    for (let d = 30; d < path.totalLength; d += 60) {
      for (const side of [-1, 1]) {
        const p = roadside(path, d, side * 4.2);
        posts.push(Matrix.Compose(new Vector3(0.13, 0.85, 0.18), Quaternion.Identity(), new Vector3(p.x, p.y + 0.4, p.z)));
        tops.push(Matrix.Compose(new Vector3(0.14, 0.19, 0.19), Quaternion.Identity(), new Vector3(p.x, p.y + 0.65, p.z)));
      }
    }
    const post = CreateBox('road-posts', { size: 1 }, this.scene); post.material = white; this.instances(post, posts);
    const top = CreateBox('road-post-tops', { size: 1 }, this.scene); top.material = black; this.instances(top, tops);
    const finish = this.material('start-line', '#d8e0b4');
    finish.lightmapTexture = this.lightmap; finish.useLightmapAsShadowmap = true;
    this.staticSurface(finish);
    this.mesh('start-line', roadSurface(path, [-3, -1.5, 0, 1.5, 3], 0, Math.min(1, path.totalLength), 0.025), finish);
  }
  private cockpit() {
    const group = new TransformNode('cockpit', this.scene); group.parent = this.camera;
    this.cockpitGroup = group;
    // Reparent under camera, but dispose it explicitly on route changes via content.
    this.content!.onDisposeObservable.add(() => group.dispose());
    const metal = this.material('handlebar', '#292b2d'); metal.specularColor.set(0.38, 0.38, 0.4); metal.specularPower = 70;
    const grips = this.material('grips', '#182420');
    const points = [[-0.37, -0.4, 0.57], [-0.39, -0.28, 0.6], [-0.32, -0.25, 0.68],
      [-0.18, -0.28, 0.62], [0, -0.28, 0.59], [0.18, -0.28, 0.62], [0.32, -0.25, 0.68],
      [0.39, -0.28, 0.6], [0.37, -0.4, 0.57]].map(p => new Vector3(...p as [number, number, number]));
    const bar = CreateTube('bar', { path: Curve3.CreateCatmullRomSpline(points, 5).getPoints(), radius: 0.019, tessellation: 12 }, this.scene);
    bar.material = metal; bar.parent = group;
    const stem = CreateTube('stem', { path: [new Vector3(0, -0.48, 0.48), new Vector3(0, -0.28, 0.59)], radius: 0.028, tessellation: 8 }, this.scene);
    stem.material = grips; stem.parent = group;
    const computer = CreateBox('bike-computer', { width: 0.09, height: 0.015, depth: 0.12 }, this.scene);
    computer.position.set(0, -0.251, 0.68); computer.material = grips; computer.parent = group;
    const screen = CreateBox('computer-screen', { width: 0.07, height: 0.016, depth: 0.09 }, this.scene);
    screen.position.set(0, -0.249, 0.68); screen.material = this.material('lcd', '#9dbda4'); screen.parent = group;
  }
  private ghostBike() {
    const group = new TransformNode('ghost', this.scene); group.parent = this.content;
    const mat = this.material('ghost-material', '#c4a6ff'); mat.alpha = 0.42; mat.emissiveColor = Color3.FromHexString('#44365d');
    const body = CreateSphere('ghost-rider', { diameter: 0.65, segments: 8 }, this.scene);
    body.scaling.set(0.65, 1.1, 1); body.position.y = 1.2; body.material = mat; body.parent = group;
    const head = CreateSphere('ghost-helmet', { diameter: 0.26, segments: 8 }, this.scene);
    head.position.set(0, 1.6, 0.25); head.material = mat; head.parent = group;
    for (const z of [-0.48, 0.48]) {
      const wheel = CreateCylinder('ghost-wheel', { height: 0.045, diameter: 0.65, tessellation: 20 }, this.scene);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(0, 0.37, z); wheel.material = mat; wheel.parent = group;
    }
    group.setEnabled(false); return group;
  }
  private peloton() {
    const materials = riderMaterials(this.scene);
    this.materials.push(materials.body, materials.spokes, materials.shadow);
    this.content!.onDisposeObservable.add(() => materials.spokes.diffuseTexture?.dispose());
    this.riders = PELOTON.map((rival, index) => {
      const rider = createRider(this.scene, rival, index, this.content!, materials);
      rider.root.setEnabled(false); return rider;
    });
  }
  private updateRiders(state: RideState) {
    const camera = this.camera.position;
    for (const [index, rider] of this.riders.entries()) {
      const rival = state.rivals[index];
      if (!rival || rival.finished) { rider.root.setEnabled(false); continue; }
      const sample = this.path!.sample(rival.distance), p = roadside(this.path!, rival.distance, rival.rival.lane);
      const visible = Math.hypot(p.x - camera.x, p.z - camera.z) < 420;
      rider.root.setEnabled(visible);
      if (!visible) continue;
      rider.root.position.set(p.x, p.y + roadHeight(rival.rival.lane), p.z);
      rider.root.rotation.set(-Math.atan(sample.slope), Math.atan2(sample.forward.x, sample.forward.z),
        -bendLean(this.path!, rival.distance, rival.speedMps) + (this.motion ? 0.035 * Math.sin(rival.crankAngle) : 0));
      rider.pose(rival.crankAngle, rival.progress / WHEEL_RADIUS);
    }
  }
  /** The few things that move by themselves: turbine blades and a flock of birds ahead of the rider. */
  private animate(state: RideState) {
    const t = state.elapsedSeconds;
    if (this.rotors.some(rotor => rotor.isDisposed())) this.rotors = this.rotors.filter(rotor => !rotor.isDisposed());
    for (const rotor of this.rotors) rotor.rotation.z = t * 0.85 + rotor.uniqueId;
    const f = state.forward, flat = Math.hypot(f.x, f.z) || 1, fx = f.x / flat, fz = f.z / flat;
    // The flock wheels slowly around a point that drifts ahead and to the sides of the road.
    const ahead = 150 + 70 * Math.sin(t / 23), aside = 90 * Math.sin(t / 17);
    const cx = state.position.x + fx * ahead + fz * aside, cz = state.position.z + fz * ahead - fx * aside;
    this.flock.forEach(({ node, wings }, i) => {
      const angle = t * 0.22 + i * 0.42, radius = 46 + i * 7;
      node.setEnabled(this.motion);
      node.position.set(cx + Math.cos(angle) * radius, state.position.y + 34 + i * 2.5 + 6 * Math.sin(t / 5 + i), cz + Math.sin(angle) * radius);
      node.rotation.y = -angle; node.scaling.setAll(1.6);
      const flap = 0.55 * Math.sin(t * 7 + i * 1.9);
      wings[0].rotation.z = -flap; wings[1].rotation.z = flap;
    });
  }
  showPreview(view?: PreviewView, build = true) {
    if (!this.path) return;
    if (this.waterSurface) this.waterSurface.phase = 0;
    const pose = previewPose(this.path, view);
    this.camera.position.copyFrom(vec(pose.eye)); this.camera.upVector.set(0, 1, 0);
    // The elevated camera does not need cockpit-scale depth precision. A farther
    // near plane keeps asphalt, shoulders and paint from z-fighting in the distance.
    this.camera.minZ = 2; this.camera.fov = 0.9; this.camera.setTarget(vec(pose.target));
    this.cockpitGroup?.setEnabled(false); this.ghost?.setEnabled(false);
    for (const rider of this.riders) rider.root.setEnabled(false);
    for (const { node } of this.flock) node.setEnabled(false);
    this.lastZoneX = Infinity; this.updateZones();
    if (build) this.buildZones(Infinity);
    this.needsRender = true;
    this.canvas.dataset.view = 'preview';
  }
  update(state: RideState) {
    if (!this.path) return;
    if (this.waterSurface) this.waterSurface.phase = state.elapsedSeconds * 0.012;
    this.needsRender = true;
    this.cockpitGroup?.setEnabled(true); this.camera.minZ = 0.04; this.camera.fov = 1.05;
    this.canvas.dataset.view = 'ride';
    const pose = cameraPose(this.path, state, this.motion);
    this.camera.position.copyFrom(vec(pose.eye)); this.camera.upVector.copyFrom(vec(pose.up));
    this.camera.setTarget(vec(pose.target));
    if (this.cockpitGroup) { this.cockpitGroup.rotation.y = pose.steer; this.cockpitGroup.rotation.z = -pose.bend * 0.45; }
    this.updateZones();
    this.updateRiders(state);
    this.animate(state);
    if (this.ghost) {
      const visible = state.ghostDistance !== null && Math.abs(state.ghostDistance - state.distance) > 2;
      this.ghost.setEnabled(visible);
      if (visible) {
        const s = this.path.sample(state.ghostDistance!);
        this.ghost.position.copyFrom(vec(s.position));
        this.ghost.rotation.y = Math.atan2(s.forward.x, s.forward.z);
      }
    }
  }
  dispose() { this.observer.disconnect(); this.scene.dispose(); this.textures.clear(); this.engine.dispose(); }
}
