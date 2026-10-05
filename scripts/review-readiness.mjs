import { chromium, webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const results = [];
for (const backend of ['metal', 'webkit']) {
 const browser = backend === 'webkit' ? await webkit.launch() : await chromium.launch({
  executablePath: process.env.CIKLISM_CHROME_PATH,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
 try {
  const page = await browser.newPage({viewport:{width:1100,height:700}});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5184/');
  for (const id of ['ovalo','ruta_inicial','valle','puerto','embalse','ermita']) {
   await page.locator('#world[data-ready=true]').waitFor({timeout:25000});
   await page.locator(`[data-route="${id}"]`).click();
   await page.locator('#world[data-ready=true]').waitFor({timeout:25000});
   if (await page.locator('#world').getAttribute('data-render-mode') === 'compatible') throw new Error(`${backend}/${id}: unexpected fallback`);
  }
  await page.route('**/__readiness',r=>r.fulfill({contentType:'text/html',body:'<canvas style="width:1000px;height:600px"></canvas>'}));
  await page.goto('http://127.0.0.1:5184/__readiness');
  const result = await page.evaluate(async backend => {
   const {RideScene}=await import('/src/render/scene.ts');
   const {routes}=await import('/src/routes/catalog.ts');
   const {CreateBox}=await import('/node_modules/@babylonjs/core/Meshes/Builders/boxBuilder.js');
   const {ShaderMaterial}=await import('/node_modules/@babylonjs/core/Materials/shaderMaterial.js');
   const r=new RideScene(document.querySelector('canvas')), option=routes[0];
   await r.load(option.path,'dia',()=>{},option.preview);
   const blocker=CreateBox('offscreen-pending',{},r.scene); blocker.position.set(100000,0,100000);
   blocker.isReady=complete=>!complete;
   const start=performance.now();
   await r.load(option.path,'dia',()=>{},option.preview);
   const offscreenMs=Math.round(performance.now()-start);
   if (r.canvas.dataset.renderMode==='compatible') throw new Error('An offscreen material blocked the preview');
   blocker.dispose(); r.scene.render();
   const visible=r.scene.getActiveMeshes(), road=visible.data.slice(0,visible.length).find(m=>m.name==='road');
   if (!road) throw new Error('No visible road: ' + JSON.stringify({active:visible.data.slice(0,visible.length).map(m=>m.name),camera:r.camera.position,road:r.scene.meshes.filter(m=>m.name==='road').length}));
   const invalid=new ShaderMaterial('unsupported-test',r.scene,{
    vertexSource:'precision highp float; attribute vec3 position; uniform mat4 worldViewProjection; void main(){gl_Position=worldViewProjection*vec4(position,1.0);}',
    fragmentSource:'precision highp float; void main(){ gl_FragColor=not_a_supported_function(); }'
   },{attributes:['position'],uniforms:['worldViewProjection']});
   road.material=invalid;
   await r.load(option.path,'dia',()=>{},option.preview);
   if (!road.material.name.startsWith('compatible-') || !road.isReady(true)) throw new Error('Shader failure did not recover with a drawable material');
   invalid.dispose();
   let contextRecovery='not tested';
   const extension=r.engine._gl.getExtension('WEBGL_lose_context');
   if (extension && backend==='metal') {
    const lost=new Promise(resolve=>r.engine.onContextLostObservable.addOnce(resolve));
    extension.loseContext(); await lost;
    setTimeout(()=>extension.restoreContext(),100);
    await r.load(option.path,'dia',()=>{},option.preview);
    if(r.contextUnavailable)throw new Error('Advertised readiness before context recovery');
    contextRecovery='passed';
   }
   const result={backend,offscreenMs,shaderFallback:road.material.name,contextRecovery};
   r.dispose(); return result;
  },backend);
  if(errors.length)throw new Error(errors.join('\n'));
  results.push(result); console.log(result);
 } finally {await browser.close();}
}
await mkdir('test-results/readiness',{recursive:true});
await writeFile('test-results/readiness/verification.json',JSON.stringify(results,null,2)+'\n');
