/* ============================================================
   activity-ui.js — 폼·연승·최근 7일 활동 화면 조각 (v1.12.0, 공용)
   데이터: data/activity.json (aggregate.js buildActivity)
   사용처: home.js(연승 중·7일 활동) · members.js(폼 점·연승/연패 배지) · dashboard.js(7일 활동)
   의존: common.js(escapeHtml)
   ============================================================ */

const STREAK_MIN = 3; // 이 이상 이어질 때만 배지·목록 표시

/* 최근 10경기 결과 점 (왼쪽이 최신) — ●승 ○패 ◐무 */
function formDots(form) {
  if (!form || !form.length) return "";
  const mark = { win: "●", lose: "○", draw: "◐" };
  return `<span class="form-dots" title="최근 ${form.length}경기 (왼쪽이 최신)">${form
    .map((r) => `<i class="${r}">${mark[r] || "·"}</i>`).join("")}</span>`;
}

/* 🔥 N연승 / 🧊 N연패 배지 */
function streakBadge(streak) {
  if (!streak || streak.n < STREAK_MIN) return "";
  return streak.type === "win"
    ? `<span class="streak-badge hot">🔥 ${streak.n}연승</span>`
    : `<span class="streak-badge cold">🧊 ${streak.n}연패</span>`;
}

/* 순위 목록 공통 행 */
function actRow(i, nick, value) {
  return `
    <div class="member-row">
      <span class="rank r${i + 1}">${i + 1}</span>
      <div class="info"><span class="nick">${escapeHtml(nick)}</span></div>
      <div class="meta" style="color:var(--silver);font-weight:700;">${value}</div>
    </div>`;
}

/* 📅 최근 7일 활동 TOP5 */
function weekBoard(activity) {
  const rows = (activity && activity.week && activity.week.rows) || [];
  const body = rows.length
    ? rows.map((r, i) => actRow(i, r.nick,
        `${r.games}판 <span style="color:var(--text-dim);font-size:var(--fs-xs);">· 승률 ${r.winRate}%</span>`)).join("")
    : `<div class="empty" style="padding:var(--sp-4);">최근 7일 경기 기록이 없어요.</div>`;
  return `
    <div class="section-title">📅 최근 7일 활동 TOP5 <span class="in-note">· 인정 매치 판수</span></div>
    <div class="card">${body}</div>`;
}

/* 🔥 지금 연승 중 / 🧊 지금 연패 중 — members: [{ouid, ingameNick}] */
function streakBoards(activity, members) {
  const nick = Object.fromEntries((members || []).map((m) => [m.ouid, m.ingameNick]));
  const list = (type) => Object.entries((activity && activity.players) || {})
    .filter(([o, p]) => p.streak && p.streak.type === type && p.streak.n >= STREAK_MIN && nick[o])
    .sort((a, b) => b[1].streak.n - a[1].streak.n)
    .map(([o, p]) => ({ nick: nick[o], n: p.streak.n }));
  const board = (title, items, unit, emptyMsg) => `
    <div class="section-title">${title}</div>
    <div class="card">${items.length
      ? items.map((x, i) => actRow(i, x.nick, `${x.n}${unit}`)).join("")
      : `<div class="empty" style="padding:var(--sp-4);">${emptyMsg}</div>`}</div>`;
  return board("🔥 지금 연승 중", list("win"), "연승", `${STREAK_MIN}연승 이상인 클럽원이 없어요.`) +
    board("🧊 지금 연패 중", list("lose"), "연패", `${STREAK_MIN}연패 이상인 클럽원이 없어요. 평화롭네요 🕊`);
}
