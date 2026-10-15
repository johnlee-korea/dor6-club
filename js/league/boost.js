/* ============================================================
   league/boost.js — 🔥 전날 판수 보너스 (v2.14.0, 사용자 요청 "열심히 한 사람이 아주 작은 베네핏")
   - 개최 전날(KST 0~24시) 공식경기(50)·공식친선(60)·리그친선(30)·감독모드(52) 판수 합 g (모두 1판 = 1판)
   - 보너스 = 처음 10판까지 판당 +0.025, 그 뒤 판당 +0.01, 최대 +0.5(35판) → 팀 공격력·수비력에 더함
     실측(24팀×300일): 최대 +0.5 = 하루 승점 +1.9 · 순위 약 1계단 · 우승 4.3% → 5.7% / 5판(+0.125) ≈ 승점 +0.5
     (+1.0으로 시험하니 순위 2계단·우승 7.3% → "큰 차이 없게" 사용자 요청에 맞춰 절반으로)
   - 개최일 06:40 스냅샷에 판수·보너스를 얼려 둠 → 낮에 판수가 바뀌어도 당일 결과 불변 (결정론)
   - 순수 함수 — Worker 스냅샷·테스트 리그·기록 스크립트·화면 공용
   ============================================================ */

export const DAILY_TYPES = [50, 60, 30, 52];
// 0.001 단위 정수 (엔진에 소수 누적 오차 없이 전달)
export const BOOST = { firstGames: 10, firstStep: 25, nextStep: 10, max: 500 };

/* 판수 → 보너스(0.001 단위 정수, 0~500) */
export function activityBoost(games) {
  const g = Math.max(0, Math.floor(games || 0));
  const first = Math.min(g, BOOST.firstGames) * BOOST.firstStep;
  const next = Math.max(0, g - BOOST.firstGames) * BOOST.nextStep;
  return Math.min(BOOST.max, first + next);
}

/* "2026-10-16" → "2026-10-15" (KST 날짜 문자열 그대로 하루 전) */
export function prevDay(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/* data/daily-games.json { days: { "YYYY-MM-DD": { ouid: [n50, n60, n30, n52] } } }
   → 스냅샷 팀마다 act(전날 유형별 판수)·boost를 붙임. 파일이 없거나 그날 집계가 없으면 보너스 없이 "skipped" */
export function attachBoost(teams, daily, date) {
  const day = prevDay(date);
  const counts = daily && daily.days && daily.days[day];
  if (!counts) return { teams, activity: "skipped", activityDay: day };
  return {
    teams: teams.map((t) => {
      const act = counts[t.ouid] || [0, 0, 0, 0];
      const boost = activityBoost(act.reduce((s, v) => s + v, 0));
      return { ...t, act, ...(boost ? { boost } : {}) };
    }),
    activity: "ok", activityDay: day
  };
}

export const gamesOf = (t) => (t && t.act ? t.act.reduce((s, v) => s + v, 0) : 0);
export const boostText = (b) => "+" + ((b || 0) / 1000).toFixed(3).replace(/0$/, "");
