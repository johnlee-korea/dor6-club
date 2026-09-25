/* record.js — 클럽원 개별 전적 (최근 경기 + 탭하면 양팀 스쿼드 모달) */

const MATCH_TYPE_LABEL = { 50: "공식", 60: "공식친선", 30: "리그친선", 52: "감독모드", 40: "1on1" };
let membersCache = [];

async function initRecord() {
  const [membersFile] = await loadAll(["data/members.json"]);

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
    <div id="insight-root"></div>
    <div class="section-title">최근 경기 <span style="font-size:var(--fs-xs);color:var(--text-dim);font-weight:400;">· 탭하면 양팀 스쿼드</span></div>
    <div class="card">${recent.map(matchRow).join("")}</div>
  `;

  renderInsights(ouid, matches).catch((e) => console.error("인사이트 표시 실패:", e));

  // 선수 메타(이름·시즌)는 첫 탭 때 로딩(sqLoadMeta 내부 캐시)
  root.querySelectorAll(".match-row").forEach((row, i) => {
    row.addEventListener("click", async () => {
      const meta = await sqLoadMeta();
      openMatchModal(recent[i], meta, member.ingameNick);
    });
  });
}

/* ============================================================
   경기 상세 인사이트 (v1.9.0) — 에이스 선수 · 골 시간대 · 슈팅맵
   집계값은 data/insights.json(현재 시즌), 슈팅맵은 회원 매치 파일의 shots를 같은 범위로 걸러 그림
   ============================================================ */
let _insightsPromise = null;
const loadInsights = () => (_insightsPromise ||= loadJSON("data/insights.json").catch(() => null));

async function renderInsights(ouid, matches) {
  const box = document.getElementById("insight-root");
  const ins = await loadInsights();
  const me = ins && ins.players && ins.players[ouid];
  if (!box || !ins) return;
  if (!me || !me.games) {
    box.innerHTML = `<div class="card in-card"><div class="in-title">📊 ${escapeHtml(ins.seasonName)} 인사이트</div>
      <div class="empty" style="padding:var(--sp-3);">이번 시즌 분석할 경기가 아직 없어요. 데이터 모으는 중…</div></div>`;
    return;
  }
  const meta = await sqLoadMeta();
  const startT = new Date(ins.seasonStart + "T00:00:00").getTime();
  const endT = new Date(ins.seasonEnd + "T23:59:59").getTime();
  const shots = matches
    .filter((m) => Array.isArray(m.shots) && ins.countedTypes.includes(m.matchType) &&
      m.styleRaw && m.styleRaw.end === 0 &&
      new Date(m.matchDate).getTime() >= startT && new Date(m.matchDate).getTime() <= endT)
    .flatMap((m) => m.shots);

  const note = `<span class="in-note">· ${escapeHtml(ins.seasonName)} ${me.games}경기 기준</span>`;
  box.innerHTML = `
    <div class="section-title">📊 시즌 인사이트 ${note}</div>
    <div class="in-grid">
      ${aceCard(me.ace, meta, ins)}
      ${goalTimeCard(me, ins.buckets)}
      <div class="card in-card" id="shotmap-card"></div>
    </div>`;

  // 슈팅맵 필터(전체/골만) — 카드 안에서만 다시 그림
  const mapCard = document.getElementById("shotmap-card");
  let onlyGoals = false;
  const draw = () => { mapCard.innerHTML = shotMapCard(shots, onlyGoals); };
  mapCard.addEventListener("click", (e) => {
    const b = e.target.closest("[data-shotfilter]");
    if (!b) return;
    onlyGoals = b.dataset.shotfilter === "goal";
    draw();
  });
  draw();
}

/* ① 에이스 선수 TOP3 (v1.10.0) — 같은 포지션 랭커 선수들 대비 가장 돋보이는 지표 순
   칭호는 랭커 분포보다 1표준편차 이상 높을 때만(aggregate.js·lib/insight.js 판정) */
function aceCard(ace, meta, ins) {
  const rows = (ace || []).map((a, i) => {
    const metric = ins.metricLabels[a.metric] || a.metric;
    const group = ins.groupLabels[a.group] || a.group;
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
    <div class="in-dim" style="margin-top:var(--sp-2);">같은 포지션 랭커 선수 평균 대비 가장 돋보이는 지표 기준 · 칭호는 눈에 띄게 높을 때만</div></div>`;
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

function matchRow(m) {
  const label = MATCH_TYPE_LABEL[m.matchType] || `유형${m.matchType}`;
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
    </div>
  `;
}

initRecord();
