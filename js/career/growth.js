/* ============================================================
   career/growth.js — 시즌 성장 · 노화 · 레전드/슬럼프 · 훈련 효과 (CLAUDE.md 26-6·26-8)
   대분류 변화 = 기본값 × 나이 G × 출전 P × 평점 Q × 수준 둔화 L × 코치진 C × 경기 수준 S (+ 레전드) + 노화 D
   ============================================================ */
import { CATS, GROWTH, LEGEND, SHOP, ageCoef, agingOf, levelCoef, playCoef, rateCoef, stageCoef } from "./rules.js";
import { applyGrowth, catValues, posOvr } from "./attrs.js";

/* 출전 비율 = (선발 1 + 교체 0.5 + 18세 이하 2군 0.5) ÷ 리그 경기 수 */
export function playRatio(mine) {
  return (mine.starts + mine.subs * 0.5 + mine.youth * GROWTH.youthBench) / (mine.games || 1);
}

/* 레전드 시즌 판정 (26-6): 25세+ · 1부 · 선발 75%+ · 같은 포지션 평점 상위 3 · 개인상 1+ · 소속팀 리그 우승
   (우승 조건: 실제 엔진에선 리그를 압도하는 선수가 평점·개인상 조건을 매 시즌 채움 → 경기 결과에 달린 우승으로 '보장되지 않게') */
export function isLegend({ age, tier, mine, champion }) {
  return age >= LEGEND.minAge && tier === 1 && mine.starts >= mine.games * LEGEND.startShare &&
    mine.posRank !== null && mine.posRank <= LEGEND.posRankTop && mine.awards.length > 0 && (!LEGEND.needTitle || !!champion);
}

/* 기록 가산 (세부 배분): 골·헤더·중거리·도움·무실점 */
export function recordBoost(mine, pos) {
  const b = {};
  const add = (k, v) => (b[k] = (b[k] || 0) + v);
  add("sht.fin", 0.03 * mine.goals); add("sht.pos", 0.03 * mine.goals);
  for (const k of mine.kinds) { if (k === "head") add("def.hea", 0.05); if (k === "long") add("sht.lsh", 0.05); if (k === "pen") add("sht.pen", 0.05); }
  if (pos === "WG" || pos === "FB") add("pas.crs", 0.03 * mine.assists);
  else { add("pas.spa", 0.03 * mine.assists); add("pas.vis", 0.03 * mine.assists); }
  add("def.mar", 0.02 * mine.cleanSheets); add("def.int", 0.02 * mine.cleanSheets);
  return b;
}

/* 시즌 성장 계산 + 적용 (player.subs를 직접 바꿈)
   ctx: { player, mine, clubR(뛴 구단 요구 OVR), coach(뛴 구단 코치진), focus[3], legend, ovrStart(소수), ovrShown(정수, 적응 페널티 반영) } */
export function applySeasonGrowth(ctx) {
  const { player, mine, clubR, coach, focus, legend } = ctx;
  const age = player.age;
  const before = catValues(player.subs);
  const ratio = playRatio(mine);
  const P = playCoef(ratio);
  const Q = mine.apps ? rateCoef(mine.avg) : 1;
  const L = legend ? 1 : levelCoef(ctx.ovrStart);
  const S = stageCoef(ctx.ovrShown - clubR);
  const G = ageCoef(age);
  const [df, du] = agingOf(age);
  const late = legend && age >= LEGEND.lateAge;
  const deltas = {};
  for (const c of CATS) {
    const f = focus.includes(c);
    let g = (f ? GROWTH.baseFocus : GROWTH.baseRest) * G * P * Q * L * S * (f && coach.includes(c) ? GROWTH.coach : 1);
    if (legend && f && !late) g += LEGEND.extra;
    deltas[c] = g + (f ? df : du) * (late ? LEGEND.lateDeclineScale : 1);
  }
  applyGrowth(player.subs, deltas, player.pos, recordBoost(mine, player.pos), GROWTH.spill);
  const after = catValues(player.subs);
  return { ratio, P, Q, L, S, G, efficiency: Math.round(P * S * 100), deltas, before, after };
}

/* 훈련 효과 (상점): 표시값 × 수준 둔화 L(현재 OVR) — 코치진·레전드 없음 */
export function applyTraining(player, kind, cat) {
  const amount = (kind === "special" ? SHOP.special : SHOP.normal) * levelCoef(posOvr(player.subs, player.pos));
  const d = {}; d[cat] = amount;
  applyGrowth(player.subs, d, player.pos, {}, GROWTH.spill);
  return amount;
}
/* 훈련 미리보기 (실제 능력치는 안 바꿈) */
export function previewTraining(player, kind, cat) {
  const copy = { ...player, subs: { ...player.subs } };
  const amount = applyTraining(copy, kind, cat);
  return { amount, subs: copy.subs };
}
