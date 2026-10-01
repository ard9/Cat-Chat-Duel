/* =========================================================
   Save the Cat — Duel server (2 to 6 players)
   Zero dependencies: run with `node server.js`
   - Serves the game from ./public
   - WebSocket at /ws for private rooms and quick match
   - Players who drop get 15 seconds to reconnect; the match pauses meanwhile
   The server is authoritative: it picks the words, runs the clock
   and decides who won each round.
   ========================================================= */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const Database = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const GRACE_MS = 15000;          // how long a dropped player may take to come back
const PING_MS = 10000;           // heartbeat; dead sockets are noticed within ~2 pings
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'savethecat.db');
let DB = null;
try { DB = Database.open(DB_PATH); }
catch (e){ console.error('  Could not open the database:', e.message); DB = null; }

/* ---------------------------------------------------------
   GAME CONFIG — tweak the duel here
   --------------------------------------------------------- */
const GAME = {
  roundsPerLevel: 3,
  roundGraceMs: 200,               // small network allowance before a timeout
  scoring: { base: 100, perSecond: 20 },
  danger: {                        // 1.0 = the branch lands on that player's cat (they are out)
    timeout: 0.25,                 // did not finish the word in time
    mistake: 0.03,                 // every wrong key
    winHeal: 0.05                  // finishing first lifts your branch a little
  }                                // the slowest finisher's penalty is SLOWEST_PENALTY below
  // Level timing and word difficulty: see LEVELS in public/wordbank.js
};

/* ---------------------------------------------------------
   Words: built-in list (public/words.js) + optional custom-words.txt
   --------------------------------------------------------- */
const WB = require('./public/wordbank.js');
const LEVEL_COUNT = WB.LEVELS.length;
const CUSTOM_WORDS_FILE = process.env.CUSTOM_WORDS || path.join(__dirname, 'custom-words.txt');
const WORDS_MODE = process.env.WORDS_MODE === 'only' ? 'only' : 'mix';   // 'only' = play with custom words alone
const BASE_WORDS = (() => {
  const src = fs.readFileSync(path.join(__dirname, 'public', 'words.js'), 'utf8');
  return JSON.parse(src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1));
})();
let CUSTOM = [];
let BANK = WB.build(BASE_WORDS, [], WORDS_MODE);
function loadCustomWords(quiet){
  let text = '';
  try { text = fs.readFileSync(CUSTOM_WORDS_FILE, 'utf8'); } catch (e){ text = ''; }
  CUSTOM = WB.parseCustom(text);
  BANK = WB.build(BASE_WORDS, CUSTOM, WORDS_MODE);
  if (!quiet) console.log(`  Words reloaded: ${CUSTOM.length} custom, ${BANK.size} in total (${BANK.mode === 'only' ? 'custom only' : 'mixed'}).`);
}
loadCustomWords(true);
// edit custom-words.txt while the server runs: new matches pick up the change
let wordsReloadTimer = 0;
try { fs.watch(path.dirname(CUSTOM_WORDS_FILE), (ev, name) => {
  if (name && path.basename(CUSTOM_WORDS_FILE) !== String(name)) return;
  clearTimeout(wordsReloadTimer); wordsReloadTimer = setTimeout(() => loadCustomWords(false), 300);
}); } catch (e){}
const randomUnit = () => crypto.randomInt(1 << 30) / (1 << 30);

/* ---------------------------------------------------------
   Static files
   --------------------------------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
};
function lanAddresses(){
  const out = [];
  for (const list of Object.values(os.networkInterfaces())){
    for (const a of list || []){
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
    }
  }
  return out;
}
/* ---------------------------------------------------------
   JSON API: accounts, leaderboards, solo scores
   --------------------------------------------------------- */
function json(res, code, obj){ res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function readJson(req, limit = 8192){
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit){ reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e){ reject(e); } });
    req.on('error', reject);
  });
}
const clientIp = req => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
const bearer = req => { const m = String(req.headers.authorization || '').match(/^Bearer ([a-f0-9]{64})$/); return m ? m[1] : null; };
const limits = new Map();
function limited(key, max, windowMs){
  const now = Date.now();
  let e = limits.get(key);
  if (!e || now > e.reset){ e = { n: 0, reset: now + windowMs }; limits.set(key, e); }
  return ++e.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, e] of limits) if (now > e.reset) limits.delete(k); }, 60000).unref();

// The highest score a solo run can honestly reach by a given level (used to reject impossible scores)
const SOLO_WORDS_PER_LEVEL = 3;
function soloMaxScore(level){
  let max = 0;
  for (let L = 1; L <= level; L++){
    max += SOLO_WORDS_PER_LEVEL * Math.ceil((GAME.scoring.base + WB.maxWordTime(L) * GAME.scoring.perSecond) * L);
  }
  return max;
}

async function handleApi(req, res, url){
  if (url.pathname === '/api/config') return json(res, 200, { accounts: !!DB });
  if (url.pathname === '/api/words') return json(res, 200, { mode: BANK.mode, custom: CUSTOM });
  if (!DB) return json(res, 503, { error: 'Accounts are turned off on this server.' });
  const ip = clientIp(req);
  try {
    switch (`${req.method} ${url.pathname}`){
      case 'POST /api/register': {
        if (limited('reg:' + ip, 5, 3600e3)) return json(res, 429, { error: 'Too many new accounts from this network. Try again later.' });
        const b = await readJson(req);
        const user = await DB.register(b.username, b.password, b.gender);
        return json(res, 200, { token: DB.createSession(user.id), user });
      }
      case 'POST /api/login': {
        if (limited('login:' + ip, 10, 600e3)) return json(res, 429, { error: 'Too many attempts. Wait a few minutes and try again.' });
        const b = await readJson(req);
        const user = await DB.login(b.username, b.password);
        if (!user) return json(res, 401, { error: 'Wrong username or password.' });
        return json(res, 200, { token: DB.createSession(user.id), user });
      }
      case 'POST /api/logout': {
        DB.deleteSession(bearer(req));
        return json(res, 200, { ok: true });
      }
      case 'GET /api/me': {
        const user = DB.userBySession(bearer(req));
        if (!user) return json(res, 401, { error: 'Not signed in.' });
        return json(res, 200, { user, rank: { duel: DB.rank(user.id, 'duel'), solo: DB.rank(user.id, 'solo') }, recent: DB.recentMatches(user.id, 5) });
      }
      case 'GET /api/leaderboard': {
        const type = url.searchParams.get('type') === 'solo' ? 'solo' : 'duel';
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
        return json(res, 200, { type, rows: DB.leaderboard(type, limit), totals: DB.stats() });
      }
      case 'POST /api/solo': {
        const user = DB.userBySession(bearer(req));
        if (!user) return json(res, 401, { error: 'Sign in to save your score.' });
        const b = await readJson(req);
        const score = Math.floor(Number(b.score)), level = Math.floor(Number(b.level));
        if (!Number.isFinite(score) || !Number.isFinite(level) || level < 1 || level > LEVEL_COUNT || score < 0 || score > soloMaxScore(level))
          return json(res, 400, { error: 'That score could not be verified.' });
        if (limited('solo:' + user.id, 1, 10000)) return json(res, 429, { error: 'Please wait a moment before saving another score.' });
        return json(res, 200, DB.recordSolo(user.id, score, level));
      }
    }
    return json(res, 404, { error: 'Not found.' });
  } catch (e){
    if (e.userMessage) return json(res, 400, { error: e.userMessage });
    if (e.message === 'too big' || e instanceof SyntaxError) return json(res, 400, { error: 'Bad request.' });
    console.error(e);
    return json(res, 500, { error: 'Something went wrong on the server.' });
  }
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',          // browsers must not guess file types
  'X-Frame-Options': 'DENY',                    // the game can't be embedded in someone else's page
  'Referrer-Policy': 'same-origin'
};
// Only files inside ./public are ever served. Anything else (server.js, db.js, data/, your home folder) is off limits.
function safePublicPath(pathname){
  let p;
  try { p = decodeURIComponent(pathname); } catch (e){ return null; }
  if (p.includes('\0') || p.includes('\\')) return null;               // null bytes and backslashes are never legitimate
  if (p.split('/').some(seg => seg.startsWith('.'))) return null;       // no "..", no hidden files like .env
  if (p.endsWith('/')) p += 'index.html';
  const file = path.resolve(PUBLIC_DIR, '.' + p);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return null;   // must be INSIDE public/, not a sibling
  return file;
}
function handleHttp(req, res){
  const url = new URL(req.url, 'http://x');
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (url.pathname === '/info'){
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ addresses: lanAddresses().map(ip => `http://${ip}:${PORT}`), port: PORT, online: conns.size }));
  }
  if (url.pathname === '/health'){ res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (req.method !== 'GET' && req.method !== 'HEAD'){ res.writeHead(405); return res.end('Method not allowed'); }
  const file = safePublicPath(url.pathname);
  if (!file){ res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()){ res.writeHead(301, { Location: url.pathname + '/' }); return res.end(); }
    if (err || !st.isFile()){ res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    const stream = fs.createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}
const server = http.createServer((req, res) => {
  try { handleHttp(req, res); }
  catch (e){ console.error('Bad request:', e.message); try { res.writeHead(400); res.end('Bad request'); } catch (x){} }
});
server.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (e){} });

/* ---------------------------------------------------------
   Minimal WebSocket (RFC 6455) — text frames, ping/pong, close
   --------------------------------------------------------- */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
class Conn {
  constructor(socket){
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = null;
    this.alive = true;
    this.closed = false;
    this.rate = { start: Date.now(), n: 0 };
    this.onmessage = () => {};
    this.onclose = () => {};
    socket.setNoDelay(true);
    socket.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this.parse(); });
    socket.on('close', () => this.finish());
    socket.on('error', () => this.finish());
  }
  parse(){
    while (this.buf.length >= 2){
      const b0 = this.buf[0], b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126){ if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127){ if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (len > 64 * 1024) return this.close();          // this game never needs big frames
      const maskAt = off;
      if (masked) off += 4;
      if (this.buf.length < off + len) return;
      const payload = Buffer.from(this.buf.subarray(off, off + len));
      if (masked){ const m = this.buf.subarray(maskAt, maskAt + 4); for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3]; }
      this.buf = this.buf.subarray(off + len);
      this.frame(op, fin, payload);
      if (this.closed) return;
    }
  }
  frame(op, fin, payload){
    this.alive = true;
    if (op === 0x8) return this.close();
    if (op === 0x9) return this.raw(0xA, payload);        // ping -> pong
    if (op === 0xA) return;                               // pong
    if (op === 0x1) this.frag = payload;
    else if (op === 0x0 && this.frag) this.frag = Buffer.concat([this.frag, payload]);
    else return;                                          // ignore binary
    if (!fin) return;
    const text = this.frag.toString('utf8'); this.frag = null;
    // simple flood protection: 60 messages per second
    const now = Date.now();
    if (now - this.rate.start > 1000){ this.rate.start = now; this.rate.n = 0; }
    if (++this.rate.n > 60){ if (this.rate.n > 300) this.close(); return; }
    let msg; try { msg = JSON.parse(text); } catch (e){ return; }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    try { this.onmessage(msg); }
    catch (e){ console.error('Ignored a bad message:', e.message); }
  }
  raw(op, payload){
    if (this.closed) return;
    const len = payload.length;
    let head;
    if (len < 126){ head = Buffer.from([0x80 | op, len]); }
    else if (len < 65536){ head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    try { this.socket.write(Buffer.concat([head, payload])); } catch (e){}
  }
  send(obj){ this.raw(0x1, Buffer.from(JSON.stringify(obj))); }
  close(){ if (this.closed) return; this.raw(0x8, Buffer.alloc(0)); try { this.socket.end(); } catch (e){} this.finish(); }
  finish(){ if (this.closed) return; this.closed = true; try { this.socket.destroy(); } catch (e){} this.onclose(); }
}
const MAX_CONNS_PER_IP = 12;        // one household or classroom is fine; a flood from one address is not
const connsPerIp = new Map();
server.on('upgrade', (req, socket) => {
  socket.on('error', () => {});
  let pathname = '';
  try { pathname = new URL(req.url, 'http://x').pathname; } catch (e){}
  const key = req.headers['sec-websocket-key'];
  if (pathname !== '/ws' || !key || !/^[A-Za-z0-9+/=]{16,40}$/.test(key)){ socket.destroy(); return; }
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?';
  if ((connsPerIp.get(ip) || 0) >= MAX_CONNS_PER_IP){ socket.destroy(); return; }
  connsPerIp.set(ip, (connsPerIp.get(ip) || 0) + 1);
  socket.once('close', () => { const n = (connsPerIp.get(ip) || 1) - 1; if (n > 0) connsPerIp.set(ip, n); else connsPerIp.delete(ip); });
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
               `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  onConnection(new Conn(socket));
});
const conns = new Set();
setInterval(() => {
  for (const c of conns){
    if (!c.alive){ c.close(); continue; }
    c.alive = false; c.raw(0x9, Buffer.alloc(0));
  }
}, PING_MS);

/* ---------------------------------------------------------
   Players and rooms (2 to 6 players)
   --------------------------------------------------------- */
const MIN_PLAYERS = 2, MAX_PLAYERS = 6;
const QUICK_COUNTDOWN_MS = 10000;   // quick match waits this long for more players once two are in
const SNAPSHOT_MS = 100;            // typing progress is streamed to everyone 10 times a second
const NET_MS = 2000;                // latency is measured this often
const MAX_COMP_MS = 150;            // most we credit back to a slow connection when timing a finish (one round trip, capped)
const PLACE_POINTS = [1, 0.7, 0.5, 0.35, 0.25, 0.2];   // share of the round's points by finishing place
const SLOWEST_PENALTY = n => n <= 2 ? 0.2 : 0.1;       // when everyone finishes, the slowest still loses a little

const rooms = new Map();            // code -> room
const playersByToken = new Map();   // session token -> player
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PLAYING = ['level', 'round', 'result', 'paused', 'resuming'];

function newCode(){
  for (let tries = 0; tries < 1000; tries++){
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
  return null;
}
const cleanName = n => (String(n || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 14)) || 'Player';
const cleanGender = g => g === 'woman' ? 'woman' : 'man';
const validToken = t => typeof t === 'string' && /^[a-f0-9]{16,64}$/.test(t);

function send(p, msg){ if (p && p.conn) p.conn.send(msg); }
function broadcast(room, msg){ room.players.forEach(p => send(p, msg)); }
function sendRoom(room){
  const info = room.players.map((p, i) => ({ name: p.name, gender: p.gender, away: !p.conn, registered: !!p.userId,
                                             rating: p.userId ? p.rating : null, left: !!(room.left && room.left[i]) }));
  const startsIn = room.startsAt ? Math.max(0, room.startsAt - Date.now()) : null;
  room.players.forEach((p, i) => send(p, { t: 'room', code: room.code, quick: room.quick, you: i, players: info, state: room.state,
                                           startsIn, max: MAX_PLAYERS, min: MIN_PLAYERS }));
}
function clearTimers(room){ room.timers.forEach(clearTimeout); room.timers = []; }
function later(room, ms, fn){ const id = setTimeout(() => { room.timers = room.timers.filter(x => x !== id); fn(); }, ms); room.timers.push(id); }
function newRoom(quick){
  const code = newCode();
  if (!code) return null;
  const room = { code, quick, players: [], state: quick ? 'forming' : 'lobby', timers: [], startsAt: null,
                 scores: [], danger: [], out: [], left: [], elimCount: 0, level: 1, roundInLevel: 0, roundId: 0,
                 pausedState: null, lastOver: null, recorded: false, dirty: false };
  rooms.set(code, room);
  return room;
}
function setProfile(p, msg){
  p.gender = cleanGender(msg.gender);
  if (p.userId){ p.name = p.username; if (DB) DB.setGender(p.userId, p.gender); }
  else p.name = cleanName(msg.name);
}
function attachAccount(p, authToken){
  const user = DB && authToken ? DB.userBySession(authToken) : null;
  p.userId = user ? user.id : null;
  p.username = user ? user.username : null;
  p.rating = user ? user.rating : null;
  if (user){ p.name = user.username; p.gender = user.gender; }
  return user;
}
const aliveIdx = room => room.players.map((_, i) => i).filter(i => !room.out[i]);

/* ---------- match flow ---------- */
function startMatch(room){
  clearTimers(room);
  const n = room.players.length;
  Object.assign(room, { state: 'level', level: 1, roundInLevel: 0, roundId: 0, scores: Array(n).fill(0), danger: Array(n).fill(0),
                        out: Array(n).fill(0), left: Array(n).fill(false), elimCount: 0, picker: WB.createPicker(BANK, randomUnit), lastOver: null,
                        recorded: false, startsAt: null });
  sendRoom(room);
  announceLevel(room);
}
function announceLevel(room){
  room.state = 'level';
  const L = WB.LEVELS[room.level - 1];
  broadcast(room, { t: 'level', level: room.level, note: L.note, rounds: GAME.roundsPerLevel, danger: room.danger, scores: room.scores, out: room.out });
  later(room, 1700, () => startRound(room));
}
function startRound(room){
  const n = room.players.length;
  room.word = room.picker.next(room.level);           // never repeats a word within a match
  room.duration = WB.durationFor(room.level, room.word);
  room.typed = Array(n).fill('');
  room.correct = Array(n).fill(0);
  room.finished = Array(n).fill(null);
  room.roundId++;
  room.state = 'round';
  room.roundStart = Date.now();
  room.dirty = false;
  broadcast(room, { t: 'round', id: room.roundId, word: room.word, duration: room.duration, level: room.level,
                    round: room.roundInLevel + 1, rounds: GAME.roundsPerLevel, danger: room.danger, out: room.out,
                    pressure: GAME.danger.timeout });
  later(room, room.duration * 1000 + GAME.roundGraceMs, () => endRound(room));
}
function allAliveDone(room){ return aliveIdx(room).every(i => room.finished[i] !== null); }
function onProgress(room, idx, msg){
  if (room.state !== 'round' || msg.id !== room.roundId || room.out[idx] || room.finished[idx] !== null) return;
  const typed = String(msg.typed || '').toUpperCase().replace(/[^A-Z ]/g, '').slice(0, room.word.length);
  const prev = room.typed[idx];
  const grew = typed.length === prev.length + 1 && typed.startsWith(prev);
  const shrank = typed.length === prev.length - 1 && prev.startsWith(typed);
  if (!grew && !shrank) return;                  // one key at a time, nothing else accepted
  room.typed[idx] = typed;
  let correct = 0;
  while (correct < typed.length && typed[correct] === room.word[correct]) correct++;
  room.correct[idx] = correct;
  room.dirty = true;
  if (grew && typed[typed.length - 1] !== room.word[typed.length - 1]){
    room.danger[idx] = Math.min(1, room.danger[idx] + GAME.danger.mistake);
    if (room.danger[idx] >= 1){
      room.out[idx] = ++room.elimCount;
      broadcast(room, { t: 'eliminated', p: idx, danger: room.danger, out: room.out });
      if (aliveIdx(room).length <= 1 || allAliveDone(room)) endRound(room);
      return;
    }
  }
  if (typed === room.word){
    // Time the finish on the server's clock. A slow connection receives the word late AND its finish
    // arrives late, so it loses one full round trip; credit that back (capped, so faking lag can't pay off).
    const comp = Math.min(MAX_COMP_MS, room.players[idx].rtt || 0);
    room.finished[idx] = Math.max(0, Date.now() - room.roundStart - comp) / 1000;
    if (allAliveDone(room)) endRound(room);
  }
}
function flushSnapshots(){
  for (const room of rooms.values()){
    if (room.state !== 'round' || !room.dirty) continue;
    room.dirty = false;
    broadcast(room, { t: 'snap', id: room.roundId, danger: room.danger,
                      prog: room.players.map((_, i) => [room.typed[i].length, room.correct[i], room.finished[i] !== null ? 1 : 0]) });
  }
}
setInterval(flushSnapshots, SNAPSHOT_MS).unref();

function endRound(room){
  if (room.state !== 'round') return;
  clearTimers(room);
  room.state = 'result';
  const alive = aliveIdx(room);
  const fin = alive.filter(i => room.finished[i] !== null).sort((a, b) => room.finished[a] - room.finished[b]);
  const missed = alive.filter(i => room.finished[i] === null);
  const places = fin.map((i, k) => {
    const left = Math.max(0, room.duration - room.finished[i]);
    const points = Math.round((GAME.scoring.base + left * GAME.scoring.perSecond) * room.level * (PLACE_POINTS[k] || 0.2));
    room.scores[i] += points;
    return { p: i, place: k + 1, time: Math.round(room.finished[i] * 100) / 100, points };
  });
  if (fin.length) room.danger[fin[0]] = Math.max(0, room.danger[fin[0]] - GAME.danger.winHeal);
  missed.forEach(i => { room.danger[i] = Math.min(1, room.danger[i] + GAME.danger.timeout); });
  let slowest = null;
  if (!missed.length && fin.length > 1){
    slowest = fin[fin.length - 1];
    room.danger[slowest] = Math.min(1, room.danger[slowest] + SLOWEST_PENALTY(alive.length));
  }
  const eliminated = alive.filter(i => room.danger[i] >= 1);
  if (eliminated.length){ const order = ++room.elimCount; eliminated.forEach(i => { room.out[i] = order; }); }
  broadcast(room, { t: 'result', word: room.word, places, missed, slowest, eliminated, scores: room.scores, danger: room.danger, out: room.out });
  if (aliveIdx(room).length <= 1) later(room, 1600, () => endMatch(room, 'last'));
  else later(room, eliminated.length ? 2400 : 2000, () => advance(room));
}
function advance(room){
  room.roundInLevel++;
  if (room.roundInLevel >= GAME.roundsPerLevel){
    room.roundInLevel = 0;
    if (room.level >= LEVEL_COUNT) return endMatch(room, 'finished');
    room.level++;
    announceLevel(room);
  } else {
    startRound(room);
  }
}
/* standings: players still in by score, then the eliminated (later out ranks higher); equal keys share a place */
function standingsOf(room){
  const key = i => room.out[i] ? [1, -room.out[i], room.scores[i]] : [0, 0, room.scores[i]];
  const order = room.players.map((_, i) => i).sort((a, b) => {
    const ka = key(a), kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || kb[2] - ka[2];
  });
  const place = [];
  order.forEach((i, k) => {
    const prev = order[k - 1];
    const same = k > 0 && String(key(prev)) === String(key(i));
    place[i] = same ? place[prev] : k + 1;
  });
  return { order, place };
}
function recordResult(room, place, reason){
  if (!DB || room.recorded || room.roundId < 1) return null;
  room.recorded = true;
  try {
    const r = DB.recordMatch({
      seats: room.players.map((p, i) => ({ userId: p.userId, name: p.name, score: room.scores[i], place: place[i] })),
      reason, level: room.level, quick: room.quick
    });
    room.players.forEach((p, i) => { if (r.ratings[i] !== null) p.rating = r.ratings[i]; });
    return r;
  } catch (e){ console.error('Could not save match:', e.message); return null; }
}
function endMatch(room, reason){
  if (room.state === 'over') return;
  clearTimers(room);
  room.state = 'over';
  const { order, place } = standingsOf(room);
  const rec = recordResult(room, place, reason);
  const firsts = order.filter(i => place[i] === 1);
  room.lastOver = {
    t: 'over', reason, level: room.level, ranked: rec ? rec.ranked : false,
    winner: firsts.length === 1 ? firsts[0] : null,
    standings: order.map(i => ({ p: i, name: room.players[i].name, gender: room.players[i].gender, score: room.scores[i], place: place[i],
                                 out: !!room.out[i], left: !!room.left[i], registered: !!room.players[i].userId,
                                 delta: rec ? rec.deltas[i] : 0, rating: rec ? rec.ratings[i] : null }))
  };
  broadcast(room, room.lastOver);
  // players who left during the match give up their seat now
  const keep = room.players.filter((_, i) => !room.left[i]);
  if (keep.length !== room.players.length){
    room.players = keep;
    room.left = keep.map(() => false);
    if (!keep.length){ rooms.delete(room.code); return; }
  }
  room.out = []; room.scores = []; room.danger = [];
  sendRoom(room);
}

/* ---------- pause while someone reconnects ---------- */
function pause(room){
  if (room.state === 'paused') return;
  if (room.state !== 'resuming') room.pausedState = room.state;
  room.state = 'paused';
  clearTimers(room);
  broadcast(room, { t: 'paused' });
}
function resume(room){
  if (room.state !== 'paused' || aliveIdx(room).some(i => !room.players[i].conn && !room.left[i])) return;
  const st = room.pausedState;
  room.state = 'resuming';
  broadcast(room, { t: 'resumed' });
  later(room, 1500, () => {
    if (aliveIdx(room).length <= 1) return endMatch(room, 'forfeit');
    if (st === 'level') return announceLevel(room);
    if (st === 'round') return startRound(room);             // the interrupted round is replayed with a new word
    advance(room);                                           // 'result'
  });
}
function goAway(p){
  const room = p.room;
  const i = room.players.indexOf(p);
  if (PLAYING.includes(room.state) && !room.out[i]) pause(room);
  broadcast(room, { t: 'away', p: i, name: p.name, seconds: GRACE_MS / 1000 });
  if (!PLAYING.includes(room.state)) sendRoom(room);
  p.graceTimer = setTimeout(() => {
    p.graceTimer = null;
    if (p.conn) return;
    leaveRoom(p);
    playersByToken.delete(p.token);
  }, GRACE_MS);
}

/* ---------- leaving (on purpose, or after the grace period) ---------- */
function leaveRoom(p){
  const room = p.room;
  if (!room) return;
  p.room = null;
  const i = room.players.indexOf(p);
  if (PLAYING.includes(room.state)){
    // keep the seat until the match ends so everyone's numbering stays put
    if (!room.out[i]) room.out[i] = ++room.elimCount;
    room.left[i] = true;
    broadcast(room, { t: 'left', p: i, name: p.name, during: true, out: room.out });
    if (room.players.every((_, j) => room.left[j])){ clearTimers(room); rooms.delete(room.code); return; }
    const alive = aliveIdx(room);
    if (alive.length <= 1){ clearTimers(room); endMatch(room, 'forfeit'); return; }
    if (room.state === 'paused') resume(room);
    else if (room.state === 'round' && allAliveDone(room)) endRound(room);
    return;
  }
  room.players.splice(i, 1);
  if (room.left.length) room.left.splice(i, 1);
  if (!room.players.length){ clearTimers(room); rooms.delete(room.code); return; }
  if (room.state === 'forming' && room.players.length < MIN_PLAYERS){ clearTimers(room); room.startsAt = null; }
  broadcast(room, { t: 'left', p: i, name: p.name, during: false });
  sendRoom(room);
}

/* ---------- quick match: join a forming room or open one ---------- */
function quickJoin(p){
  let r = [...rooms.values()].find(r => r.quick && r.state === 'forming' && r.players.length < MAX_PLAYERS &&
                                         !r.players.some(o => p.userId && o.userId === p.userId));
  if (!r){ r = newRoom(true); if (!r) return send(p, { t: 'error', message: 'The server is full. Try again in a minute.' }); }
  r.players.push(p); p.room = r;
  if (r.players.length >= MAX_PLAYERS){ clearTimers(r); return launchQuick(r); }
  if (r.players.length >= MIN_PLAYERS && !r.startsAt){
    r.startsAt = Date.now() + QUICK_COUNTDOWN_MS;
    later(r, QUICK_COUNTDOWN_MS, () => launchQuick(r));
  }
  sendRoom(r);
}
function launchQuick(r){
  if (r.state !== 'forming') return;
  const gone = r.players.filter(o => !o.conn);
  gone.forEach(o => { o.room = null; });
  r.players = r.players.filter(o => o.conn);
  if (r.players.length < MIN_PLAYERS){ r.startsAt = null; if (!r.players.length) rooms.delete(r.code); else sendRoom(r); return; }
  startMatch(r);
}

/* ---------- connections ---------- */
function newPlayer(conn, token){
  const p = { token: token || crypto.randomBytes(16).toString('hex'), name: 'Player', gender: 'man', conn, room: null, graceTimer: null,
              userId: null, username: null, rating: null, rtt: 0 };
  playersByToken.set(p.token, p);
  conn.player = p;
  return p;
}
function hello(conn, msg){
  if (conn.player) return;
  const token = validToken(msg.token) ? msg.token : null;
  const existing = token ? playersByToken.get(token) : null;
  if (existing){
    // The same tab is back on a new socket. The old socket may still look alive
    // here (phones often switch networks before the server notices), so retire it.
    if (existing.conn && existing.conn !== conn){
      const old = existing.conn;
      old.player = null; existing.conn = null;
      old.send({ t: 'kicked' });
      old.close();
    }
    if (existing.room){
      clearTimeout(existing.graceTimer); existing.graceTimer = null;
      existing.conn = conn; conn.player = existing;
      conn.send({ t: 'hello', resumed: true, token: existing.token, user: existing.userId && DB ? DB.user(existing.userId) : null });
      const room = existing.room;
      const i = room.players.indexOf(existing);
      if (PLAYING.includes(room.state) && room.state !== 'paused' && !room.out[i]) pause(room);   // replay the interrupted moment
      sendRoom(room);
      if (room.state === 'over' && room.lastOver) send(existing, room.lastOver);
      else if (PLAYING.includes(room.state))
        send(existing, { t: 'sync', level: room.level, rounds: GAME.roundsPerLevel, danger: room.danger, scores: room.scores, out: room.out });
      broadcast(room, { t: 'back', p: i, name: existing.name });
      resume(room);
      return;
    }
    playersByToken.delete(token);
  }
  newPlayer(conn, token);
  const user = attachAccount(conn.player, msg.auth);
  conn.send({ t: 'hello', resumed: false, token: conn.player.token, user });
}
/* latency: the server pings each player; the reply gives the round trip time */
setInterval(() => {
  const now = Date.now();
  for (const c of conns){ if (c.player) c.send({ t: 'sp', s: now, rtt: c.player.rtt }); }
  for (const room of rooms.values()){
    if (room.players.length > 1) broadcast(room, { t: 'net', rtt: room.players.map(p => p.conn ? p.rtt : -1) });
  }
}, NET_MS).unref();

function onConnection(conn){
  conns.add(conn);
  conn.player = null;
  conn.onclose = () => {
    conns.delete(conn);
    const p = conn.player;
    if (!p || p.conn !== conn) return;
    p.conn = null;
    if (p.room) goAway(p); else playersByToken.delete(p.token);
  };
  conn.onmessage = msg => {
    if (msg.t === 'hello') return hello(conn, msg);
    const p = conn.player || newPlayer(conn, null);
    const room = p.room;
    const idx = room ? room.players.indexOf(p) : -1;
    switch (msg.t){
      case 'sp': {
        const sample = Date.now() - Number(msg.s);
        if (sample >= 0 && sample < 10000) p.rtt = p.rtt ? Math.round(p.rtt * 0.7 + sample * 0.3) : sample;
        break;
      }
      case 'create': {
        leaveRoom(p); setProfile(p, msg);
        const r = newRoom(false);
        if (!r) return send(p, { t: 'error', message: 'The server is full. Try again in a minute.' });
        r.players.push(p); p.room = r;
        sendRoom(r);
        break;
      }
      case 'join': {
        const code = String(msg.code || '').toUpperCase().replace(/[^A-Z]/g, '');
        const r = rooms.get(code);
        if (!r || r.quick) return send(p, { t: 'error', message: `No room with code ${code || '?'}. Check the code and try again.` });
        if (r === room) return sendRoom(r);
        if (r.state !== 'lobby') return send(p, { t: 'error', message: 'That room is in the middle of a match. Try again when it ends.' });
        if (r.players.length >= MAX_PLAYERS) return send(p, { t: 'error', message: `That room is full (${MAX_PLAYERS} players).` });
        if (p.userId && r.players.some(o => o.userId === p.userId)) return send(p, { t: 'error', message: 'You are already in this room in another tab.' });
        leaveRoom(p); setProfile(p, msg);
        r.players.push(p); p.room = r;
        sendRoom(r);
        break;
      }
      case 'quick':
        leaveRoom(p); setProfile(p, msg);
        quickJoin(p);
        break;
      case 'auth': {
        if (room && PLAYING.includes(room.state)) return send(p, { t: 'error', message: 'Finish this match before switching accounts.' });
        const user = attachAccount(p, msg.auth);
        send(p, { t: 'authed', user });
        if (room) sendRoom(room);
        break;
      }
      case 'start':
        if (room && idx === 0 && !room.quick && room.state === 'lobby' && room.players.length >= MIN_PLAYERS && room.players.every(o => o.conn)) startMatch(room);
        break;
      case 'toLobby':
        if (room && !room.quick && room.state === 'over'){ room.state = 'lobby'; sendRoom(room); }
        else if (room) sendRoom(room);
        break;
      case 'progress':
        if (room && idx >= 0) onProgress(room, idx, msg);
        break;
      case 'leave':
        leaveRoom(p);
        break;
    }
  };
}

server.listen(PORT, HOST, () => {
  const ips = lanAddresses();
  console.log('\n  Save the Cat — Duel server is running\n');
  console.log(`  On this computer:   http://localhost:${PORT}`);
  ips.forEach(ip => console.log(`  On your network:    http://${ip}:${PORT}`));
  if (!ips.length) console.log('  (No network address found. Connect to Wi-Fi or a hotspot to play on two devices.)');
  console.log(`\n  Words: ${BANK.size} (${CUSTOM.length} from custom-words.txt${BANK.mode === 'only' ? ', custom only' : ''})`);
  if (DB){ const st = DB.stats(); console.log(`\n  Database: ${DB_PATH}  (${st.users} players, ${st.matches} matches)`); }
  else console.log('\n  Database: OFF. Accounts and leaderboards need Node.js 22.13 or newer.');
  console.log('\n  Open one of the network addresses on the second device.\n  Press Ctrl+C to stop.\n');
});
