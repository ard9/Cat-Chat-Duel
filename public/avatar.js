/* =========================================================
   Save the Cat — avatars (shared by the pages and the server)
   An avatar is { g: 'man' | 'woman', skin, hat, hair } where the last three
   are indexes into the palettes below. The SVG art reads the colours from
   CSS variables, so one drawing serves every combination.
   ========================================================= */
(function (root, factory){
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.STCAvatar = api;
})(typeof self !== 'undefined' ? self : this, function (){
  'use strict';
  const SKIN = [   // [face, neck shade]
    ['#F6CBA7', '#E6B18B'], ['#E3AE83', '#CF966B'], ['#C48A60', '#AD754D'], ['#94603F', '#7E4F33'], ['#6B4430', '#5A3726']
  ];
  const HAT = [    // [dome, brim]
    ['#FFD23F', '#F2B705'], ['#FF8A2B', '#E36F17'], ['#4FA3FF', '#2F83E0'], ['#F2545B', '#D23A42'], ['#3FBF6A', '#2E9E54'], ['#A77BFF', '#8A5CE6']
  ];
  const HAIR = ['#4A2F1E', '#7A4128', '#1F1A17', '#D9A441', '#B5532B', '#8C8C96'];
  const NAMES = {
    skin: ['Light', 'Fair', 'Tan', 'Brown', 'Deep'],
    hat: ['Yellow', 'Orange', 'Blue', 'Red', 'Green', 'Purple'],
    hair: ['Dark brown', 'Brown', 'Black', 'Blonde', 'Red', 'Grey']
  };
  const DEFAULT = { g: 'man', skin: 0, hat: 0, hair: 0 };
  const idx = (v, n, d) => Number.isInteger(v) && v >= 0 && v < n ? v : d;
  function normalize(a, gender){
    let o = a;
    if (typeof o === 'string'){ try { o = JSON.parse(o); } catch (e){ o = null; } }
    if (!o || typeof o !== 'object') o = {};
    return {
      g: o.g === 'woman' || o.g === 'man' ? o.g : (gender === 'woman' ? 'woman' : 'man'),
      skin: idx(o.skin, SKIN.length, 0),
      hat: idx(o.hat, HAT.length, 0),
      hair: idx(o.hair, HAIR.length, o.g === 'woman' || gender === 'woman' ? 1 : 0)
    };
  }
  // CSS custom properties understood by the worker drawings (they flow into <use> copies)
  function style(a){
    const v = normalize(a);
    return `--skin:${SKIN[v.skin][0]};--skin-shade:${SKIN[v.skin][1]};--hat:${HAT[v.hat][0]};--hat-dark:${HAT[v.hat][1]};--hair:${HAIR[v.hair]}`;
  }
  function apply(el, a){
    if (!el) return;
    const v = normalize(a);
    el.style.setProperty('--skin', SKIN[v.skin][0]); el.style.setProperty('--skin-shade', SKIN[v.skin][1]);
    el.style.setProperty('--hat', HAT[v.hat][0]); el.style.setProperty('--hat-dark', HAT[v.hat][1]);
    el.style.setProperty('--hair', HAIR[v.hair]);
  }
  // A small portrait (upper body) for lists, lobby seats and the account box
  function portrait(a, cls){
    const v = normalize(a);
    return `<svg class="${cls || 'avatar'}" viewBox="-40 -178 72 60" aria-hidden="true" style="${style(v)}"><use href="#portrait-${v.g}"/></svg>`;
  }
  return { SKIN, HAT, HAIR, NAMES, DEFAULT, normalize, style, apply, portrait };
});
