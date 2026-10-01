/* =========================================================
   Save the Cat — Duel client
   The server (server.js) decides words, timing and winners.
   This file draws both parks and sends your keystrokes.
   ========================================================= */
(() => {
'use strict';

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = {
  lin: t => t,
  inQ: t => t * t,
  out: t => 1 - (1 - t) * (1 - t),
  inOut: t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
  back: t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); }
};
const motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.3 : 1;
const store = {
  get(k, d){ try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e){ return d; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e){} }
};
const G = { gen: 0 };                       // bump to cancel controller-level sequences
function tween(dur, fn, e = ease.inOut, owner = G){
  const my = owner.gen;
  return new Promise(res => {
    const t0 = performance.now();
    const step = now => {
      if (owner.gen !== my) return res(false);
      const t = Math.min(1, (now - t0) / dur);
      fn(e(t));
      if (t < 1) requestAnimationFrame(step); else res(true);
    };
    requestAnimationFrame(step);
  });
}
function wait(ms, owner = G){ const my = owner.gen; return new Promise(r => setTimeout(() => r(owner.gen === my), ms)); }

/* =========================================================
   Sound (Web Audio, optional)
   ========================================================= */
const Sfx = (() => {
  let ctx = null, master = null, noiseBuf = null;
  let muted = store.get('stc.muted', false);
  function ensure(){
    if (muted) return null;
    try {
      if (!ctx){
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e){ return null; }
  }
  function tone(f, d, o = {}){
    const c = ensure(); if (!c) return;
    try {
      const t = c.currentTime + (o.at || 0);
      const osc = c.createOscillator(), g = c.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(o.v || 0.1, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + d + 0.03);
    } catch (e){}
  }
  function noise(d, o = {}){
    const c = ensure(); if (!c) return;
    try {
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
      src.start(t, Math.random() * 0.5); src.stop(t + d + 0.03);
    } catch (e){}
  }
  return {
    unlock: ensure,
    isMuted: () => muted,
    setMuted(m){ muted = m; store.set('stc.muted', m); if (ctx){ try { m ? ctx.suspend() : ctx.resume(); } catch (e){} } },
    type(){ tone(640 + Math.random() * 160, .045, { type: 'triangle', v: .05 }); },
    wrong(){ tone(200, .2, { type: 'sawtooth', v: .07, to: 110 }); },
    correct(){ [523, 659, 784, 1047].forEach((f, i) => tone(f, .16, { type: 'triangle', v: .09, at: i * .06 })); },
    lose(){ [330, 262].forEach((f, i) => tone(f, .18, { type: 'triangle', v: .08, at: i * .12 })); },
    warn(){ tone(880, .09, { type: 'square', v: .045 }); },
    axe(){ noise(.22, { v: .28, f: 500, to: 3200, q: 1.2 }); },
    chop(){ tone(150, .12, { type: 'square', v: .09, to: 70 }); noise(.08, { v: .3, f: 2500, type: 'highpass' }); },
    crack(){ for (let i = 0; i < 5; i++) noise(.05, { v: .25, f: 1800 + Math.random() * 1500, q: 3, at: i * .045 }); noise(.3, { v: .12, f: 400, type: 'lowpass', at: .05 }); },
    creak(){ tone(170, .35, { type: 'sawtooth', v: .03, to: 250 }); },
    meow(){ tone(620, .14, { type: 'triangle', v: .08, to: 920 }); tone(920, .3, { type: 'triangle', v: .07, to: 520, at: .12 }); },
    thud(){ tone(95, .25, { type: 'sine', v: .22, to: 45 }); noise(.25, { v: .15, f: 300, type: 'lowpass' }); },
    levelUp(){ [392, 523, 659, 784].forEach((f, i) => tone(f, .14, { type: 'square', v: .04, at: i * .07 })); },
    join(){ [523, 784].forEach((f, i) => tone(f, .12, { type: 'triangle', v: .07, at: i * .09 })); },
    gameOver(){ [392, 330, 262, 196].forEach((f, i) => tone(f, .32, { type: 'triangle', v: .09, at: i * .18 })); },
    win(){ [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, .2, { type: 'triangle', v: .09, at: i * .11 })); },
    click(){ tone(520, .06, { type: 'triangle', v: .05 }); }
  };
})();

/* =========================================================
   Scene decoration
   ========================================================= */
function mulberry32(a){ return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function decorate(svg){
  const R = mulberry32(12);
  const petals = ['#FF6B9A', '#FFD23F', '#FFFFFF', '#B28DFF', '#FF8A5B', '#6EC6FF'];
  let back = '', front = '', tufts = '';
  for (let i = 0; i < 80; i++){
    const x = -700 + R() * 2400, y = 506 + R() * 84;
    if (x > 420 && x < 590 && y < 522) continue;
    if (x > 280 && x < 460 && y < 540) continue;
    const sc = (0.75 + R() * 0.4) * (0.85 + (y - 506) / 84 * 0.45);
    const u = `<use href="#flower" transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) scale(${sc.toFixed(2)})" style="--petal:${petals[i % petals.length]}"/>`;
    if (y > 540) front += u; else back += u;
  }
  for (let i = 0; i < 46; i++){
    const x = -700 + R() * 2400, y = 500 + R() * 95;
    tufts += `<use href="#tuft" transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) scale(${(0.8 + R() * 0.7).toFixed(2)})"/>`;
  }
  svg.querySelector('.flowersBack').innerHTML = back;
  svg.querySelector('.flowersFront').innerHTML = front;
  svg.querySelector('.tufts').innerHTML = tufts;
  const clouds = [[-560,120,1],[-280,40,.8],[60,150,.9],[300,-40,1.1],[660,130,.85],[920,30,1.2],[1200,110,.8],[1450,40,1],
                  [100,-230,1],[620,-310,1.1],[-220,-360,.9],[900,-200,.9],[320,-540,1],[720,-680,1.2]];
  svg.querySelector('.clouds').innerHTML = clouds.map((c, i) =>
    `<g transform="translate(${c[0]} ${c[1]}) scale(${c[2]})"><g class="drift" style="animation-duration:${28 + i * 3}s;animation-delay:-${i * 4}s"><use href="#cloud"/></g></g>`).join('');
}

/* =========================================================
   Scene: one park with a tree, a branch, a worker and a cat
   ========================================================= */
const PIVOT = { x: 472, y: 300 }, CAT_X = 330, CHOP_X = 418, GROUND = 500;
const AXE_REST = -25, AXE_WIND = -235, AXE_HIT = -148, MAX_ANGLE = 30;
const angleFor = p => -MAX_ANGLE * Math.pow(Math.min(1, Math.max(0, p)), 1.25);
const LEAF_COLORS = ['#4DB356', '#56BD5E', '#3FA34D', '#8BD36B'];
const HEART = 'M0 5 C -7 -1 -11 -7 -6 -11 C -3 -13 0 -11 0 -8 C 0 -11 3 -13 6 -11 C 11 -7 7 -1 0 5 Z';
function starPts(r1, r2, n){
  let s = '';
  for (let i = 0; i < n * 2; i++){ const r = i % 2 ? r2 : r1, a = Math.PI * i / n - Math.PI / 2; s += `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)} `; }
  return s;
}

class Scene {
  constructor(host, isMe){
    this.host = host; this.isMe = isMe;
    const svg = $('#sceneTpl').content.firstElementChild.cloneNode(true);
    host.prepend(svg);
    this.svg = svg;
    const q = s => svg.querySelector(s);
    this.branchEl = q('.branch'); this.crackEl = q('.crack'); this.workerEl = q('.worker'); this.axeArm = q('.axeArm');
    this.bubble = q('.bubble'); this.headUse = q('.workerHead'); this.catEl = q('.cat'); this.catBody = q('.catBody'); this.fx = q('.fx');
    decorate(svg);
    this.gen = 0; this.mode = 'idle'; this.wantLive = false; this.danger = 0; this.jolt = 0; this.level = 1;
    this.phase = Math.random() * 10; this.leafTimer = 1;
    this.br = { x: 0, y: 0, angle: 0, s: 1, op: 1 };
    this.w = { x: 130, hop: 0, face: 1, axe: AXE_REST };
    this.c = { jump: 0, shake: 0 };
    this.homeX = 130;
    const fit = () => this.fit();
    if ('ResizeObserver' in window) new ResizeObserver(fit).observe(host); else addEventListener('resize', fit);
    this.fit(); this.applyAll();
  }
  /* keep tree, cat and worker in view at any size */
  fit(){
    const W = this.host.clientWidth, H = this.host.clientHeight;
    if (!W || !H) return;
    const a = W / H;
    let w, h;
    if (a >= 1000 / 600){ h = 600; w = h * a; } else { w = Math.max(440, 600 * a); h = w / a; }
    const cx = w >= 1000 ? 500 : 390 + (w - 440) / 560 * 110;
    const x = cx - w / 2, y = 578 - h;
    this.svg.setAttribute('viewBox', `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
    this.homeX = Math.min(250, Math.max(130, x + 50));
    if (this.mode !== 'anim'){ this.w.x = this.homeX; this.applyWorker(); }
  }
  tw(d, fn, e){ return tween(d, fn, e, this); }
  wt(ms){ return wait(ms, this); }
  applyBranch(){
    const b = this.br;
    this.branchEl.setAttribute('transform',
      `translate(${b.x.toFixed(2)} ${b.y.toFixed(2)}) rotate(${b.angle.toFixed(2)} ${PIVOT.x} ${PIVOT.y}) translate(${PIVOT.x} ${PIVOT.y}) scale(${Math.max(0.01, b.s).toFixed(3)}) translate(${-PIVOT.x} ${-PIVOT.y})`);
    this.branchEl.setAttribute('opacity', b.op.toFixed(2));
  }
  applyWorker(){ this.workerEl.setAttribute('transform', `translate(${this.w.x.toFixed(1)} ${(GROUND + this.w.hop).toFixed(1)}) scale(${this.w.face} 1)`); }
  applyAxe(){ this.axeArm.setAttribute('transform', `rotate(${this.w.axe.toFixed(1)} 4 -110)`); }
  applyCat(){ this.catBody.setAttribute('transform', `translate(${this.c.shake.toFixed(2)} ${this.c.jump.toFixed(2)})`); }
  applyAll(){ this.applyBranch(); this.applyWorker(); this.applyAxe(); this.applyCat(); }
  setCat(m){ if (this.catEl.dataset.mood !== m) this.catEl.dataset.mood = m; }
  setGender(g){ this.headUse.setAttribute('href', '#head-' + (g === 'woman' ? 'woman' : 'man')); }
  setLevel(l){
    this.level = l;
    this.svg.classList.toggle('windy', l >= 5);
    this.svg.style.setProperty('--sway-dur', Math.max(1.1, 3.2 - l * 0.22).toFixed(2) + 's');
  }
  setCrack(p){ this.crackEl.setAttribute('opacity', (0.25 + 0.75 * Math.min(1, p)).toFixed(2)); }
  reset(){
    this.gen++;
    this.fx.innerHTML = '';
    this.mode = 'idle'; this.wantLive = false; this.danger = 0; this.jolt = 0;
    Object.assign(this.br, { x: 0, y: 0, angle: 0, s: 1, op: 1 });
    this.gone = false;
    this.workerEl.classList.remove('running');
    Object.assign(this.w, { x: this.homeX, hop: 0, face: 1, axe: AXE_REST });
    Object.assign(this.c, { jump: 0, shake: 0 });
    this.bubble.classList.remove('show');
    this.setCat('normal'); this.setCrack(0);
    this.applyAll();
  }
  /* put a fresh branch back on the tree, growing it in */
  regrow(danger){
    this.gone = false;
    Object.assign(this.br, { x: 0, y: 0, angle: angleFor(danger), s: 0.01, op: 1 });
    this.applyBranch(); this.setCrack(danger);
    if (this.isMe) Sfx.creak();
    tween(340, t => { this.br.s = Math.max(0.01, t); this.applyBranch(); }, ease.back, this);
  }
  /* instantly restore the branch if an animation was interrupted while it was away */
  ensureBranch(){
    if (!this.gone && this.br.op === 1 && this.br.x === 0 && this.br.y === 0 && this.br.s >= 1) return;
    this.gone = false;
    Object.assign(this.br, { x: 0, y: 0, s: 1, op: 1 });
    this.applyBranch();
  }
  goLive(){ this.ensureBranchIfIdle(); this.wantLive = true; if (this.mode === 'idle') this.mode = 'live'; this.react(); }
  ensureBranchIfIdle(){ if (this.mode === 'idle' || this.mode === 'live') this.ensureBranch(); }
  endLive(){ this.wantLive = false; if (this.mode === 'live') this.mode = 'idle'; }
  settle(){ this.mode = this.wantLive ? 'live' : 'idle'; }
  react(){
    this.bubble.classList.remove('show');
    requestAnimationFrame(() => this.bubble.classList.add('show'));
    if (this.mode === 'anim') return;
    tween(260, t => { this.w.hop = -14 * Math.sin(Math.PI * t); this.applyWorker(); }, ease.lin, this);
  }
  /* called every frame by the game loop */
  tick(now, dt, p){
    if (this.mode !== 'idle' && this.mode !== 'live') return;
    if (this.gone || this.br.op < 1 || this.br.x !== 0 || this.br.y !== 0) this.ensureBranch();
    this.jolt *= Math.pow(0.004, dt);
    const live = this.mode === 'live';
    const t = now / 1000;
    const amp = (0.25 + this.level * 0.14) * (live ? (0.35 + p * 1.4) : 0.35) * motion;
    this.br.angle = angleFor(p) + Math.sin(t * (16 + this.level * 2.2) + this.phase) * amp - this.jolt;
    this.applyBranch();
    this.setCrack(p);
    const mood = live ? (p < 0.3 ? 'lookup' : p < 0.65 ? 'worried' : 'scared')
                      : (p < 0.35 ? 'normal' : p < 0.65 ? 'worried' : 'scared');
    this.setCat(mood);
    this.c.shake = mood === 'scared' ? Math.sin(t * 55) * (1 + this.level * 0.08) * motion : 0;
    this.applyCat();
    if (live){
      this.leafTimer -= dt;
      if (this.leafTimer <= 0){ this.windLeaf(); this.leafTimer = Math.max(0.35, 2.4 - this.level * 0.19) * (0.7 + Math.random() * 0.6); }
    }
  }
  async moveWorker(x, dur){
    const from = this.w.x;
    if (Math.abs(x - from) < 1) return true;
    this.w.face = x > from ? 1 : -1;
    this.workerEl.classList.add('running'); this.applyWorker();
    const ok = await this.tw(dur, t => { this.w.x = lerp(from, x, t); this.applyWorker(); }, ease.inOut);
    this.workerEl.classList.remove('running');
    this.w.face = 1; this.applyWorker();
    return ok;
  }
  /* this player won the round */
  async chop(newDanger){
    this.gen++;
    this.mode = 'anim';
    this.bubble.classList.remove('show');
    this.setCat('lookup'); this.c.shake = 0; this.c.jump = 0; this.applyCat();
    this.dust(this.w.x - 10);
    if (!(await this.moveWorker(CHOP_X, 360))) return;
    if (this.isMe) Sfx.axe();
    if (!(await this.tw(150, t => { this.w.axe = lerp(AXE_REST, AXE_WIND, t); this.applyAxe(); }, ease.out))) return;
    if (!(await this.tw(100, t => { this.w.axe = lerp(AXE_WIND, AXE_HIT, t); this.applyAxe(); }, ease.inQ))) return;
    if (this.isMe){ Sfx.chop(); Sfx.crack(); }
    this.chopBurst();
    const a0 = this.br.angle;
    this.gone = true;
    const flyAway = this.tw(720, t => {
      this.br.x = -430 * t;
      this.br.y = -80 * Math.sin(Math.PI * t * 0.8) + 380 * t * t;
      this.br.angle = a0 + 160 * t;
      this.br.op = t < .7 ? 1 : 1 - (t - .7) / .3;
      this.applyBranch();
    }, ease.lin);
    this.leavesBurst(PIVOT.x - 150, PIVOT.y - 10, 7, 120);
    this.setCat('happy'); if (this.isMe) Sfx.meow(); this.hearts(3);
    this.tw(560, t => { this.c.jump = -42 * Math.abs(Math.sin(Math.PI * 2 * t)); this.applyCat(); }, ease.lin);
    this.tw(260, t => { this.w.axe = lerp(AXE_HIT, AXE_REST, t); this.applyAxe(); }, ease.inOut);
    if (!(await flyAway)) return;               // the old branch must be fully gone first
    if (!(await this.wt(150))) return;
    this.danger = newDanger;
    this.regrow(newDanger);
    if (!(await this.moveWorker(this.homeX, 420))) return;
    this.settle();
  }
  /* this player was too slow: the branch drops a notch */
  async creak(newDanger){
    this.gen++;
    this.ensureBranch();
    this.mode = 'anim';
    this.bubble.classList.remove('show');
    this.danger = newDanger;
    if (this.isMe) Sfx.creak();
    this.setCat(newDanger >= .65 ? 'scared' : 'worried');
    const a0 = this.br.angle, a1 = angleFor(newDanger);
    this.leavesBurst(330, 330, 4, 140);
    const ok = await this.tw(650, t => {
      this.br.angle = lerp(a0, a1, t) + Math.sin(t * Math.PI * 7) * 2.2 * (1 - t);
      this.applyBranch(); this.setCrack(newDanger);
      this.c.shake = Math.sin(t * 60) * 1.4 * (1 - t) * motion; this.applyCat();
    }, ease.out);
    if (ok) this.settle();
  }
  /* the branch lands: this player is out */
  async fall(){
    this.gen++;
    this.ensureBranch();
    this.mode = 'anim';
    this.bubble.classList.remove('show');
    if (this.isMe) Sfx.crack();
    this.setCat('surprised'); this.c.shake = 0;
    const a0 = this.br.angle;
    this.tw(320, t => { this.c.jump = -110 * t; this.applyCat(); }, ease.out)
      .then(ok => ok && this.tw(300, t => { this.c.jump = lerp(-110, -19, t); this.applyCat(); }, ease.inQ));
    if (!(await this.tw(480, t => { this.br.y = 190 * t; this.br.angle = lerp(a0, -5, t); this.applyBranch(); }, ease.inQ))) return;
    if (this.isMe){ Sfx.thud(); shakeArena(); }
    this.poofRow(); this.leavesBurst(330, 440, 8, 160);
    this.tw(180, t => { this.br.y = 190 - 10 * Math.sin(Math.PI * t); this.applyBranch(); }, ease.lin);
    if (!(await this.wt(320))) return;
    this.leafOnHead();
    this.mode = 'fallen';
  }
  async celebrate(){
    this.gen++;
    this.mode = 'anim';
    this.setCat('happy'); this.c.shake = 0;
    this.hearts(5);
    await this.tw(900, t => { this.c.jump = -50 * Math.abs(Math.sin(Math.PI * 3 * t)); this.applyCat(); }, ease.lin);
    this.mode = 'party';
  }
  /* ---------- effects ---------- */
  fxAt(x, y, markup, frames, opts){
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
    g.innerHTML = markup;
    this.fx.appendChild(g);
    const el = g.firstElementChild;
    if (el && el.animate && frames){ const a = el.animate(frames, Object.assign({ fill: 'forwards' }, opts)); a.onfinish = () => g.remove(); }
    else if (frames) setTimeout(() => g.remove(), (opts && opts.duration) || 1000);
    return g;
  }
  leaf(x, y, dx, dy, dur){
    const c = LEAF_COLORS[(Math.random() * LEAF_COLORS.length) | 0];
    const rot = (Math.random() * 2 - 1) * 540;
    this.fxAt(x, y, `<g><ellipse rx="7" ry="3.5" fill="${c}" stroke="#233049" stroke-width="1.2"/></g>`, [
      { transform: 'translate(0px,0px) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx * 0.5 + 18}px,${dy * 0.45}px) rotate(${rot * 0.5}deg)`, opacity: 1, offset: .5 },
      { transform: `translate(${dx}px,${dy}px) rotate(${rot}deg)`, opacity: 0 }
    ], { duration: dur, easing: 'ease-in' });
  }
  windLeaf(){ const x = 360 + Math.random() * 300, y = 170 + Math.random() * 80; this.leaf(x, y, (Math.random() * 2 - 1) * 120 - 30, 300 - (y - 170), 2200 + Math.random() * 900); }
  leavesBurst(x, y, n, spread = 90){
    for (let i = 0; i < n; i++) this.leaf(x + (Math.random() * 2 - 1) * spread * 0.5, y + (Math.random() * 2 - 1) * 20, (Math.random() * 2 - 1) * spread, 120 + Math.random() * 140, 900 + Math.random() * 600);
  }
  chopBurst(){
    this.fxAt(PIVOT.x - 6, PIVOT.y + 8,
      `<g><polygon points="${starPts(38, 17, 9)}" fill="#FFF6B0" stroke="#233049" stroke-width="3" stroke-linejoin="round"/>
        <text x="-2" y="-44" text-anchor="middle" font-size="30" class="fx-text" fill="#FFC933" stroke="#233049" stroke-width="5" paint-order="stroke fill">CHOP!</text></g>`,
      [{ transform: 'scale(.3) rotate(-20deg)', opacity: 1 }, { transform: 'scale(1.2) rotate(6deg)', opacity: 1, offset: .3 },
       { transform: 'scale(1) rotate(0deg)', opacity: 1, offset: .6 }, { transform: 'scale(1.1)', opacity: 0 }],
      { duration: 700, easing: 'ease-out' });
    for (let i = 0; i < 7; i++){
      const a = Math.random() * Math.PI * 2, d = 40 + Math.random() * 50;
      this.fxAt(PIVOT.x, PIVOT.y + 6, `<g><rect x="-5" y="-2" width="10" height="4" rx="2" fill="#B07A52" stroke="#233049" stroke-width="1"/></g>`, [
        { transform: 'translate(0px,0px) rotate(0deg)', opacity: 1 },
        { transform: `translate(${Math.cos(a) * d}px,${Math.sin(a) * d + 40}px) rotate(${Math.random() * 400}deg)`, opacity: 0 }
      ], { duration: 600, easing: 'ease-out' });
    }
  }
  poofRow(){
    for (let i = 0; i < 9; i++){
      const x = 250 + i * 26 + Math.random() * 10, r = 10 + Math.random() * 10;
      this.fxAt(x, GROUND - 4 - Math.random() * 8, `<g><circle r="${r.toFixed(0)}" fill="#fff" stroke="#233049" stroke-width="2" opacity=".95"/></g>`, [
        { transform: 'scale(.3) translate(0px,0px)', opacity: 1 },
        { transform: `scale(1.6) translate(${(i - 4) * 3}px,-14px)`, opacity: 0 }
      ], { duration: 700 + Math.random() * 200, easing: 'ease-out' });
    }
  }
  dust(x){
    for (let i = 0; i < 4; i++){
      this.fxAt(x - i * 8, GROUND - 4, `<g><circle r="7" fill="#fff" opacity=".85"/></g>`, [
        { transform: 'scale(.4)', opacity: .9 }, { transform: `scale(1.5) translate(${-10 - i * 4}px,-8px)`, opacity: 0 }
      ], { duration: 450, easing: 'ease-out', delay: i * 40 });
    }
  }
  hearts(n){
    for (let i = 0; i < n; i++){
      const dx = (i - (n - 1) / 2) * 22;
      this.fxAt(CAT_X + dx * 0.4, GROUND - 110, `<g><path d="${HEART}" fill="#FF6B8B" stroke="#233049" stroke-width="1.8" transform="scale(1.3)"/></g>`, [
        { transform: 'translate(0px,0px) scale(.3)', opacity: 0 },
        { transform: `translate(${dx * 0.6}px,-20px) scale(1.2)`, opacity: 1, offset: .25 },
        { transform: `translate(${dx}px,-70px) scale(1)`, opacity: 0 }
      ], { duration: 1100, easing: 'ease-out', delay: i * 120 });
    }
  }
  leafOnHead(){
    this.fxAt(CAT_X - 6, GROUND - 120, `<g transform="rotate(-25)"><ellipse rx="10" ry="5" fill="#4DB356" stroke="#233049" stroke-width="1.8"/><path d="M-9 0 H9" stroke="#2E7D3A" stroke-width="1.4"/></g>`, null, null);
  }
}

/* =========================================================
   DOM refs
   ========================================================= */
const app = $('#app'), arena = $('#arena');
const levelEl = $('#levelEl'), roundEl = $('#roundEl'), timeEl = $('#timeEl'), timeWrap = $('#timeWrap');
const timebar = $('#timebar'), timefill = $('#timefill');
const challenge = $('#challenge'), wordEl = $('#word'), hintEl = $('#hint'), shoutEl = $('#shout');
const banner = $('#banner'), bannerLv = $('#bannerLv'), bannerNote = $('#bannerNote');
const oprog = $('#oprog'), rivalsEl = $('#rivals'), awayEl = $('#away');
const screens = [...document.querySelectorAll('.screen')];
const sides = { me: $('#sideMe'), opp: $('#sideOpp') };
const sceneMe = new Scene(sides.me, true);
const sceneOpp = new Scene(sides.opp, false);

/* =========================================================
   Match state (mirrors what the server tells us)
   ========================================================= */
const S = {
  me: 0, players: [], code: '', quick: false, state: 'menu', layout: 'duo',
  level: 1, round: 1, rounds: 3, roundId: 0, word: '', duration: 8, start: 0, pressure: 0.25,
  typed: [], roundDone: false, danger: [], scores: [], out: [], prog: [], rtt: [], myRtt: 0, warnMark: 4,
  lobbyNotice: '', kicked: false, boardTab: 'duel', startsAt: 0,
  profile: { name: store.get('stc.name', ''), gender: store.get('stc.worker', 'man') }
};
const N = () => S.players.length;
const others = () => S.players.map((_, i) => i).filter(i => i !== S.me);
const nameOf = i => (S.players[i] && S.players[i].name) || (i === S.me ? 'You' : 'Rival');
const isOut = i => !!S.out[i];
const duo = () => S.layout === 'duo';
const duoRival = () => others()[0];
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

/* ---------- screens ---------- */
function showScreen(id){
  screens.forEach(s => s.hidden = s.id !== id);
  const sc = screens.find(s => s.id === id);
  if (sc){
    const target = sc.querySelector('input:not([type=hidden])') || sc.querySelector('.btn:not(:disabled)');
    setTimeout(() => { if (!sc.hidden && target && !('ontouchstart' in window && target.tagName === 'INPUT')) target.focus({ preventScroll: true }); }, 420);
  }
}
function setErr(id, text){ const el = $(id); if (el) el.textContent = text || ''; }
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
function netClass(ms){ return ms < 0 ? 'off' : ms < 90 ? 'good' : ms < 220 ? 'ok' : 'bad'; }
function paintNet(el, ms){
  if (!el) return;
  el.className = 'pnet ' + netClass(ms);
  el.textContent = ms < 0 ? '' : ms + 'ms';
  el.title = ms < 0 ? 'Disconnected' : `Ping ${ms} ms`;
}

/* =========================================================
   Rival cards: lightweight view for 3 to 6 player matches
   ========================================================= */
const MINI = `<svg class="rmini" viewBox="0 0 120 78" aria-hidden="true">
  <rect width="120" height="78" style="fill:var(--sky-bottom)"/>
  <rect y="62" width="120" height="16" class="c-grass"/>
  <path d="M79 64 L81 8 L93 8 L95 64 Z" fill="#8B5A3C" stroke="#233049" stroke-width="1.5" stroke-linejoin="round"/>
  <circle cx="72" cy="16" r="12" fill="#3A9A47" stroke="#233049" stroke-width="1.5"/><circle cx="100" cy="16" r="12" fill="#3A9A47" stroke="#233049" stroke-width="1.5"/>
  <circle cx="86" cy="9" r="15" fill="#4DB356" stroke="#233049" stroke-width="1.5"/>
  <g class="rb"><path d="M81 30 L40 28 L40 33 L81 37 Z" fill="#8B5A3C" stroke="#233049" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="40" cy="29" r="8" fill="#4DB356" stroke="#233049" stroke-width="1.5"/><circle cx="50" cy="24" r="5.5" fill="#56BD5E" stroke="#233049" stroke-width="1.5"/></g>
  <g class="rcat" transform="translate(52 63)">
    <ellipse cx="0" cy="-7" rx="8" ry="7" fill="#F7A04B" stroke="#233049" stroke-width="1.5"/>
    <path d="M-7 -19 L-6 -28 L-1 -23 Z M7 -19 L6 -28 L1 -23 Z" fill="#F7A04B" stroke="#233049" stroke-width="1.3" stroke-linejoin="round"/>
    <circle cx="0" cy="-18" r="7" fill="#F7A04B" stroke="#233049" stroke-width="1.5"/>
    <g class="rc-eyes"><circle cx="-2.6" cy="-19" r="1.3" fill="#233049"/><circle cx="2.6" cy="-19" r="1.3" fill="#233049"/></g>
    <g class="rc-o"><circle cx="-2.6" cy="-19" r="2.2" fill="#fff" stroke="#233049" stroke-width=".9"/><circle cx="2.6" cy="-19" r="2.2" fill="#fff" stroke="#233049" stroke-width=".9"/></g>
    <path class="rc-sweat" d="M8 -24 C7 -22 7 -21 8 -20 C9 -21 9 -22 8 -24 Z" fill="#8ED3FF" stroke="#233049" stroke-width=".8"/>
  </g>
  <g class="rcheck"><circle cx="108" cy="66" r="8" fill="#2FA84F" stroke="#233049" stroke-width="1.5"/><path d="M104 66 L107 69 L112 63" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></g>
</svg>`;
class RivalCard {
  constructor(i){
    this.i = i;
    const el = this.el = document.createElement('div');
    el.className = 'rcard';
    el.innerHTML = `${MINI}<div class="rinfo">
        <div class="rname"><span class="nm"></span><span class="ptag"></span></div>
        <div class="rrow"><span class="rscore">0</span><span class="pnet"></span></div>
        <div class="meter"><b><i></i></b></div>
        <div class="rprog"></div>
      </div><span class="rplace"></span><span class="rstamp"></span>`;
    this.q = s => el.querySelector(s);
    this.branch = this.q('.rb');
    this.setDanger(0);
  }
  update(p){
    this.q('.nm').textContent = p ? p.name : '';
    const tag = this.q('.ptag');
    tag.className = 'ptag' + (p && !p.registered && Auth.enabled ? ' guest' : '');
    tag.textContent = !p || !Auth.enabled ? '' : p.registered ? String(p.rating) : 'GUEST';
    this.el.classList.toggle('away', !!(p && p.away));
  }
  setDanger(d){
    this.danger = d;
    if (!this.el.classList.contains('out')) this.branch.style.transform = `rotate(${angleFor(d).toFixed(1)}deg)`;
    this.q('.meter i').style.setProperty('--d', Math.round(Math.min(1, d) * 100) + '%');
    this.el.classList.toggle('worried', d >= .5 && d < .8);
    this.el.classList.toggle('scared', d >= .8);
  }
  setScore(v){ this.q('.rscore').textContent = v; }
  setProg(len, correct, fin){
    const w = S.word;
    this.q('.rprog').innerHTML = w ? [...w].map((ch, k) => {
      let c = ch === ' ' ? 'sp' : '';
      if (fin || k < correct) c += ' ok'; else if (k < len) c += ' bad';
      return `<i class="${c.trim()}"></i>`;
    }).join('') : '';
    this.el.classList.toggle('fin', !!fin);
  }
  newRound(){ this.el.classList.remove('fin', 'missed', 'chop'); this.q('.rplace').textContent = ''; this.setProg(0, 0, false); }
  jolt(){ this.el.classList.remove('jolt'); void this.el.offsetWidth; this.el.classList.add('jolt'); }
  result(place, points, missed){
    const pl = this.q('.rplace');
    pl.textContent = place ? ORD[place - 1] : '';
    pl.className = 'rplace' + (place === 1 ? ' first' : '');
    this.el.classList.toggle('missed', !!missed);
    if (place){ this.el.classList.remove('chop'); void this.el.offsetWidth; this.el.classList.add('chop'); }
    if (points){
      const d = document.createElement('span'); d.className = 'rpop'; d.textContent = '+' + points;
      this.el.appendChild(d); d.addEventListener('animationend', () => d.remove());
    }
  }
  setOut(out, left){
    this.el.classList.toggle('out', !!out);
    this.q('.rstamp').textContent = left ? 'LEFT' : out ? 'OUT' : '';
    if (out) this.branch.style.transform = 'translate(-8px,30px) rotate(-4deg)';
    else this.setDanger(this.danger || 0);
  }
}
let cards = {};
function buildRivalCards(){
  rivalsEl.innerHTML = '';
  cards = {};
  others().forEach(i => { const c = new RivalCard(i); cards[i] = c; rivalsEl.appendChild(c.el); });
  rivalsEl.dataset.count = others().length;
  refreshCards();
}
function refreshCards(){
  Object.values(cards).forEach(c => {
    c.update(S.players[c.i]);
    c.setScore(S.scores[c.i] || 0);
    c.setDanger(S.danger[c.i] || 0);
    c.setOut(isOut(c.i), S.players[c.i] && S.players[c.i].left);
    paintNet(c.q('.pnet'), S.rtt[c.i] === undefined ? 0 : S.rtt[c.i]);
  });
}
function sizeRivals(){
  // big picture cards only when every rival fits without scrolling; otherwise compact cards
  const count = Object.keys(cards).length;
  const r = rivalsEl.getBoundingClientRect();
  if (!count || !r.width){ rivalsEl.classList.remove('big'); return; }
  const cols = Math.max(1, Math.floor((r.width - 24) / 212));
  const colW = (r.width - 24 - (cols - 1) * 12) / cols;
  const rows = Math.ceil(count / cols);
  const cardH = colW * 78 / 120 + 96;
  rivalsEl.classList.toggle('big', r.width >= 360 && rows * cardH + (rows - 1) * 12 + 24 <= r.height);
}
if ('ResizeObserver' in window) new ResizeObserver(sizeRivals).observe(rivalsEl);
function setLayout(){
  S.layout = N() > 2 ? 'multi' : 'duo';
  arena.dataset.layout = S.layout;
  if (S.layout === 'multi') buildRivalCards(); else { rivalsEl.innerHTML = ''; cards = {}; }
  requestAnimationFrame(() => { sceneMe.fit(); sceneOpp.fit(); sizeRivals(); });
}

/* ---------- plates (your park, and the rival's park in a duel) ---------- */
function plateFor(i){ return i === S.me ? sides.me : (duo() && i === duoRival() ? sides.opp : null); }
function updatePlates(){
  const meP = S.players[S.me];
  const paint = (side, i, p, fallbackGender) => {
    side.querySelector('.nm').textContent = p ? p.name : nameOf(i);
    const g = p ? p.gender : fallbackGender;
    side.querySelector('.faceUse').setAttribute('href', '#portrait-' + g);
    const tag = side.querySelector('.ptag');
    tag.className = 'ptag' + (p && !p.registered && Auth.enabled ? ' guest' : '');
    tag.textContent = !p || !Auth.enabled ? '' : p.registered ? String(p.rating) : 'GUEST';
    side.querySelector('.pscore').textContent = S.scores[i] || 0;
    side.querySelector('.meter i').style.setProperty('--d', Math.round(Math.min(1, S.danger[i] || 0) * 100) + '%');
    return g;
  };
  sceneMe.setGender(paint(sides.me, S.me, meP, S.profile.gender));
  if (duo()){
    const r = duoRival();
    sceneOpp.setGender(paint(sides.opp, r, S.players[r], S.profile.gender === 'man' ? 'woman' : 'man'));
  }
  refreshCards();
}
function updateMeters(){
  S.players.forEach((_, i) => {
    const side = plateFor(i);
    if (side) side.querySelector('.meter i').style.setProperty('--d', Math.round(Math.min(1, S.danger[i] || 0) * 100) + '%');
    if (cards[i]) cards[i].setDanger(S.danger[i] || 0);
  });
}
function animateScore(i, from, to){
  if (cards[i]){ cards[i].setScore(to); return; }
  const side = plateFor(i); if (!side) return;
  const el = side.querySelector('.pscore');
  tween(650, t => { el.textContent = Math.round(lerp(from, to, t)); }, ease.out);
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  const plate = side.querySelector('.plate');
  plate.classList.remove('win'); void plate.offsetWidth; plate.classList.add('win');
}
function popOn(el, text, kind){
  const d = document.createElement('div');
  d.className = 'pop ' + kind; d.textContent = text;
  el.appendChild(d);
  d.addEventListener('animationend', () => d.remove());
}
function renderOppProgress(len, correct, fin){
  if (!S.word){ oprog.innerHTML = ''; return; }
  oprog.innerHTML = [...S.word].map((ch, i) => {
    let c = ch === ' ' ? 'sp' : '';
    if (fin || i < correct) c += ' ok'; else if (i < len) c += ' bad';
    return `<i class="${c.trim()}"></i>`;
  }).join('');
}

/* ---------- HUD, tiles ---------- */
function updateTime(left){
  timeEl.textContent = 'Time: ' + left.toFixed(1);
  const frac = S.duration > 0 ? Math.max(0, left / S.duration) : 0;
  timefill.style.transform = `scaleX(${frac.toFixed(4)})`;
  timebar.classList.toggle('mid', frac <= .5 && frac > .25);
  timebar.classList.toggle('low', frac <= .25);
  timeEl.classList.toggle('danger', left <= 2 && left > 0 && S.state === 'round' && !S.roundDone);
}
let tiles = [];
function buildTiles(){
  wordEl.innerHTML = '';
  wordEl.style.setProperty('--n', S.word.length);
  wordEl.setAttribute('aria-label', 'Type: ' + S.word);
  tiles = [...S.word].map((ch, i) => {
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
    const has = i < S.typed.length, ok = has && S.typed[i] === S.word[i];
    t.classList.toggle('ok', ok);
    t.classList.toggle('bad', has && !ok);
    t.classList.toggle('next', i === S.typed.length && !S.roundDone);
  });
}
function clearWord(){
  wordEl.innerHTML = ''; tiles = []; S.word = '';
  challenge.className = 'idle';
  oprog.innerHTML = '';
}
function shout(text, kind, hold){
  shoutEl.textContent = text;
  shoutEl.className = '';
  void shoutEl.offsetWidth;
  shoutEl.className = (kind ? kind + ' ' : '') + (hold ? 'hold' : 'show');
}
function showBanner(level, note){
  bannerLv.textContent = 'Level ' + level;
  bannerNote.textContent = note || '';
  banner.classList.remove('show'); void banner.offsetWidth; banner.classList.add('show');
}
function shakeArena(){ arena.classList.remove('shake'); void arena.offsetWidth; arena.classList.add('shake'); }
function setSpectating(on){
  challenge.classList.toggle('spectate', !!on);
  $('#spectateBar').hidden = !on;
}

/* =========================================================
   Session: survives a page reload in the same tab, so a player
   who drops or refreshes can take back their seat
   ========================================================= */
const Session = (() => {
  const mem = {};
  const get = k => { try { return sessionStorage.getItem(k); } catch (e){ return mem[k] || null; } };
  const set = (k, v) => { try { v === null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch (e){ mem[k] = v; } };
  function hex(n){ const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, '0')).join(''); }
  if (!get('stc.session')) set('stc.session', hex(16));
  return {
    get token(){ return get('stc.session'); },
    set token(v){ if (v) set('stc.session', v); },
    get inMatch(){ return get('stc.inMatch') === '1'; },
    set inMatch(v){ set('stc.inMatch', v ? '1' : null); }
  };
})();
const isLocalNet = () => {
  const h = location.hostname;
  return /^(localhost|127\.|\[?::1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.endsWith('.local');
};

/* =========================================================
   Accounts (sign-in token kept in this browser)
   ========================================================= */
const Auth = {
  enabled: false, token: store.get('stc.auth', null), user: null,
  async api(method, path, body){
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = 'Bearer ' + this.token;
    let r;
    try { r = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
    catch (e){ throw new Error('Could not reach the server. Check your connection.'); }
    let data = {};
    try { data = await r.json(); } catch (e){}
    if (!r.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { status: r.status });
    return data;
  },
  signIn(token, user){
    this.token = token; this.user = user;
    store.set('stc.auth', token);
    if (user && user.gender) setGender(user.gender);
    renderAccount();
    Net.send({ t: 'auth', auth: token });
  },
  signOut(){
    this.token = null; this.user = null;
    store.set('stc.auth', null);
    renderAccount();
    Net.send({ t: 'auth', auth: null });
  },
  async refresh(){
    if (!this.enabled || !this.token) return null;
    try { const d = await this.api('GET', '/me'); this.user = d.user; renderAccount(); return d; }
    catch (e){ if (e.status === 401) this.signOut(); return null; }
  }
};
function renderAccount(){
  const u = Auth.user;
  $('#acctGuest').hidden = !!u;
  $('#acctUser').hidden = !u;
  $('#acctCta').hidden = !Auth.enabled;
  $('#boardBtn').hidden = !Auth.enabled;
  if (u){
    $('#acctName').textContent = u.username;
    $('#acctFace').setAttribute('href', '#portrait-' + u.gender);
    $('#acctStats').textContent = u.matches
      ? `Rating ${u.rating}, ${plural(u.wins, 'win')} in ${plural(u.matches, 'match', 'matches')}`
      : `Rating ${u.rating}. Play a match to get ranked.`;
  }
}

/* =========================================================
   Networking
   ========================================================= */
const Net = {
  ws: null, pending: null,
  connect(){
    if (this.ws && this.ws.readyState === 1) return Promise.resolve({ resumed: false, already: true });
    if (this.pending) return this.pending;
    if (location.protocol === 'file:') return Promise.reject(new Error('file'));
    this.pending = new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); }
      catch (e){ this.pending = null; return reject(e); }
      const timer = setTimeout(() => { try { ws.close(); } catch (e){} }, 6000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token: Session.token, auth: Auth.token }));
      ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch (x){ return; }
        if (m.t === 'hello' && ws !== this.ws){
          clearTimeout(timer);
          this.ws = ws; this.pending = null;
          if (m.token) Session.token = m.token;
          if (m.user){ Auth.user = m.user; renderAccount(); }
          resolve(m);
          return;
        }
        if (m.t === 'sp'){ ws.send(JSON.stringify({ t: 'sp', s: m.s })); S.myRtt = m.rtt || 0; paintNet(sides.me.querySelector('.pnet'), S.myRtt); return; }
        onMessage(m);
      };
      ws.onclose = () => {
        clearTimeout(timer);
        const wasOpen = this.ws === ws;
        if (wasOpen) this.ws = null;
        if (this.pending && !wasOpen){ this.pending = null; reject(new Error('closed')); }
        if (wasOpen) onSocketLost();
      };
    });
    return this.pending;
  },
  send(o){ if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
};
function connectError(e){
  return e && e.message === 'file'
    ? 'Online play needs the game server. In the game folder run "node server.js", then open the address it prints.'
    : 'Could not reach the game server. Check your connection and try again.';
}

/* ---------- waiting-for-a-player overlay ---------- */
let awayTimer = 0;
function showAway(text, seconds){
  clearInterval(awayTimer);
  const paint = left => { awayEl.querySelector('.away-text').textContent = text; awayEl.querySelector('.away-count').textContent = left > 0 ? left : ''; };
  if (seconds){
    const until = Date.now() + seconds * 1000;
    paint(seconds);
    awayTimer = setInterval(() => { const left = Math.ceil((until - Date.now()) / 1000); paint(left); if (left <= 0) clearInterval(awayTimer); }, 250);
  } else paint(0);
  awayEl.hidden = false;
}
function hideAway(){ clearInterval(awayTimer); awayEl.hidden = true; }
function freezeRound(){
  S.roundDone = true;
  sceneMe.endLive(); sceneOpp.endLive();
  timeEl.classList.remove('danger');
  clearWord();
}

/* ---------- messages from the server ---------- */
function onMessage(m){
  switch (m.t){
    case 'error':
      setErr(!$('#join').hidden ? '#joinErr' : '#menuErr', m.message);
      if (S.state === 'queue') toMenu();
      break;
    case 'room': onRoom(m); break;
    case 'sync': onSync(m); break;
    case 'level': onLevel(m); break;
    case 'round': onRound(m); break;
    case 'snap': onSnap(m); break;
    case 'eliminated': onEliminated(m); break;
    case 'result': onResult(m); break;
    case 'over': onOver(m); break;
    case 'net':
      S.rtt = m.rtt;
      m.rtt.forEach((ms, i) => {
        if (i === S.me) return;
        if (cards[i]) paintNet(cards[i].q('.pnet'), ms);
        else if (duo() && i === duoRival()) paintNet(sides.opp.querySelector('.pnet'), ms);
      });
      break;
    case 'paused':
      S.state = 'paused';
      freezeRound();
      break;
    case 'away': {
      const text = `${m.name} lost connection. Waiting for them to come back…`;
      if (app.dataset.mode === 'game' && S.state !== 'over' && !isOut(m.p)) showAway(text, m.seconds);
      else if (S.state === 'over') $('#rematchNote').textContent = `${m.name} lost connection.`;
      if (cards[m.p]) cards[m.p].el.classList.add('away');
      break;
    }
    case 'back':
      if (!awayEl.hidden) showAway(`${m.name} is back. Get ready…`);
      if (cards[m.p]) cards[m.p].el.classList.remove('away');
      break;
    case 'resumed':
      if (app.dataset.mode === 'game') showAway('Get ready…');
      break;
    case 'left':
      if (m.during){
        S.out = m.out || S.out;
        if (S.players[m.p]) S.players[m.p].left = true;
        if (cards[m.p]) cards[m.p].setOut(true, true);
        else if (duo() && m.p === duoRival()) sceneOpp.fall();
        hideAwayIfFor(m.name);
        popOn(timeWrap, `${m.name} left`, 'penalty');
      } else if (S.state === 'lobby' || S.state === 'queue'){
        S.lobbyNotice = `${m.name} left the room.`;
      } else if (S.state === 'over'){
        $('#rematchNote').textContent = `${m.name} left.`;
      }
      break;
    case 'kicked': S.kicked = true; break;
    case 'authed': if (m.user || !Auth.token){ Auth.user = m.user; renderAccount(); } break;
  }
}
function hideAwayIfFor(name){ if (!awayEl.hidden && awayEl.textContent.includes(name)) hideAway(); }
function onRoom(m){
  const before = N();
  S.code = m.code; S.me = m.you; S.players = m.players; S.quick = !!m.quick;
  Session.inMatch = true;
  if (m.state === 'forming'){
    S.state = 'queue';
    S.startsAt = m.startsIn === null ? 0 : Date.now() + m.startsIn;
    if (N() > before && before > 0) Sfx.join();
    renderQueue();
    if ($('#queue').hidden) showScreen('queue');
    return;
  }
  if (m.state === 'lobby'){
    if (S.state === 'over'){
      $('#rematchNote').textContent = 'The room is open again. Tap BACK TO ROOM to join the next match.';
      return;
    }
    if (S.state !== 'lobby' && S.state !== 'menu'){ G.gen++; sceneMe.reset(); sceneOpp.reset(); clearWord(); hideAway(); }
    S.state = 'lobby';
    app.dataset.mode = 'menu';
    if (N() > before && before > 0){ Sfx.join(); S.lobbyNotice = ''; }
    renderLobby();
    if ($('#lobby').hidden) showScreen('lobby');
    return;
  }
  if (app.dataset.mode === 'game') updatePlates();
}

/* ---------- quick match: gathering players ---------- */
let queueTimer = 0;
function renderQueue(){
  const box = $('#queueVs');
  box.innerHTML = '';
  for (let k = 0; k < 6; k++){
    const p = S.players[k];
    const d = document.createElement('div');
    d.className = 'qslot' + (p ? ' filled' : '') + (k === S.me ? ' me' : '');
    d.innerHTML = p ? `<svg viewBox="-40 -178 72 60" aria-hidden="true"><use href="#portrait-${p.gender}"/></svg><span class="who"></span>`
                    : '<span class="qmark">?</span><span class="who"></span>';
    d.querySelector('.who').textContent = p ? (k === S.me ? 'You' : p.name) : '';
    box.appendChild(d);
  }
  const tick = () => {
    const n = N();
    if (n < 2){
      $('#queueTitle').textContent = 'Finding players';
      $('#queueText').textContent = 'Waiting for another player to tap QUICK MATCH.';
    } else {
      const sec = Math.max(0, Math.ceil((S.startsAt - Date.now()) / 1000));
      $('#queueTitle').textContent = `${n} players ready`;
      $('#queueText').textContent = n >= 6 ? 'The room is full. Starting now!'
        : `Starting in ${sec}s. More players can still join, up to 6.`;
    }
  };
  clearInterval(queueTimer);
  tick();
  queueTimer = setInterval(() => { if (S.state !== 'queue') return clearInterval(queueTimer); tick(); }, 250);
}

/* ---------- private room lobby ---------- */
let serverAddrs = null;
function renderLobby(){
  $('#codeTiles').innerHTML = [...S.code].map(c => `<span>${c}</span>`).join('');
  const slotsEl = $('#slots');
  slotsEl.innerHTML = '';
  for (let i = 0; i < 6; i++){
    const p = S.players[i];
    const d = document.createElement('div');
    if (!p){ d.className = 'slot'; d.innerHTML = i === N() ? '<span class="dots">Open</span>' : '<span class="tag">Open</span>'; slotsEl.appendChild(d); continue; }
    const tag = p.away ? 'Reconnecting…' : i === S.me ? (i === 0 ? 'You, host' : 'You') : i === 0 ? 'Host'
              : p.registered && Auth.enabled ? `Rating ${p.rating}` : Auth.enabled ? 'Guest' : 'Player';
    d.className = 'slot filled' + (i === S.me ? ' me' : '');
    d.innerHTML = `<svg viewBox="-40 -178 72 60" aria-hidden="true"><use href="#portrait-${p.gender}"/></svg><span class="who"></span><span class="tag"></span>`;
    d.querySelector('.who').textContent = p.name;
    d.querySelector('.tag').textContent = tag;
    slotsEl.appendChild(d);
  }
  const btn = $('#startBtn');
  const ready = N() >= 2 && S.players.every(p => !p.away);
  if (S.me === 0){ btn.disabled = !ready; btn.textContent = ready ? `START MATCH (${N()} PLAYERS)` : 'WAITING FOR PLAYERS…'; }
  else { btn.disabled = true; btn.textContent = 'WAITING FOR THE HOST…'; }
  $('#lobbyCount').textContent = `${N()} of 6 players`;
  $('#lobbyNotice').textContent = S.lobbyNotice;
  const guestView = S.me !== 0;
  const help = $('#lobbyHelp');
  help.hidden = guestView; $('#lobbyAddr').hidden = guestView;
  help.textContent = isLocalNet()
    ? 'Up to 6 players. On each other device, join the same Wi-Fi or hotspot, open this address, choose JOIN ROOM and enter the code:'
    : 'Up to 6 players. Send this code to your friends. They open this site, choose JOIN ROOM and enter it:';
  if (!guestView) renderAddresses();
  if (!btn.disabled) setTimeout(() => btn.focus({ preventScroll: true }), 50);
}
function renderAddresses(){
  const box = $('#lobbyAddr');
  const paint = list => {
    box.innerHTML = '';
    list.forEach(a => { const c = document.createElement('code'); c.textContent = a; box.appendChild(c); });
  };
  const loopback = /^(localhost|127\.|\[?::1)/.test(location.hostname);
  if (!loopback){ paint([location.origin]); return; }
  if (serverAddrs){ paint(serverAddrs.length ? serverAddrs : [location.origin]); return; }
  paint([location.origin]);
  fetch('/info').then(r => r.json()).then(d => { serverAddrs = d.addresses || []; if (serverAddrs.length) paint(serverAddrs); }).catch(() => {});
}

/* ---------- the match ---------- */
function beginMatchUI(){
  G.gen++;
  sceneMe.reset(); sceneOpp.reset();
  const n = N();
  S.scores = Array(n).fill(0); S.danger = Array(n).fill(0); S.out = Array(n).fill(0); S.prog = [];
  S.lobbyNotice = '';
  clearInterval(queueTimer);
  setLayout();
  updatePlates();
  setSpectating(false);
  screens.forEach(s => s.hidden = true);
  shoutEl.className = '';
  app.dataset.mode = 'game';
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  try { window.focus(); } catch (e){}
}
function applyOuts(){
  // anyone already out (after a reload or a sync) is drawn as out without replaying the fall
  S.players.forEach((_, i) => {
    if (!isOut(i)) return;
    if (cards[i]) cards[i].setOut(true, S.players[i].left);
  });
  setSpectating(isOut(S.me));
}
function onSync(m){
  beginMatchUI();
  S.state = 'paused';
  S.level = m.level; S.rounds = m.rounds; S.danger = m.danger; S.scores = m.scores; S.out = m.out || S.out;
  levelEl.textContent = 'Level: ' + m.level;
  roundEl.textContent = 'Paused';
  sceneMe.setLevel(m.level); sceneOpp.setLevel(m.level);
  updatePlates(); applyOuts();
  clearWord();
  showAway('Back in the match. Get ready…');
}
function onLevel(m){
  if (['lobby', 'over', 'menu', 'queue', 'lobbyWait'].includes(S.state)) beginMatchUI();
  hideAway();
  S.state = 'level';
  S.level = m.level; S.danger = m.danger; S.scores = m.scores; S.rounds = m.rounds; S.out = m.out || S.out;
  levelEl.textContent = 'Level: ' + m.level;
  roundEl.textContent = `Round 1 of ${m.rounds}`;
  sceneMe.setLevel(m.level); sceneOpp.setLevel(m.level);
  updatePlates(); applyOuts();
  clearWord();
  S.duration = 1; updateTime(0); timefill.style.transform = 'scaleX(1)';
  showBanner(m.level, m.note);
  Sfx.levelUp();
}
function onRound(m){
  hideAway();
  S.state = 'round';
  S.roundId = m.id; S.word = m.word; S.duration = m.duration;
  S.start = performance.now() - Math.min(300, S.myRtt / 2);      // line the clock up with the server's
  S.typed = []; S.danger = m.danger; S.out = m.out || S.out; S.round = m.round; S.rounds = m.rounds;
  S.prog = S.players.map(() => [0, 0, 0]);
  S.pressure = typeof m.pressure === 'number' ? m.pressure : 0.25;
  S.warnMark = S.duration > 3.2 ? 4 : Math.ceil(S.duration);
  const spectating = isOut(S.me);
  S.roundDone = spectating;
  levelEl.textContent = 'Level: ' + m.level;
  roundEl.textContent = `Round ${m.round} of ${m.rounds}`;
  challenge.className = '';
  setSpectating(spectating);
  hintEl.textContent = spectating ? "You're out. Watching the others…"
                    : N() > 2 ? 'Finish in time to stay safe. Fastest scores most!' : 'First to finish wins the round!';
  buildTiles();
  renderOppProgress(0, 0, false);
  Object.values(cards).forEach(c => c.newRound());
  updateTime(S.duration);
  updateMeters();
  if (!spectating) sceneMe.goLive();
  if (duo() && !isOut(duoRival())) sceneOpp.goLive();
}
function onSnap(m){
  if (m.id !== S.roundId || S.state !== 'round') return;
  const prevDanger = S.danger;
  S.danger = m.danger;
  let done = 0, alive = 0;
  m.prog.forEach((pr, i) => {
    S.prog[i] = pr;
    if (!isOut(i)){ alive++; if (pr[2]) done++; }
    if (i === S.me) return;
    if ((m.danger[i] || 0) > (prevDanger[i] || 0) + 0.001){
      if (cards[i]) cards[i].jolt(); else if (duo()) sceneOpp.jolt += 5;
    }
    if (cards[i]) cards[i].setProg(pr[0], pr[1], pr[2]);
    else if (duo() && i === duoRival()) renderOppProgress(pr[0], pr[1], pr[2]);
  });
  updateMeters();
  if (N() > 2 && (S.roundDone || isOut(S.me))){
    hintEl.textContent = isOut(S.me) ? `You're out. ${done} of ${alive} finished…` : `Done! ${done} of ${alive} finished. Waiting for the rest…`;
  }
}
function onEliminated(m){
  S.danger = m.danger; S.out = m.out;
  updateMeters();
  if (m.p === S.me){
    S.roundDone = true;
    sceneMe.fall();
    shout('OH NO!', 'bad');
    hintEl.textContent = 'Too many mistakes. Your branch fell!';
    setSpectating(true);
  } else if (cards[m.p]) cards[m.p].setOut(true, false);
  else if (duo()) sceneOpp.fall();
}
function onResult(m){
  S.state = 'result';
  S.roundDone = true;
  const prev = S.scores.slice();
  S.scores = m.scores; S.danger = m.danger; S.out = m.out;
  sceneMe.endLive(); sceneOpp.endLive();
  timeEl.classList.remove('danger');
  challenge.classList.add('done');
  renderTiles();
  const placeOf = {}; m.places.forEach(x => { placeOf[x.p] = x; });
  const elim = new Set(m.eliminated || []);
  // every player's park reacts: finished = chop, missed = the branch drops, out = it falls
  S.players.forEach((_, i) => {
    const pl = placeOf[i], missed = m.missed.includes(i);
    if (!pl && !missed) return;                                  // was already out
    if (pl && pl.points) animateScore(i, prev[i], S.scores[i]);
    if (cards[i]){
      cards[i].result(pl ? pl.place : 0, pl ? pl.points : 0, missed);
      cards[i].setScore(S.scores[i]);
      cards[i].setDanger(S.danger[i]);
      if (elim.has(i)) setTimeout(() => cards[i] && cards[i].setOut(true, false), 700);
      return;
    }
    const sc = i === S.me ? sceneMe : sceneOpp;
    if (elim.has(i)) sc.fall();
    else if (pl) sc.chop(S.danger[i]);
    else sc.creak(S.danger[i]);
    if (pl && pl.points) popOn(i === S.me ? sides.me : sides.opp, '+' + pl.points, 'score');
  });
  updateMeters();
  // your headline
  const mine = placeOf[S.me], fastest = m.places[0];
  const fastestName = fastest ? (fastest.p === S.me ? 'You' : nameOf(fastest.p)) : '';
  if (mine || m.missed.includes(S.me)){
    if (elim.has(S.me)){ shout('OH NO!', 'bad'); Sfx.gameOver(); hintEl.textContent = 'Your branch fell. You can keep watching.'; setSpectating(true); }
    else if (!mine){ shout("TIME'S UP!", 'bad'); Sfx.lose(); hintEl.textContent = fastest ? `Too slow this time. ${fastestName} took ${fastest.time.toFixed(2)}s.` : 'Nobody finished in time!'; }
    else if (m.slowest === S.me){ shout('TOO SLOW!', 'rival'); Sfx.lose(); hintEl.textContent = `Everyone finished, you were last (${mine.time.toFixed(2)}s). Your branch dips a little.`; }
    else if (mine.place === 1){ challenge.classList.add('won'); shout(N() > 2 ? 'FIRST!' : (Math.random() < .5 ? 'NICE!' : 'SAVED!')); Sfx.correct();
      hintEl.textContent = `Fastest in ${mine.time.toFixed(2)}s!`; }
    else { challenge.classList.add('won'); shout(`${ORD[mine.place - 1].toUpperCase()}!`); Sfx.type();
      hintEl.textContent = `${ORD[mine.place - 1]} place in ${mine.time.toFixed(2)}s. Safe!`; }
  } else {
    hintEl.textContent = fastest ? `${fastestName} was fastest (${fastest.time.toFixed(2)}s).` : 'Nobody finished in time!';
  }
  if ((m.eliminated || []).some(i => i !== S.me)){
    const names = m.eliminated.filter(i => i !== S.me).map(nameOf).join(', ');
    popOn(timeWrap, `${names} out!`, 'penalty');
  }
}
async function onOver(m){
  if (app.dataset.mode !== 'game') beginMatchUI();
  hideAway();
  S.state = 'over';
  S.roundDone = true;
  sceneMe.endLive(); sceneOpp.endLive();
  timeEl.classList.remove('danger');
  clearWord();
  setSpectating(false);
  const mine = m.standings.find(s => s.p === S.me) || { place: m.standings.length, delta: 0 };
  const firsts = m.standings.filter(s => s.place === 1).length;
  const iWon = mine.place === 1 && firsts === 1, tiedFirst = mine.place === 1 && firsts > 1;
  if (iWon || tiedFirst) sceneMe.celebrate();
  if (duo() && m.winner === duoRival()) sceneOpp.celebrate();
  const title = iWon ? 'YOU WIN!' : tiedFirst ? 'TIED FOR FIRST!' : N() > 2 || m.standings.length > 2 ? `${ORD[mine.place - 1].toUpperCase()} PLACE` : 'YOU LOSE';
  shout(iWon ? 'YOU WIN!' : tiedFirst ? 'TIE!' : title, iWon || tiedFirst ? '' : 'bad', true);
  if (iWon) Sfx.win(); else if (tiedFirst) Sfx.levelUp(); else setTimeout(() => Sfx.gameOver(), 500);

  const top = m.standings[0];
  const topName = top ? (top.p === S.me ? 'you' : top.name) : '';
  let sub;
  if (m.reason === 'forfeit') sub = iWon ? 'Everyone else left, so the win is yours.' : 'The match ended because players left.';
  else if (m.reason === 'last') sub = iWon ? 'Your cat was the last one safe!' : `${top.name}'s cat was the last one safe.`;
  else sub = firsts > 1 ? 'All 10 levels done with a tie at the top.' : `All 10 levels done. Top score: ${topName}.`;

  const list = $('#overStats');
  list.innerHTML = '';
  m.standings.forEach(s => {
    const li = document.createElement('li');
    if (s.p === S.me) li.className = 'me';
    li.innerHTML = `<span class="rk">${s.place}</span><svg viewBox="-40 -178 72 60" aria-hidden="true"><use href="#portrait-${s.gender === 'woman' ? 'woman' : 'man'}"/></svg>
      <span><span class="who"></span><span class="sub2"></span></span><span class="val"></span>`;
    li.querySelector('.who').textContent = s.name + (s.p === S.me ? ' (you)' : '');
    const bits = [];
    if (s.left) bits.push('left'); else if (s.out) bits.push('out'); else bits.push('safe to the end');
    if (m.ranked && s.rating !== null) bits.push(`${s.delta >= 0 ? '+' : ''}${s.delta} rating`);
    li.querySelector('.sub2').textContent = bits.join(', ');
    li.querySelector('.val').textContent = s.score;
    list.appendChild(li);
  });
  const rl = $('#ratingLine');
  rl.className = 'rating-line'; rl.textContent = '';
  if (m.ranked && mine.rating !== null && mine.rating !== undefined){
    const d = mine.delta, now = mine.rating;
    rl.innerHTML = `Rating ${now - d} → <b>${now}</b> <span class="${d >= 0 ? 'up' : 'down'}">(${d >= 0 ? '+' : ''}${d})</span>`;
    if (Auth.user) Auth.user.rating = now;
    Auth.refresh();
  } else if (Auth.enabled){
    rl.className = 'rating-line muted';
    rl.textContent = !Auth.user ? 'Sign in before your next match to save your wins and rating.'
                                : 'Unranked: ratings change only between signed-in players.';
    if (Auth.user) Auth.refresh();
  }
  $('#overTitle').textContent = title;
  $('#overSub').textContent = sub;
  $('#rematchNote').textContent = '';
  const rb = $('#rematchBtn');
  rb.disabled = false;
  rb.dataset.action = S.quick ? 'quick' : 'toLobby';
  rb.textContent = S.quick ? 'FIND NEW MATCH' : 'BACK TO ROOM';
  if (!(await wait(m.reason === 'forfeit' ? 900 : 2200))) return;
  if (S.state !== 'over') return;
  shoutEl.className = '';
  showScreen('over');
}

/* ---------- dropped connection: try to get the seat back ---------- */
let reconnecting = false;
async function onSocketLost(){
  if (S.kicked){ S.kicked = false; lostConnection('This match continued in another tab or window.'); return; }
  if (S.state === 'menu') return;
  if (reconnecting) return;
  reconnecting = true;
  const wasQueue = S.state === 'queue';
  if (app.dataset.mode === 'game') freezeRound();
  showScreen('reconnect');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline){
    try {
      const h = await Net.connect();
      reconnecting = false;
      if (h.resumed){ $('#reconnect').hidden = true; return; }
      if (wasQueue){ $('#reconnect').hidden = true; Net.send(Object.assign({ t: 'quick' }, profileMsg())); return; }
      break;
    } catch (e){}
    await new Promise(r => setTimeout(r, 1500));
  }
  reconnecting = false;
  lostConnection();
}
function lostConnection(text){
  $('#noticeText').textContent = text || "Couldn't get back into the match within 15 seconds. Check your internet connection and start a new game from the menu.";
  G.gen++;
  sceneMe.reset(); sceneOpp.reset();
  clearWord(); hideAway(); clearInterval(queueTimer);
  S.state = 'menu'; S.code = ''; S.players = [];
  Session.inMatch = false;
  app.dataset.mode = 'menu';
  shoutEl.className = ''; banner.classList.remove('show');
  showScreen('notice');
}
function toMenu(){
  if (S.code || S.state === 'queue') Net.send({ t: 'leave' });
  G.gen++;
  sceneMe.reset(); sceneOpp.reset();
  clearWord(); hideAway(); clearInterval(queueTimer); setSpectating(false);
  S.state = 'menu'; S.code = ''; S.players = []; S.scores = []; S.danger = []; S.out = [];
  Session.inMatch = false;
  app.dataset.mode = 'menu';
  arena.dataset.layout = 'duo'; rivalsEl.innerHTML = ''; cards = {}; S.layout = 'duo';
  shoutEl.className = ''; banner.classList.remove('show');
  setErr('#menuErr', ''); setErr('#joinErr', '');
  updatePlates();
  showScreen('menu');
}

/* =========================================================
   Game loop: animates the parks and the countdown
   ========================================================= */
let lastT = performance.now();
function frame(now){
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  let prog = 0;
  if (S.state === 'round'){
    const el = (now - S.start) / 1000;
    prog = Math.min(1, el / S.duration);
    const left = Math.max(0, S.duration - el);
    updateTime(left);
    if (!S.roundDone && left > 0 && left <= 3 && Math.ceil(left) < S.warnMark){ S.warnMark = Math.ceil(left); Sfx.warn(); }
  }
  const pressure = i => {
    const base = S.danger[i] || 0;
    const done = S.prog[i] && S.prog[i][2];
    return Math.min(1, S.state === 'round' && !done ? base + prog * S.pressure : base);
  };
  sceneMe.tick(now, dt, pressure(S.me));
  if (duo() && S.players.length > 1) sceneOpp.tick(now, dt, pressure(duoRival()));
  else if (!S.players.length) sceneOpp.tick(now, dt, 0);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

/* =========================================================
   Typing
   ========================================================= */
function sendTyped(){ Net.send({ t: 'progress', id: S.roundId, typed: S.typed.join('') }); }
function handleChar(ch){
  if (S.state !== 'round' || S.roundDone || isOut(S.me)) return;
  if (S.typed.length >= S.word.length){
    wordEl.classList.remove('nudge'); void wordEl.offsetWidth; wordEl.classList.add('nudge');
    return;
  }
  S.typed.push(ch);
  const i = S.typed.length - 1;
  if (ch === S.word[i]) Sfx.type();
  else {
    Sfx.wrong();
    sceneMe.jolt += 5;
    popOn(timeWrap, 'Branch drops!', 'penalty');
    if (S.level >= 4) shakeArena();
  }
  renderTiles();
  sendTyped();
  if (S.typed.join('') === S.word){
    S.roundDone = true;
    if (S.prog[S.me]) S.prog[S.me][2] = 1;
    renderTiles();
    sceneMe.endLive();
    const waitingFor = others().filter(i => !isOut(i) && !(S.prog[i] && S.prog[i][2]));
    hintEl.textContent = !waitingFor.length ? 'Done! Checking the times…'
      : N() > 2 ? 'Done! Waiting for the others…' : `Done! Waiting for ${nameOf(waitingFor[0])}…`;
  }
}
function backspace(){
  if (S.state !== 'round' || S.roundDone || !S.typed.length || isOut(S.me)) return;
  S.typed.pop();
  Sfx.type();
  renderTiles();
  sendTyped();
}
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA'){
    if (e.key === 'Enter'){
      if (e.target.id === 'codeInput') act('join');
      else if (e.target.id === 'nameInput') act('quick', e.target);
      else if (/^authPass2?$|^authUser$/.test(e.target.id)) submitAuth();
    }
    return;
  }
  if (app.dataset.mode !== 'game') return;
  if (e.key === 'Backspace'){ e.preventDefault(); backspace(); return; }
  if (e.key === ' ' || e.key === 'Spacebar'){ e.preventDefault(); handleChar(' '); return; }
  if (e.key && e.key.length === 1 && /[a-z]/i.test(e.key)){ e.preventDefault(); handleChar(e.key.toUpperCase()); }
});

/* =========================================================
   Buttons
   ========================================================= */
const nameInput = $('#nameInput'), codeInput = $('#codeInput');
nameInput.value = S.profile.name;
codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });
function saveProfile(){
  S.profile.name = nameInput.value.trim().slice(0, 14);
  store.set('stc.name', S.profile.name);
}
function profileMsg(){ return { name: (Auth.user && Auth.user.username) || S.profile.name || 'Player', gender: S.profile.gender }; }
function setGender(g){
  S.profile.gender = g === 'woman' ? 'woman' : 'man';
  store.set('stc.worker', S.profile.gender);
  if (Auth.user && Auth.user.gender !== S.profile.gender){ Auth.user.gender = S.profile.gender; renderAccount(); }
  document.querySelectorAll('.pick').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.gender === S.profile.gender)));
  if (!S.players.length) sceneMe.setGender(S.profile.gender);
}
function updateSoundUI(){
  const m = Sfx.isMuted();
  app.classList.toggle('muted', m);
  $('#soundBtn').textContent = m ? 'SOUND OFF' : 'SOUND ON';
  $('#muteBtn').setAttribute('aria-label', m ? 'Turn sound on' : 'Turn sound off');
}
async function act(a, el){
  switch (a){
    case 'sound':
      Sfx.setMuted(!Sfx.isMuted()); updateSoundUI();
      if (!Sfx.isMuted()) Sfx.click();
      if (el && app.dataset.mode === 'game') el.blur();
      return;
    case 'gender': setGender(el.dataset.gender); return;
    case 'quick': {
      setErr('#menuErr', '');
      if (el && el.closest && el.closest('#menu')) saveProfile();
      if (app.dataset.mode === 'game'){ G.gen++; sceneMe.reset(); sceneOpp.reset(); clearWord(); app.dataset.mode = 'menu'; }
      if (S.code) Net.send({ t: 'leave' });
      S.state = 'queue'; S.code = ''; S.players = [];
      renderQueue();
      showScreen('queue');
      try { await Net.connect(); Net.send(Object.assign({ t: 'quick' }, profileMsg())); }
      catch (e){ S.state = 'menu'; showScreen('menu'); setErr('#menuErr', connectError(e)); }
      return;
    }
    case 'cancelQuick': toMenu(); return;
    case 'create': {
      setErr('#menuErr', '');
      saveProfile();
      try { await Net.connect(); Net.send(Object.assign({ t: 'create' }, profileMsg())); }
      catch (e){ setErr('#menuErr', connectError(e)); }
      return;
    }
    case 'joinScreen':
      saveProfile(); setErr('#joinErr', ''); showScreen('join'); return;
    case 'join': {
      setErr('#joinErr', '');
      const code = codeInput.value.trim();
      if (code.length !== 4){ setErr('#joinErr', 'The room code has 4 letters.'); return; }
      try { await Net.connect(); Net.send(Object.assign({ t: 'join', code }, profileMsg())); }
      catch (e){ setErr('#joinErr', connectError(e)); }
      return;
    }
    case 'start': Net.send({ t: 'start' }); return;
    case 'toLobby': S.state = 'lobbyWait'; Net.send({ t: 'toLobby' }); return;
    case 'leaveMatch': toMenu(); return;
    case 'leave': toMenu(); return;
    case 'menu': toMenu(); return;
    case 'howto': showScreen('howto'); return;
    case 'solo': location.href = location.protocol === 'file:' ? 'solo/index.html' : 'solo/'; return;
    case 'authScreen': setAuthTab('login'); setErr('#authErr', ''); showScreen('auth'); return;
    case 'authTab': setAuthTab(el.dataset.tab); return;
    case 'authSubmit': return submitAuth();
    case 'logout':
      Auth.api('POST', '/logout').catch(() => {});
      Auth.signOut();
      return;
    case 'board': showScreen('board'); loadBoard(S.boardTab || 'duel'); return;
    case 'boardTab': loadBoard(el.dataset.tab); return;
  }
}
app.addEventListener('click', e => {
  const b = e.target.closest('[data-action]');
  if (!b || b.disabled) return;
  Sfx.unlock();
  if (b.dataset.action !== 'sound') Sfx.click();
  act(b.dataset.action, b);
});

/* ---------- sign in / sign up ---------- */
let authMode = 'login';
function setAuthTab(mode){
  authMode = mode === 'signup' ? 'signup' : 'login';
  document.querySelectorAll('#auth .tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === authMode)));
  const up = authMode === 'signup';
  $('#authPass2Row').hidden = !up;
  $('#authRules').hidden = !up;
  $('#authPass').setAttribute('autocomplete', up ? 'new-password' : 'current-password');
  $('#authSubmit').textContent = up ? 'CREATE ACCOUNT' : 'LOG IN';
  $('#authIntro').textContent = up ? 'Pick a username. It will show on the leaderboard.' : 'Welcome back! Your rating and wins are waiting.';
  if (up && !$('#authUser').value && S.profile.name) $('#authUser').value = S.profile.name.replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 16);
  setErr('#authErr', '');
}
async function submitAuth(){
  const btn = $('#authSubmit');
  const username = $('#authUser').value.trim(), password = $('#authPass').value;
  setErr('#authErr', '');
  if (!username || !password){ setErr('#authErr', 'Enter a username and a password.'); return; }
  if (authMode === 'signup' && password !== $('#authPass2').value){ setErr('#authErr', "The two passwords don't match."); return; }
  btn.disabled = true;
  try {
    const d = await Auth.api('POST', authMode === 'signup' ? '/register' : '/login', { username, password, gender: S.profile.gender });
    Auth.signIn(d.token, d.user);
    $('#authPass').value = ''; $('#authPass2').value = '';
    Sfx.join();
    showScreen('menu');
  } catch (e){ setErr('#authErr', e.message); }
  finally { btn.disabled = false; }
}

/* ---------- leaderboard ---------- */
async function loadBoard(type){
  S.boardTab = type === 'solo' ? 'solo' : 'duel';
  document.querySelectorAll('#board .tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === S.boardTab)));
  const list = $('#boardList'), intro = $('#boardIntro'), me = $('#meCard');
  intro.textContent = S.boardTab === 'duel'
    ? 'Ranked by match rating, from duels and group matches. Everyone starts at 1000.'
    : 'Best single-player scores.';
  list.innerHTML = '<li class="empty">Loading…</li>';
  me.hidden = true;
  let data, mine = null;
  try { [data, mine] = await Promise.all([Auth.api('GET', `/leaderboard?type=${S.boardTab}&limit=50`), Auth.refresh()]); }
  catch (e){ list.innerHTML = ''; const li = document.createElement('li'); li.className = 'empty'; li.textContent = e.message; list.appendChild(li); return; }
  if (S.boardTab !== data.type) return;
  list.innerHTML = '';
  if (!data.rows.length){
    const li = document.createElement('li'); li.className = 'empty';
    li.textContent = S.boardTab === 'duel' ? 'No ranked matches yet. Sign in and win the first one!' : 'No solo scores yet. Be the first!';
    list.appendChild(li);
  }
  const myName = Auth.user ? Auth.user.username : null;
  data.rows.forEach(r => {
    const li = document.createElement('li');
    if (r.username === myName) li.className = 'me';
    li.innerHTML = `<span class="rk">${r.rank}</span><svg viewBox="-40 -178 72 60" aria-hidden="true"><use href="#portrait-${r.gender === 'woman' ? 'woman' : 'man'}"/></svg>
      <span><span class="who"></span><span class="sub2"></span></span><span class="val"></span>`;
    li.querySelector('.who').textContent = r.username;
    if (S.boardTab === 'duel'){
      li.querySelector('.sub2').textContent = `${r.wins} first, ${r.matches} played`;
      li.querySelector('.val').textContent = r.rating;
    } else {
      li.querySelector('.sub2').textContent = `Level ${r.level}`;
      li.querySelector('.val').textContent = r.score;
    }
    list.appendChild(li);
  });
  if (mine && mine.user){
    const u = mine.user, rank = mine.rank[S.boardTab];
    me.innerHTML = '';
    const line = document.createElement('div');
    if (S.boardTab === 'duel'){
      line.textContent = u.matches
        ? `You: rank #${rank}, rating ${u.rating} (best ${u.peakRating}), first place in ${plural(u.wins, 'match', 'matches')} of ${u.matches}.`
        : 'No ranked matches yet. Play against signed-in players to appear here.';
    } else {
      line.textContent = u.soloBest ? `You: rank #${rank}, best ${u.soloBest} (level ${u.soloLevel}) over ${plural(u.soloRuns, 'run')}.` : 'Play solo while signed in to post a score.';
    }
    me.appendChild(line);
    me.hidden = false;
  } else if (Auth.enabled){
    me.textContent = 'Sign in to see your own rank here.';
    me.hidden = false;
  }
}

/* ---------- on-screen keyboard (touch devices) ---------- */
(function buildKeyboard(){
  const vk = $('#vk');
  ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'].forEach((r, ri) => {
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
const setTouch = () => app.classList.add('touch');
if (matchMedia('(pointer: coarse)').matches) setTouch();
addEventListener('touchstart', setTouch, { passive: true, once: true });

/* =========================================================
   Boot
   ========================================================= */
setGender(S.profile.gender);
sceneOpp.setGender(S.profile.gender === 'man' ? 'woman' : 'man');
updateSoundUI();
renderAccount();
const wasInMatch = Session.inMatch;
toMenu();
if (location.protocol !== 'file:'){
  fetch('/api/config').then(r => r.json()).then(async c => {
    Auth.enabled = !!c.accounts;
    renderAccount();
    if (Auth.enabled) await Auth.refresh();
    if (location.hash === '#leaderboard' && Auth.enabled && S.state === 'menu'){ showScreen('board'); loadBoard('duel'); history.replaceState(null, '', location.pathname); }
  }).catch(() => {});
}
if (location.protocol === 'file:'){
  setErr('#menuErr', 'You opened the file directly, so only PLAY SOLO works here. For online play, run "node server.js" and open the address it prints.');
} else if (wasInMatch){
  // the page was reloaded during a match: try to take the seat back
  S.state = 'reconnect';
  showScreen('reconnect');
  Net.connect().then(h => {
    if (h.resumed) $('#reconnect').hidden = true;
    else toMenu();
  }).catch(() => toMenu());
}
})();
