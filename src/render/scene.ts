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
import { pineCrown, forestCrown, grassTuft, meadowClump } from './vegetation';
import { AdaptiveResolution, frameLimit, type Quality } from './budget';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateTube } from '@babylonjs/core/Meshes/Builders/tubeBuilder';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/core/Materials/standardMaterial';
import { RoutePath, type Vec3 } from '../domain/route';
import { cameraPose, type RideState } from '../domain/ride';
import { distantHill, groundAt, terrainHeightAt, hash, markings, ribbon, roadSurface, roadRepairs, roadHeight, riverRibbon, roadside, shoulderBanks, terrainTiles, TILE_SIZE, type Geometry } from './geometry';

export type { Daylight } from './lighting';
export type { Quality } from './budget';
const PALETTES = {
  dia: { sky: '#598dc0', fog: '#c0cdd0', grass: '#94c28a' },
  amanecer: { sky: '#7f9daf', fog: '#d8bda9', grass: '#abc89b' },
  atardecer: { sky: '#738ca6', fog: '#d8b9a0', grass: '#b1c38b' },
};
const vec = (p: Vec3) => new Vector3(p.x, p.y, p.z);

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
  private zones: { mesh: Mesh; x: number; z: number; radius: number; range: number; minRange: number }[] = [];
  private lastZoneX = Infinity;
  private lastZoneZ = Infinity;
  private needsRender = true;
  private loadedKey = '';
  private failedTextures = new Set<string>();
  private contextUnavailable = false;
  private preparing = false;
  private diagnostic(stage: string, pending: Scene['meshes'] = []) {
    if (!import.meta.env.DEV || !import.meta.hot) return;
    import.meta.hot.send('ciklism:render-diagnostic', {
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
      this.path = ridePath; this.showPreview(preview); this.resize();
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
    this.zones = []; this.lastZoneX = Infinity; this.lastZoneZ = Infinity;
    this.content?.dispose(); this.content = null; this.ghost = null;
    for (const mat of this.materials) mat.dispose(false, false);
    this.materials = [];
    this.lightmap?.dispose(); this.lightmap = null;
    for (const light of [...this.scene.lights]) light.dispose();
    this.content = new TransformNode('route', this.scene);
    const palette = PALETTES[daylight], lighting = LIGHTING[daylight];
    this.scene.fogDensity = path.route.scenery === 'river' ? 0.00072 : 0.00125;
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
    let tileIndex = 0;
    for (const tile of terrainTiles(path)) {
      this.zone(this.mesh(`terrain-${tileIndex++}`, tile, grass), 1050);
      if (tileIndex % 24 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    for (let from = 0; from < path.totalLength; from += TILE_SIZE) {
      const to = Math.min(path.totalLength, from + TILE_SIZE);
      this.zone(this.mesh('shoulders', shoulderBanks(path, from, to), shoulder), 850);
      const surface = roadSurface(path, [-3, -1.5, 0, 1.5, 3], from, to);
      roadRepairs(path, from, to, surface);
      this.zone(this.mesh('road', surface, asphalt), 850);
      const lines = markings(path, from, to);
      for (const side of [-1, 1]) {
        const edge = roadSurface(path, [side * 2.76 - 0.05, side * 2.76 + 0.05], from, to, 0.02);
        const base = lines.positions.length / 3;
        lines.positions.push(...edge.positions); lines.indices.push(...edge.indices.map(n => n + base));
        lines.uvs.push(...edge.uvs); lines.colors.push(...edge.colors);
      }
      this.zone(this.mesh('paint', lines, paint), 850);
    }
    onProgress('Plantando el paisaje…');
    await new Promise(resolve => setTimeout(resolve, 0));
    this.trees(path);
    this.verges(path);
    this.hills(path, biome.grass);
    this.landmarks(path);
    this.roadFurniture(path);
    this.cockpit();
    this.ghost = this.ghostBike();
    this.path = ridePath;
    this.showPreview(preview);
    this.resize();
    onProgress('Abriendo la vista previa…');
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
          console.error('Ciklism: materiales pendientes', names);
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
    this.zones.push({ mesh, x: bounds.centerWorld.x, z: bounds.centerWorld.z, radius: bounds.radiusWorld, range, minRange });
    return mesh;
  }
  private updateZones() {
    const { x, z } = this.camera.position;
    if (Math.hypot(x - this.lastZoneX, z - this.lastZoneZ) < 16) return;
    this.lastZoneX = x; this.lastZoneZ = z;
    for (const zone of this.zones) {
      const distance = Math.hypot(x - zone.x, z - zone.z);
      const nearRange = this.quality === 'low' ? 90 : 180;
      const range = zone.range === 180 ? nearRange : zone.range === 28 && this.quality === 'low' ? 18 : zone.range;
      const minRange = zone.minRange === 180 ? nearRange : zone.minRange;
      zone.mesh.setEnabled(distance < range + zone.radius && (minRange === 0 || distance >= minRange + zone.radius));
    }
  }
  private instances(mesh: Mesh, transforms: Matrix[], range = 650, minRange = 0, cellSize = TILE_SIZE) {
    const cells = new Map<string, Matrix[]>();
    for (const transform of transforms) {
      const key = `${Math.floor(transform.m[12] / cellSize)},${Math.floor(transform.m[14] / cellSize)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key)!.push(transform);
    }
    // Thin-instance matrix attributes belong to the geometry in Babylon. Each
    // spatial batch needs its own geometry to avoid overwriting another batch.
    for (const [key, matrices] of cells) {
      const part = mesh.clone(`${mesh.name}-${key}`, this.content)!;
      part.makeGeometryUnique();
      const buffer = new Float32Array(matrices.length * 16);
      matrices.forEach((m, i) => m.copyToArray(buffer, i * 16));
      part.thinInstanceSetBuffer('matrix', buffer, 16, true);
      part.isPickable = false; part.freezeWorldMatrix(); this.zone(part, range, minRange);
    }
    mesh.dispose();
  }
  private trees(path: RoutePath) {
    const bark = this.material('bark', '#b6afa0'); bark.diffuseTexture = this.photo('bark_diff', 1);
    const leaves = this.material('pine-needles', '#edf0d1');
    const river = path.route.scenery === 'river';
    leaves.diffuseTexture = this.photo(river ? 'valley-trees' : 'pine-tree'); leaves.diffuseTexture.hasAlpha = true;
    leaves.useAlphaFromDiffuseTexture = true;
    leaves.transparencyMode = StandardMaterial.MATERIAL_ALPHATEST; leaves.alphaCutOff = 0.4;
    leaves.backFaceCulling = false; leaves.twoSidedLighting = true;
    // The cutout already contains soft lighting. Relighting each crossed plane
    // separately exposes its flat shape and makes back-facing foliage black.
    leaves.disableLighting = true;
    leaves.emissiveColor = this.sunlight!.diffuse.scale(0.9);
    const trunks: Matrix[] = [], crowns: Matrix[] = [], alders: Matrix[] = [];
    for (const tree of treeLayout(path.route)) {
      const h = tree.height;
      const q = Quaternion.RotationYawPitchRoll(tree.yaw, tree.lean, 0);
      trunks.push(Matrix.Compose(new Vector3(h * 0.035, h * 0.27, h * 0.035), q, new Vector3(tree.x, tree.y + h * 0.135, tree.z)));
      (tree.kind === 'alder' ? alders : crowns).push(Matrix.Compose(new Vector3(h, h, h), q, new Vector3(tree.x, tree.y, tree.z)));
    }
    const trunk = CreateCylinder('trunks', { height: 1, diameterBottom: 1, diameterTop: 0.08, tessellation: 7 }, this.scene);
    trunk.material = bark; this.instances(trunk, trunks, 180);
    this.instances(this.mesh('pine-near', river ? forestCrown(true, 'spruce') : pineCrown(true), leaves), crowns, 180);
    this.instances(this.mesh('pine-far', river ? forestCrown(false, 'spruce') : pineCrown(false), leaves), crowns, river ? 1100 : 650, 180);
    if (river) {
      this.instances(this.mesh('alder-near', forestCrown(true, 'alder'), leaves), alders, 180);
      this.instances(this.mesh('alder-far', forestCrown(false, 'alder'), leaves), alders, 1100, 180);
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
          this.zone(this.mesh('river-water', riverRibbon(path, from,
            Math.min(from + TILE_SIZE, path.totalLength)), water), 1250);
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
  showPreview(view?: PreviewView) {
    if (!this.path) return;
    if (this.waterSurface) this.waterSurface.phase = 0;
    const pose = previewPose(this.path, view);
    this.camera.position.copyFrom(vec(pose.eye)); this.camera.upVector.set(0, 1, 0);
    // The elevated camera does not need cockpit-scale depth precision. A farther
    // near plane keeps asphalt, shoulders and paint from z-fighting in the distance.
    this.camera.minZ = 2; this.camera.fov = 0.9; this.camera.setTarget(vec(pose.target));
    this.cockpitGroup?.setEnabled(false); this.ghost?.setEnabled(false);
    this.lastZoneX = Infinity; this.updateZones(); this.needsRender = true;
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
    this.updateZones();
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
