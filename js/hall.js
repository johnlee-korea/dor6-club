/* hall.js — 명예의 전당 (시즌별 최다판수·최다승·최고승률) */

async function initHall() {
  const root = document.getElementById("hall-root");
  const bar = document.getElementById("season-bar");
  const hall = await loadJSON("data/hall.json").catch(() => null);

  if (!hall || !hall.seasons || !hall.seasons.length) {
    bar.innerHTML = "";
    root.innerHTML = emptyState("명예의 전당 데이터가 아직 없습니다. 집계 실행 후 표시됩니다.", "🏆");
    return;
  }

  // 데이터 있는 시즌만
  const seasons = hall.seasons.filter((s) =>
    s.mostGames.length || s.mostWins.length || s.bestWinRate.length);
  if (!seasons.length) {
    bar.innerHTML = "";
    root.innerHTML = emptyState("아직 집계된 경기가 없습니다.", "🏆");
    return;
  }

  let idx = seasons.length - 1; // 최신 시즌
  bar.innerHTML = `<div class="chip-row">${seasons.map((s, i) =>
    `<button class="chip ${i === idx ? "active" : ""}" data-i="${i}">${escapeHtml(s.seasonName)}</button>`).join("")}</div>`;
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    idx = +btn.dataset.i;
    bar.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    render(seasons[idx], hall.minGames);
  });

  render(seasons[idx], hall.minGames);

  function render(s, minGames) {
    root.innerHTML = `
      ${board("🎮 최다 판수", s.mostGames, (x) => `${x.games}판`)}
      ${board("🏅 최다 승", s.mostWins, (x) => `${x.wins}승`)}
      ${board(`📈 최고 승률`, s.bestWinRate, (x) => `${x.winRate}% <span style="color:var(--text-dim);font-size:var(--fs-xs);">(${x.games}판)</span>`, `최소 ${minGames}판`)}
    `;
  }
}

function board(title, list, valueFn, note = "") {
  const rows = list.length
    ? list.map((x, i) => `
      <div class="member-row">
        <span class="rank r${i + 1}">${i + 1}</span>
        <div class="info"><span class="nick">${escapeHtml(x.nick)}</span></div>
        <div class="meta" style="color:var(--silver);font-weight:700;">${valueFn(x)}</div>
      </div>`).join("")
    : `<div class="empty" style="padding:var(--sp-4);">해당 없음</div>`;
  return `
    <div class="section-title">${title}
      ${note ? `<span style="font-size:var(--fs-xs);color:var(--text-dim);font-weight:400;">· ${note}</span>` : ""}
    </div>
    <div class="card">${rows}</div>
  `;
}

initHall();
