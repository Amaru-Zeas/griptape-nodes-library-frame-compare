// Browser integration tests. Set PLAYWRIGHT_MODULE to your installed playwright module when needed.
// Generate plate.webm (5s) and mask.webm (7s, white right half) with tests/make_fixtures.ps1.
const { createRequire } = await import('node:module');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { createServer } = await import('node:http');
const { readFileSync, existsSync, mkdirSync } = await import('node:fs');
const { resolve, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const { strict: assert } = await import('node:assert');
const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(process.env.FRAME_COMPARE_FIXTURES || resolve(here,'fixtures'));
const outDir = resolve(process.env.FRAME_COMPARE_RESULTS || resolve(here,'results')); mkdirSync(outDir,{recursive:true});
const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:30px;background:#101215;color:#fff;font:14px Segoe UI}#host{width:960px;margin:auto}</style></head><body><div id="host"></div><script type="module">
import mount from '/widget.js'; window.mount=mount;window.events=[];window.value={};window.host=document.getElementById('host');
window.onChange=v=>{window.value=v;events.push(v);window.handle.update({value:v,onChange});};
window.handle=mount(host,{value,onChange});window.patch=v=>{value={...value,...v};handle.update({value,onChange});};
</script></body></html>`;
const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost').pathname;
  if(url==='/'){res.setHeader('content-type','text/html');res.end(html);return;}
  const path=url==='/widget.js'?resolve(here,'../frame_compare_nodes/FrameCompareWidget.js'):resolve(fixtureDir,url.slice(1));
  if(!['/widget.js','/plate.webm','/mask.webm'].includes(url)||!existsSync(path)){res.writeHead(404);res.end();return;}
  const data=readFileSync(path);res.setHeader('content-type',url.endsWith('.js')?'text/javascript':'video/webm');
  res.setHeader('accept-ranges','bytes');const match=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');
  if(match){const start=Number(match[1]),end=match[2]?Number(match[2]):data.length-1;res.writeHead(206,{'content-range':`bytes ${start}-${end}/${data.length}`,'content-length':end-start+1});res.end(data.subarray(start,end+1));}else res.end(data);
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(process.env.FRAME_COMPARE_TEST_PORT)||0,'127.0.0.1',resolve);});
const url=`http://${process.env.FRAME_COMPARE_TEST_HOST||'127.0.0.1'}:${server.address().port}`;
let browser;
try {
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const page=await browser.newPage({viewport:{width:1040,height:780}}); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  if(process.env.FRAME_COMPARE_DISABLE_WEBGL==='1')await page.addInitScript(()=>{
    const getContext=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){return /^webgl/.test(type)?null:getContext.call(this,type,...args);};
  });
  await page.goto(url); await page.waitForFunction(()=>!!window.handle);
  assert.equal(await page.locator('video').count(),2);
  assert.equal(await page.locator('.fc-play').isDisabled(),true);
  await page.screenshot({fullPage:true,path:resolve(outDir,'empty.png')});
  // Wire changes must reach the existing mount through the real update contract.
  await page.evaluate(()=>patch({plate:'/plate.webm',mask:'/mask.webm'}));
  await page.waitForFunction(()=>value.plateDuration===5 && value.maskDuration===7 && document.querySelector('.fc-ready').textContent==='2 / 2 ready');
  assert.equal(await page.locator('.fc-total').textContent(),'/ 168');
  // Image areas follow the PLATE aspect at every node width, below the title row.
  for(const nodeWidth of [600,960,1440]) {
    await page.evaluate(w=>{host.style.width=w+'px';handle.update({value,onChange,height:300});},nodeWidth);
    await page.waitForFunction(()=>{
      const c=document.querySelector('canvas'), w=(c.width-6)/2,h=(c.height-6)/2-26;
      return Math.abs(w/h-16/9)<.015;
    });
  }
  await page.evaluate(()=>{host.style.width='960px';});
  await page.waitForFunction(()=>document.querySelector('canvas').width<1000);
  assert.deepEqual(await page.locator('canvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(c.width*.25,10,1,1).data)),[24,30,36,255]);
  await page.screenshot({fullPage:true,path:resolve(outDir,'four-up.png')});
  const seekIdle=async()=>page.waitForFunction(()=>[...document.querySelectorAll('video')].every(v=>!v.seeking && v.readyState>=2));
  await page.locator('.fc-jump').fill('145'); await page.locator('.fc-jump').press('Tab'); await seekIdle();
  let times=await page.locator('video').evaluateAll(v=>v.map(x=>x.currentTime));
  assert.ok(Math.abs(times[0]-1)<0.02, JSON.stringify({times, value:await page.evaluate(()=>value), jump:await page.locator(".fc-jump").inputValue()}));assert.ok(Math.abs(times[1]-6)<0.02);
  await page.locator('.fc-loop').click();await seekIdle();
  times=await page.locator('video').evaluateAll(v=>v.map(x=>x.currentTime));
  assert.ok(times[0]>4.95 && times[0]<5);assert.ok(Math.abs(times[1]-6)<0.02);
  await page.locator('.fc-frames').fill('200');await page.locator('.fc-frames').press('Tab');assert.equal(await page.locator('.fc-total').textContent(),'/ 200');
  await page.locator('.fc-auto').click();assert.equal(await page.locator('.fc-total').textContent(),'/ 168');
  // Canvas pixels prove that the luminance matte and invert control work.
  await page.locator('.fc-focus').selectOption('green');await seekIdle();
  const pixel=()=>page.locator('canvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(c.width*.25,c.height*.5,1,1).data));
  let p=await pixel(); assert.ok(p[0]<5 && p[1]>160 && p[1]<185 && p[2]>65 && p[2]<90,JSON.stringify(p));
  await page.locator('.fc-invert').click();let q=await pixel();assert.notDeepEqual(q,p);
  await page.locator('.fc-invert').click();
  for(const mode of ['split','wipe','difference','quad']){
    await page.locator(`[data-mode=${mode}]`).click();assert.equal(await page.locator(`[data-mode=${mode}]`).getAttribute('aria-pressed'),'true');
    await page.waitForFunction(mode=>{
      const c=document.querySelector('canvas'), columns=mode==='split'||mode==='quad'?2:1,rows=mode==='quad'?2:1;
      return Math.abs(((c.width-(columns-1)*6)/columns)/((c.height-(rows-1)*6)/rows-26)-16/9)<.015;
    },mode);
  }
  await page.locator('[data-mode=wipe]').click(); const bounds=await page.locator('canvas').boundingBox();
  await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.5);await page.mouse.down();await page.mouse.move(bounds.x+bounds.width*.75,bounds.y+bounds.height*.5);await page.mouse.up();
  assert.ok(Math.abs(await page.evaluate(()=>value.wipe)-.75)<.02);
  assert.equal(await page.locator('.fc-wipe-slider').inputValue(),'75');
  await page.locator('.fc-wipe-slider').evaluate(el=>{el.value='25';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
  assert.equal(await page.evaluate(()=>value.wipe),.25);
  await page.locator('[data-mode=wipe]').click();assert.equal(await page.locator('[data-mode=quad]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.fc-wipe-control').isVisible(),false);
  await page.locator('[data-mode=wipe]').click();assert.equal(await page.locator('.fc-wipe-control').isVisible(),true);
  await page.screenshot({fullPage:true,path:resolve(outDir,'wipe.png')});
  await page.locator('.fc-root').focus();await page.keyboard.press('ArrowLeft');await seekIdle();assert.equal(await page.locator('.fc-jump').inputValue(),'144');
  await page.locator('.fc-jump').fill('1');await page.locator('.fc-jump').press('Tab');await seekIdle();
  await page.locator('.fc-play').click();await page.waitForFunction(()=>Number(document.querySelector('.fc-jump').value)>3);await page.locator('.fc-play').click();await seekIdle();
  assert.ok(await page.evaluate(()=>value.frame)>0);
  // Decoder readiness can fall during a seek; transport must remain clickable.
  await page.locator('video').evaluateAll(videos=>videos.forEach(v=>{
    Object.defineProperty(v,'seeking',{configurable:true,get:()=>true});
    Object.defineProperty(v,'readyState',{configurable:true,get:()=>1});
    v.dispatchEvent(new Event('seeked'));
  }));
  assert.equal(await page.locator('.fc-play').isDisabled(),false);
  for(let i=0;i<3;i++) {
    await page.locator('.fc-play').click();assert.match(await page.locator('.fc-play').textContent(),/Pause/);
    await page.locator('.fc-play').click();assert.match(await page.locator('.fc-play').textContent(),/Play/);
  }
  await page.locator('video').evaluateAll(videos=>videos.forEach(v=>{delete v.seeking;delete v.readyState;}));
  await seekIdle();
  await page.evaluate(()=>{
    window.playDisabledChanges=0;
    window.playObserver=new MutationObserver(records=>{playDisabledChanges+=records.length;});
    playObserver.observe(document.querySelector('.fc-play'),{attributes:true,attributeFilter:['disabled']});
  });
  await page.locator('.fc-play').click();
  await page.waitForFunction(()=>Number(document.querySelector('.fc-jump').value)>7);
  await page.locator('.fc-play').click();
  assert.equal(await page.evaluate(()=>{playObserver.disconnect();return playDisabledChanges;}),0);
  await seekIdle();
  await page.evaluate(()=>handle.update({value,disabled:true,onChange}));assert.equal(await page.locator('.fc-play').isDisabled(),true);assert.equal(await page.locator('.fc-focus').isDisabled(),true);
  await page.evaluate(()=>handle.update({value,disabled:false,onChange}));
  // Default playback uses native decoders and GPU matte, not a seek per frame.
  assert.equal(await page.locator('.fc-root').getAttribute('data-renderer'),process.env.FRAME_COMPARE_DISABLE_WEBGL==='1'?'cpu':'gpu');
  await page.locator('[data-mode=quad]').click();
  await page.locator('.fc-jump').fill('1');await page.locator('.fc-jump').press('Tab');await seekIdle();
  await page.evaluate(()=>{
    window.playbackSeeks=0;window.playbackBegan=performance.now();
    document.querySelectorAll('video').forEach(v=>v.addEventListener('seeking',()=>playbackSeeks++));
  });
  await page.locator('.fc-play').click();
  await page.waitForFunction(()=>[...document.querySelectorAll('video')].every(v=>!v.paused));
  await page.waitForFunction(()=>Number(document.querySelector('.fc-jump').value)>=25);
  const performanceResult=await page.evaluate(()=>({elapsed:performance.now()-playbackBegan,seeks:playbackSeeks}));
  assert.ok(performanceResult.elapsed<2200,JSON.stringify(performanceResult));
  assert.ok(performanceResult.seeks<8,JSON.stringify(performanceResult));
  await page.locator('.fc-play').click();await seekIdle();
  assert.equal(await page.locator('video').evaluateAll(v=>v.every(x=>x.paused)),true);
  const pausedFrame=Number(await page.locator('.fc-jump').inputValue());
  await page.locator('.fc-next').click();await seekIdle();assert.equal(Number(await page.locator('.fc-jump').inputValue()),pausedFrame+1);
  console.log('PASS: smooth native playback, GPU matte, exact paused stepping:',performanceResult);
  // Source removal clears metadata and old pictures without remounting.
  await page.evaluate(()=>patch({mask:''}));await page.waitForFunction(()=>document.querySelector('.fc-total').textContent==='/ 120');
  await page.evaluate(()=>patch({mask:'/missing.webm'}));await page.waitForFunction(()=>!document.querySelector('.fc-message').hidden);
  assert.match(await page.locator('.fc-message').textContent(),/could not load/);
  await page.evaluate(()=>patch({mask:'/mask.webm'}));await page.waitForFunction(()=>document.querySelector('.fc-ready').textContent==='2 / 2 ready');
  // Node resize and canvas zoom must not change backing pixels to graph-scaled sizes.
  await page.evaluate(()=>{host.style.width='600px';host.style.transform='scale(.7)';host.style.transformOrigin='top left';});
  await page.waitForFunction(()=>document.querySelector('canvas').width===document.querySelector('.fc-view').clientWidth);
  assert.equal(await page.locator('.fc-root').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
  await page.screenshot({fullPage:true,path:resolve(outDir,'compact.png')});
  await page.evaluate(()=>handle.cleanup());assert.equal(await page.locator('video').count(),0);
  await page.evaluate(()=>{host.style.width='960px';host.style.transform='';handle=mount(host,{value:{plate:'/plate.webm',mask:'/mask.webm',frame:60},onChange});});
  await page.waitForFunction(()=>document.querySelector('.fc-ready').textContent==='2 / 2 ready');await seekIdle();assert.equal(await page.locator('.fc-jump').inputValue(),'61');
  // Optional end-to-end check against media served by the running Griptape engine.
  if(process.env.FRAME_COMPARE_REAL_PLATE && process.env.FRAME_COMPARE_REAL_MASK) {
    await page.evaluate(({plate,mask})=>patch({plate,mask,frame:0,mode:'quad'}),{plate:process.env.FRAME_COMPARE_REAL_PLATE,mask:process.env.FRAME_COMPARE_REAL_MASK});
    await page.waitForFunction(()=>document.querySelector('.fc-ready').textContent==='2 / 2 ready',null,{timeout:30000});
    await seekIdle();
    assert.ok(await page.evaluate(()=>value.plateDuration>0 && value.maskDuration>0));
    assert.equal(await page.locator('.fc-message').isVisible(),false);
    await page.screenshot({fullPage:true,path:resolve(outDir,'real-footage.png')});
    await page.locator('[data-mode=wipe]').click();
    await page.locator('.fc-wipe-slider').evaluate(el=>{el.value='50';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});
    await page.screenshot({fullPage:true,path:resolve(outDir,'real-comparison.png')});
    console.log('PASS: actual connected Griptape MP4s loaded and composited:',await page.evaluate(()=>({plateDuration:value.plateDuration,maskDuration:value.maskDuration})));
    await page.locator('[data-mode=quad]').click();
    await page.evaluate(()=>{window.realPlaybackBegan=performance.now();window.playbackSeeks=0;});
    await page.locator('.fc-play').click();
    await page.waitForFunction(()=>[...document.querySelectorAll('video')].every(v=>!v.paused));
    await page.waitForFunction(()=>Number(document.querySelector('.fc-jump').value)>=25);
    console.log('PASS: real-footage continuous playback:',await page.evaluate(()=>({elapsed:performance.now()-realPlaybackBegan,seeks:playbackSeeks})));
    await page.locator('.fc-play').click();await seekIdle();
  }
  await page.evaluate(()=>handle.cleanup());
  assert.deepEqual(errors,[]);
  console.log('PASS: live wire updates, 5s/7s timeline, repeat/hold, custom/auto range, keyed pixels, invert, layouts, wipe dragging, stepping, playback, disabled state, source removal/error/recovery, graph scaling, cleanup, frame restoration.');
} finally {if(browser)await browser.close();server.close();}


