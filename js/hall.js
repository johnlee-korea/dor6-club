/* hall.js — 명예의 전당 (시즌별 최다판수·최다승·최고승률 + v1.9.0 경기 상세 6부문: 현재 시즌만) */

async function initHall() {
  const root = document.getElementById("hall-root");
  const bar = document.getElementById("season-bar");
  const [hall, insights] = await loadAll(["data/hall.json", "data/insights.json"]);
  // 선수 이름·시즌 이미지(득점왕·도움왕 선수 칩용)
  const meta = insights ? await sqLoadMeta() : null;

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
      ${recordBoards(s)}
      ${insights && insights.seasonId === s.seasonId ? insightBoards(insights, meta) : ""}
    `;
  }
}

/* v1.12.0 기록 4부문 (hall.json 시즌별) — 최다 골 차 승리 · 무실점 · 최장 연승 · 하루 최다 판수(KST) */
function recordBoards(s) {
  const dim = (x) => `<span style="color:var(--text-dim);font-size:var(--fs-xs);">${x}</span>`;
  const day = (d) => (d ? `${+d.slice(5, 7)}.${+d.slice(8, 10)}` : "-");
  return `
    ${board("💥 최다 골 차 승리", s.biggestWin || [],
      (x) => `${x.goalFor} : ${x.goalAgainst} ${dim(`<br>vs ${escapeHtml(x.opponentNick || "?")} · ${fmt.date(x.matchDate)}`)}`, "클럽원별 최고 1경기")}
    ${board("🧤 무실점 경기", s.cleanSheets || [], (x) => `${x.cleanSheets}경기 ${dim(`(${x.games}판 중)`)}`)}
    ${board("📈 최다 연승 기록", s.longestStreak || [], (x) => `${x.longestStreak}연승`, "시즌 중 최장")}
    ${board("🗓 하루 최다 판수", s.busiestDay || [], (x) => `${x.dayGames}판 ${dim(day(x.day))}`, "한국 날짜 기준")}
  `;
}

/* 경기 상세 인사이트 6부문 (data/insights.json clubTop) */
function insightBoards(ins, meta) {
  const t = ins.clubTop || {};
  const dim = (s) => `<span style="color:var(--text-dim);font-size:var(--fs-xs);">${s}</span>`;
  const withPlayer = (x) => `${escapeHtml(x.nick)}<div style="margin-top:4px;">${sqPlayerChip(x.spId, meta)}</div>`;
  const manner = (x) => `${x.score} ${dim(`경기당 · 카드 ${x.yellow + x.red} · 파울 ${x.foul}`)}`;
  // 포지션 스페셜리스트: 칭호 + 선수 칩, 값은 '지표 수치 · 랭커 평균 대비 배수'
  const specialist = (x) => `${escapeHtml(x.nick)}
    <div style="margin-top:2px;color:#ffd479;font-weight:800;">${x.title.emoji} ${escapeHtml(x.title.name)}</div>
    <div style="margin-top:4px;">${sqPlayerChip(x.spId, meta)}</div>`;
  const specialistVal = (x) => {
    const ratio = x.base > 0 && x.metric !== "rt" ? ` · ${(x.value / x.base).toFixed(1)}배` : "";
    return `${escapeHtml((ins.metricLabels || {})[x.metric] || x.metric)} ${x.value}
      ${dim(`<br>랭커 ${escapeHtml((ins.groupLabels || {})[x.group] || x.group)} ${x.base}${ratio}`)}`;
  };
  return `
    ${board("🏅 포지션 스페셜리스트", t.specialists || [], specialistVal, "같은 포지션 랭커 대비 가장 돋보이는 선수", specialist)}
    ${board("⚽ 클럽 득점왕 선수", t.topScorers || [], (x) => `${x.goals}골 ${dim(`(${x.games}경기)`)}`, "클럽원별 선수 카드 기준", withPlayer)}
    ${board("🅰️ 도움왕 선수", t.topAssists || [], (x) => `${x.assists}도움 ${dim(`(${x.games}경기)`)}`, "", withPlayer)}
    ${board("🔄 역전의 명수", t.comebackKing || [], (x) => `${x.comebacks}회`, "지고 있다가 뒤집은 승리")}
    ${board("🎭 극장골 제조기", t.lateHero || [], (x) => `${x.lateWinners}회`, "80분 이후 결승골로 승리")}
    ${board("😇 신사상", t.gentleman || [], manner, `(카드×3+파울)÷경기 최저 · 최소 ${ins.minGames}판`)}
    ${board("💪 터프가이상", t.toughGuy || [], manner, `(카드×3+파울)÷경기 최고 · 최소 ${ins.minGames}판`)}
  `;
}

function board(title, list, valueFn, note = "", nameFn = (x) => escapeHtml(x.nick)) {
  const rows = list.length
    ? list.map((x, i) => `
      <div class="member-row">
        <span class="rank r${i + 1}">${i + 1}</span>
        <div class="info"><span class="nick">${nameFn(x)}</span></div>
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
