/* style-analysis.js — 플레이스타일 분석 (성향 태그 + 누적 통계) */

async function initStyle() {
  const root = document.getElementById("style-root");
  const [statsFile, membersFile] = await loadAll(["data/stats.json", "data/members.json"]);

  if (!statsFile || !statsFile.players) {
    root.innerHTML = emptyState("플레이스타일 데이터가 아직 없습니다. 집계 실행 후 표시됩니다.", "⚽");
    return;
  }
  const members = (membersFile && membersFile.members) || [];
  const withData = members
    .filter((m) => m.ouid && statsFile.players[m.ouid] && statsFile.players[m.ouid].games > 0)
    .map((m) => ({ m, st: statsFile.players[m.ouid] }))
    .sort((a, b) => b.st.games - a.st.games);

  if (!withData.length) {
    root.innerHTML = emptyState("통계에 필요한 경기 데이터가 아직 없습니다.", "⚽");
    return;
  }

  root.innerHTML = `<div class="card-grid">${withData.map(({ m, st }) => styleCard(m, st)).join("")}</div>`;
}

function styleCard(m, st) {
  const tags = (st.tags || []).map((t) => `<span class="tag">${t}</span>`).join("");
  const stat = (label, val, unit = "") =>
    `<div style="display:flex;justify-content:space-between;font-size:var(--fs-sm);padding:2px 0;">
       <span style="color:var(--text-muted);">${label}</span>
       <b>${val == null ? "-" : val}${val == null ? "" : unit}</b></div>`;
  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:baseline;">
        <span style="font-weight:800;">${escapeHtml(m.ingameNick)}</span>
        <span style="font-size:var(--fs-xs);color:var(--text-dim);">${st.games}경기</span>
      </div>
      <div style="margin:var(--sp-2) 0;">${tags || '<span class="tag">데이터 부족</span>'}</div>
      <div style="border-top:1px solid var(--border);padding-top:var(--sp-2);">
        ${stat("승률", st.winRate, "%")}
        ${stat("평균 점유율", st.avgPossession, "%")}
        ${stat("평균 슈팅", st.avgShoot, "회")}
        ${stat("유효 슈팅", st.avgEffectiveShoot, "회")}
        ${stat("패스 성공률", st.passSuccessRate, "%")}
        ${stat("경기당 득점", st.goalPerGame, "골")}
      </div>
    </div>
  `;
}

initStyle();
