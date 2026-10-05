export default function FrameCompareWidget(container, props = {}) {
  // Griptape mounts once and forwards parameter changes through this handle.
  if (container.__fc) container.__fc.cleanup();
  const modes = ['quad', 'split', 'wipe', 'difference', 'plate', 'mask', 'checker', 'green'];
  const names = {quad: 'Four up', split: 'Side by side', wipe: 'Mask / plate', difference: 'Difference', plate: 'Plate', mask: 'Mask', checker: 'Checker', green: 'Green'};
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const number = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const integer = (v, fallback, max) => clamp(Math.round(number(v, fallback)), 0, max);
  let value = {}, onChange, disabled = false, alive = true, playing = false;
  let frame = 0, fps = 24, loop = true, custom = 0, mode = 'quad', wipe = 0.5, invert = false;
  let zoom = 1, panX = 0, panY = 0, width = 1, height = 1, dpr = 1;
  let raf = 0, playbackStart = null, playbackFrame = 0, lastCorrection = 0, lastPaintFrame = -1;
  let playbackGeneration = 0;
  let publishTimer = 0, lastPayload = '', keySignature = '', compositeError = '';
  let dragging = null;
  const listeners = [];
  const TITLE_HEIGHT = 26, CELL_GAP = 6;

  container.innerHTML = `
    <style>
      .fc-root{--fc-edge:#33383e;--fc-muted:#919ba6;--fc-accent:#84cec8;box-sizing:border-box;display:flex;flex:0 0 auto;flex-direction:column;min-width:0;width:100%;height:auto;overflow:hidden;border:1px solid var(--fc-edge);border-radius:10px;background:#191c20;color:#e7eaed;font:12px/1.4 'Segoe UI',sans-serif;user-select:none;outline:none;color-scheme:dark}
      .fc-root *{box-sizing:border-box}.fc-root:focus-visible{outline:2px solid var(--fc-accent);outline-offset:2px}
      .fc-root button,.fc-root input,.fc-root select{font:inherit;color:inherit}
      .fc-root button,.fc-root select,.fc-root input[type=number]{border:1px solid var(--fc-edge);background:#24282e;border-radius:5px;height:29px;padding:0 9px}
      .fc-root button{cursor:pointer;white-space:nowrap}.fc-root button:hover{background:#343b43}.fc-root button:focus-visible,.fc-root select:focus-visible,.fc-root input:focus-visible{outline:2px solid var(--fc-accent);outline-offset:1px}
      .fc-root button[aria-pressed=true]{background:#27403f;border-color:#508581;color:#b9f2ed}.fc-root button:disabled,.fc-root input:disabled,.fc-root select:disabled{opacity:.4;cursor:default}
      .fc-root input{user-select:text;min-width:0}.fc-root input[type=range]{accent-color:var(--fc-accent);height:16px;cursor:pointer;margin:0;min-width:40px}
      .fc-head,.fc-toolbar,.fc-transport,.fc-settings,.fc-footer{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:10px 12px}
      .fc-head{padding-bottom:8px}.fc-brand{font-size:13px;font-weight:650;letter-spacing:.025em}.fc-brand-mark{display:inline-grid;grid-template-columns:repeat(2,5px);gap:2px;margin-right:8px}.fc-brand-mark i{width:5px;height:5px;background:var(--fc-accent);border-radius:1px}.fc-brand-mark i:last-child{opacity:.4}
      .fc-subtitle{color:var(--fc-muted);font-size:10px;letter-spacing:.14em;margin-left:5px}.fc-spacer{flex:1}.fc-badge{display:flex;align-items:center;gap:6px;color:var(--fc-muted);font-size:11px}.fc-dot{width:5px;height:5px;border-radius:50%;background:#6b7784}.fc-badge[data-ready=true] .fc-dot{background:var(--fc-accent)}
      .fc-toolbar{padding-top:0;padding-bottom:9px}.fc-modes{display:flex;gap:3px;flex-wrap:wrap}.fc-modes button{font-size:11px}.fc-zoom{font-variant-numeric:tabular-nums;color:var(--fc-muted);font-size:11px}
      .fc-wipe-control{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--fc-muted)}.fc-wipe-control[hidden]{display:none}.fc-wipe-slider{width:110px}.fc-wipe-percent{width:30px;font-variant-numeric:tabular-nums}
      .fc-view{position:relative;flex:0 0 auto;min-width:0;margin:0 10px;background:#0c0e10;border:1px solid #30353b;border-radius:6px;overflow:hidden}.fc-canvas{display:block;width:100%;height:100%;touch-action:none}
      .fc-message{position:absolute;bottom:12px;left:12px;right:12px;margin:0;padding:8px 10px;background:#352c23e8;border:1px solid #796246;border-radius:5px;color:#efd7b9;font-size:11px;pointer-events:none}.fc-message[hidden]{display:none}
      .fc-transport{padding-top:10px;padding-bottom:6px}.fc-play{min-width:69px}.fc-scrub{flex:1}.fc-readout{display:flex;align-items:center;gap:6px;font-variant-numeric:tabular-nums;white-space:nowrap}.fc-root .fc-jump{width:65px;text-align:right;height:27px;padding:0 5px}.fc-total{color:var(--fc-muted);min-width:35px}
      .fc-tracks{padding:0 12px 7px;display:grid;gap:5px}.fc-track{display:flex;align-items:center;gap:9px;font-size:10px;color:var(--fc-muted)}.fc-track-label{width:34px}.fc-rail{height:8px;flex:1;background:#252a30;position:relative;overflow:hidden;border-radius:2px}.fc-fill{position:absolute;inset:0 auto 0 0;background:#669e9b;border-radius:2px}.fc-track-mask .fc-fill{background:#8393b8}.fc-rail[data-loop=true]{background:repeating-linear-gradient(90deg,#354442 0 6px,#252a30 6px 10px)}.fc-cursor{position:absolute;top:0;bottom:0;width:2px;background:#e1efee}.fc-track-count{min-width:85px;text-align:right;font-variant-numeric:tabular-nums}
      .fc-settings{padding-top:7px;padding-bottom:8px;border-top:1px solid #2a2f35;font-size:11px}.fc-settings label{display:flex;align-items:center;gap:6px;color:var(--fc-muted)}.fc-settings input{width:68px}.fc-settings .fc-fps{width:49px}.fc-settings button{font-size:11px}.fc-footer{padding:0 12px 9px;justify-content:space-between;gap:4px;color:#8d98a3;font-size:10px}.fc-status{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
      .fc-root:fullscreen{height:100vh!important;width:100vw;border-radius:0;padding:8px}.fc-root:fullscreen .fc-view{min-height:0}
    </style>
    <section class="fc-root nodrag nowheel" tabindex="0" aria-label="Frame Compare video review">
      <header class="fc-head"><span class="fc-brand"><span class="fc-brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Frame Compare</span><span class="fc-subtitle">REVIEW</span><span class="fc-spacer"></span><span class="fc-badge"><i class="fc-dot"></i><span class="fc-ready">No sources</span></span></header>
      <div class="fc-toolbar"><div class="fc-modes" role="group" aria-label="Comparison layout">${['quad','split','wipe','difference'].map(m => `<button type="button" data-mode="${m}" aria-pressed="false">${names[m]}</button>`).join('')}</div><select class="fc-focus" aria-label="Focus on a single view"><option value="">Focus view…</option>${['plate','mask','checker','green'].map(m => `<option value="${m}">${names[m]}</option>`).join('')}</select><label class="fc-wipe-control" hidden>Split <input class="fc-wipe-slider" type="range" min="0" max="100" step="1" value="50" aria-label="Mask and plate split position"><span class="fc-wipe-percent">50%</span></label><span class="fc-spacer"></span><span class="fc-zoom">Fit</span><button type="button" class="fc-fit" title="Reset zoom and pan (F)">Fit</button><button type="button" class="fc-full" title="Fullscreen viewer" aria-label="Fullscreen viewer">⛶</button></div>
      <div class="fc-view"><canvas class="fc-canvas" aria-label="Plate and mask comparison"></canvas><p class="fc-message" role="status" hidden></p></div>
      <div class="fc-transport"><button type="button" class="fc-play" title="Play or pause (Space)">▶ Play</button><button type="button" class="fc-prev" title="Previous frame (Left arrow)" aria-label="Previous frame">‹</button><button type="button" class="fc-next" title="Next frame (Right arrow)" aria-label="Next frame">›</button><input class="fc-scrub" type="range" min="1" max="1" value="1" step="1" aria-label="Timeline frame"><div class="fc-readout"><input class="fc-jump" type="number" min="1" step="1" aria-label="Current frame"><span class="fc-total">/ 0</span></div></div>
      <div class="fc-tracks">${['plate','mask'].map(k => `<div class="fc-track fc-track-${k}"><span class="fc-track-label">${k === 'plate' ? 'Plate' : 'Mask'}</span><div class="fc-rail"><div class="fc-fill"></div><div class="fc-cursor"></div></div><span class="fc-track-count">Not connected</span></div>`).join('')}</div>
      <div class="fc-settings"><label>Range <input class="fc-frames" type="number" min="0" max="200000" step="1" placeholder="Auto" aria-label="Custom timeline length in frames"></label><button type="button" class="fc-auto" title="Use the longest clip">Auto</button><label>FPS <input class="fc-fps" type="number" min="1" max="120" step="1" aria-label="Review frames per second"></label><button type="button" class="fc-loop" aria-pressed="true" title="Loop the timeline and repeat shorter clips; off holds their last frame">Loop</button><span class="fc-spacer"></span><button type="button" class="fc-invert" aria-pressed="false" title="Black keeps the plate instead of white">Invert mask</button></div>
      <footer class="fc-footer"><span class="fc-status">Connect Plate and Mask to begin</span><span>Space play · ← → step · Wheel zoom · Drag pan · F fit</span></footer>
    </section>`;
  const $ = s => container.querySelector(s);
  const root = $('.fc-root'), viewer = $('.fc-view'), canvas = $('.fc-canvas'), ctx = canvas.getContext('2d');
  const scrub = $('.fc-scrub'), jump = $('.fc-jump'), rangeInput = $('.fc-frames'), fpsInput = $('.fc-fps');
  const keyed = document.createElement('canvas'), matte = document.createElement('canvas');
  const keyCtx = keyed.getContext('2d', {willReadFrequently:true}), matteCtx = matte.getContext('2d', {willReadFrequently:true});
  let gpu = createMatteRenderer(), compositeCanvas = keyed;
  root.dataset.renderer = gpu ? 'gpu' : 'cpu';
  function listen(target, event, fn, options) { target.addEventListener(event, fn, options); listeners.push(() => target.removeEventListener(event, fn, options)); }
  const sources = ['plate', 'mask'].map(key => {
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous';
    // Attach for browser media lifecycle, but never expose duplicate video players.
    video.hidden = true; container.appendChild(video);
    return {key, video, url:'', duration:0, error:'', loaded:false, starting:false, version:0};
  });
  const [plate, mask] = sources;
  const count = s => s.duration > 0 ? Math.max(1, Math.round(s.duration * fps)) : 0;
  const total = () => custom || Math.max(...sources.map(count));
  const localFrame = s => count(s) ? (loop ? frame % count(s) : Math.min(frame, count(s)-1)) : 0;
  const ready = s => !!s.url && !s.error && s.video.readyState >= 2 && !s.video.seeking;
  // Once decoded, a clip remains playable while seeks temporarily lower readiness.
  const playable = s => !!s.url && !s.error && s.loaded && s.duration > 0;
  const settling = () => sources.some(s => s.url && !s.error && (s.video.readyState < 2 || s.video.seeking));
  function payload() { return {...value, plate:plate.url, mask:mask.url, plateDuration:plate.duration, maskDuration:mask.duration, frame, fps, loop, timelineFrames:custom, mode, wipe, invert}; }
  function persist() {
    if (!alive || disabled || typeof onChange !== 'function') return;
    const result = payload(), serialized = JSON.stringify(result);
    if (lastPayload === serialized) return;
    lastPayload = serialized; onChange(result);
  }
  function queuePersist() { clearTimeout(publishTimer); publishTimer = setTimeout(persist, 80); }
  function seek() {
    for (const s of sources) {
      if (!s.duration || s.video.readyState < 1 || s.error) continue;
      // Sample inside the frame rather than on an ambiguous decoder boundary.
      const wanted = Math.min((localFrame(s) + 0.1) / fps, Math.max(0, s.duration - 0.5 / fps));
      if (Math.abs(s.video.currentTime - wanted) > 0.02 / fps) s.video.currentTime = wanted;
    }
  }
  function stop(save = true) {
    playing = false; playbackGeneration++; cancelAnimationFrame(raf); raf = 0; playbackStart = null;
    for(const s of sources){s.video.pause();s.video.playbackRate=1;}
    if(save){seek();draw();}
    paint(); if (save) persist();
  }
  function setFrame(next, save = true) {
    frame = clamp(Math.round(next), 0, Math.max(0, total()-1));
    seek(); draw(); paint(); if (save) persist();
  }
  function play() {
    if (disabled) return;
    if (playing) { stop(); return; }
    if (!total() || !sources.some(playable)) return;
    if (frame >= total()-1) setFrame(0, false);
    playing = true; playbackGeneration++; playbackFrame = frame; playbackStart = null; lastCorrection = 0; lastPaintFrame = -1;
    seek(); paint(); raf = requestAnimationFrame(tick);
  }
  function runMedia(time, correct = false) {
    for(const s of sources) {
      if(!playable(s) || s.video.seeking)continue;
      s.video.loop = loop;
      if(!loop && time >= s.duration-0.5/fps) {
        s.video.pause();
        const end=Math.min(Math.max(0,(count(s)-1+0.1)/fps),Math.max(0,s.duration-0.5/fps));
        if(Math.abs(s.video.currentTime-end)>1/fps)s.video.currentTime=end;
        continue;
      }
      if(correct) {
        const wanted=loop?time%s.duration:Math.min(time,s.duration-0.5/fps);
        let drift=wanted-s.video.currentTime;
        if(loop){if(drift>s.duration/2)drift-=s.duration;else if(drift<-s.duration/2)drift+=s.duration;}
        // Rate nudges handle small drift. Seek only for an actual discontinuity.
        if(Math.abs(drift)>0.3)s.video.currentTime=wanted;
        else s.video.playbackRate=clamp(1+drift*.2,.95,1.05);
      }
      if(s.video.paused && s.starting!==playbackGeneration) {
        const generation=playbackGeneration;s.starting=generation;
        s.video.play().catch(()=>{if(alive && playing && generation===playbackGeneration){stop(false);$('.fc-status').textContent='Playback could not start. Click Play to retry.';}}).finally(()=>{if(s.starting===generation)s.starting=null;});
      }
    }
  }
  function tick(now) {
    if (!alive || !playing) return;
    if (!container.isConnected) { stop(false); return; }
    if(playbackStart===null) {
      // One precise seek at startup; subsequent frames use native video playback.
      if(settling()){raf=requestAnimationFrame(tick);return;}
      playbackStart=now;runMedia(playbackFrame/fps,true);
    }
    let time=playbackFrame/fps+(now-playbackStart)/1000;
    const end=total()/fps;
    if(time>=end) {
      if(!loop){frame=Math.max(0,total()-1);stop();return;}
      time%=end;playbackFrame=Math.floor(time*fps);frame=playbackFrame;
      for(const s of sources)s.video.pause();
      seek();playbackStart=null;lastPaintFrame=-1;
      raf=requestAnimationFrame(tick);return;
    }
    frame=clamp(Math.floor(time*fps),0,Math.max(0,total()-1));
    const correct=now-lastCorrection>=200;
    runMedia(time,correct);if(correct)lastCorrection=now;
    draw();
    if(frame!==lastPaintFrame){lastPaintFrame=frame;paint();}
    raf = requestAnimationFrame(tick);
  }
  function changeSource(s, url) {
    if (url === s.url) return false;
    s.video.pause(); s.url = url; s.duration = 0; s.error = ''; s.loaded = false; s.version++;
    keySignature = ''; compositeError = '';
    s.video.removeAttribute('src');
    if (url) s.video.src = url;
    s.video.load();
    return true;
  }
  for (const s of sources) {
    listen(s.video, 'loadedmetadata', () => {
      if (!alive || !s.url) return;
      s.duration = Number.isFinite(s.video.duration) && s.video.duration < 1e6 ? s.video.duration : 0;
      if (sources.every(source => !source.url || source.duration || source.error)) frame = clamp(frame, 0, Math.max(0, total()-1));
      seek(); resize(); paint(); queuePersist();
    });
    for (const event of ['loadeddata','seeked']) listen(s.video, event, () => { if (alive) { if(s.url && s.video.readyState>=2)s.loaded=true; s.version++; draw(); paint(); } });
    listen(s.video, 'error', () => {
      if (!s.url || !alive) return;
      s.error = `${names[s.key]} could not load. Check the video URL, codec, and server CORS access.`;
      s.duration = 0; stop(false); draw(); paint(); queuePersist();
    });
  }
  function rects() {
    const gap = CELL_GAP;
    if (mode === 'quad') {
      const w = (width-gap)/2, h = (height-gap)/2;
      return ['plate','mask','checker','green'].map((kind,i) => ({kind,x:(i%2)*(w+gap),y:Math.floor(i/2)*(h+gap),w,h}));
    }
    if (mode === 'split') return ['plate','mask'].map((kind,i) => ({kind,x:i*(width+gap)/2,y:0,w:(width-gap)/2,h:height}));
    return [{kind:mode,x:0,y:0,w:width,h:height}];
  }
  function fit(video, r) {
    const scale = Math.min(r.w/(video.videoWidth || 16),r.h/(video.videoHeight || 9));
    const w = (video.videoWidth || 16)*scale, h = (video.videoHeight || 9)*scale;
    return {x:r.x+(r.w-w)/2,y:r.y+(r.h-h)/2,w,h};
  }
  function image(s, r, box) { if (ready(s)) { const b=box || fit(s.video,r); ctx.drawImage(s.video,b.x,b.y,b.w,b.h); } }
  function composite() {
    if (!ready(plate) || !ready(mask)) return false;
    const signature = [plate.version,mask.version,Math.floor(plate.video.currentTime*fps),Math.floor(mask.video.currentTime*fps),invert].join(':');
    if (signature === keySignature) return !compositeError;
    keySignature = signature; compositeError = '';
    const w = Math.min(1280,plate.video.videoWidth), h = Math.max(1,Math.round(w*plate.video.videoHeight/plate.video.videoWidth));
    if(gpu) {
      try {compositeCanvas=gpu.render(w,h,plate.video,mask.video,invert);return true;}
      catch(error){gpu.dispose();gpu=null;root.dataset.renderer='cpu';}
    }
    compositeCanvas=keyed;
    keyed.width=w; keyed.height=h; matte.width=w; matte.height=h;
    try {
      keyCtx.drawImage(plate.video,0,0,w,h); matteCtx.drawImage(mask.video,0,0,w,h);
      const p=keyCtx.getImageData(0,0,w,h), m=matteCtx.getImageData(0,0,w,h).data;
      for (let i=0;i<m.length;i+=4) {
        let alpha=(m[i]*0.2126+m[i+1]*0.7152+m[i+2]*0.0722)/255;
        if (invert) alpha=1-alpha;
        p.data[i+3]=Math.round(p.data[i+3]*alpha*m[i+3]/255);
      }
      keyCtx.putImageData(p,0,0); return true;
    } catch (e) {
      compositeError = 'Cannot read media pixels for the matte. Serve both videos from Griptape or a server allowing CORS.';
      return false;
    }
  }
  function checker(b) {
    const size=16;
    ctx.fillStyle='#444a51'; ctx.fillRect(b.x,b.y,b.w,b.h);
    ctx.fillStyle='#60676f';
    for(let y=0;y<b.h;y+=size) for(let x=0;x<b.w;x+=size) if((Math.floor(x/size)+Math.floor(y/size))%2===0) ctx.fillRect(b.x+x,b.y+y,Math.min(size,b.w-x),Math.min(size,b.h-y));
  }
  function empty(r, title, hint) {
    ctx.fillStyle='#9eabb7'; ctx.font='500 13px Segoe UI,sans-serif'; ctx.textAlign='center';
    ctx.fillText(title,r.x+r.w/2,r.y+r.h/2-3,Math.max(10,r.w-24));
    ctx.fillStyle='#606c78'; ctx.font='11px Segoe UI,sans-serif';
    ctx.fillText(hint,r.x+r.w/2,r.y+r.h/2+18,Math.max(10,r.w-24)); ctx.textAlign='left';
  }
  function drawCell(cell) {
    // Titles occupy their own row; image pixels and zoom/pan never cover it.
    const r = {...cell, y:cell.y + TITLE_HEIGHT, h:Math.max(1,cell.h - TITLE_HEIGHT)};
    ctx.save(); ctx.beginPath(); ctx.rect(r.x,r.y,r.w,r.h); ctx.clip();
    ctx.fillStyle='#101316'; ctx.fillRect(r.x,r.y,r.w,r.h);
    const single = r.kind === 'plate' || r.kind === 'mask';
    const needed = single ? [r.kind==='plate'?plate:mask] : [plate,mask];
    const missing = needed.filter(s => !s.url);
    if(needed.some(s=>s.error)) empty(r,'Video unavailable','See the source error below');
    else if (missing.length) empty(r, single ? `Connect ${names[r.kind]}` : 'Plate + Mask', single ? 'Connect a video to the input socket' : 'Connect both inputs to preview the composite');
    else if(needed.some(s=>!ready(s))) empty(r,'Loading video…','Waiting for the next decoded frame');
    else {
      ctx.save(); ctx.translate(r.x+r.w/2+panX,r.y+r.h/2+panY); ctx.scale(zoom,zoom); ctx.translate(-r.x-r.w/2,-r.y-r.h/2);
      const b=fit(plate.video,r);
      if(single) image(needed[0],r,b);
      else if(r.kind==='checker' || r.kind==='green') {
        if(r.kind==='checker') checker(b); else { ctx.fillStyle='#00ad50'; ctx.fillRect(b.x,b.y,b.w,b.h); }
        if(composite()) ctx.drawImage(compositeCanvas,b.x,b.y,b.w,b.h);
      } else if(r.kind==='difference') {
        image(plate,r,b); ctx.globalCompositeOperation='difference'; image(mask,r,b); ctx.globalCompositeOperation='source-over';
      } else if(r.kind==='wipe') {
        image(mask,r,b);
        // The wipe remains in screen coordinates while both sources share a transform.
        ctx.restore(); ctx.save(); ctx.beginPath(); ctx.rect(r.x+r.w*wipe,r.y,r.w*(1-wipe),r.h); ctx.clip();
        ctx.translate(r.x+r.w/2+panX,r.y+r.h/2+panY); ctx.scale(zoom,zoom); ctx.translate(-r.x-r.w/2,-r.y-r.h/2); image(plate,r,b);
      }
      ctx.restore();
    }
    if(r.kind==='wipe') {
      const x=r.x+r.w*wipe; ctx.strokeStyle='#a4e0db'; ctx.lineWidth=1.5; ctx.beginPath(); ctx.moveTo(x,r.y); ctx.lineTo(x,r.y+r.h); ctx.stroke();
      ctx.fillStyle='#a4e0db'; ctx.fillRect(x-8,r.y+r.h/2-15,16,30); ctx.fillStyle='#243331'; ctx.font='12px Segoe UI'; ctx.fillText('↔',x-6,r.y+r.h/2+4);
    }
    ctx.restore();
    ctx.fillStyle='#181e24'; ctx.fillRect(cell.x,cell.y,cell.w,TITLE_HEIGHT);
    ctx.font='600 10px Segoe UI,sans-serif';
    const title=cell.kind==='wipe' ? 'MASK / PLATE' : names[cell.kind].toUpperCase();
    ctx.fillStyle='#b7c7d3'; ctx.fillText(title,cell.x+10,cell.y+17);
  }
  function draw() {
    if (!alive || !ctx) return;
    // Keep the last coherent pair visible during a seek; source changes clear it immediately.
    if ((sources.some(s=>s.video.seeking) || (playing && settling())) && !sources.some(s=>s.error)) return;
    ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height);
    ctx.fillStyle='#292e34'; ctx.fillRect(0,0,width,height);
    for(const r of rects()) drawCell(r);
    const error=sources.map(s=>s.error).filter(Boolean).concat(compositeError || []).join(' ');
    $('.fc-message').hidden=!error; $('.fc-message').textContent=error;
  }
  function paint() {
    const length=total();
    const playButton=$('.fc-play'), playLabel=playing?'Ⅱ Pause':'▶ Play';
    if(playButton.textContent!==playLabel)playButton.textContent=playLabel;
    if(playButton.getAttribute('aria-pressed')!==String(playing))playButton.setAttribute('aria-pressed',String(playing));
    for(const el of root.querySelectorAll('button,input,select')) {
      const transport=el.matches('.fc-prev,.fc-next,.fc-scrub,.fc-jump');
      const off=disabled || (el===playButton ? (!playing && (!length || !sources.some(playable))) : transport && !length);
      if(el.disabled!==off)el.disabled=off;
    }
    scrub.max=String(Math.max(1,length)); scrub.value=String(length?frame+1:1);
    if(document.activeElement!==jump) jump.value=length?String(frame+1):'';
    jump.max=String(Math.max(1,length)); $('.fc-total').textContent=`/ ${length}`;
    if(document.activeElement!==rangeInput) rangeInput.value=custom?String(custom):'';
    if(document.activeElement!==fpsInput) fpsInput.value=String(fps);
    for(const el of root.querySelectorAll('[data-mode]')) el.setAttribute('aria-pressed',String(el.dataset.mode===mode));
    $('.fc-focus').value=['plate','mask','checker','green'].includes(mode)?mode:'';
    $('.fc-wipe-control').hidden=mode!=='wipe';
    if(document.activeElement!==$('.fc-wipe-slider'))$('.fc-wipe-slider').value=String(Math.round(wipe*100));
    $('.fc-wipe-percent').textContent=`${Math.round(wipe*100)}%`;
    $('.fc-auto').setAttribute('aria-pressed',String(!custom)); $('.fc-loop').setAttribute('aria-pressed',String(loop)); $('.fc-invert').setAttribute('aria-pressed',String(invert));
    $('.fc-zoom').textContent=zoom===1?'Fit':`${Math.round(zoom*100)}%`;
    const loaded=sources.filter(playable).length, failed=sources.some(s=>s.error);
    $('.fc-ready').textContent=failed?'Source unavailable':loaded?`${loaded} / 2 ready`:sources.some(s=>s.url)?'Loading sources':'No sources'; $('.fc-badge').dataset.ready=String(loaded>0);
    $('.fc-status').textContent=failed?'Media unavailable · see the source error above':length?`${custom?'Custom':'Auto'} · ${length} frames · ${(length/fps).toFixed(2)}s · ${fps} fps${playing?' · Playing':settling()?' · Seeking…':''}`:'Connect Plate and Mask to begin';
    for(const s of sources) {
      const row=$(`.fc-track-${s.key}`), n=count(s), rail=row.querySelector('.fc-rail');
      rail.dataset.loop=String(loop && n>0 && n<length);
      row.querySelector('.fc-fill').style.width=`${Math.min(100,n/Math.max(1,length)*100)}%`;
      row.querySelector('.fc-cursor').style.left=`${frame/Math.max(1,length-1)*100}%`;
      row.querySelector('.fc-track-count').textContent=s.error?'Load failed':n?`${n}f${n<length?(loop?' · repeat':' · hold'):''}`:s.url?'Loading…':'Not connected';
    }
  }
  function resize() {
    // Width determines height. Griptape's suggested fixed widget height must
    // not squeeze the image into a mismatched quadrant when a node is resized.
    const aspect=plate.video.videoWidth && plate.video.videoHeight ? plate.video.videoWidth/plate.video.videoHeight : 16/9;
    const columns=mode==='quad' || mode==='split' ? 2 : 1, rows=mode==='quad' ? 2 : 1;
    let availableWidth=Math.max(1,root.clientWidth-22);
    const naturalHeight=w=>rows*((w-(columns-1)*CELL_GAP)/columns/aspect+TITLE_HEIGHT)+(rows-1)*CELL_GAP;
    if(document.fullscreenElement===root) {
      const chrome=Array.from(root.children).filter(el=>el!==viewer).reduce((sum,el)=>sum+el.offsetHeight,0);
      const availableHeight=Math.max(rows*TITLE_HEIGHT+CELL_GAP+1,root.clientHeight-chrome-18);
      if(naturalHeight(availableWidth)>availableHeight) availableWidth=Math.max(1,((availableHeight-(rows-1)*CELL_GAP)/rows-TITLE_HEIGHT)*aspect*columns+(columns-1)*CELL_GAP);
      viewer.style.width=`${availableWidth+2}px`; viewer.style.alignSelf='center';
    } else {viewer.style.width='';viewer.style.alignSelf='';}
    viewer.style.height=`${naturalHeight(availableWidth)+2}px`;
    // clientWidth/Height stay in node-local pixels even when the graph is zoomed.
    width=Math.max(1,viewer.clientWidth); height=Math.max(1,viewer.clientHeight); dpr=Math.min(window.devicePixelRatio||1,2);
    if(canvas.width!==Math.round(width*dpr) || canvas.height!==Math.round(height*dpr)) {
      canvas.width=Math.round(width*dpr); canvas.height=Math.round(height*dpr);
    }
    draw();
  }
  function resetView() { zoom=1; panX=0; panY=0; draw(); paint(); }
  function setMode(next) { if(disabled || !modes.includes(next)) return; mode=next; resize(); resetView(); persist(); }
  listen($('.fc-play'),'click',play);
  listen($('.fc-prev'),'click',()=>{stop(false);setFrame(frame-1);}); listen($('.fc-next'),'click',()=>{stop(false);setFrame(frame+1);});
  listen(scrub,'input',()=>{const next=Number(scrub.value)-1;stop(false);setFrame(next,false);}); listen(scrub,'change',persist);
  listen(jump,'change',()=>{const next=number(jump.value,1)-1;stop(false);setFrame(next);});
  listen(rangeInput,'change',()=>{const next=integer(rangeInput.value,0,200000);stop(false);custom=next;setFrame(frame);});
  listen(fpsInput,'change',()=>{const next=clamp(integer(fpsInput.value,24,120),1,120);stop(false);fps=next;keySignature='';setFrame(frame);});
  listen($('.fc-auto'),'click',()=>{stop(false);custom=0;setFrame(frame);});
  listen($('.fc-loop'),'click',()=>{loop=!loop;if(playing)runMedia(frame/fps,true);else seek();draw();paint();persist();});
  listen($('.fc-invert'),'click',()=>{invert=!invert;draw();paint();persist();});
  for(const el of root.querySelectorAll('[data-mode]')) listen(el,'click',()=>setMode(el.dataset.mode==='wipe' && mode==='wipe'?'quad':el.dataset.mode));
  listen($('.fc-wipe-slider'),'input',()=>{wipe=clamp(Number($('.fc-wipe-slider').value)/100,0,1);draw();paint();});
  listen($('.fc-wipe-slider'),'change',persist);
  listen($('.fc-focus'),'change',e=>setMode(e.target.value)); listen($('.fc-fit'),'click',resetView);
  listen($('.fc-full'),'click',async()=>{
    try { if(document.fullscreenElement===root) await document.exitFullscreen(); else await root.requestFullscreen(); }
    catch { $('.fc-status').textContent='Fullscreen unavailable in this host. Resize the node to expand the viewer.'; }
  });
  listen(root,'keydown',e=>{
    if(disabled || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if(['Space','ArrowLeft','ArrowRight','Home','End','KeyF'].includes(e.code)) { e.preventDefault();e.stopPropagation(); }
    if(e.code==='Space') play();
    else if(e.code==='ArrowLeft' || e.code==='ArrowRight') {stop(false);setFrame(frame+(e.code==='ArrowLeft'?-1:1)*(e.shiftKey?10:1));}
    else if(e.code==='Home' || e.code==='End') {stop(false);setFrame(e.code==='Home'?0:total()-1);}
    else if(e.code==='KeyF') resetView();
  });
  const point = e => {const b=canvas.getBoundingClientRect();return {x:(e.clientX-b.left)*width/Math.max(1,b.width),y:(e.clientY-b.top)*height/Math.max(1,b.height)};};
  listen(canvas,'wheel',e=>{
    e.preventDefault();e.stopPropagation();if(disabled)return;
    zoom=clamp(zoom*Math.exp(-e.deltaY*0.0015),1,8); if(zoom===1){panX=0;panY=0;} draw();paint();
  },{passive:false});
  listen(canvas,'pointerdown',e=>{
    if(disabled || (e.button!==0 && e.button!==1))return;
    e.preventDefault(); e.stopPropagation(); root.focus({preventScroll:true});
    const p=point(e); dragging={x:p.x,y:p.y,panX,panY,wipe:mode==='wipe' && e.button===0 && (zoom===1 || Math.abs(p.x-width*wipe)<18)};
    canvas.setPointerCapture(e.pointerId); if(dragging.wipe){wipe=clamp(p.x/width,0,1);draw();}
  });
  listen(canvas,'pointermove',e=>{
    if(!dragging || disabled)return; const p=point(e);
    if(dragging.wipe){wipe=clamp(p.x/width,0,1);paint();}else{panX=dragging.panX+p.x-dragging.x;panY=dragging.panY+p.y-dragging.y;}draw();
  });
  function endDrag(){if(!dragging)return;const save=dragging.wipe;dragging=null;if(save)persist();}
  listen(canvas,'pointerup',endDrag);listen(canvas,'pointercancel',endDrag);listen(canvas,'lostpointercapture',endDrag);
  listen(canvas,'dblclick',()=>{if(!disabled)resetView();});
  listen(document,'visibilitychange',()=>{if(document.hidden && playing)stop();});
  listen(document,'fullscreenchange',resize);
  function update(next={}) {
    if(!alive)return;
    onChange=next.onChange; disabled=!!next.disabled;
    const incoming=next.value && typeof next.value==='object'?next.value:{};
    value=incoming;
    let changed=false;
    for(const s of sources) changed=changeSource(s,typeof incoming[s.key]==='string'?incoming[s.key]:'') || changed;
    for(const s of sources) if(incoming[s.key+'Error'])s.error=String(incoming[s.key+'Error']);
    if(changed || disabled)stop(false);
    if(!playing && !dragging) {
      fps=clamp(integer(incoming.fps,24,120),1,120); custom=integer(incoming.timelineFrames,0,200000); loop=incoming.loop!==false;
      mode=modes.includes(incoming.mode)?incoming.mode:'quad'; wipe=clamp(number(incoming.wipe,0.5),0,1); invert=!!incoming.invert;
      frame=integer(incoming.frame,0,200000);
      if(total()>0)frame=clamp(frame,0,Math.max(0,total()-1));
    }
    container.style.height='auto';
    // Do not trust saved durations after swapping clips; metadata is authoritative.
    lastPayload=JSON.stringify(payload()); if(!playing)seek();resize();paint();draw();
  }
  const observer=new ResizeObserver(resize); observer.observe(root); observer.observe(viewer);
  const handle={update,cleanup(){
    if(!alive)return;alive=false;playing=false;cancelAnimationFrame(raf);clearTimeout(publishTimer);observer.disconnect();if(gpu)gpu.dispose();
    listeners.forEach(off=>off());for(const s of sources){s.video.pause();s.video.removeAttribute('src');s.video.load();s.video.remove();}
    if(container.__fc===handle)delete container.__fc;
  }};
  container.__fc=handle; update(props); return handle;
}

// A small offscreen shader keeps matte processing off the JavaScript pixel loop.
function createMatteRenderer() {
  const output=document.createElement('canvas');
  const gl=output.getContext('webgl',{alpha:true,premultipliedAlpha:false,preserveDrawingBuffer:true,antialias:false,depth:false,stencil:false});
  if(!gl)return null;
  const shaders=[],textures=[];
  let program,buffer;
  function dispose(){for(const t of textures)gl.deleteTexture(t);for(const s of shaders)gl.deleteShader(s);if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);}
  try {
    function compile(type,source){const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error('Shader unavailable');return shader;}
    program=gl.createProgram();
    gl.attachShader(program,compile(gl.VERTEX_SHADER,'attribute vec2 position; varying vec2 uv; void main(){uv=position*0.5+0.5;gl_Position=vec4(position,0.0,1.0);}'));
    gl.attachShader(program,compile(gl.FRAGMENT_SHADER,'precision mediump float; varying vec2 uv; uniform sampler2D plate; uniform sampler2D mask; uniform float invertMask; void main(){vec4 p=texture2D(plate,uv);vec4 m=texture2D(mask,uv);float a=dot(m.rgb,vec3(0.2126,0.7152,0.0722));a=mix(a,1.0-a,invertMask);gl_FragColor=vec4(p.rgb,p.a*a*m.a);}'));
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Shader unavailable');
    gl.useProgram(program);
    buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const position=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    for(let unit=0;unit<2;unit++) {
      const texture=gl.createTexture();textures.push(texture);gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    }
    gl.uniform1i(gl.getUniformLocation(program,'plate'),0);gl.uniform1i(gl.getUniformLocation(program,'mask'),1);
    const invertLocation=gl.getUniformLocation(program,'invertMask');
    return {dispose,render(w,h,plate,mask,invert){
      if(gl.isContextLost())throw new Error('GPU context unavailable');
      if(output.width!==w || output.height!==h){output.width=w;output.height=h;}
      gl.viewport(0,0,w,h);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
      for(const [unit,video] of [plate,mask].entries()) {
        gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,textures[unit]);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,video);
      }
      gl.uniform1f(invertLocation,invert?1:0);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
      if(gl.getError()!==gl.NO_ERROR)throw new Error('GPU matte unavailable');
      return output;
    }};
  } catch(error){dispose();return null;}
}
