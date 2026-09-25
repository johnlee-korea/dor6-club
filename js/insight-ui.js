/* ============================================================
   insight-ui.js — 플레이스타일·에이스 선수 화면 조각 (공용)
   사용처: member.js(프로필 개요·인사이트) · search.js(전적 검색) · share.js(공유 이미지)
   판정은 서버 쪽(scripts/lib/playstyle.js·insight.js — aggregate.js / Worker)에서 끝내고 여기서는 그리기만 한다
   의존: common.js(escapeHtml), squad.js(sqPlayerChip)
   ============================================================ */

/* 지표 값 표시 — '%'는 0~1 비율, 'avg%'는 이미 % 값, 그 외는 경기당 수치 */
function psVal(v, unit) {
  if (unit === "%") return `${(v * 100).toFixed(1)}%`;
  if (unit === "avg%") return `${v.toFixed(1)}%`;
  return v.toFixed(2);
}

function psChip(x, dir) {
  const tip = `나 ${psVal(x.v, x.unit)} · 랭커 평균 ${psVal(x.avg, x.unit)}`;
  return `<span class="ps-chip ${dir}${x.key ? " key" : ""}" title="${escapeHtml(tip)}">${x.key ? "★" : dir === "up" ? "▲" : "▼"} ${escapeHtml(x.label)} <b>${psVal(x.v, x.unit)}</b></span>`;
}

/* 플레이스타일 블록 — ps: { games, style?, highs?, lows? } (playstyles.json 회원 항목 또는 검색 analysis) */
function psBlock(ps, minGames) {
  if (!ps) return "";
  if (!ps.style) return `<div class="ps"><span class="ps-wait">🎭 스타일 분석 대기 (${ps.games}/${minGames}경기)</span></div>`;
  return `
    <div class="ps">
      <div><span class="ps-name">🎭 ${escapeHtml(ps.style.name)}</span> <span class="ps-line">“${escapeHtml(ps.style.line)}”</span></div>
      <div class="ps-chips">${ps.highs.map((x) => psChip(x, "up")).join("")}${ps.lows.map((x) => psChip(x, "down")).join("")}</div>
    </div>`;
}

/* 에이스 선수 TOP3 (v1.10.0) — 선수별 주 포지션에서 같은 포지션 랭커 선수들 대비 가장 돋보이는 지표 순
   칭호는 랭커 분포보다 1표준편차 이상 높을 때만(lib/insight.js 판정)
   labels: { metricLabels, groupLabels } (insights.json 또는 검색 analysis), note: 카드 하단 기준 안내 */
function aceCard(ace, meta, labels, note) {
  const rows = (ace || []).map((a, i) => {
    const metric = labels.metricLabels[a.metric] || a.metric;
    const group = labels.groupLabels[a.group] || a.group;
    const ratio = a.base > 0 && a.metric !== "rt" ? ` <b class="in-up">${(a.value / a.base).toFixed(1)}배</b>` : "";
    const title = a.title
      ? `<span class="in-ace-title">${a.title.emoji} ${escapeHtml(a.title.name)}</span>`
      : `<span class="in-ace-title plain">돋보인 지표</span>`;
    return `
    <div class="in-ace">
      <span class="rank r${i + 1}">${i + 1}</span>
      <div class="in-ace-body">
        ${title}
        <div class="in-ace-player">${sqPlayerChip(a.spId, meta)}
          <span class="badge">${escapeHtml(meta.posName[a.pos] || group)}</span></div>
        <div class="in-ace-stat">${escapeHtml(metric)} <b>${a.value}</b>/경기 · 랭커 ${escapeHtml(group)} 평균 ${a.base}${ratio}
          <span class="in-dim">· 선발 ${a.games}경기</span></div>
      </div>
    </div>`;
  }).join("");
  return `<div class="card in-card"><div class="in-title">⚽ 에이스 선수</div>
    ${rows || `<div class="empty" style="padding:var(--sp-3);">한 포지션에서 선발 5경기 이상 뛴 선수가 아직 없어요.</div>`}
    <div class="in-dim" style="margin-top:var(--sp-2);">${note || "선수별 주 포지션(선발 최다)에서 같은 포지션 랭커 선수 평균 대비 가장 돋보이는 지표 기준 · 칭호는 눈에 띄게 높을 때만"}</div></div>`;
}

/* ② 골 시간대 — 위(득점)·아래(실점) 대칭 막대 + 역전승·극장골 배지 */
function goalTimeCard(me, buckets) {
  const f = me.goalMins.for, a = me.goalMins.against;
  const max = Math.max(1, ...f, ...a);
  const cols = buckets.map((label, i) => `
    <div class="in-col" title="${label}분 득점 ${f[i]} · 실점 ${a[i]}">
      <span class="in-num">${f[i] || ""}</span>
      <div class="in-bar-up"><i style="height:${(f[i] / max) * 100}%"></i></div>
      <div class="in-bar-down"><i style="height:${(a[i] / max) * 100}%"></i></div>
      <span class="in-num lose">${a[i] || ""}</span>
      <span class="in-lbl">${label}</span>
    </div>`).join("");
  const sum = (arr) => arr.reduce((s, v) => s + v, 0);
  return `<div class="card in-card"><div class="in-title">⏱ 골 시간대
      <span class="in-dim">득점 ${sum(f)} · 실점 ${sum(a)}</span></div>
    <div class="in-legend"><span class="win">■ 득점</span> <span class="lose">■ 실점</span></div>
    <div class="in-chart">${cols}</div>
    <div class="in-badges">
      <span class="in-badge">🔄 역전승 <b>${me.comebacks}</b></span>
      <span class="in-badge" title="80분 이후 동점→리드 골로 승리">🎭 극장골 <b>${me.lateWinners}</b></span>
    </div></div>`;
}

/* ③ 슈팅맵 — 공격 하프 코트(세로, 위가 상대 골문). 넥슨 좌표 x: 0 내 골문 → 1 상대 골문, y: 0~1 좌우
   SVG 단위 = 미터(가로 68 × 세로 52.5) */
function shotMapCard(shots, onlyGoals) {
  const W = 68, H = 52.5, L = 105;
  const list = onlyGoals ? shots.filter((s) => s[3] === 3) : shots;
  const marks = list.map(([t, x, y, res]) => {
    const px = (y * W).toFixed(1), py = Math.min(H - 0.8, (1 - x) * L).toFixed(1);
    const min = Math.floor(t / 60) + 1;
    if (res === 3) return `<circle class="sm-goal" cx="${px}" cy="${py}" r="1.1"><title>골 ${min}분</title></circle>`;
    if (res === 1) return `<circle class="sm-on" cx="${px}" cy="${py}" r="0.9"><title>유효슈팅 ${min}분</title></circle>`;
    return `<path class="sm-off" d="M${px - 0.7} ${py - 0.7}l1.4 1.4m0-1.4l-1.4 1.4"><title>빗나감 ${min}분</title></path>`;
  }).join("");
  const goals = shots.filter((s) => s[3] === 3);
  const onT = shots.filter((s) => s[3] !== 2).length;
  const boxGoals = goals.filter((s) => s[1] >= 1 - 16.5 / L && s[2] >= 0.204 && s[2] <= 0.796).length;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  return `
    <div class="in-title">🎯 슈팅맵
      <span class="chip-row in-filter">
        <button class="chip ${onlyGoals ? "" : "active"}" data-shotfilter="all">전체</button>
        <button class="chip ${onlyGoals ? "active" : ""}" data-shotfilter="goal">골만</button>
      </span></div>
    <svg class="shotmap" viewBox="-1 -1 ${W + 2} ${H + 2}" role="img" aria-label="슈팅 위치">
      <rect class="sm-pitch" x="0" y="0" width="${W}" height="${H}"/>
      <rect class="sm-line" x="${(W - 40.32) / 2}" y="0" width="40.32" height="16.5"/>
      <rect class="sm-line" x="${(W - 18.32) / 2}" y="0" width="18.32" height="5.5"/>
      <rect class="sm-goalpost" x="${(W - 7.32) / 2}" y="-1" width="7.32" height="1"/>
      <circle class="sm-dot" cx="${W / 2}" cy="11" r="0.3"/>
      <path class="sm-line" d="M${W / 2 - 7.3} 16.5 A9.15 9.15 0 0 0 ${W / 2 + 7.3} 16.5"/>
      <path class="sm-line" d="M${W / 2 - 9.15} ${H} A9.15 9.15 0 0 1 ${W / 2 + 9.15} ${H}"/>
      ${marks}
    </svg>
    <div class="in-legend"><span class="sm-k goal">●</span> 골 <span class="sm-k on">○</span> 유효 <span class="sm-k off">×</span> 빗나감</div>
    <div class="in-dim" style="margin-top:var(--sp-1);">슈팅 ${shots.length} · 유효 ${pct(onT, shots.length)}% · 결정력 ${pct(goals.length, shots.length)}% · 박스 안 골 ${pct(boxGoals, goals.length)}%</div>`;
}
