/* ============================================================
   season.js — 시즌 판수 계산 유틸 (비례 기준·중간점검·휴식 처리)
   설계 의도: 규칙(50판/25판, 가입일 비례, 휴식 제외)을 한 곳에 모아
   대시보드/홈/명예의전당이 동일 로직을 재사용하도록 한다.
   ============================================================ */

const DAY = 86400000;

/* 설정값 날짜(시즌·중간점검·가입일·휴식)는 KST 기준 — 타임존 표기가 없으므로 KST(+09:00)로 명시 파싱한다.
   ※ 넥슨 매치일시(matchDate)는 UTC이므로 toDate가 아니라 matchTime으로 파싱할 것 (v1.12.0 보정) */
export function toDate(s) {
  if (!s) return null;
  let str = String(s);
  if (str.length <= 10) str += "T00:00:00+09:00";                 // 날짜만
  else if (!/[zZ]|[+-]\d\d:?\d\d$/.test(str)) str += "+09:00";     // 시간 있으나 tz 없음
  return new Date(str);
}

/* 넥슨 매치일시 → Date. 타임존 표기 없는 UTC 문자열(예: "2026-09-24T14:58:41")
   근거: 저장 경기 시각 분포 피크가 13~15시(=KST 22~24시), 수집 시각과의 선후관계도 UTC일 때만 성립 */
export function matchTime(s) {
  if (!s) return null;
  const str = String(s);
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(str) ? str : str + "Z");
}

/* 넥슨 매치일시 → KST 날짜 문자열 "YYYY-MM-DD" (하루 단위 집계용) */
export function matchDayKST(s) {
  return new Date(matchTime(s).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
const daysBetween = (a, b) => Math.max(0, Math.round((b - a) / DAY));

/* 기간 배열이 [start,end] 구간과 겹치는 총 일수 */
function overlapDays(start, end, periods = []) {
  let sum = 0;
  for (const p of periods) {
    const ps = toDate(p.from), pe = toDate(p.to);
    if (!ps || !pe) continue;
    const s = Math.max(start.getTime(), ps.getTime());
    const e = Math.min(end.getTime(), pe.getTime());
    if (e > s) sum += Math.round((e - s) / DAY);
  }
  return sum;
}

/* 오늘이 휴식 기간 안인가 */
function isRestingNow(periods = [], now = new Date()) {
  return periods.some((p) => {
    const s = toDate(p.from), e = toDate(p.to);
    return s && e && now >= s && now <= e;
  });
}

/* 현재 시즌 객체 */
export function getCurrentSeason(seasonsFile) {
  if (!seasonsFile || !seasonsFile.seasons || !seasonsFile.seasons.length) return null;
  const id = seasonsFile.meta && seasonsFile.meta.currentSeasonId;
  return seasonsFile.seasons.find((s) => s.id === id) || seasonsFile.seasons[seasonsFile.seasons.length - 1];
}

/* 시즌 구간 + 인정 유형으로 매치 판수 카운트 */
export function countGames(matches = [], season, countedTypes, until = null) {
  const start = toDate(season.start).getTime();
  // 종료일은 그날 끝(23:59:59)까지 포함
  const end = (until ? toDate(until) : toDate(season.end)).getTime() + (DAY - 1000);
  const typeSet = new Set(countedTypes);
  return matches.filter((m) => {
    const t = matchTime(m.matchDate).getTime();
    return t >= start && t <= end && typeSet.has(m.matchType);
  }).length;
}

/*
  한 회원의 시즌 판수 현황 계산.
  member: members.json 항목, matches: 해당 회원 매치 요약 배열
  반환: { played, target, mid, playedByMid, midMiss, resting, restDays, prorated }
*/
export function computeMemberSeason(member, matches, season, countedTypes, now = new Date()) {
  const start = toDate(season.start);
  const end = toDate(season.end);
  const mid = toDate(season.midCheck);
  const join = member.joinDate ? toDate(member.joinDate) : start;
  const activeStart = new Date(Math.max(start.getTime(), join.getTime()));

  // --- 시즌 전체 비례 기준 ---
  const seasonDays = daysBetween(start, end) || 1;
  const memberSpan = daysBetween(activeStart, end);
  const restInSeason = overlapDays(activeStart, end, member.restPeriods);
  const activeDays = Math.max(0, memberSpan - restInSeason);
  const target = Math.round(season.targetGames * (activeDays / seasonDays));

  // --- 중간점검 비례 기준 ---
  const midDays = daysBetween(start, mid) || 1;
  const midMemberSpan = activeStart >= mid ? 0 : daysBetween(activeStart, mid);
  const restInMid = overlapDays(activeStart, mid, member.restPeriods);
  const midActiveDays = Math.max(0, midMemberSpan - restInMid);
  const midTarget = Math.round(season.midTargetGames * (midActiveDays / midDays));

  // --- 실제 판수 ---
  const played = countGames(matches, season, countedTypes);
  const playedByMid = countGames(matches, season, countedTypes, season.midCheck);

  const resting = isRestingNow(member.restPeriods, now);
  const midPassed = now >= mid;
  const midMiss = midPassed && !resting && playedByMid < midTarget;

  return {
    played,
    target: Math.max(0, target),
    mid: Math.max(0, midTarget),
    playedByMid,
    midMiss,
    resting,
    restDays: restInSeason,
    prorated: target !== season.targetGames
  };
}
