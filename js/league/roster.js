/* ============================================================
   league/roster.js — 클럽원 실제 스쿼드 → 엔진 선수 명단 (v2.12.0, 사용자 요청)
   - 출처: data/squads.json 회원별 최근 수집 경기 라인업 18명(선발 11 + 교체 7) — 넥슨은 현재 스쿼드 미제공
   - 스냅샷에는 [spId, spPosition]만 얼려 둠(개최일 06:40 기준) → 이름은 data/meta/players.json으로 표시 때 붙임
     (엔진 결과는 이름과 무관 — 이름 파일을 못 불러와도 결과 동일)
   - 능력치·강화 등급은 쓰지 않음(사용자 결정) — 포지션만 사용
   ============================================================ */

/* 넥슨 spPosition 코드 → 세부 포지션 (data/meta/spposition.json과 같은 순서, 28 = 교체) */
export const POS_CODE = ["GK", "SW", "RWB", "RB", "RCB", "CB", "LCB", "LB", "LWB", "RDM", "CDM", "LDM", "RM", "RCM", "CM",
  "LCM", "LM", "RAM", "CAM", "LAM", "RF", "CF", "LF", "RW", "RS", "ST", "LS", "LW", "SUB"];

/* squads.json 라인업 → 스냅샷용 [[spId, spPosition], …] (18명 아니면 null → 가상 선수) */
export function squadFromLineup(entry) {
  const lu = entry && entry.lineup;
  if (!Array.isArray(lu) || lu.length !== 18) return null;
  return lu.map((p) => [p.spId, p.spPosition]);
}

/* 스냅샷 squad → 엔진 roster [{ name, role, starter, spId }] — 선발 먼저, 교체 뒤 */
export function squadToRoster(squad, names) {
  if (!Array.isArray(squad)) return undefined;
  const list = squad.map(([spId, code]) => ({
    spId, role: POS_CODE[code] || "SUB", starter: code !== 28,
    name: (names && names[spId]) || null
  }));
  return [...list.filter((p) => p.starter), ...list.filter((p) => !p.starter)];
}

/* 스냅샷 → 엔진 teams 입력 */
export function snapshotTeams(snap, names) {
  return snap.teams.map((t) => ({ id: t.ouid, name: t.name, roster: squadToRoster(t.squad, names) }));
}

export const hasSquads = (snap) => !!(snap && snap.teams && snap.teams.some((t) => t.squad));
