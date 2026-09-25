/* ============================================================
   insight-ui.js — 플레이스타일·에이스 선수 화면 조각 (공용)
   사용처: members.js(명단 플레이스타일) · record.js(시즌 인사이트 에이스) · search.js(전적 검색)
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
