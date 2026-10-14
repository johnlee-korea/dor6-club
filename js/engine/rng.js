/* ============================================================
   rng.js — 결정론 난수·수학 (경기 엔진 공용, 브라우저/Node/Worker 공용 ES 모듈)

   ★ 핵심 규칙: 같은 시드 → 어느 기기에서든 100% 같은 결과
     - Math.random 금지 (시드 없음)
     - Math.exp·log·pow·sin 등 초월함수 금지
       → 브라우저 엔진(크롬 V8 / 아이폰·카톡 WebKit / Node)마다 마지막 자리가 다를 수 있음
     - 사칙연산(+ − × ÷)·비교·Math.floor/round/imul/min/max/abs만 사용
       (IEEE 754 사칙연산은 어디서나 같은 값을 보장)
   ============================================================ */

/* 문자열 → 32비트 시드 (xmur3 해시) */
export function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/* mulberry32 PRNG — 0 이상 1 미만 실수를 차례로 돌려줌 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 편의 도구 묶음: makeRng("시드 문자열") */
export function makeRng(seedStr) {
  const next = mulberry32(hashSeed(String(seedStr)));
  const rng = {
    next,
    /* 0 ~ n-1 정수 */
    int: (n) => Math.floor(next() * n),
    /* lo ~ hi 정수 (양끝 포함) */
    range: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    /* 확률 p로 true */
    chance: (p) => next() < p,
    /* 가중치 배열 → 뽑힌 인덱스 (가중치 합 0이면 -1) */
    weighted(weights) {
      let sum = 0;
      for (const w of weights) sum += w;
      if (sum <= 0) return -1;
      let r = next() * sum;
      for (let i = 0; i < weights.length; i++) {
        r -= weights[i];
        if (r < 0) return i;
      }
      return weights.length - 1;
    },
    /* 배열 섞기 (Fisher–Yates, 원본 유지) */
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }
  };
  return rng;
}

/* e^(-x) — 사칙연산만으로 계산 (초월함수 금지 규칙 때문에 직접 구현)
   x를 16등분(y = x/16, 작아서 급수가 빨리 수렴) → 테일러 급수 → 16제곱(4번 제곱) */
export function expNeg(x) {
  const y = x / 16;
  let term = 1, sum = 1;
  for (let k = 1; k <= 18; k++) {
    term = term * y / k;
    sum += term;
  }
  let e = 1 / sum;              // e^(-y)
  e = e * e; e = e * e; e = e * e; e = e * e;  // ^16
  return e;
}

/* 포아송 난수 (크누스 방식): 균일 난수를 곱해 e^-λ 아래로 떨어질 때까지 센다 */
export function poisson(rng, lambda, max = 9) {
  const limit = expNeg(lambda);
  let k = 0, p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > limit && k <= max);
  return k - 1;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
