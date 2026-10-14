/* ============================================================
   league/eligibility.js — 도륙리그 참가 자격 판정 (CLAUDE.md 25-0, 순수 함수)
   사용자 결정(2026-10-14): 판수 미달·휴식 중·부계정은 리그에서 제외
   - 판수 미달 = 진행률 기준: played < floor(target × 경과 일수 ÷ 기간 일수)
   - 판정할 수 없으면 참가 (제외는 확실할 때만)
   Worker(스냅샷 생성)·관리자 화면(예상 참가 수)·테스트가 같은 규칙을 공유
   ============================================================ */

const dayNum = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
};

/* 필요 판수 — 기간 시작 = max(시즌 시작, 가입일), 개최일 당일은 경과에서 제외 */
export function requiredGames(target, season, joinDate, date) {
  const start = Math.max(dayNum(season.start), joinDate ? dayNum(joinDate) : -Infinity);
  const total = dayNum(season.end) - start + 1;
  const elapsed = Math.max(0, dayNum(date) - start);
  if (total <= 0) return 0;
  return Math.floor((target * Math.min(elapsed, total)) / total);
}

/* members: members.json 객체, dashboard: dashboard.json 객체(없으면 null), date: 개최일 "YYYY-MM-DD"
   반환: { teams: [{ ouid, name }] (ouid 정렬), excluded: [{ ouid, name, reason, played?, need? }], eligibility: "ok"|"skipped" } */
export function judgeEligibility(members, dashboard, date) {
  const list = ((members && members.members) || []).filter((m) => m.ouid);
  const cur = dashboard && dashboard.current;
  const rows = new Map(((cur && cur.rows) || []).map((r) => [r.ouid, r]));
  const inSeason = !!(cur && cur.start && cur.end && date >= cur.start && date <= cur.end);
  const teams = [], excluded = [];
  for (const m of list) {
    const name = m.ingameNick || m.ouid.slice(0, 8);
    const row = rows.get(m.ouid);
    if (m.isSub) { excluded.push({ ouid: m.ouid, name, reason: "sub" }); continue; }
    if (row && row.resting) { excluded.push({ ouid: m.ouid, name, reason: "rest" }); continue; }
    if (row && inSeason) {
      const need = requiredGames(row.target, cur, m.joinDate, date);
      if (row.played < need) { excluded.push({ ouid: m.ouid, name, reason: "short", played: row.played, need }); continue; }
    }
    teams.push({ ouid: m.ouid, name });
  }
  const byOuid = (a, b) => (a.ouid < b.ouid ? -1 : a.ouid > b.ouid ? 1 : 0);
  return { teams: teams.sort(byOuid), excluded: excluded.sort(byOuid), eligibility: cur ? "ok" : "skipped" };
}

/* 제외 사유 문구 */
export function reasonLabel(x) {
  if (x.reason === "short") return `판수 미달 ${x.played}/${x.need}판`;
  if (x.reason === "rest") return "휴식 중";
  if (x.reason === "sub") return "부계정";
  return x.reason;
}
