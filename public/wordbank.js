/* =========================================================
   Save the Cat — word bank (shared by the server and the solo game)
   - LEVELS: how hard each level is (edit here to tune difficulty)
   - build(): merges the built-in list (words.js) with custom words
   - createPicker(): hands out words for one match, never repeating one
   ========================================================= */
(function (root, factory){
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.STCWordBank = api;
})(typeof self !== 'undefined' ? self : this, function (){
  'use strict';

  const BASE_CHARS = 4;   // words up to this length get the level's base time

  /* Each level draws from two neighbouring difficulty tiers (1 = easiest, 10 = hardest).
     weights: chance of the easier / harder tier. perChar: extra seconds for each letter beyond BASE_CHARS.
     From level 7 on, multi-word phrases join in (phraseChance). */
  const LEVELS = [
    { time: 8,   perChar: 0.50, tiers: [1, 1],  weights: [0.5, 0.5],  phrases: [],                   phraseChance: 0,    note: 'Warm up those fingers.' },
    { time: 7,   perChar: 0.45, tiers: [1, 2],  weights: [0.4, 0.6],  phrases: [],                   phraseChance: 0,    note: 'The branches are creaking faster.' },
    { time: 6,   perChar: 0.42, tiers: [2, 3],  weights: [0.35, 0.65], phrases: [],                  phraseChance: 0,    note: 'Longer words are coming.' },
    { time: 5.5, perChar: 0.38, tiers: [3, 4],  weights: [0.35, 0.65], phrases: [],                  phraseChance: 0,    note: 'Every word is a bit bigger now.' },
    { time: 5,   perChar: 0.35, tiers: [4, 5],  weights: [0.35, 0.65], phrases: [],                  phraseChance: 0,    note: 'The wind is picking up.' },
    { time: 4.5, perChar: 0.32, tiers: [5, 6],  weights: [0.35, 0.65], phrases: [],                  phraseChance: 0,    note: 'Keep your eyes on the letters.' },
    { time: 4,   perChar: 0.30, tiers: [6, 7],  weights: [0.35, 0.65], phrases: ['short'],           phraseChance: 0.25, note: 'Phrases join in. Spaces count.' },
    { time: 3.5, perChar: 0.27, tiers: [7, 8],  weights: [0.35, 0.65], phrases: ['short', 'medium'], phraseChance: 0.3,  note: 'Nerves of steel now.' },
    { time: 3,   perChar: 0.24, tiers: [8, 9],  weights: [0.35, 0.65], phrases: ['medium'],          phraseChance: 0.35, note: 'Long words and longer phrases.' },
    { time: 2.5, perChar: 0.22, tiers: [9, 10], weights: [0.35, 0.65], phrases: ['medium', 'long'],   phraseChance: 0.4,  note: 'Final level. Fastest fingers win!' }
  ];

  const round1 = x => Math.round(x * 10) / 10;
  function durationFor(level, word){
    const L = LEVELS[Math.min(LEVELS.length, Math.max(1, level)) - 1];
    return round1(L.time + Math.max(0, word.length - BASE_CHARS) * L.perChar);
  }
  // Highest score a word can give (used by the server to reject impossible solo scores)
  function maxWordTime(level){ return durationFor(level, 'X'.repeat(24)); }

  /* ---------- custom words ---------- */
  const clean = s => String(s || '').toUpperCase().replace(/[\t ]+/g, ' ').trim();
  const VALID = /^[A-Z]+( [A-Z]+)*$/;
  function parseCustom(text){
    const out = [], seen = new Set();
    String(text || '').split(/\r?\n/).forEach(line => {
      const w = clean(line.replace(/#.*/, ''));
      if (!w || w.length < 2 || w.length > 24 || !VALID.test(w) || seen.has(w)) return;
      seen.add(w); out.push(w);
    });
    return out;
  }
  const HARD = { Q: 1.2, Z: 1.1, X: 1.0, J: 1.0, K: .35, V: .35, W: .3, Y: .3 };
  // Custom words have no frequency data, so grade them by length, awkward letters and double letters,
  // then put them in the built-in tier whose words are most similar in length.
  function gradeWord(word, avgLens){
    const doubles = [...word].filter((c, i) => c === word[i + 1]).length;
    const hard = [...word].reduce((s, c) => s + (HARD[c] || 0), 0);
    const eff = word.length + 0.5 * hard + 0.3 * doubles;
    let best = 0;
    avgLens.forEach((a, i) => { if (Math.abs(a - eff) < Math.abs(avgLens[best] - eff)) best = i; });
    return best;   // 0-based tier
  }
  const phraseSize = p => p.length <= 12 ? 'short' : p.length <= 18 ? 'medium' : 'long';

  /* ---------- build the bank ---------- */
  // mode 'mix': custom words join the built-in list. 'only': use nothing but custom words.
  function build(base, custom = [], mode = 'mix'){
    const tiers = base.tiers.map(t => t.slice());
    const avgLens = tiers.map(t => t.reduce((s, w) => s + w.length, 0) / Math.max(1, t.length));
    const phrases = { short: [], medium: [], long: [] };
    if (mode !== 'only' || !custom.length){
      Object.keys(phrases).forEach(k => { phrases[k] = (base.phrases[k] || []).slice(); });
    } else {
      tiers.forEach(t => { t.length = 0; });
    }
    custom.forEach(w => {
      if (w.includes(' ')) phrases[phraseSize(w)].push(w);
      else tiers[gradeWord(w, avgLens)].push(w);
    });
    tiers.forEach(t => { const u = [...new Set(t)]; t.length = 0; t.push(...u); });
    return { tiers, phrases, mode: custom.length ? mode : 'mix', customCount: custom.length,
             size: tiers.reduce((s, t) => s + t.length, 0) + Object.values(phrases).reduce((s, p) => s + p.length, 0) };
  }

  /* ---------- pick words for one match: never the same word twice ---------- */
  function createPicker(bank, rng = Math.random){
    const used = new Set();
    let last = null;
    const pickFrom = (list, allowReset) => {
      let fresh = list.filter(w => !used.has(w) && w !== last);
      if (!fresh.length && allowReset){         // the whole pool was used: allow repeats again (but not twice in a row)
        list.forEach(w => used.delete(w));
        fresh = list.filter(w => w !== last);
      }
      if (!fresh.length) return null;
      const w = fresh[Math.floor(rng() * fresh.length)];
      used.add(w); last = w;
      return w;
    };
    // nearest non-empty tier, searching outward from the wanted one (matters when only a few custom words exist)
    const tierList = t => {
      for (let d = 0; d < bank.tiers.length; d++){
        for (const k of [t - d, t + d]){
          if (k >= 0 && k < bank.tiers.length && bank.tiers[k].length) return bank.tiers[k];
        }
      }
      return [];
    };
    const allWords = bank.tiers.flat();
    const allPhrases = Object.values(bank.phrases).flat();
    return {
      next(level){
        const L = LEVELS[Math.min(LEVELS.length, Math.max(1, level)) - 1];
        const phraseList = L.phrases.flatMap(k => bank.phrases[k] || []);
        if (phraseList.length && rng() < L.phraseChance){
          const p = pickFrom(phraseList, bank.mode === 'only');
          if (p) return p;
        }
        const tier = (rng() < L.weights[0] ? L.tiers[0] : L.tiers[1]) - 1;
        // small custom lists run dry quickly: widen to every word, then every phrase, before giving up
        return pickFrom(tierList(tier)) || pickFrom(allWords) || pickFrom(allPhrases)
            || pickFrom(allWords, true) || pickFrom(allPhrases, true) || last || 'CAT';
      }
    };
  }

  return { LEVELS, BASE_CHARS, durationFor, maxWordTime, parseCustom, gradeWord, build, createPicker };
});
