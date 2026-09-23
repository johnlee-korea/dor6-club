/* internal.js — 클럽 내전 기록 (상대 전적표 + 최근 내전) */

async function initInternal() {
  const root = document.getElementById("internal-root");
  const [internal, membersFile] = await loadAll(["data/internal.json", "data/members.json"]);

  if (!internal || !internal.matches || !internal.matches.length) {
    root.innerHTML = emptyState("아직 기록된 클럽 내전이 없습니다. 클럽원끼리 경기하면 자동 집계됩니다.", "⚔️");
    return;
  }
  const members = (membersFile && membersFile.members) || [];
  const nick = Object.fromEntries(members.map((m) => [m.ouid, m.ingameNick]));
  const name = (ouid) => nick[ouid] || "?";

  // 상대 전적표
  const h2h = (internal.headToHead || []).map((r) => {
    const total = r.aWin + r.bWin + r.draw;
    return `
      <tr>
        <td><b>${escapeHtml(name(r.a))}</b></td>
        <td class="num"><span class="wl win">${r.aWin}</span> - <span class="wl lose">${r.bWin}</span></td>
        <td><b>${escapeHtml(name(r.b))}</b></td>
        <td class="num" style="color:var(--text-muted);">${r.draw}무 · ${total}전</td>
      </tr>`;
  }).join("");

  // 최근 내전
  const recent = internal.matches.slice(0, 30).map((x) => `
    <tr>
      <td>${fmt.date(x.matchDate)}</td>
      <td><b>${escapeHtml(x.aNick)}</b></td>
      <td class="num" style="font-variant-numeric:tabular-nums;">
        <span class="wl ${x.result}">${x.goalFor} : ${x.goalAgainst}</span>
      </td>
      <td>${escapeHtml(x.bNick)}</td>
    </tr>`).join("");

  root.innerHTML = `
    <div class="section-title">🤝 클럽원 간 상대 전적</div>
    <div class="card"><div class="table-wrap"><table class="data">
      <tr><th>클럽원 A</th><th class="num">전적</th><th>클럽원 B</th><th class="num">비고</th></tr>
      ${h2h}
    </table></div></div>

    <div class="section-title">🕑 최근 내전</div>
    <div class="card"><div class="table-wrap"><table class="data">
      <tr><th>날짜</th><th>승자 관점</th><th class="num">스코어</th><th>상대</th></tr>
      ${recent}
    </table></div>
    <div style="font-size:var(--fs-xs);color:var(--text-dim);margin-top:var(--sp-2);">
      스코어는 왼쪽(승자 관점) 기준입니다. 총 ${internal.matches.length}건.
    </div></div>
  `;
}

initInternal();
