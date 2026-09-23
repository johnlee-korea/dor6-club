/* dashboard.js — 시즌 판수 대시보드 (진행률·중간점검·휴식·부클럽장별) */

async function initDashboard() {
  const root = document.getElementById("dash-root");
  const bar = document.getElementById("season-bar");
  const [dash, membersFile] = await loadAll(["data/dashboard.json", "data/members.json"]);

  if (!dash || !dash.current || !dash.current.rows.length) {
    bar.innerHTML = "";
    root.innerHTML = emptyState("판수 집계 데이터가 아직 없습니다. 수집·집계 실행 후 표시됩니다.", "🎯");
    return;
  }
  const cur = dash.current;
  const rows = cur.rows;
  const members = (membersFile && membersFile.members) || [];
  const nameByOuid = Object.fromEntries(members.map((m) => [m.ouid, m.ingameNick]));

  // 시즌 바 + 요약
  const active = rows.filter((r) => !r.resting);
  const achieved = active.filter((r) => r.played >= r.target).length;
  const midMiss = active.filter((r) => r.midMiss).length;
  const avgRate = Math.round(active.reduce((a, r) =>
    a + Math.min(100, r.target ? (r.played / r.target) * 100 : 100), 0) / (active.length || 1));

  bar.innerHTML = `
    <div class="card" style="margin-bottom:var(--sp-4);">
      <div style="font-weight:800;font-size:var(--fs-lg);">${cur.seasonName}</div>
      <div style="color:var(--text-muted);font-size:var(--fs-sm);">기준 ${cur.targetGames}판 · 중간점검 ${cur.midTargetGames}판 · 갱신 ${fmt.dateTime(dash.updated)}</div>
    </div>
    <div class="stat-row" style="margin-bottom:var(--sp-5);">
      <div class="stat-tile"><div class="value">${rows.length}</div><div class="label">전체</div></div>
      <div class="stat-tile"><div class="value">${avgRate}%</div><div class="label">평균 달성률</div></div>
      <div class="stat-tile"><div class="value" style="background:none;color:var(--ok);">${achieved}</div><div class="label">기준 달성</div></div>
      <div class="stat-tile"><div class="value" style="background:none;color:${midMiss ? "var(--danger)" : "var(--text)"};">${midMiss}</div><div class="label">중간점검 미달</div></div>
    </div>
  `;

  // 운영진 + 클럽원 평면 (담당 그룹 없음). 판수 많은 순 정렬.
  const staff = rows.filter((r) => r.role !== "클럽원");
  const clubMembers = rows.filter((r) => r.role === "클럽원")
    .sort((a, b) => b.played - a.played);
  const done = clubMembers.filter((r) => !r.resting && r.played >= r.target).length;

  let html = "";
  if (staff.length) html += groupBlock("👑 운영진", staff);
  html += groupBlock("👥 클럽원", clubMembers, `달성 ${done}/${clubMembers.length}`);
  root.innerHTML = html;
}

function groupBlock(title, list, subtitle = "") {
  if (!list.length) return "";
  return `
    <div class="section-title">${title}
      ${subtitle ? `<span style="font-size:var(--fs-xs);color:var(--text-dim);font-weight:400;">· ${subtitle}</span>` : ""}
    </div>
    <div class="card">${list.map(progressRow).join("")}</div>
  `;
}

function progressRow(r) {
  const status = r.resting ? "" : progressStatus(r.played, r.target);
  const pct = r.target ? Math.min(100, Math.round((r.played / r.target) * 100)) : 100;
  const badges = [];
  if (r.resting) badges.push(`<span class="badge rest">휴식중</span>`);
  else if (r.played >= r.target) badges.push(`<span class="badge ok">달성</span>`);
  if (r.midMiss) badges.push(`<span class="badge danger">중간점검 미달</span>`);
  if (r.prorated) badges.push(`<span class="badge" title="가입일/휴식 비례 기준">비례기준</span>`);

  return `
    <div style="padding:var(--sp-3) 0;border-bottom:1px solid var(--border);${r.resting ? "opacity:.55;" : ""}">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:var(--sp-2);">
        <span style="font-weight:700;">${escapeHtml(r.ingameNick)} ${badges.join(" ")}</span>
        <span style="font-size:var(--fs-sm);color:var(--text-muted);white-space:nowrap;">
          <b style="color:var(--text);font-size:var(--fs-base);">${r.played}</b> / ${r.target}판
        </span>
      </div>
      <div class="progress ${status}"><div class="bar" style="width:${pct}%;"></div></div>
      <div style="font-size:var(--fs-xs);color:var(--text-dim);">
        중간점검 ${r.playedByMid}/${r.mid}판 ${r.restDays ? `· 휴식 ${r.restDays}일 반영` : ""}
      </div>
    </div>
  `;
}

initDashboard();
