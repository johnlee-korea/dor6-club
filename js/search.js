/* search.js — 일반 전적 검색 (Worker 프록시 경유, 키 노출 없음) */

function initSearch() {
  const btn = document.getElementById("search-btn");
  const input = document.getElementById("q");
  btn.addEventListener("click", doSearch);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

  // ?q= 로 진입 시 자동 검색
  const q = new URLSearchParams(location.search).get("q");
  if (q) { input.value = q; doSearch(); }

  if (!window.DOR6.workerUrl) {
    document.getElementById("search-msg").innerHTML =
      `⚙️ 검색 백엔드(Worker)가 아직 연결되지 않았습니다. 배포 후 이용 가능합니다.`;
  }
}

async function doSearch() {
  const root = document.getElementById("search-root");
  const msg = document.getElementById("search-msg");
  const nickname = document.getElementById("q").value.trim();
  if (!nickname) { msg.textContent = "닉네임을 입력하세요."; return; }

  if (!window.DOR6.workerUrl) {
    root.innerHTML = errorState("검색 기능은 Worker 배포 후 활성화됩니다.");
    return;
  }

  msg.textContent = "";
  root.innerHTML = `<div class="loading">🔍 조회 중…</div>`;
  try {
    const data = await auth.call("/search", { nickname });
    renderResult(root, data);
  } catch (e) {
    root.innerHTML = errorState(escapeHtml(e.message));
  }
}

function renderResult(root, d) {
  const s = d.summary || {};
  const strip = (d.matches || []).map((m) =>
    `<span class="wl-dot ${m.result}">${fmt.wl(m.result)}</span>`).join("");

  const rows = (d.matches || []).length
    ? d.matches.map((m) => `
      <div style="display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) 0;border-bottom:1px solid var(--border);">
        <span class="wl-dot ${m.result}">${fmt.wl(m.result)}</span>
        <span style="font-weight:700;font-variant-numeric:tabular-nums;">${m.goalFor} : ${m.goalAgainst}</span>
        <span style="flex:1;min-width:0;color:var(--text-muted);font-size:var(--fs-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">vs ${escapeHtml(m.opponentNick || "?")}</span>
        <span style="font-size:var(--fs-xs);color:var(--text-dim);white-space:nowrap;">점유 ${m.possession == null ? "-" : m.possession + "%"} · ${fmt.date(m.matchDate)}</span>
      </div>`).join("")
    : emptyState("최근 공식경기 기록이 없습니다.");

  root.innerHTML = `
    <div class="card" style="margin-bottom:var(--sp-4);">
      <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:var(--sp-2);">
        <span style="font-weight:800;font-size:var(--fs-xl);">${escapeHtml(d.nickname || "?")}</span>
        <span style="font-size:var(--fs-sm);color:var(--text-muted);">
          ${d.level ? "Lv." + d.level + " · " : ""}<span style="color:var(--silver);font-weight:700;">${escapeHtml(d.maxDivision || "-")}</span>
        </span>
      </div>
      <div style="margin-top:var(--sp-3);">${strip}</div>
      <div style="font-size:var(--fs-xs);color:var(--text-dim);margin-top:var(--sp-1);">
        최근 ${s.games || 0}경기 중 ${s.wins || 0}승 ${s.winRate != null ? "· 승률 " + s.winRate + "%" : ""} (공식경기 기준)
      </div>
    </div>
    <div class="section-title">최근 공식경기</div>
    <div class="card">${rows}</div>
  `;
}

document.addEventListener("DOMContentLoaded", initSearch);
