(() => {
'use strict';

/* =========================================================
   CONFIG — tweak difficulty here
   ========================================================= */
const CONFIG = {
  wordsPerLevel: 3,          // correct words needed to clear a level
  mistakePenalty: 0.5,       // seconds removed for each wrong key
  baseCharCount: 4,          // words up to this length get the level's base time
  extraTimePerChar: 0.15,    // bonus seconds per character beyond baseCharCount
  scoring: { base: 100, perSecond: 20 },   // (base + secondsLeft * perSecond) * level
  branch: { maxAngle: 30, shakeBase: 0.25, shakePerLevel: 0.14 },
  words: {
    1: ['CAT','RUN','HELP','SAVE','TREE','STOP','GO','FAST'],
    2: ['DANGER','QUICK','BRANCH','RESCUE','FOREST','ESCAPE','ACTION','SAFETY'],
    3: ['SAVE THE CAT','CUT THE BRANCH','WATCH OUT','MOVE QUICKLY','SAVE THE ANIMAL']
  },
  levels: [
    { time: 8,   pools: [1],   note: 'Warm up those fingers.' },
    { time: 7,   pools: [1],   note: 'The branch is creaking faster.' },
    { time: 6,   pools: [1,2], note: 'Longer words are coming.' },
    { time: 5.5, pools: [2],   note: 'Every word is a big one now.' },
    { time: 5,   pools: [2],   note: 'The wind is picking up.' },
    { time: 4.5, pools: [2],   note: 'Keep your eyes on the letters.' },
    { time: 4,   pools: [2,3], note: 'Phrases join in. Spaces count.' },
    { time: 3.5, pools: [2,3], note: 'The cat believes in you.' },
    { time: 3,   pools: [3],   note: 'Full phrases only.' },
    { time: 2.5, pools: [3],   note: 'Final level. Save the cat!' }
  ]
};

/* =========================================================
   Helpers
   ========================================================= */
const $ = s => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const lerp = (a,b,t) => a + (b-a)*t;
const ease = {
  lin: t => t,
  inQ: t => t*t,
  out: t => 1 - (1-t)*(1-t),
  inOut: t => t<.5 ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2,
  back: t => { const c=1.9; return 1 + (c+1)*Math.pow(t-1,3) + c*Math.pow(t-1,2); }
};
const motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.3 : 1;
const store = {
  get(k,d){ try{ const v=localStorage.getItem(k); return v===null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
};

let gen = 0; // bumps on every reset so stale sequences stop
function tween(dur, fn, e = ease.inOut){
  const my = gen;
  return new Promise(res => {
    const t0 = performance.now();
    const step = now => {
      if (my !== gen) return res(false);
      const t = Math.min(1, (now - t0) / dur);
      fn(e(t));
      if (t < 1) requestAnimationFrame(step); else res(true);
    };
    requestAnimationFrame(step);
  });
}
function wait(ms){ const my = gen; return new Promise(r => setTimeout(() => r(my === gen), ms)); }

/* =========================================================
   Sound (Web Audio, fully optional)
   ========================================================= */
const Sfx = (() => {
  let ctx = null, master = null, noiseBuf = null;
  let muted = store.get('stc.muted', false);
  function ensure(){
    if (muted) return null;
    try{
      if (!ctx){
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
        const len = ctx.sampleRate;
        noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i=0;i<len;i++) d[i] = Math.random()*2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }catch(e){ return null; }
  }
  function tone(f, d, o = {}){
    const c = ensure(); if (!c) return;
    try{
      const t = c.currentTime + (o.at || 0);
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.v || 0.1, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      osc.connect(g); g.connect(master);
      osc.start(t); osc.stop(t + d + 0.03);
    }catch(e){}
  }
  function noise(d, o = {}){
    const c = ensure(); if (!c) return;
    try{
      const t = c.currentTime + (o.at || 0);
      const src = c.createBufferSource(); src.buffer = noiseBuf;
      const fl = c.createBiquadFilter(); fl.type = o.type || 'bandpass';
      fl.frequency.setValueAtTime(o.f || 1200, t);
      if (o.to) fl.frequency.exponentialRampToValueAtTime(o.to, t + d);
      fl.Q.value = o.q || 0.8;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.v || 0.2, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      src.connect(fl); fl.connect(g); g.connect(master);
      src.start(t, Math.random()*0.5); src.stop(t + d + 0.03);
    }catch(e){}
  }
  return {
    unlock: ensure,
    isMuted: () => muted,
    setMuted(m){ muted = m; store.set('stc.muted', m); if (ctx){ try{ m ? ctx.suspend() : ctx.resume(); }catch(e){} } },
    type(){ tone(640 + Math.random()*160, .045, {type:'triangle', v:.05}); },
    wrong(){ tone(200, .2, {type:'sawtooth', v:.07, to:110}); },
    correct(){ [523,659,784,1047].forEach((f,i) => tone(f, .16, {type:'triangle', v:.09, at:i*.06})); },
    warn(){ tone(880, .09, {type:'square', v:.045}); },
    axe(){ noise(.22, {v:.28, f:500, to:3200, q:1.2}); },
    chop(){ tone(150, .12, {type:'square', v:.09, to:70}); noise(.08, {v:.3, f:2500, type:'highpass'}); },
    crack(){ for (let i=0;i<5;i++) noise(.05, {v:.25, f:1800 + Math.random()*1500, q:3, at:i*.045}); noise(.3, {v:.12, f:400, type:'lowpass', at:.05}); },
    creak(){ tone(170, .35, {type:'sawtooth', v:.025, to:250}); },
    meow(){ tone(620, .14, {type:'triangle', v:.08, to:920}); tone(920, .3, {type:'triangle', v:.07, to:520, at:.12}); },
    thud(){ tone(95, .25, {type:'sine', v:.22, to:45}); noise(.25, {v:.15, f:300, type:'lowpass'}); },
    levelUp(){ [392,523,659,784].forEach((f,i) => tone(f, .14, {type:'square', v:.04, at:i*.07})); },
    gameOver(){ [392,330,262,196].forEach((f,i) => tone(f, .32, {type:'triangle', v:.09, at:i*.18})); },
    win(){ [523,659,784,1047,784,1047].forEach((f,i) => tone(f, .2, {type:'triangle', v:.09, at:i*.11})); },
    click(){ tone(520, .06, {type:'triangle', v:.05}); }
  };
})();

/* =========================================================
   DOM refs
   ========================================================= */
const app = $('#app'), play = $('#play'), svg = $('#scene');
const branchEl = $('#branch'), crackEl = $('#crack'), workerEl = $('#worker'), axeArm = $('#axeArm');
const bubble = $('#bubble'), catEl = $('#cat'), catBody = $('#catBody'), fxLayer = $('#fx');
const scoreEl = $('#scoreEl'), levelEl = $('#levelEl'), timeEl = $('#timeEl'), timeWrap = $('#timeWrap');
const timebar = $('#timebar'), timefill = $('#timefill');
const challenge = $('#challenge'), wordEl = $('#word'), shoutEl = $('#shout');
const banner = $('#banner'), bannerLv = $('#bannerLv'), bannerNote = $('#bannerNote');
const screens = [...document.querySelectorAll('.screen')];

/* =========================================================
   Scene decoration (generated once)
   ========================================================= */
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
(function decorate(){
  const R = mulberry32(12);
  const petals = ['#FF6B9A','#FFD23F','#FFFFFF','#B28DFF','#FF8A5B','#6EC6FF'];
  let back = '', front = '', tufts = '';
  for (let i=0;i<80;i++){
    const x = -700 + R()*2400, y = 506 + R()*84;
    if (x > 420 && x < 590 && y < 522) continue;       // trunk base
    if (x > 280 && x < 460 && y < 540) continue;       // cat & worker stage
    const sc = (0.75 + R()*0.4) * (0.85 + (y-506)/84*0.45);
    const u = `<use href="#flower" transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) scale(${sc.toFixed(2)})" style="--petal:${petals[i % petals.length]}"/>`;
    if (y > 540) front += u; else back += u;
  }
  for (let i=0;i<46;i++){
    const x = -700 + R()*2400, y = 500 + R()*95;
    tufts += `<use href="#tuft" transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) scale(${(0.8+R()*0.7).toFixed(2)})"/>`;
  }
  $('#flowersBack').innerHTML = back;
  $('#flowersFront').innerHTML = front;
  $('#tufts').innerHTML = tufts;
  const clouds = [[-560,120,1],[-280,40,.8],[60,150,.9],[300,-40,1.1],[660,130,.85],[920,30,1.2],[1200,110,.8],[1450,40,1],
                  [100,-230,1],[620,-310,1.1],[-220,-360,.9],[900,-200,.9],[320,-540,1],[720,-680,1.2],[80,-820,.9]];
  $('#clouds').innerHTML = clouds.map((c,i) =>
    `<g transform="translate(${c[0]} ${c[1]}) scale(${c[2]})"><g class="drift" style="animation-duration:${28+i*3}s;animation-delay:-${i*4}s"><use href="#cloud"/></g></g>`).join('');
})();

/* =========================================================
   Responsive framing: always keep the tree, cat and worker in view
   ========================================================= */
const PIVOT = { x: 472, y: 300 }, CAT_X = 330, CHOP_X = 418, GROUND = 500;
let vb = { x:0, y:0, w:1000, h:600 };
let homeX = 130;
function fitScene(){
  const W = play.clientWidth, H = play.clientHeight;
  if (!W || !H) return;
  const a = W / H;
  let w, h;
  if (a >= 1000/600){ h = 600; w = h * a; }
  else { w = Math.max(440, 600 * a); h = w / a; }
  const cx = w >= 1000 ? 500 : 390 + (w - 440) / 560 * 110;
  vb = { x: cx - w/2, y: 578 - h, w, h };
  svg.setAttribute('viewBox', `${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
  homeX = Math.min(250, Math.max(130, vb.x + 50));
  if (!workerBusy){ worker.x = homeX; applyWorker(); }
}
if ('ResizeObserver' in window) new ResizeObserver(fitScene).observe(play);
else addEventListener('resize', fitScene);

/* =========================================================
   Character state + rendering
   ========================================================= */
const br = { x:0, y:0, angle:-3, s:1, op:1 };
function applyBranch(){
  branchEl.setAttribute('transform',
    `translate(${br.x.toFixed(2)} ${br.y.toFixed(2)}) rotate(${br.angle.toFixed(2)} ${PIVOT.x} ${PIVOT.y}) translate(${PIVOT.x} ${PIVOT.y}) scale(${Math.max(0.01,br.s).toFixed(3)}) translate(${-PIVOT.x} ${-PIVOT.y})`);
  branchEl.setAttribute('opacity', br.op.toFixed(2));
}
const AXE_REST = -25, AXE_WIND = -235, AXE_HIT = -148;
const worker = { x:130, hop:0, face:1, axe:AXE_REST };
let workerBusy = false;
function applyWorker(){
  workerEl.setAttribute('transform', `translate(${worker.x.toFixed(1)} ${(GROUND + worker.hop).toFixed(1)}) scale(${worker.face} 1)`);
}
function applyAxe(){ axeArm.setAttribute('transform', `rotate(${worker.axe.toFixed(1)} 4 -110)`); }
const cat = { jump:0, shake:0 };
function applyCat(){ catBody.setAttribute('transform', `translate(${cat.shake.toFixed(2)} ${cat.jump.toFixed(2)})`); }
function setCat(mood){ if (catEl.dataset.mood !== mood) catEl.dataset.mood = mood; }

async function moveWorker(x, dur){
  const from = worker.x;
  if (Math.abs(x - from) < 1) return true;
  workerBusy = true;
  worker.face = x > from ? 1 : -1;
  workerEl.classList.add('running'); applyWorker();
  const ok = await tween(dur, t => { worker.x = lerp(from, x, t); applyWorker(); }, ease.inOut);
  workerEl.classList.remove('running');
  worker.face = 1; applyWorker();
  if (x === homeX) workerBusy = false;
  return ok;
}
function workerReact(){
  bubble.classList.remove('show'); void bubble.getBBox; requestAnimationFrame(() => bubble.classList.add('show'));
  tween(260, t => { worker.hop = -14 * Math.sin(Math.PI * t); applyWorker(); }, ease.lin);
}

/* =========================================================
   Effects
   ========================================================= */
function fxAt(x, y, markup, frames, opts){
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  g.innerHTML = markup;
  fxLayer.appendChild(g);
  const el = g.firstElementChild;
  if (el && el.animate && frames){
    const a = el.animate(frames, Object.assign({ fill:'forwards' }, opts));
    a.onfinish = () => g.remove();
  } else if (frames){ setTimeout(() => g.remove(), (opts && opts.duration) || 1000); }
  return g;
}
const LEAF_COLORS = ['#4DB356','#56BD5E','#3FA34D','#8BD36B'];
function leaf(x, y, dx, dy, dur){
  const c = LEAF_COLORS[(Math.random()*LEAF_COLORS.length)|0];
  const rot = (Math.random()*2-1) * 540;
  fxAt(x, y, `<g><ellipse rx="7" ry="3.5" fill="${c}" stroke="#233049" stroke-width="1.2"/></g>`, [
    { transform:'translate(0px,0px) rotate(0deg)', opacity:1 },
    { transform:`translate(${dx*0.5 + 18}px,${dy*0.45}px) rotate(${rot*0.5}deg)`, opacity:1, offset:.5 },
    { transform:`translate(${dx}px,${dy}px) rotate(${rot}deg)`, opacity:0 }
  ], { duration:dur, easing:'ease-in' });
}
function windLeaf(){
  const x = 360 + Math.random()*300, y = 170 + Math.random()*80;
  leaf(x, y, (Math.random()*2-1)*120 - 30, 300 - (y - 170), 2200 + Math.random()*900);
}
function leavesBurst(x, y, n, spread = 90){
  for (let i=0;i<n;i++) leaf(x + (Math.random()*2-1)*spread*0.5, y + (Math.random()*2-1)*20, (Math.random()*2-1)*spread, 120 + Math.random()*140, 900 + Math.random()*600);
}
function starPts(r1, r2, n){
  let s = '';
  for (let i=0;i<n*2;i++){ const r = i%2 ? r2 : r1, a = Math.PI*i/n - Math.PI/2; s += `${(Math.cos(a)*r).toFixed(1)},${(Math.sin(a)*r).toFixed(1)} `; }
  return s;
}
function chopBurst(){
  fxAt(PIVOT.x - 6, PIVOT.y + 8,
    `<g><polygon points="${starPts(38,17,9)}" fill="#FFF6B0" stroke="#233049" stroke-width="3" stroke-linejoin="round"/>
      <text x="-2" y="-44" text-anchor="middle" font-size="30" class="fx-text" fill="#FFC933" stroke="#233049" stroke-width="5" paint-order="stroke fill">CHOP!</text></g>`,
    [ { transform:'scale(.3) rotate(-20deg)', opacity:1 }, { transform:'scale(1.2) rotate(6deg)', opacity:1, offset:.3 },
      { transform:'scale(1) rotate(0deg)', opacity:1, offset:.6 }, { transform:'scale(1.1)', opacity:0 } ],
    { duration:700, easing:'ease-out' });
  for (let i=0;i<7;i++){
    const a = Math.random()*Math.PI*2, d = 40 + Math.random()*50;
    fxAt(PIVOT.x, PIVOT.y + 6, `<g><rect x="-5" y="-2" width="10" height="4" rx="2" fill="#B07A52" stroke="#233049" stroke-width="1"/></g>`, [
      { transform:'translate(0px,0px) rotate(0deg)', opacity:1 },
      { transform:`translate(${Math.cos(a)*d}px,${Math.sin(a)*d + 40}px) rotate(${Math.random()*400}deg)`, opacity:0 }
    ], { duration:600, easing:'ease-out' });
  }
}
function poofRow(){
  for (let i=0;i<9;i++){
    const x = 250 + i*26 + Math.random()*10, r = 10 + Math.random()*10;
    fxAt(x, GROUND - 4 - Math.random()*8, `<g><circle r="${r.toFixed(0)}" fill="#fff" stroke="#233049" stroke-width="2" opacity=".95"/></g>`, [
      { transform:'scale(.3) translate(0px,0px)', opacity:1 },
      { transform:`scale(1.6) translate(${(i-4)*3}px,-14px)`, opacity:0 }
    ], { duration:700 + Math.random()*200, easing:'ease-out' });
  }
}
function dust(x){
  for (let i=0;i<4;i++){
    fxAt(x - i*8, GROUND - 4, `<g><circle r="7" fill="#fff" opacity=".85"/></g>`, [
      { transform:'scale(.4)', opacity:.9 }, { transform:`scale(1.5) translate(${-10 - i*4}px,-8px)`, opacity:0 }
    ], { duration:450, easing:'ease-out', delay:i*40 });
  }
}
const HEART = 'M0 5 C -7 -1 -11 -7 -6 -11 C -3 -13 0 -11 0 -8 C 0 -11 3 -13 6 -11 C 11 -7 7 -1 0 5 Z';
function hearts(n = 3){
  for (let i=0;i<n;i++){
    const dx = (i - (n-1)/2) * 22;
    fxAt(CAT_X + dx*0.4, GROUND - 110, `<g><path d="${HEART}" fill="#FF6B8B" stroke="#233049" stroke-width="1.8" transform="scale(1.3)"/></g>`, [
      { transform:'translate(0px,0px) scale(.3)', opacity:0 },
      { transform:`translate(${dx*0.6}px,-20px) scale(1.2)`, opacity:1, offset:.25 },
      { transform:`translate(${dx}px,-70px) scale(1)`, opacity:0 }
    ], { duration:1100, easing:'ease-out', delay:i*120 });
  }
}
function leafOnHead(){
  fxAt(CAT_X - 6, GROUND - 19 - 101, `<g transform="rotate(-25)"><ellipse rx="10" ry="5" fill="#4DB356" stroke="#233049" stroke-width="1.8"/><path d="M-9 0 H9" stroke="#2E7D3A" stroke-width="1.4"/></g>`, null, null);
}
function shakePlay(){ play.classList.remove('shake'); void play.offsetWidth; play.classList.add('shake'); }
function shout(text, kind, hold){
  shoutEl.textContent = text;
  shoutEl.className = '';
  void shoutEl.offsetWidth;
  shoutEl.className = (kind === 'bad' ? 'bad ' : '') + (hold ? 'hold' : 'show');
}
function pop(text, kind){
  const d = document.createElement('div');
  d.className = 'pop ' + kind; d.textContent = text;
  (kind === 'penalty' ? timeWrap : challenge).appendChild(d);
  d.addEventListener('animationend', () => d.remove());
}
function showBanner(){
  bannerLv.textContent = 'Level ' + level;
  bannerNote.textContent = CONFIG.levels[level-1].note;
  banner.classList.remove('show'); void banner.offsetWidth; banner.classList.add('show');
}

/* =========================================================
   Game state
   ========================================================= */
let state = 'menu', level = 1, score = 0, wordsDone = 0;
let target = '', typed = [], tiles = [], lastWord = null;
let total = 8, elapsed = 0, lastT = 0, rafId = 0, warnMark = 4, jolt = 0, leafTimer = 1, branchGone = false;

/* ---------- words: the shared word bank (about 3000 graded words) when available ---------- */
const WB = window.STCWordBank || null;
let BANK = WB && window.STC_WORDS ? WB.build(window.STC_WORDS, [], 'mix') : null;
let picker = null;
if (WB && BANK && location.protocol !== 'file:'){
  // when served by server.js, also use the words from custom-words.txt
  fetch('/api/words').then(r => r.json()).then(d => {
    if (d && Array.isArray(d.custom) && d.custom.length) BANK = WB.build(window.STC_WORDS, d.custom, d.mode);
  }).catch(() => {});
}
if (WB) WB.LEVELS.forEach((L, i) => { if (CONFIG.levels[i]) CONFIG.levels[i].note = L.note; });
function pickWord(pools){
  if (picker) return picker.next(level);              // never repeats a word within one game
  const list = pools.flatMap(p => CONFIG.words[p]).filter(w => w !== lastWord);
  const w = list[(Math.random()*list.length)|0];
  lastWord = w;
  return w;
}
function wordTime(L, word){
  if (WB && BANK) return WB.durationFor(level, word);
  return Math.round((L.time + Math.max(0, word.length - CONFIG.baseCharCount) * CONFIG.extraTimePerChar) * 10) / 10;
}

function updateHUD(){
  levelEl.textContent = 'Level: ' + level;
  scoreEl.textContent = 'Score: ' + score;
}
function updateTime(left, p){
  timeEl.textContent = 'Time: ' + left.toFixed(1);
  const frac = total > 0 ? Math.max(0, left / total) : 0;
  timefill.style.transform = `scaleX(${frac.toFixed(4)})`;
  timebar.classList.toggle('mid', frac <= .5 && frac > .25);
  timebar.classList.toggle('low', frac <= .25);
  timeEl.classList.toggle('danger', left <= 2 && left > 0 && state === 'playing');
}
function setIntensity(){
  svg.classList.toggle('windy', level >= 5);
  svg.style.setProperty('--sway-dur', Math.max(1.1, 3.2 - level*0.22).toFixed(2) + 's');
}

function buildTiles(){
  wordEl.innerHTML = '';
  wordEl.style.setProperty('--n', target.length);
  wordEl.setAttribute('aria-label', 'Type: ' + target);
  tiles = [...target].map((ch, i) => {
    const s = document.createElement('span');
    s.className = 'tile' + (ch === ' ' ? ' space' : '');
    s.style.setProperty('--i', i);
    s.textContent = ch === ' ' ? '' : ch;
    wordEl.appendChild(s);
    return s;
  });
  wordEl.classList.remove('enter'); void wordEl.offsetWidth; wordEl.classList.add('enter');
  renderTiles();
}
function renderTiles(){
  tiles.forEach((t, i) => {
    const has = i < typed.length;
    const ok = has && typed[i] === target[i];
    t.classList.toggle('ok', ok);
    t.classList.toggle('bad', has && !ok);
    t.classList.toggle('next', i === typed.length);
  });
}
function clearWord(){ wordEl.innerHTML = ''; tiles = []; challenge.classList.add('idle'); challenge.classList.remove('done'); }

function resetScene(){
  gen++;
  cancelAnimationFrame(rafId);
  fxLayer.innerHTML = '';
  Object.assign(br, { x:0, y:0, angle:-3, s:1, op:1 }); applyBranch();
  crackEl.setAttribute('opacity', '.25');
  branchGone = false;
  workerBusy = false;
  workerEl.classList.remove('running');
  Object.assign(worker, { x:homeX, hop:0, face:1, axe:AXE_REST }); applyWorker(); applyAxe();
  bubble.classList.remove('show');
  Object.assign(cat, { jump:0, shake:0 }); applyCat(); setCat('normal');
  shoutEl.className = ''; banner.classList.remove('show');
  timeEl.classList.remove('danger');
  clearWord();
}

/* ---------- flow ---------- */
function showScreen(id){
  screens.forEach(s => s.hidden = s.id !== id);
  const sc = screens.find(s => s.id === id);
  if (sc){ const b = sc.querySelector('.btn'); setTimeout(() => { if (!sc.hidden) b.focus({ preventScroll:true }); }, 450); }
}
let holdGame = false;
function pauseGame(){
  if (app.dataset.mode !== 'game' || state === 'over' || state === 'win') return false;
  holdGame = true;
  if (state === 'playing'){ state = 'paused'; cancelAnimationFrame(rafId); }
  $('#confirm').hidden = false;
  setTimeout(() => $('#confirm .btn').focus({ preventScroll: true }), 50);
  return true;
}
function resumeGame(){
  holdGame = false;
  $('#confirm').hidden = true;
  if (state === 'paused'){ state = 'playing'; lastT = performance.now(); rafId = requestAnimationFrame(loop); }
}
function toMenu(){
  holdGame = false;
  const c = $('#confirm'); if (c) c.hidden = true;
  if (!ACCOUNT){ showScreen('gate'); return; }
  resetScene();
  state = 'menu';
  app.dataset.mode = 'menu';
  const best = store.get('stc.best', 0);
  $('#menuBest').textContent = best > 0 ? 'Best score: ' + best : '';
  showScreen('menu');
}
function startGame(){
  Sfx.unlock();
  try { window.focus(); } catch(e){}
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  resetScene();
  score = 0; level = 1; wordsDone = 0; lastWord = null;
  picker = WB && BANK ? WB.createPicker(BANK) : null;
  updateHUD(); updateTime(CONFIG.levels[0].time, 0);
  timefill.style.transform = 'scaleX(1)';
  showScreen(null);
  app.dataset.mode = 'game';
  levelIntro();
}
async function levelIntro(){
  state = 'transition';
  updateHUD(); setIntensity(); clearWord();
  const L = CONFIG.levels[level-1];
  total = L.time; updateTime(L.time, 0); timefill.style.transform = 'scaleX(1)';
  showBanner();
  Sfx.levelUp();
  if (!(await wait(1350))) return;
  startRound();
}
function startRound(){
  const L = CONFIG.levels[level-1];
  target = pickWord(L.pools);
  typed = []; elapsed = 0; jolt = 0;
  total = wordTime(L, target);
  warnMark = total > 3.2 ? 4 : Math.ceil(total);
  leafTimer = 0.4;
  challenge.classList.remove('idle', 'done');
  buildTiles();
  updateTime(total, 0);
  if (branchGone){
    branchGone = false;
    Object.assign(br, { x:0, y:0, angle:0, s:0.01, op:1 }); applyBranch();
    crackEl.setAttribute('opacity', '.25');
    Sfx.creak();
    tween(340, t => { br.s = t; applyBranch(); }, ease.back);
  }
  setCat('lookup');
  workerReact();
  state = 'playing';
  lastT = performance.now();
  if (holdGame){ state = 'paused'; return; }     // the quit dialog is open: wait until the player decides
  rafId = requestAnimationFrame(loop);
}

function loop(now){
  if (state !== 'playing') return;
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  elapsed += dt;
  const left = Math.max(0, total - elapsed);
  const p = Math.min(1, elapsed / total);
  jolt *= Math.pow(0.004, dt);
  const t = now / 1000;
  const amp = (CONFIG.branch.shakeBase + level * CONFIG.branch.shakePerLevel) * (0.35 + p * 1.4) * motion;
  br.angle = -CONFIG.branch.maxAngle * Math.pow(p, 1.25) + Math.sin(t * (16 + level * 2.2)) * amp - jolt;
  applyBranch();
  crackEl.setAttribute('opacity', (0.25 + 0.75 * p).toFixed(2));

  const mood = p < 0.3 ? 'lookup' : p < 0.65 ? 'worried' : 'scared';
  setCat(mood);
  cat.shake = mood === 'scared' ? Math.sin(t * 55) * (1 + level * 0.08) * motion : 0;
  applyCat();

  updateTime(left, p);
  if (left > 0 && left <= 3 && Math.ceil(left) < warnMark){ warnMark = Math.ceil(left); Sfx.warn(); }

  leafTimer -= dt;
  if (leafTimer <= 0){ windLeaf(); leafTimer = Math.max(0.3, 2.2 - level * 0.19) * (0.7 + Math.random() * 0.6); }

  if (left <= 0){ fail(); return; }
  rafId = requestAnimationFrame(loop);
}

/* ---------- typing ---------- */
function handleChar(ch){
  if (state !== 'playing') return;
  if (typed.length >= target.length){
    wordEl.classList.remove('nudge'); void wordEl.offsetWidth; wordEl.classList.add('nudge');
    return;
  }
  typed.push(ch);
  const i = typed.length - 1;
  if (ch === target[i]) Sfx.type(); else mistake();
  renderTiles();
  if (typed.join('') === target) success();
}
function backspace(){
  if (state !== 'playing' || !typed.length) return;
  typed.pop();
  Sfx.type();
  renderTiles();
}
function mistake(){
  Sfx.wrong();
  elapsed += CONFIG.mistakePenalty;
  jolt += 5;
  pop('-' + CONFIG.mistakePenalty + 's', 'penalty');
  if (level >= 4) shakePlay();
}

/* ---------- outcomes ---------- */
function addScore(pts){
  const from = score; score += pts;
  const to = score;
  tween(650, t => { scoreEl.textContent = 'Score: ' + Math.round(lerp(from, to, t)); }, ease.out);
  scoreEl.classList.remove('bump'); void scoreEl.offsetWidth; scoreEl.classList.add('bump');
  pop('+' + pts, 'score');
}
async function success(){
  state = 'resolving';
  cancelAnimationFrame(rafId);
  timeEl.classList.remove('danger');
  const left = Math.max(0, total - elapsed);
  const pts = Math.round((CONFIG.scoring.base + left * CONFIG.scoring.perSecond) * level);
  Sfx.correct();
  shout(Math.random() < .5 ? 'NICE!' : 'SAVED!', 'good');
  addScore(pts);
  challenge.classList.add('done');
  setCat('lookup'); cat.shake = 0; applyCat();
  bubble.classList.remove('show');

  dust(worker.x - 10);
  if (!(await moveWorker(CHOP_X, 360))) return;
  Sfx.axe();
  if (!(await tween(150, t => { worker.axe = lerp(AXE_REST, AXE_WIND, t); applyAxe(); }, ease.out))) return;
  if (!(await tween(100, t => { worker.axe = lerp(AXE_WIND, AXE_HIT, t); applyAxe(); }, ease.inQ))) return;

  Sfx.chop(); Sfx.crack();
  chopBurst();
  const a0 = br.angle;
  branchGone = true;
  tween(720, t => {
    br.x = -430 * t;
    br.y = -80 * Math.sin(Math.PI * t * 0.8) + 380 * t * t;
    br.angle = a0 + 160 * t;
    br.op = t < .7 ? 1 : 1 - (t - .7) / .3;
    applyBranch();
  }, ease.lin);
  leavesBurst(PIVOT.x - 150, PIVOT.y - 10, 7, 120);
  setCat('happy'); Sfx.meow(); hearts();
  tween(560, t => { cat.jump = -42 * Math.abs(Math.sin(Math.PI * 2 * t)); applyCat(); }, ease.lin);
  tween(260, t => { worker.axe = lerp(AXE_HIT, AXE_REST, t); applyAxe(); }, ease.inOut);

  if (!(await wait(820))) return;
  if (!(await moveWorker(homeX, 420))) return;

  wordsDone++;
  if (wordsDone >= CONFIG.wordsPerLevel){
    wordsDone = 0;
    if (level >= CONFIG.levels.length){ win(); return; }
    level++;
    levelIntro();
  } else {
    startRound();
  }
}
async function fail(){
  state = 'resolving';
  cancelAnimationFrame(rafId);
  updateTime(0, 1);
  timeEl.classList.remove('danger');
  challenge.classList.add('done');
  Sfx.crack();
  shout('OH NO!', 'bad', true);
  setCat('surprised'); cat.shake = 0;
  bubble.classList.remove('show');
  const a0 = br.angle;
  tween(320, t => { cat.jump = -110 * t; applyCat(); }, ease.out)
    .then(ok => ok && tween(300, t => { cat.jump = lerp(-110, -19, t); applyCat(); }, ease.inQ));
  if (!(await tween(480, t => { br.y = 190 * t; br.angle = lerp(a0, -5, t); applyBranch(); }, ease.inQ))) return;
  Sfx.thud(); poofRow(); shakePlay(); leavesBurst(330, 440, 8, 160);
  tween(180, t => { br.y = 190 - 10 * Math.sin(Math.PI * t); applyBranch(); }, ease.lin);
  if (!(await wait(320))) return;
  leafOnHead();
  if (!(await wait(1000))) return;
  Sfx.gameOver();
  state = 'over';
  const best = Math.max(store.get('stc.best', 0), score);
  store.set('stc.best', best);
  $('#goScore').textContent = score;
  $('#goLevel').textContent = level;
  $('#goBest').textContent = best;
  shoutEl.className = '';
  saveOnline(score, level, '#goOnline');
  showScreen('gameover');
}
async function win(){
  state = 'win';
  shout('YOU DID IT!', 'good', true);
  Sfx.win();
  setCat('happy'); hearts(5);
  tween(900, t => { cat.jump = -50 * Math.abs(Math.sin(Math.PI * 3 * t)); applyCat(); }, ease.lin);
  if (!(await wait(1500))) return;
  const best = Math.max(store.get('stc.best', 0), score);
  store.set('stc.best', best);
  $('#winScore').textContent = score;
  $('#winBest').textContent = best;
  shoutEl.className = '';
  saveOnline(score, CONFIG.levels.length, '#winOnline');
  showScreen('win');
}

/* =========================================================
   Online leaderboard (only when served by server.js)
   ========================================================= */
let accountsOn = false;
const authToken = () => store.get('stc.auth', null);
if (location.protocol !== 'file:'){
  fetch('/api/config').then(r => r.json()).then(c => {
    accountsOn = !!c.accounts;
    const link = document.getElementById('soloBoardLink');
    if (link) link.hidden = !accountsOn;
  }).catch(() => {});
}
async function saveOnline(score, lvl, sel){
  const el = $(sel);
  el.className = 'online-line'; el.textContent = '';
  if (!accountsOn) return;
  if (!authToken()){ el.textContent = 'Sign in from the duel menu to put your scores on the leaderboard.'; return; }
  if (score <= 0) return;
  el.textContent = 'Saving your score…';
  try {
    const r = await fetch('/api/solo', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken() },
                                         body: JSON.stringify({ score, level: lvl }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok){ el.textContent = d.error || 'Could not save your score.'; return; }
    el.className = 'online-line' + (d.newBest ? ' good' : '');
    el.textContent = d.newBest ? `New personal best! You're #${d.rank} on the solo leaderboard.`
                               : `Saved. Your best is ${d.soloBest} (rank #${d.rank}).`;
  } catch (e){ el.textContent = 'Could not reach the server to save your score.'; }
}

/* =========================================================
   Input
   ========================================================= */
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape'){
    const sc = screens.find(x => !x.hidden);
    const back = sc && sc.querySelector('[data-back]');
    if (back){ e.preventDefault(); back.click(); return; }
    if (!sc && pauseGame()) e.preventDefault();
    return;
  }
  if (state === 'playing' || state === 'resolving' || state === 'transition'){
    if (e.key === 'Backspace'){ e.preventDefault(); backspace(); return; }
    if (e.key === ' ' || e.key === 'Spacebar'){ e.preventDefault(); handleChar(' '); return; }
    if (e.key && e.key.length === 1 && /[a-z]/i.test(e.key)){ e.preventDefault(); handleChar(e.key.toUpperCase()); }
  }
});

function updateSoundUI(){
  const m = Sfx.isMuted();
  app.classList.toggle('muted', m);
  $('#soundBtn').textContent = m ? 'SOUND OFF' : 'SOUND ON';
  $('#muteBtn').setAttribute('aria-label', m ? 'Turn sound on' : 'Turn sound off');
}
app.addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (!b) return;
  const act = b.dataset.action;
  if (act === 'sound'){
    Sfx.setMuted(!Sfx.isMuted()); updateSoundUI();
    if (!Sfx.isMuted()) Sfx.click();
    if (state === 'playing') b.blur();
    return;
  }
  Sfx.click();
  if (act === 'quitAsk'){ b.blur(); pauseGame(); return; }
  if (act === 'resumeGame'){ resumeGame(); return; }
  if (act === 'quitGame'){ toMenu(); return; }
  if (act === 'start'){ if (!ACCOUNT){ showScreen('gate'); return; } startGame(); }
  else if (act === 'howto') showScreen('howto');
  else if (act === 'menu') toMenu();
});

/* On-screen keyboard for touch devices */
(function buildKeyboard(){
  const vk = $('#vk');
  const rows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];
  rows.forEach((r, ri) => {
    const row = document.createElement('div');
    row.className = 'vk-row r' + (ri + 1);
    [...r].forEach(ch => row.appendChild(key(ch, ch)));
    if (ri === 2) row.appendChild(key('\u232B', 'BACK', 'back'));
    vk.appendChild(row);
  });
  const last = document.createElement('div');
  last.className = 'vk-row';
  last.appendChild(key('SPACE', ' ', 'space'));
  vk.appendChild(last);
  function key(label, val, cls){
    const b = document.createElement('button');
    b.type = 'button'; b.tabIndex = -1;
    b.className = 'vk-key' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.setAttribute('aria-label', val === ' ' ? 'Space' : val === 'BACK' ? 'Backspace' : val);
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      Sfx.unlock();
      if (val === 'BACK') backspace(); else handleChar(val);
      b.classList.add('down');
      setTimeout(() => b.classList.remove('down'), 110);
    });
    return b;
  }
})();
const setTouch = () => { if (!app.classList.contains('touch')){ app.classList.add('touch'); } };
if (matchMedia('(pointer: coarse)').matches) setTouch();
addEventListener('touchstart', setTouch, { passive:true, once:true });

/* =========================================================
   Boot
   ========================================================= */
/* Everyone plays with an account: check the sign-in saved by the main page */
let ACCOUNT = null;
function applyAccount(u){
  ACCOUNT = u;
  const av = window.STCAvatar ? window.STCAvatar.normalize(u.avatar, u.gender) : { g: u.gender === 'woman' ? 'woman' : 'man' };
  $('#workerHead').setAttribute('href', '#head-' + av.g);
  if (window.STCAvatar) window.STCAvatar.apply(workerEl, av);
  $('#soloName').textContent = u.username;
  $('#soloFace').innerHTML = window.STCAvatar ? window.STCAvatar.portrait(av, 'acct-face') : '';
  $('#soloStats').textContent = u.soloBest ? `Solo best ${u.soloBest} (level ${u.soloLevel})` : 'No solo score yet. Set your first!';
}
async function checkAccount(){
  if (location.protocol === 'file:'){
    $('#gateText').textContent = 'You opened the file directly. Start the server with "node server.js", open the address it prints and sign in. Everyone needs an account to play.';
    return null;
  }
  const token = authToken();
  if (!token) return null;
  try {
    const r = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return null;
    return (await r.json()).user;
  } catch (e){ $('#gateText').textContent = 'Could not reach the server. Check your connection and reload the page.'; return null; }
}

updateSoundUI();
fitScene();
applyBranch(); applyWorker(); applyAxe(); applyCat();
showScreen(null);
checkAccount().then(u => {
  if (u){ applyAccount(u); accountsOn = true; toMenu(); }
  else showScreen('gate');
});
})();
