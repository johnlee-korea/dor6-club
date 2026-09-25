/* dashboard.js — 시즌 판수 대시보드 (진행률·중간점검·휴식·부클럽장별) */

async function initDashboard() {
  const root = document.getElementById("dash-root");
  const bar = document.getElementById("season-bar");
  const [dash, membersFile, activity] = await loadAll(["data/dashboard.json", "data/members.json", "data/activity.json"]);

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

  const dday = seasonDday(cur);
  bar.innerHTML = `
    <div class="card" style="margin-bottom:var(--sp-4);">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:var(--sp-2);flex-wrap:wrap;">
        <span style="font-weight:800;font-size:var(--fs-lg);">${cur.seasonName}</span>
        ${dday ? `<span class="badge ${dday.cls}">${dday.label}</span>` : ""}
      </div>
      <div style="color:var(--text-muted);font-size:var(--fs-sm);">기준 ${cur.targetGames}판 · 중간점검 ${cur.midTargetGames}판 · 갱신 ${fmt.dateTime(dash.updated)}</div>
      <button class="btn sm" type="button" data-dash-share style="margin-top:var(--sp-3);">📸 전체 판수 이미지 (카톡 공유용 한 장)</button>
    </div>
    <div class="stat-row" style="margin-bottom:var(--sp-5);">
      <div class="stat-tile"><div class="value">${rows.length}</div><div class="label">전체</div></div>
      <div class="stat-tile"><div class="value">${avgRate}%</div><div class="label">평균 달성률</div></div>
      <div class="stat-tile"><div class="value" style="background:none;color:var(--ok);">${achieved}</div><div class="label">기준 달성</div></div>
      <div class="stat-tile"><div class="value" style="background:none;color:${midMiss ? "var(--danger)" : "var(--text)"};">${midMiss}</div><div class="label">중간점검 미달</div></div>
    </div>
  `;
  // 📸 전체 판수 한 장 이미지 (share.js) — 운영진 카톡 공유용
  bar.querySelector("[data-dash-share]").addEventListener("click", (e) => shareDashboardImage(dash, e.currentTarget));

  // 운영진 + 클럽원 평면 (담당 그룹 없음). 판수 많은 순 정렬.
  const staff = rows.filter((r) => r.role !== "클럽원");
  const clubMembers = rows.filter((r) => r.role === "클럽원")
    .sort((a, b) => b.played - a.played);
  const done = clubMembers.filter((r) => !r.resting && r.played >= r.target).length;

  let html = "";
  if (staff.length) html += groupBlock("👑 운영진", staff);
  html += groupBlock("👥 클럽원", clubMembers, `달성 ${done}/${clubMembers.length}`);
  // 📅 최근 7일 활동 TOP5 (activity-ui.js, v1.12.0) — 시즌 판수 아래에 이어서
  if (activity) html += weekBoard(activity);
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

/* 시즌 D-day: 전반기 종료(중간점검) 전이면 그때까지, 이후면 시즌 종료까지 */
function seasonDday(cur) {
  if (!cur.end) return null;
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = (t) => Math.round((t - today) / 86400000);
  const end = parse(cur.end);
  const mid = cur.midCheck ? parse(cur.midCheck) : null;
  if (mid && today < mid) { const n = days(mid); return { label: `전반기 종료 D-${n}`, cls: n <= 7 ? "warn" : "" }; }
  if (today <= end) { const n = days(end); return { label: `시즌 종료 D-${n}`, cls: n <= 7 ? "warn" : "" }; }
  return { label: "시즌 종료", cls: "" };
}

initDashboard();
