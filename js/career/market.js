/* ============================================================
   career/market.js — 입단·영입 제안 · 임대 · 포지션 전환 · 연봉 · 상점 (CLAUDE.md 26-7-5·26-8)
   ============================================================ */
import { makeRng } from "../engine/rng.js";
import { MARKET, GROWTH, ADJACENT, MAX_CONVERSIONS, CONVERT_PENALTY, ROLE, CATS, W,
         entryMargin, salaryOf, shopPrice, stageCoef, playCoef, clamp } from "./rules.js";
import { aiSquad, roleFor, roleScore } from "./squad.js";
import { leagueOf } from "./world.js";
import { posOvr, catValues } from "./attrs.js";
import { prefMatch, reevaluateType, typeEffects } from "./types.js";

/* 예상 출전 비율 (카드 미리보기) */
export function expectedRatio(role, age, short) {
  const [ps0, psub] = ROLE.prob[role];
  const ps = Math.min(ROLE.maxStart, ps0 + (short ? ROLE.shortageBonus : 0));
  const sub = (1 - ps) * psub, bench = (1 - ps) * (1 - psub);
  return ps + sub * 0.5 + (age <= GROWTH.youthAge ? bench * GROWTH.youthBench : 0);
}

/* 구단 카드 정보: 예상 역할·연봉·보너스·예상 성장 효율 (P × S × 코치진 평균) */
export function clubCard(state, clubId, opts = {}) {
  const { world, seed, player } = state;
  const c = world.clubs[clubId];
  const age = opts.age ?? player.age;
  const ovr = opts.ovr ?? Math.round(posOvr(player.subs, player.pos, opts.penalty ?? 0));
  const pm = prefMatch(player.pos, player.typeKey, c.pref);
  const trust = opts.trust ?? 0;
  const squad = aiSquad(world, clubId, seed);
  const role = roleFor(squad, player.pos, roleScore(ovr, pm, trust));
  const short = c.short.includes(player.pos);
  const ratio = expectedRatio(role, age, short);
  // 코치진: 포지션 가중치 상위 3 대분류 중 특화가 몇 개인지
  const top3 = CATS.slice().sort((a, b) => W[player.pos][b] - W[player.pos][a]).slice(0, 3);
  const coachHit = top3.filter((k) => c.coach.includes(k));
  const eff = playCoef(ratio) * stageCoef(ovr - c.R);
  // 예상 선발 경기 수 (카드 표시: 출전 빈도 비교용)
  const games = 2 * (Object.values(world.clubs).filter((x) => x.league === c.league).length - 1);
  const ps = Math.min(ROLE.maxStart, ROLE.prob[role][0] + (short ? ROLE.shortageBonus : 0));
  return {
    games, expStarts: Math.round(ps * games), prefPos: c.pref ? c.pref.split(":")[0] : null,
    clubId, league: c.league, tier: leagueOf(c.league).tier, country: leagueOf(c.league).country, R: c.R, role, short,
    pref: c.pref, prefMatch: pm, coach: c.coach, coachHit, salary: salaryOf(c.R, role, age),
    efficiency: Math.round(eff * 100), stage: stageCoef(ovr - c.R)
  };
}

/* 시작 구단 선택지 (16세): 요구 OVR ≤ OVR + 3 + 7 */
export function startOptions(state) {
  const ovr = Math.round(posOvr(state.player.subs, state.player.pos));
  const lim = ovr + entryMargin(state.player.age);
  return Object.keys(state.world.clubs).sort().filter((id) => state.world.clubs[id].R <= lim).map((id) => clubCard(state, id));
}
export const entryLimit = (ovr, age) => ovr + entryMargin(age);

/* 영입 제안 (최대 5): 도전 1 · 주전 예상 2(R 상위 6에서) · 무작위 2 — 가중치: 부족 포지션 ×2 · 선호 유형 ×1.5 · 다른 나라 ×1.2
   last: 직전 시즌 요약(같은 포지션 상위 10% → +1 · 슬럼프 → −1~2) */
export function makeOffers(state, last) {
  const { world, seed, player } = state;
  const ovr = Math.round(posOvr(player.subs, player.pos, player.penaltySeason === world.season ? CONVERT_PENALTY : 0));
  const lim = ovr + entryMargin(player.age);
  const rng = makeRng(`${seed}|S${world.season}|offers`);
  const home = player.clubId;
  const myCountry = leagueOf(world.clubs[home].league).country;
  const pool = Object.keys(world.clubs).sort().filter((id) => id !== home && world.clubs[id].R <= lim).map((id) => clubCard(state, id, { ovr }));
  const weight = (c) => (c.short ? 2 : 1) * (c.prefMatch === "full" ? 1.5 : 1) * (c.country !== myCountry ? 1.2 : 1);
  const pickW = (list, k) => {
    const out = [], rest = list.slice();
    for (let i = 0; i < k && rest.length; i++) { const j = rng.weighted(rest.map(weight)); out.push(rest.splice(j, 1)[0]); }
    return out;
  };
  let count = MARKET.maxOffers;
  if (last && last.posRank && last.posCount && last.posRank <= Math.max(1, Math.ceil(last.posCount * 0.1))) count++;
  if (last && last.slump) count -= 1 + rng.int(2);
  // v2.13.3 (사용자 요청 "선택지 모두 내 포지션을 원하는 구단, 차이는 유형·출전 빈도"):
  //   ① 내 포지션이 부족하거나 감독이 내 포지션 유형을 선호하는 구단만 후보 (모자라면 다른 구단을 '그 포지션 보강' 구단으로)
  //   ② 출전 빈도가 고르게: 주전 예상(요구 OVR 상위 = 시장 가치) · 로테이션 · 후보(도전) 각 1 이상
  //   ③ 감독 선호 유형 일치 구단이 있으면 1개 이상 포함
  const wants = (c) => c.short || c.prefPos === player.pos;
  let base = pool.filter(wants);
  if (base.length < count + 2) base = base.concat(rng.shuffle(pool.filter((c) => !wants(c))).slice(0, count + 2 - base.length));
  const chosen = [];
  const has = (c) => chosen.some((x) => x.clubId === c.clubId);
  const push = (arr) => { for (const c of arr) if (!has(c) && chosen.length < count) chosen.push(c); };
  const starters = base.filter((c) => c.role === "S" && c.R >= ovr - MARKET.starterRange).sort((a, b) => b.R - a.R || (a.clubId < b.clubId ? -1 : 1)).slice(0, MARKET.starterPool);
  push(pickW(starters, 2));
  push(pickW(base.filter((c) => c.role === "R" && !has(c)), 1));
  push(pickW(base.filter((c) => c.role === "B" && !has(c)), 1));
  if (!chosen.some((c) => c.prefMatch)) push(pickW(base.filter((c) => c.prefMatch && !has(c)), 1));
  push(pickW(base.filter((c) => !has(c)), Math.max(0, count - chosen.length)));
  // 제안한 구단 = 내 포지션을 보강하려는 구단 → 이번 시즌 부족 포지션에 내 포지션 추가 (카드·출전 보너스 일관)
  const out = chosen.slice(0, Math.max(0, count)).map((c) => {
    const w = world.clubs[c.clubId];
    if (!w.short.includes(player.pos)) w.short = w.short.concat(player.pos);
    return clubCard(state, c.clubId, { ovr });
  });
  const rank = { S: 0, R: 1, B: 2 };
  return out.sort((a, b) => rank[a.role] - rank[b.role] || b.efficiency - a.efficiency || b.salary - a.salary);
}

/* 임대 후보: 24세 이하 + 후보일 때, R이 더 낮고 예상 역할 주전·로테이션 구단 2~3개 */
export function loanOptions(state, currentRole) {
  const { world, seed, player } = state;
  if (player.age > MARKET.loanMaxAge || currentRole !== "B") return [];
  const myR = world.clubs[player.clubId].R;
  const rng = makeRng(`${seed}|S${world.season}|loan`);
  const pool = Object.keys(world.clubs).sort().filter((id) => id !== player.clubId && world.clubs[id].R < myR)
    .map((id) => clubCard(state, id)).filter((c) => c.role !== "B");
  pool.sort((a, b) => b.efficiency - a.efficiency || b.R - a.R);
  return rng.shuffle(pool.slice(0, 8)).slice(0, MARKET.loanCount).sort((a, b) => b.efficiency - a.efficiency);
}

/* 포지션 전환 미리보기 */
export function conversionOptions(player) {
  if ((player.conversions || 0) >= MAX_CONVERSIONS) return [];
  return ADJACENT[player.pos].map((pos) => {
    const cv = catValues(player.subs);
    const key = reevaluateType(player.typeKey, cv);
    return { pos, typeKey: key, ovr: Math.round(posOvr(player.subs, pos)) - CONVERT_PENALTY, ovrAfter: Math.round(posOvr(player.subs, pos)), fx: typeEffects(pos, key) };
  });
}

export { shopPrice, salaryOf, clamp };
