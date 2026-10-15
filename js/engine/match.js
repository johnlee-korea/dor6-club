/* ============================================================
   match.js — 한 경기 시뮬레이션 (가벼운 버전)
   흐름: 공격력·수비력 → 기대 득점(λ) → 포아송으로 골 수 → 득점자·도움·시각 추첨 → 평점
   seedStr이 같으면 결과가 항상 같다 (rng.js 규칙 준수: 초월함수·Math.random 금지)
   ============================================================ */
import { makeRng, poisson, clamp } from "./rng.js";

/* 선택값 (커리어 시뮬레이터, CLAUDE.md 26-11) — 없으면 기존과 결과·난수 순서 동일
   선수 sw·aw: 득점·도움 가중 배율 · 선수 rb: 평점 보정(×10 정수) · 팀 subs: [{ min, in, out }] 교체 */

/* 밸런스 계수 — 바꾸면 결과가 달라지므로 ENGINE_VERSION(index.js)을 올릴 것 */
export const TUNE = {
  base: 1.32,        // 실력이 같을 때 한 팀 기대 득점
  k: 0.045,          // (내 공격 − 상대 수비) 1점당 기대 득점 변화율
  gap: -1.2,         // 공격력·수비력 척도 차이 보정 (실측 평균 공격 72.5 · 수비 73.7 → 평균 팀끼리 차이 0)
  home: 0.15,        // 홈 어드밴티지 (골)
  minL: 0.3, maxL: 3.5,
  assistRate: 0.85   // 골에 도움이 붙을 확률
};

/* 득점자·도움 가중 — 세부 포지션만으로 결정 (v2, 사용자 결정: 능력치·강화 미반영, "골키퍼가 득점왕 안 나오게")
   스트라이커 > 세컨톱·윙어 > 공격형 미드 > 측면 미드 > 중앙 미드 > 수비형·윙백 > 풀백 > 센터백 > 골키퍼(0) */
export const SCORE_W = {
  ST: 8, RS: 8, LS: 8, CF: 8, RF: 7, LF: 7, RW: 6, LW: 6,
  CAM: 5, RAM: 5, LAM: 5, RM: 3.5, LM: 3.5, CM: 2, RCM: 2, LCM: 2,
  CDM: 1, RDM: 1, LDM: 1, RWB: 1, LWB: 1, RB: 0.7, LB: 0.7, CB: 0.5, RCB: 0.5, LCB: 0.5, SW: 0.5, GK: 0
};
export const ASSIST_W = {
  CAM: 6, RAM: 6, LAM: 6, RW: 5.5, LW: 5.5, RM: 5, LM: 5, RF: 5, LF: 5,
  CM: 4, RCM: 4, LCM: 4, ST: 3.5, RS: 3.5, LS: 3.5, CF: 3.5, RWB: 3.5, LWB: 3.5, RB: 3, LB: 3,
  CDM: 2.5, RDM: 2.5, LDM: 2.5, CB: 1, RCB: 1, LCB: 1, SW: 1, GK: 0.3
};

export function expectedGoals(att, def, isHome) {
  const l = TUNE.base * (1 + TUNE.k * (att - def - TUNE.gap)) + (isHome ? TUNE.home : 0);
  return clamp(l, TUNE.minL, TUNE.maxL);
}

/* home·away: buildTeam 결과. 반환:
   { hg, ag, ev: [{ min, add, side: "h"|"a", s: 득점자 idx, as: 도움 idx|null }], rt: { h: [[idx, 평점×10]…], a: […] } } */
export function simulateMatch(home, away, seedStr) {
  const rng = makeRng(seedStr);
  const hg = poisson(rng, expectedGoals(home.att, away.def, true));
  const ag = poisson(rng, expectedGoals(away.att, home.def, false));

  const ev = [];
  const goalsBy = { h: {}, a: {} }, assistsBy = { h: {}, a: {} };
  const addGoals = (side, team, n) => {
    const withSubs = Array.isArray(team.subs) && team.subs.length > 0;
    for (let g = 0; g < n; g++) {
      // 교체가 있는 팀(커리어 선택값)은 시각을 먼저 뽑아 그 시각 경기장에 있던 선수 중에서 추첨
      // 교체가 없으면 기존 순서(득점자 → 도움 → 시각) 그대로 → 도륙리그 결과 불변
      const min0 = withSubs ? 1 + rng.int(90) : 0;
      const st = withSubs ? onPitch(team, min0) : team.starters.map((i) => team.players[i]);
      const s = st[rng.weighted(st.map((p) => (SCORE_W[p.role] || 0) * (p.sw ?? 1)))].idx;
      let as = null;
      if (rng.chance(TUNE.assistRate)) {
        const pool = st.filter((p) => p.idx !== s);
        as = pool[rng.weighted(pool.map((p) => (ASSIST_W[p.role] || 0) * (p.aw ?? 1)))].idx;
      }
      // 시각: 1~90분, 90분 골은 추가시간(90+1~4)일 수 있음
      const min = withSubs ? min0 : 1 + rng.int(90);
      const add = min === 90 && rng.chance(0.6) ? 1 + rng.int(4) : 0;
      ev.push({ min, add, side, s, as, o: ev.length });
      goalsBy[side][s] = (goalsBy[side][s] || 0) + 1;
      if (as !== null) assistsBy[side][as] = (assistsBy[side][as] || 0) + 1;
    }
  };
  addGoals("h", home, hg);
  addGoals("a", away, ag);
  ev.sort((x, y) => x.min - y.min || x.add - y.add || x.o - y.o);
  ev.forEach((e) => delete e.o);

  const rt = {
    h: rateTeam(rng, home, goalsBy.h, assistsBy.h, hg, ag),
    a: rateTeam(rng, away, goalsBy.a, assistsBy.a, ag, hg)
  };
  return { hg, ag, ev, rt };
}

/* 평점 (×10 정수로 계산 → 반올림 오차 없음): 6.0 기준, 3.0~10.0 */
function rateTeam(rng, team, goals, assists, gf, ga) {
  const res = gf > ga ? 3 : gf < ga ? -3 : 0;
  const rate = (i, part) => {
    const p = team.players[i];
    let r = 60 + (part ? res / 3 : res) + (goals[i] || 0) * 10 + (assists[i] || 0) * 6 + (p.rb | 0);
    if (!part && (p.pos === "GK" || p.pos === "DF")) r += ga === 0 ? 5 : -Math.min(8, ga * 2);
    r += rng.int(11) - 5;    // 그날 컨디션 ±0.5
    return [i, clamp(Math.round(r), 30, 100)];
  };
  const out = team.starters.map((i) => rate(i, false));
  // 교체 투입 선수(커리어 선택값 subs가 있을 때만): 결과 반영 1/3, 무실점 보너스 없음
  if (Array.isArray(team.subs)) for (const sb of team.subs) out.push(rate(sb.in, true));
  return out;
}

/* 교체 선택값: 그 시각(분) 경기장에 있던 선수들 — 교체 시각 이전 골은 나간 선수, 이후 골은 들어온 선수 */
function onPitch(team, min) {
  const out = new Set(), inn = [];
  for (const sb of team.subs) {
    if (min > sb.min) { out.add(sb.out); inn.push(sb.in); }
  }
  return team.starters.filter((i) => !out.has(i)).concat(inn).map((i) => team.players[i]);
}
