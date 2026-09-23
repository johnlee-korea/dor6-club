/* record.js — 클럽원 개별 전적 (최근 경기 + 라인업) */

const MATCH_TYPE_LABEL = { 50: "공식", 60: "공식친선", 30: "리그친선", 52: "감독모드", 40: "1on1" };
let posMap = {};
let membersCache = [];

async function initRecord() {
  const [membersFile, posMeta] = await loadAll(["data/members.json", "data/meta/spposition.json"]);
  if (posMeta) posMap = Object.fromEntries(posMeta.map((x) => [x.spposition, x.desc]));

  const picker = document.getElementById("member-picker");
  membersCache = ((membersFile && membersFile.members) || []).filter((m) => m.ouid);
  if (!membersCache.length) {
    picker.innerHTML = "";
    document.getElementById("record-root").innerHTML = emptyState("조회 가능한 클럽원이 없습니다.", "📜");
    return;
  }
  picker.innerHTML = membersCache.map((m, i) =>
    `<button class="chip" data-ouid="${m.ouid}" data-i="${i}">${escapeHtml(m.ingameNick)}</button>`).join("");
  picker.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    picker.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    showMember(btn.dataset.ouid, membersCache[btn.dataset.i]);
  });

  // 첫 회원 자동 선택
  const first = picker.querySelector(".chip");
  if (first) first.click();
}

async function showMember(ouid, member) {
  const root = document.getElementById("record-root");
  root.innerHTML = `<div class="loading">불러오는 중…</div>`;
  const store = await loadJSON(`data/matches/${ouid}.json`).catch(() => null);

  if (!store || !store.matches || !store.matches.length) {
    root.innerHTML = emptyState(`${member.ingameNick} 님의 수집된 경기가 없습니다.`, "📭");
    return;
  }
  const matches = store.matches;
  const recent = matches.slice(0, 30);

  // 요약 (전체 기준)
  const w = matches.filter((m) => m.result === "win").length;
  const d = matches.filter((m) => m.result === "draw").length;
  const l = matches.filter((m) => m.result === "lose").length;
  const rate = matches.length ? Math.round((w / matches.length) * 100) : 0;

  const strip = matches.slice(0, 15).map((m) =>
    `<span class="wl-dot ${m.result}">${fmt.wl(m.result)}</span>`).join("");

  root.innerHTML = `
    <div class="card" style="margin-bottom:var(--sp-4);">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:var(--sp-2);">
        <span style="font-weight:800;font-size:var(--fs-lg);">${escapeHtml(member.ingameNick)}</span>
        <span style="font-size:var(--fs-sm);color:var(--text-muted);">
          <span class="wl win">${w}승</span> <span class="wl draw">${d}무</span> <span class="wl lose">${l}패</span>
          · 승률 <b>${rate}%</b> · 누적 ${matches.length}경기
        </span>
      </div>
      <div style="margin-top:var(--sp-3);">${strip}</div>
      <div style="font-size:var(--fs-xs);color:var(--text-dim);margin-top:var(--sp-1);">최근 15경기 (왼쪽이 최신)</div>
    </div>
    <div class="section-title">최근 경기 <span style="font-size:var(--fs-xs);color:var(--text-dim);font-weight:400;">· 탭하면 라인업</span></div>
    <div class="card">${recent.map(matchRow).join("")}</div>
  `;

  root.querySelectorAll(".match-row").forEach((row) => {
    row.addEventListener("click", () => {
      const lu = row.querySelector(".lineup");
      if (lu) lu.style.display = lu.style.display === "none" ? "block" : "none";
    });
  });
}

function matchRow(m) {
  const label = MATCH_TYPE_LABEL[m.matchType] || `유형${m.matchType}`;
  const lineup = (m.lineup || []).length
    ? `<div class="lineup" style="display:none;margin-top:var(--sp-3);">
         <div class="table-wrap"><table class="data">
           <tr><th>포지션</th><th class="num">등급</th></tr>
           ${m.lineup.map((p) => `<tr><td>${escapeHtml(posMap[p.spPosition] || ("#" + p.spPosition))}</td><td class="num">${p.spGrade}</td></tr>`).join("")}
         </table></div>
       </div>`
    : "";
  return `
    <div class="match-row" style="padding:var(--sp-3) 0;border-bottom:1px solid var(--border);cursor:pointer;">
      <div style="display:flex;align-items:center;gap:var(--sp-3);">
        <span class="wl-dot ${m.result}">${fmt.wl(m.result)}</span>
        <span style="font-weight:700;font-variant-numeric:tabular-nums;">${m.goalFor} : ${m.goalAgainst}</span>
        <span style="flex:1;min-width:0;color:var(--text-muted);font-size:var(--fs-sm);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          vs ${escapeHtml(m.opponentNick || "?")}</span>
        <span class="badge">${label}</span>
        <span style="font-size:var(--fs-xs);color:var(--text-dim);white-space:nowrap;">${fmt.date(m.matchDate)}</span>
      </div>
      ${lineup}
    </div>
  `;
}

initRecord();
