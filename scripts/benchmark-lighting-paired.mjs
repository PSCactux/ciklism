import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const baseline = process.env.CIKLISM_RENDER_BASELINE;
if (!baseline) throw new Error('Set CIKLISM_RENDER_BASELINE to a compatible reference module served by Vite.');
const browser = await chromium.launch({executablePath:process.env.CIKLISM_CHROME_PATH,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:960,height:640},deviceScaleFactor:1});
 await page.route('**/__paired',r=>r.fulfill({contentType:'text/html',body:'<style>html,body{margin:0;width:100%;height:100%}canvas{position:absolute;width:100%;height:100%;inset:0}</style><canvas id="before"></canvas><canvas id="after"></canvas>'}));
 await page.goto('http://127.0.0.1:5184/__paired');
 const result=await page.evaluate(async(baseline)=>{
  const {RoutePath}=await import('/src/domain/route.ts'); const {RideEngine}=await import('/src/domain/ride.ts');
  const {default:route}=await import('/src/routes/ermita.json');const path=new RoutePath(route),ride=new RideEngine(path);
  const runs=[];
  for(const [id,src] of [['before',baseline],['after','/src/render/scene.ts']]){
   const {RideScene}=await import(src);const renderer=new RideScene(document.getElementById(id));renderer.setOptions('high',false);await renderer.load(path,'dia',()=>{});renderer.engine.stopRenderLoop();runs.push({id,renderer,times:[]});
  }
  for(let i=0;i<100;i++){
   ride.state.distance=i*3;
   for(const run of i%2?[...runs].reverse():runs){
    const r=run.renderer;r.update(ride.state);const start=performance.now();r.engine.beginFrame();r.scene.render();const gl=r.engine._gl;gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));r.engine.endFrame();if(i>=20)run.times.push(performance.now()-start);
   }
   await new Promise(r=>setTimeout(r,0));
  }
  return runs.map(run=>{const sorted=run.times.sort((a,b)=>a-b);return{id:run.id,median:sorted[40],p95:sorted[76]}});
 },baseline);
 console.log(result);await writeFile('test-results/lighting/paired-benchmark.json',JSON.stringify(result,null,2)+'\n');
}finally{await browser.close()}
