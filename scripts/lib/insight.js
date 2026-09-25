/* ============================================================
   insight.js — 경기 상세 인사이트 공용 로직 (v1.9.0)
   - collect.js : 매치 상세 → 경기별 저장 필드(ctrl·cards·pStats·shots·oppGoals) 추출
   - aggregate.js: 저장 필드 → 에이스 선수·골 시간대·역전승·극장골·매너 집계
   설계: 넥슨 호출 추가 없이 이미 받는 매치 상세에서 필요한 값만 짧은 배열로 저장(용량 절약)
   ============================================================ */

/* 넥슨 goalTime = 하프 오프셋(2^24 단위) + 해당 하프 경과 초
   0 전반 · 1 후반 · 2 연장 전반 · 3 연장 후반 · 4 승부차기 */
const HALF = 2 ** 24;
const HALF_START_SEC = [0, 45 * 60, 90 * 60, 105 * 60];
export const SHOOTOUT = 4;

/* goalTime → 경기 시각(초, 킥오프 기준). 승부차기는 null(시간대·역전 판정에서 제외) */
export function gameSec(goalTime) {
  const half = Math.floor(goalTime / HALF);
  if (half >= SHOOTOUT) return null;
  return HALF_START_SEC[half] + (goalTime % HALF);
}

/* 슈팅 결과 코드 (넥슨 shootDetail.result) */
export const SHOT_RESULT = { ON: 1, OFF: 2, GOAL: 3 };

/* 매치 상세의 한쪽(me) + 상대(opp) → 저장 필드
   pStats: [spId, 골, 도움, 평점] — 평점 0(미출전 교체)은 제외
   shots : [초, x, y, 결과, 유형, spId, 도움spId|0] — 승부차기 제외, 좌표 소수 2자리
   oppGoals: 상대 골 시각(초) 배열 */
export function insightRaw(me, opp) {
  if (!me) return { ctrl: null, cards: null, pStats: null, shots: null, oppGoals: null };
  const md = me.matchDetail || {};
  const r2 = (n) => Math.round((n ?? 0) * 100) / 100;
  const shots = [];
  for (const s of me.shootDetail || []) {
    const t = gameSec(s.goalTime);
    if (t == null) continue;
    shots.push([t, r2(s.x), r2(s.y), s.result, s.type, s.spId, s.assist ? s.assistSpId : 0]);
  }
  shots.sort((a, b) => a[0] - b[0]);
  const oppGoals = ((opp && opp.shootDetail) || [])
    .filter((s) => s.result === SHOT_RESULT.GOAL)
    .map((s) => gameSec(s.goalTime))
    .filter((t) => t != null)
    .sort((a, b) => a - b);
  const pStats = (me.player || [])
    .filter((pl) => pl.status && pl.status.spRating > 0)
    .map((pl) => [pl.spId, pl.status.goal ?? 0, pl.status.assist ?? 0, pl.status.spRating]);
  return {
    ctrl: md.controller || null,
    cards: { y: md.yellowCards ?? 0, r: md.redCards ?? 0 },
    pStats, shots, oppGoals
  };
}

/* 골 시간대 7구간: 전반 0-15·16-30·31-45+ / 후반 46-60·61-75·76-90+ / 연장 */
export const GOAL_BUCKETS = ["1-15", "16-30", "31-45", "46-60", "61-75", "76-90", "연장"];
export function bucketOf(sec) {
  if (sec >= 90 * 60) return 6;
  const base = sec >= 45 * 60 ? 3 : 0;
  const m = (sec - (base ? 45 * 60 : 0)) / 60;
  return base + (m < 15 ? 0 : m < 30 ? 1 : 2);
}

/* 득실 순서 복원 → 역전승·극장골 판정
   내 골 시각 수·상대 골 시각 수가 최종 스코어와 다르면(자책골 등 기록 누락) 판정 불가 → null */
export const LATE_SEC = 80 * 60;
export function goalFlow(match) {
  const mine = (match.shots || []).filter((s) => s[3] === SHOT_RESULT.GOAL).map((s) => s[0]);
  const theirs = match.oppGoals || [];
  if (mine.length !== match.goalFor || theirs.length !== match.goalAgainst) return null;
  const events = [...mine.map((t) => [t, 1]), ...theirs.map((t) => [t, -1])].sort((a, b) => a[0] - b[0]);
  let diff = 0, trailed = false, lastGoAhead = null;
  for (const [t, d] of events) {
    const before = diff;
    diff += d;
    if (diff < 0) trailed = true;
    if (d === 1 && before === 0 && diff === 1) lastGoAhead = t; // 동점 → 리드 전환 골
  }
  const win = match.result === "win" && diff > 0; // 승부차기 승(동점)은 제외
  return {
    comeback: win && trailed,
    lateWinner: win && lastGoAhead != null && lastGoAhead >= LATE_SEC
  };
}
