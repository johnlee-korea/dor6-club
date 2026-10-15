/* ============================================================
   career/attrs.js — 세부 29 ↔ 대분류 6 · 포지션 OVR · 시작 능력치 · 성장 배분 (CLAUDE.md 26-3·26-5·26-6)
   세부 능력치 저장 형식: { "sht.fin": 57.3, ... } (소수 2자리)
   ============================================================ */
import { CATS, SUBS, SUB_KEYS, W, KEY_SUBS, START, STAR_SHARE, clamp } from "./rules.js";

const r2 = (v) => Math.round(v * 100) / 100;
const subsOf = (cat) => SUBS[cat].map(([k]) => `${cat}.${k}`);

/* 대분류 값 = 소속 세부 균등 평균 */
export function catValue(subs, cat) {
  const ks = subsOf(cat);
  let s = 0;
  for (const k of ks) s += subs[k];
  return s / ks.length;
}
export function catValues(subs) {
  const out = {};
  for (const c of CATS) out[c] = catValue(subs, c);
  return out;
}

/* 포지션 강조 평균: 핵심 세부 ×2, 나머지 ×1 */
function emphasized(subs, cat, pos) {
  let s = 0, w = 0;
  for (const k of subsOf(cat)) {
    const e = KEY_SUBS[pos].includes(k) ? 2 : 1;
    s += subs[k] * e; w += e;
  }
  return s / w;
}

/* 포지션 OVR (소수) — 판정·표시는 Math.round */
export function posOvr(subs, pos, penalty = 0) {
  let s = 0;
  for (const c of CATS) if (W[pos][c]) s += W[pos][c] * emphasized(subs, c, pos);
  return s / 100 - penalty;
}
export const ovrInt = (subs, pos, penalty = 0) => Math.round(posOvr(subs, pos, penalty));

/* 대분류 값만 있을 때의 근사 OVR (미리보기용: 핵심 세부 강조 무시) */
export function ovrFromCats(cv, pos) {
  let s = 0;
  for (const c of CATS) s += W[pos][c] * cv[c];
  return s / 100;
}

export const comboShare = (pos, pair) => W[pos][pair[0]] + W[pos][pair[1]];
export const isStar = (pos, pair) => comboShare(pos, pair) >= STAR_SHARE;
/* 대분류를 포지션 가중치 큰 순서로 */
export const catsByWeight = (pos) => CATS.slice().sort((a, b) => W[pos][b] - W[pos][a] || CATS.indexOf(a) - CATS.indexOf(b));

/* 예상 시작 OVR (선택 화면용, 강점 58 · 비강점 46) */
export function predictedStartOvr(pos, pair) {
  const cv = {};
  for (const c of CATS) cv[c] = pair.includes(c) ? 58 : (START.total - 116) / 4;
  return ovrFromCats(cv, pos);
}

/* 시작 능력치 생성 (26-5) */
export function makeStart(pos, pair, rng) {
  const target = {};
  target[pair[0]] = rng.range(START.strongMin, START.strongMax);
  target[pair[1]] = rng.range(START.strongMin, START.strongMax);
  const weak = CATS.filter((c) => !pair.includes(c));
  let rest = START.total - target[pair[0]] - target[pair[1]];
  weak.forEach((c, i) => {
    const v = i < 3 ? Math.round(rest / (4 - i)) + rng.range(-1, 1) : rest;
    target[c] = v; rest -= v;
  });
  // 강점 ≤ 가장 낮은 비강점 × 1.3 이 될 때까지 강점 1을 가장 낮은 비강점으로 옮김 (합 300 유지)
  for (;;) {
    const hi = target[pair[0]] >= target[pair[1]] ? pair[0] : pair[1];
    const lo = weak.reduce((m, c) => (target[c] < target[m] ? c : m), weak[0]);
    if (target[hi] <= target[lo] * START.ratio) break;
    target[hi]--; target[lo]++;
  }
  const subs = {};
  for (const c of CATS) {
    const ks = subsOf(c);
    const raw = ks.map((k) => target[c] + rng.range(-START.subSpread, START.subSpread) + (KEY_SUBS[pos].includes(k) ? rng.range(1, 2) : 0));
    const mean = raw.reduce((s, v) => s + v, 0) / raw.length;
    ks.forEach((k, i) => (subs[k] = r2(clamp(raw[i] - mean + target[c], 1, 99))));
  }
  return subs;
}

/* 대분류 변화량 delta를 세부에 배분 (26-6)
   Δ_j = Δ × (0.5 + 0.5 × w_j / 평균 w), w_j = 강조(핵심 2·나머지 1) × 기록 가산(1 + boost)
   99를 넘는 분은 같은 대분류의 다른 세부로 → 그래도 남으면 반환(대분류 넘침 이월용) */
export function applyCatDelta(subs, cat, delta, pos, boost = {}) {
  const ks = subsOf(cat);
  const w = ks.map((k) => (KEY_SUBS[pos].includes(k) ? 2 : 1) * (1 + Math.min(0.6, boost[k] || 0)));
  const mw = w.reduce((s, v) => s + v, 0) / w.length;
  let over = 0;
  ks.forEach((k, i) => {
    const v = subs[k] + delta * (0.5 + 0.5 * w[i] / mw);
    if (v > 99) { over += v - 99; subs[k] = 99; }
    else subs[k] = r2(Math.max(1, v));
  });
  // 같은 대분류 안에서 99 미만 세부로 재분배
  for (let pass = 0; pass < 3 && over > 0.001; pass++) {
    const room = ks.filter((k) => subs[k] < 99);
    if (!room.length) break;
    const each = over / room.length;
    over = 0;
    for (const k of room) {
      const v = subs[k] + each;
      if (v > 99) { over += v - 99; subs[k] = 99; } else subs[k] = r2(v);
    }
  }
  return over > 0.001 ? over : 0;
}

/* 여러 대분류 변화를 한 번에 적용 + 대분류 넘침을 포지션 가중치 순서로 이월 (26-6) */
export function applyGrowth(subs, deltas, pos, boost = {}, spill = true) {
  let over = 0;
  for (const c of CATS) if (deltas[c]) over += applyCatDelta(subs, c, deltas[c], pos, boost);
  if (spill) {
    for (const c of catsByWeight(pos)) {
      if (over <= 0.001) break;
      if (!W[pos][c] || catValue(subs, c) >= 98.99) continue;
      const room = (99 - catValue(subs, c));
      const add = Math.min(room, over);
      over -= add;
      over += applyCatDelta(subs, c, add, pos, boost);
    }
  }
  return subs;
}

export { SUB_KEYS, subsOf };
