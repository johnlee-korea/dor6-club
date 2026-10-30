/* ============================================================
   league/boost.js — 🔥 전날 판수 보너스 (v2.14.0, 사용자 요청 "열심히 한 사람이 아주 작은 베네핏")
   - 개최 전날(KST 0~24시) 공식경기(50)·공식친선(60)·리그친선(30)·클래식(40, v2.17.1)은 1판 = 1판,
     감독모드(52)는 자동 진행이라 1판 = 0.5판 (v2.22.0) → 인정 판수 g (소수 버림)
   - 보너스 = 판당 +0.03, 최대 +0.9(30판) → 팀 공격력·수비력에 더함 (v2.22.0 사용자 결정)
     실측(실제 8회 스냅샷 × 400회): 30판+ 팀 우승 5.3% → 6.3% · TOP3 15% → 18% / 0판 팀 우승 3.4% (무보너스 평균 4.2%)
     (v2.14.0 원안: 10판까지 판당 +0.025, 이후 +0.01, 최대 +0.5@35판 — 판수 1위도 상한에 묻혀 차이가 없다는 피드백)
   - 개최일 06:40 스냅샷에 판수·보너스를 얼려 둠 → 낮에 판수가 바뀌어도 당일 결과 불변 (결정론)
   - 순수 함수 — Worker 스냅샷·테스트 리그·기록 스크립트·화면 공용
   ============================================================ */

export const DAILY_TYPES = [50, 60, 30, 52, 40];   // daily-games.json 칸 순서 (클래식은 맨 뒤 — 예전 4칸 스냅샷 호환)
// 유형별 1판 가중치 (DAILY_TYPES 순서) — 감독모드는 자동 진행이라 절반
export const TYPE_WEIGHT = [1, 1, 1, 0.5, 1];
// 0.001 단위 정수 (엔진에 소수 누적 오차 없이 전달)
export const BOOST = { step: 30, maxGames: 30 };

/* 유형별 판수 [n50, n60, n30, n52, n40] → 인정 판수 (감독모드 절반, 소수 버림) */
export function countedGames(act) {
  if (!act) return 0;
  return Math.floor(act.reduce((s, v, i) => s + (v || 0) * (TYPE_WEIGHT[i] ?? 1), 0));
}

/* 인정 판수 → 보너스(0.001 단위 정수, 0~900) */
export function activityBoost(games) {
  const g = Math.max(0, Math.floor(games || 0));
  return Math.min(g, BOOST.maxGames) * BOOST.step;
}

/* "2026-10-16" → "2026-10-15" (KST 날짜 문자열 그대로 하루 전) */
export function prevDay(date) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/* data/daily-games.json { days: { "YYYY-MM-DD": { ouid: [n50, n60, n30, n52, n40] } } }
   → 스냅샷 팀마다 act(전날 유형별 판수)·boost를 붙임. 파일이 없거나 그날 집계가 없으면 보너스 없이 "skipped" */
export function attachBoost(teams, daily, date) {
  const day = prevDay(date);
  const counts = daily && daily.days && daily.days[day];
  if (!counts) return { teams, activity: "skipped", activityDay: day };
  return {
    teams: teams.map((t) => {
      const act = counts[t.ouid] || [0, 0, 0, 0, 0];
      const boost = activityBoost(countedGames(act));
      return { ...t, act, ...(boost ? { boost } : {}) };
    }),
    activity: "ok", activityDay: day
  };
}

export const gamesOf = (t) => (t && t.act ? t.act.reduce((s, v) => s + v, 0) : 0);
export const boostText = (b) => "+" + ((b || 0) / 1000).toFixed(3).replace(/0$/, "");
