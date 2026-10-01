/* =========================================================
   Save the Cat — database (SQLite, built into Node.js 22.13+)
   Accounts, login sessions, match history, Elo ratings,
   solo best scores and leaderboards. No npm packages needed.
   ========================================================= */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// node:sqlite prints an "experimental" warning on load; hide only that one.
const origEmitWarning = process.emitWarning;
process.emitWarning = function (warning, ...args){
  const type = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].type);
  const text = String((warning && warning.message) || warning);
  if ((type === 'ExperimentalWarning' || (warning && warning.name === 'ExperimentalWarning')) && /sqlite/i.test(text)) return;
  return origEmitWarning.call(process, warning, ...args);
};
let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (e){ DatabaseSync = null; }

const SESSION_DAYS = 30;
const START_RATING = 1000;
const ELO_K = 32;

/* ---------- schema (bump user_version to migrate) ---------- */
const MIGRATIONS = [
  `CREATE TABLE users (
     id            INTEGER PRIMARY KEY,
     username      TEXT    NOT NULL,
     username_lc   TEXT    NOT NULL UNIQUE,
     pass_hash     TEXT    NOT NULL,
     pass_salt     TEXT    NOT NULL,
     gender        TEXT    NOT NULL DEFAULT 'man',
     rating        INTEGER NOT NULL DEFAULT ${START_RATING},
     peak_rating   INTEGER NOT NULL DEFAULT ${START_RATING},
     matches       INTEGER NOT NULL DEFAULT 0,
     wins          INTEGER NOT NULL DEFAULT 0,
     losses        INTEGER NOT NULL DEFAULT 0,
     draws         INTEGER NOT NULL DEFAULT 0,
     best_duel     INTEGER NOT NULL DEFAULT 0,
     solo_best     INTEGER NOT NULL DEFAULT 0,
     solo_level    INTEGER NOT NULL DEFAULT 0,
     solo_runs     INTEGER NOT NULL DEFAULT 0,
     created_at    INTEGER NOT NULL,
     last_seen     INTEGER NOT NULL
   );
   CREATE INDEX idx_users_rating ON users(rating DESC) WHERE matches > 0;
   CREATE INDEX idx_users_solo   ON users(solo_best DESC) WHERE solo_best > 0;

   CREATE TABLE sessions (
     token_hash TEXT    PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX idx_sessions_user ON sessions(user_id);

   CREATE TABLE matches (
     id          INTEGER PRIMARY KEY,
     played_at   INTEGER NOT NULL,
     quick       INTEGER NOT NULL,
     ranked      INTEGER NOT NULL,
     p1_user     INTEGER REFERENCES users(id) ON DELETE SET NULL,
     p2_user     INTEGER REFERENCES users(id) ON DELETE SET NULL,
     p1_name     TEXT    NOT NULL,
     p2_name     TEXT    NOT NULL,
     p1_score    INTEGER NOT NULL,
     p2_score    INTEGER NOT NULL,
     p1_delta    INTEGER NOT NULL DEFAULT 0,
     p2_delta    INTEGER NOT NULL DEFAULT 0,
     winner      INTEGER,             -- 0, 1 or NULL for a draw
     reason      TEXT    NOT NULL,    -- fall | finished | forfeit
     level       INTEGER NOT NULL
   );
   CREATE INDEX idx_matches_p1 ON matches(p1_user, played_at DESC);
   CREATE INDEX idx_matches_p2 ON matches(p2_user, played_at DESC);

   CREATE TABLE solo_runs (
     id        INTEGER PRIMARY KEY,
     user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     score     INTEGER NOT NULL,
     level     INTEGER NOT NULL,
     played_at INTEGER NOT NULL
   );
   CREATE INDEX idx_solo_user ON solo_runs(user_id, score DESC);`,

  // v2: matches with 2 to 6 players. One row per player; old two-player rows are copied over.
  `CREATE TABLE match_players (
     match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
     seat     INTEGER NOT NULL,
     user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
     name     TEXT    NOT NULL,
     score    INTEGER NOT NULL,
     place    INTEGER NOT NULL,
     delta    INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (match_id, seat)
   );
   CREATE INDEX idx_mp_user ON match_players(user_id, match_id DESC);
   ALTER TABLE matches ADD COLUMN player_count INTEGER NOT NULL DEFAULT 2;
   INSERT INTO match_players (match_id, seat, user_id, name, score, place, delta)
     SELECT id, 0, p1_user, p1_name, p1_score, CASE WHEN winner IS NULL OR winner = 0 THEN 1 ELSE 2 END, p1_delta FROM matches;
   INSERT INTO match_players (match_id, seat, user_id, name, score, place, delta)
     SELECT id, 1, p2_user, p2_name, p2_score, CASE WHEN winner IS NULL OR winner = 1 THEN 1 ELSE 2 END, p2_delta FROM matches;`
];

class UserError extends Error { constructor(msg){ super(msg); this.userMessage = msg; } }

function normName(s){ return String(s || '').normalize('NFKC').trim(); }
function checkUsername(u){
  if (u.length < 3 || u.length > 16) throw new UserError('Username must be 3 to 16 characters.');
  if (!/^[\p{L}\p{N}_]+$/u.test(u)) throw new UserError('Use only letters, numbers and _ in your username.');
  if (/^guest/i.test(u)) throw new UserError('That username is reserved. Please pick another.');
}
function checkPassword(p){
  if (typeof p !== 'string' || p.length < 6) throw new UserError('Password must be at least 6 characters.');
  if (p.length > 128) throw new UserError('Password is too long.');
}
const scrypt = (pw, salt) => new Promise((res, rej) =>
  crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => err ? rej(err) : res(key)));
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

function publicUser(r){
  if (!r) return null;
  return {
    id: r.id, username: r.username, gender: r.gender,
    rating: r.rating, peakRating: r.peak_rating,
    matches: r.matches, wins: r.wins, losses: r.losses, draws: r.draws, bestDuel: r.best_duel,
    soloBest: r.solo_best, soloLevel: r.solo_level, soloRuns: r.solo_runs,
    createdAt: r.created_at
  };
}
// Multi-player Elo: every player is compared with every other ranked player by finishing place.
// K is shared across the comparisons, so a 6-player match moves ratings about as much as a duel.
function eloDeltas(ratings, places){
  const n = ratings.length, k = ELO_K / Math.max(1, n - 1);
  return ratings.map((ra, i) => {
    let d = 0;
    for (let j = 0; j < n; j++){
      if (j === i) continue;
      const expected = 1 / (1 + Math.pow(10, (ratings[j] - ra) / 400));
      const actual = places[i] < places[j] ? 1 : places[i] === places[j] ? 0.5 : 0;
      d += k * (actual - expected);
    }
    return Math.round(d);
  });
}

class Store {
  constructor(db){
    this.db = db;
    const q = sql => db.prepare(sql);
    this.s = {
      userById:      q('SELECT * FROM users WHERE id = ?'),
      userByName:    q('SELECT * FROM users WHERE username_lc = ?'),
      insertUser:    q(`INSERT INTO users (username, username_lc, pass_hash, pass_salt, gender, created_at, last_seen)
                        VALUES (?, ?, ?, ?, ?, ?, ?)`),
      touchUser:     q('UPDATE users SET last_seen = ? WHERE id = ?'),
      setGender:     q('UPDATE users SET gender = ? WHERE id = ?'),
      insertSession: q('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
      session:       q('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?'),
      deleteSession: q('DELETE FROM sessions WHERE token_hash = ?'),
      purgeSessions: q('DELETE FROM sessions WHERE expires_at < ?'),
      insertMatch:   q(`INSERT INTO matches (played_at, quick, ranked, p1_user, p2_user, p1_name, p2_name, p1_score, p2_score,
                                             p1_delta, p2_delta, winner, reason, level, player_count)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
      insertSeat:    q(`INSERT INTO match_players (match_id, seat, user_id, name, score, place, delta) VALUES (?, ?, ?, ?, ?, ?, ?)`),
      applyResult:   q(`UPDATE users SET matches = matches + 1, wins = wins + ?, losses = losses + ?, draws = draws + ?,
                          rating = MAX(100, rating + ?), peak_rating = MAX(peak_rating, MAX(100, rating + ?)),
                          best_duel = MAX(best_duel, ?) WHERE id = ?`),
      insertSolo:    q('INSERT INTO solo_runs (user_id, score, level, played_at) VALUES (?, ?, ?, ?)'),
      applySolo:     q(`UPDATE users SET solo_runs = solo_runs + 1,
                          solo_level = CASE WHEN ? > solo_best THEN ? ELSE solo_level END,
                          solo_best  = MAX(solo_best, ?) WHERE id = ?`),
      topDuel:       q(`SELECT username, gender, rating, matches, wins, losses, draws FROM users
                        WHERE matches > 0 ORDER BY rating DESC, wins DESC, matches ASC LIMIT ?`),
      topSolo:       q(`SELECT username, gender, solo_best, solo_level FROM users
                        WHERE solo_best > 0 ORDER BY solo_best DESC, solo_level DESC LIMIT ?`),
      rankDuel:      q('SELECT COUNT(*) + 1 AS r FROM users WHERE matches > 0 AND rating > ?'),
      rankSolo:      q('SELECT COUNT(*) + 1 AS r FROM users WHERE solo_best > ?'),
      counts:        q(`SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM matches) AS matches,
                               (SELECT COUNT(*) FROM users WHERE matches > 0) AS duelists`),
      recent:        q(`SELECT m.played_at, m.ranked, m.reason, m.player_count, mp.place, mp.score, mp.delta
                        FROM match_players mp JOIN matches m ON m.id = mp.match_id
                        WHERE mp.user_id = ? ORDER BY m.played_at DESC LIMIT ?`)
    };
    this.purge();
    setInterval(() => this.purge(), 6 * 3600 * 1000).unref();
  }
  tx(fn){
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e){ try { this.db.exec('ROLLBACK'); } catch (x){} throw e; }
  }
  purge(){ this.s.purgeSessions.run(Date.now()); }

  /* ---------- accounts ---------- */
  async register(username, password, gender){
    const u = normName(username);
    checkUsername(u);
    checkPassword(password);
    const lc = u.toLowerCase();
    if (this.s.userByName.get(lc)) throw new UserError('That username is already taken.');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt)).toString('hex');
    const now = Date.now();
    try {
      const r = this.s.insertUser.run(u, lc, hash, salt, gender === 'woman' ? 'woman' : 'man', now, now);
      return publicUser(this.s.userById.get(Number(r.lastInsertRowid)));
    } catch (e){
      if (/UNIQUE/.test(e.message)) throw new UserError('That username is already taken.');
      throw e;
    }
  }
  async login(username, password){
    const row = this.s.userByName.get(normName(username).toLowerCase());
    // hash anyway so a missing user takes as long as a wrong password
    const salt = row ? row.pass_salt : 'x'.repeat(32);
    const key = await scrypt(String(password || ''), salt);
    if (!row) return null;
    const stored = Buffer.from(row.pass_hash, 'hex');
    if (stored.length !== key.length || !crypto.timingSafeEqual(stored, key)) return null;
    this.s.touchUser.run(Date.now(), row.id);
    return publicUser(row);
  }
  createSession(userId){
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    this.s.insertSession.run(sha256(token), userId, now, now + SESSION_DAYS * 864e5);
    return token;
  }
  userBySession(token){
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const s = this.s.session.get(sha256(token));
    if (!s || s.expires_at < Date.now()) return null;
    return publicUser(this.s.userById.get(s.user_id));
  }
  deleteSession(token){ if (typeof token === 'string') this.s.deleteSession.run(sha256(token)); }
  user(id){ return publicUser(this.s.userById.get(id)); }
  setGender(id, g){ this.s.setGender.run(g === 'woman' ? 'woman' : 'man', id); }

  /* ---------- duels and group matches ---------- */
  // seats: [{ userId|null, name, score, place }, ...]  (place 1 = best; equal places are ties)
  recordMatch({ seats, reason, level, quick }){
    const counts = new Map();
    seats.forEach(s => { if (s.userId) counts.set(s.userId, (counts.get(s.userId) || 0) + 1); });
    const rankedIdx = seats.map((s, i) => i).filter(i => seats[i].userId && counts.get(seats[i].userId) === 1);
    const ranked = rankedIdx.length >= 2;
    const firsts = seats.filter(s => s.place === 1).length;
    return this.tx(() => {
      const deltas = seats.map(() => 0), ratings = seats.map(() => null);
      if (ranked){
        const before = rankedIdx.map(i => this.s.userById.get(seats[i].userId).rating);
        const d = eloDeltas(before, rankedIdx.map(i => seats[i].place));
        rankedIdx.forEach((i, k) => { deltas[i] = d[k]; });
      }
      const winner = firsts === 1 ? seats.findIndex(s => s.place === 1) : null;
      const a = seats[0], b = seats[1] || { userId: null, name: '', score: 0 };
      const r = this.s.insertMatch.run(Date.now(), quick ? 1 : 0, ranked ? 1 : 0, a.userId || null, b.userId || null,
        a.name, b.name, a.score, b.score, deltas[0], deltas[1] || 0, winner, reason, level, seats.length);
      const matchId = Number(r.lastInsertRowid);
      seats.forEach((s, i) => this.s.insertSeat.run(matchId, i, s.userId || null, s.name, s.score, s.place, deltas[i]));
      if (ranked){
        rankedIdx.forEach(i => {
          const s = seats[i];
          const won = s.place === 1 && firsts === 1 ? 1 : 0, drew = s.place === 1 && firsts > 1 ? 1 : 0, lost = s.place > 1 ? 1 : 0;
          this.s.applyResult.run(won, lost, drew, deltas[i], deltas[i], s.score, s.userId);
          ratings[i] = this.s.userById.get(s.userId).rating;
        });
      }
      return { ranked, deltas, ratings };
    });
  }
  recentMatches(userId, limit = 5){
    return this.s.recent.all(userId, limit).map(m => ({
      at: m.played_at, players: m.player_count, place: m.place, score: m.score, delta: m.delta, ranked: !!m.ranked, reason: m.reason
    }));
  }

  /* ---------- solo ---------- */
  recordSolo(userId, score, level){
    return this.tx(() => {
      const before = this.s.userById.get(userId).solo_best;
      this.s.insertSolo.run(userId, score, level, Date.now());
      this.s.applySolo.run(score, level, score, userId);
      const u = this.s.userById.get(userId);
      return { newBest: score > before, soloBest: u.solo_best, rank: this.rank(userId, 'solo') };
    });
  }

  /* ---------- leaderboards ---------- */
  leaderboard(type, limit = 50){
    if (type === 'solo'){
      return this.s.topSolo.all(limit).map((r, i) => ({ rank: i + 1, username: r.username, gender: r.gender, score: r.solo_best, level: r.solo_level }));
    }
    return this.s.topDuel.all(limit).map((r, i) => ({ rank: i + 1, username: r.username, gender: r.gender, rating: r.rating,
      matches: r.matches, wins: r.wins, losses: r.losses, draws: r.draws }));
  }
  rank(userId, type){
    const u = this.s.userById.get(userId);
    if (!u) return null;
    if (type === 'solo') return u.solo_best > 0 ? this.s.rankSolo.get(u.solo_best).r : null;
    return u.matches > 0 ? this.s.rankDuel.get(u.rating).r : null;
  }
  stats(){ return this.s.counts.get(); }
}

function open(file){
  if (!DatabaseSync) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version; v < MIGRATIONS.length; v++){
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec('COMMIT'); }
    catch (e){ db.exec('ROLLBACK'); throw e; }
  }
  return new Store(db);
}

module.exports = { open, available: () => !!DatabaseSync, UserError };
