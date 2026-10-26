/* ============================================================
   squad.js — 스쿼드(최근 경기 라인업) 공통 로직 (Node 스크립트용)
   넥슨 API는 '현재 스쿼드'를 직접 제공하지 않으므로,
   회원의 가장 최근 수집 경기 라인업을 현재 스쿼드로 간주한다.
   선수 카드·포메이션 변환은 화면(js/squad.js)에서 메타로 처리한다.
   ============================================================ */

/* 최신순 정렬된 매치 목록에서 라인업이 있는 가장 최근 경기 */
export function latestLineupMatch(matches) {
  return (matches || []).find((m) => Array.isArray(m.lineup) && m.lineup.length) || null;
}

/* 현재 스쿼드 추정: 최근 n경기(모든 수집 유형, 최신순 배열) 라인업에 한 번이라도 있던 spId (교체 명단 포함)
   — 직전 1경기만 보면 로테이션 선수까지 빠지고, 시즌 전체를 보면 판 선수가 남음 */
export function recentSquadIds(matches, n = 20) {
  const ids = new Set();
  for (const m of (matches || []).filter((x) => Array.isArray(x.lineup) && x.lineup.length).slice(0, n))
    for (const l of m.lineup) ids.add(l.spId);
  return ids;
}

/* spId 앞 3자리 = 시즌 id */
export const seasonIdOf = (spId) => Math.floor(spId / 1000000);

/* "ICON TM (ICON The Moment)" → "ICON TM" (괄호 앞 약칭) */
export function shortSeasonName(className) {
  return String(className || "").split(" (")[0].trim();
}
