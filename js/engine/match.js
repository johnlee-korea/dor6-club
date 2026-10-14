/* ============================================================
   match.js — 한 경기 시뮬레이션 (가벼운 버전)
   흐름: 공격력·수비력 → 기대 득점(λ) → 포아송으로 골 수 → 득점자·도움·시각 추첨 → 평점
   seedStr이 같으면 결과가 항상 같다 (rng.js 규칙 준수: 초월함수·Math.random 금지)
   ============================================================ */
import { makeRng, poisson, clamp } from "./rng.js";

/* 밸런스 계수 — 바꾸면 결과가 달라지므로 ENGINE_VERSION(index.js)을 올릴 것 */
export const TUNE = {
  base: 1.32,        // 실력이 같을 때 한 팀 기대 득점
  k: 0.045,          // (내 공격 − 상대 수비) 1점당 기대 득점 변화율
  gap: -1.2,         // 공격력·수비력 척도 차이 보정 (실측 평균 공격 72.5 · 수비 73.7 → 평균 팀끼리 차이 0)
  home: 0.15,        // 홈 어드밴티지 (골)
  minL: 0.3, maxL: 3.5,
  assistRate: 0.85   // 골에 도움이 붙을 확률
};

// 득점자 가중: 포지션 × 슈팅 / 도움 가중: 포지션 × 패스
const SCORE_W = { GK: 0, DF: 1, MF: 3, FW: 6 };
const ASSIST_W = { GK: 0.2, DF: 1.5, MF: 4, FW: 3 };

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
    for (let g = 0; g < n; g++) {
      const st = team.starters.map((i) => team.players[i]);
      const s = st[rng.weighted(st.map((p) => SCORE_W[p.pos] * p.attrs.sht))].idx;
      let as = null;
      if (rng.chance(TUNE.assistRate)) {
        const pool = st.filter((p) => p.idx !== s);
        as = pool[rng.weighted(pool.map((p) => ASSIST_W[p.pos] * p.attrs.pas))].idx;
      }
      // 시각: 1~90분, 90분 골은 추가시간(90+1~4)일 수 있음
      const min = 1 + rng.int(90);
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
  return team.starters.map((i) => {
    const p = team.players[i];
    let r = 60 + res + (goals[i] || 0) * 10 + (assists[i] || 0) * 6;
    if (p.pos === "GK" || p.pos === "DF") r += ga === 0 ? 5 : -Math.min(8, ga * 2);
    r += rng.int(11) - 5;    // 그날 컨디션 ±0.5
    return [i, clamp(r, 30, 100)];
  });
}
