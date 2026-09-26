/* ============================================================
   member.js — 클럽원 개인 프로필 (v2.0.0)  member.html?id=<ouid>#<탭>
   한 사람의 정보를 한 곳에: 헤더(닉·등급·폼·시즌 판수) + 탭 6개
     개요(전적 요약·플레이스타일) · 인사이트(에이스·골 시간대·슈팅맵) · 스쿼드 · 라이벌 · 경기 · 구단운영(v2.4.0, js/manage.js 부품)
   선택한 탭은 주소 #탭에 반영 → 카톡 공유 링크·뒤로가기가 그대로 동작
   화면 조각은 공용 파일 재사용: insight-ui.js · activity-ui.js · squad.js, 이미지 공유는 share.js(탭마다 📸 — v2.3.0)
   ============================================================ */

const MATCH_TYPE_LABEL = { 50: "공식", 60: "공식친선", 30: "리그친선", 52: "감독모드", 40: "클래식" };
const COUNTED_TYPES = [50, 60, 30]; // 판수 인정 매치 (config.json countedMatchTypes와 동일)
const PF_TABS = [["overview", "개요"], ["insight", "인사이트"], ["squad", "스쿼드"], ["rival", "라이벌"], ["matches", "경기"], ["manage", "구단운영"]];
const PF_CTRL = { keyboard: ["⌨️", "키보드"], gamepad: ["🎮", "패드"] };

let PF = null; // 현재 프로필 컨텍스트 (share.js도 사용)

async function initProfile() {
  const root = document.getElementById("profile-root");
  const id = new URLSearchParams(location.search).get("id");
  const [membersFile, profilesFile, stylesFile, insightsFile, activityFile, squadsFile, dashFile] = await loadAll([
    "data/members.json", "data/profiles.json", "data/playstyles.json", "data/insights.json",
    "data/activity.json", "data/squads.json", "data/dashboard.json"
  ]);
  const member = ((membersFile && membersFile.members) || []).find((m) => m.ouid && m.ouid === id);
  if (!member) {
    root.innerHTML = emptyState(`클럽원을 찾을 수 없어요. <a href="members.html" style="text-decoration:underline;">클럽원 검색으로</a>`, "🔍");
    return;
  }
  const store = await loadJSON(`data/matches/${id}.json`).catch(() => null);
  const matches = (store && store.matches) || [];
  const cur = dashFile && dashFile.current;

  PF = {
    member,
    prof: (profilesFile && profilesFile.profiles && profilesFile.profiles[id]) || {},
    styles: stylesFile,
    style: stylesFile && stylesFile.players ? stylesFile.players[id] : null,
    ins: insightsFile,
    insMe: insightsFile && insightsFile.players ? insightsFile.players[id] : null,
    act: activityFile && activityFile.players ? activityFile.players[id] : null,
    squad: squadsFile && squadsFile.squads ? squadsFile.squads[id] : null,
    season: cur ? { name: cur.seasonName, row: (cur.rows || []).find((r) => r.ouid === id) } : null,
    matches,
    counted: matches.filter((m) => COUNTED_TYPES.includes(m.matchType))
  };
  myProfile.visit(id);
  document.title = `${member.ingameNick} · 도륙 Dor6`;

  root.innerHTML = `
    <div id="pf-head"></div>
    <div class="pf-tabs" role="tablist">${PF_TABS.map(([k, label]) =>
      `<a href="#${k}" class="pf-tab" data-tab="${k}" role="tab">${label}</a>`).join("")}</div>
    <div id="pf-body"></div>`;
  renderHead();
  window.addEventListener("hashchange", showTab);
  showTab();
}

/* ---------- 헤더: 닉·컨트롤러·역할·등급 / 폼·연승 / 시즌 판수 / 버튼 ---------- */
function renderHead() {
  const { member: m, prof, act, season, counted } = PF;
  const ci = PF.insMe && PF_CTRL[PF.insMe.ctrl];
  const w = counted.filter((x) => x.result === "win").length;
  const d = counted.filter((x) => x.result === "draw").length;
  const l = counted.filter((x) => x.result === "lose").length;
  const rate = counted.length ? Math.round((w / counted.length) * 100) : 0;
  const isMe = myProfile.get() === m.ouid;
  const row = season && season.row;
  document.getElementById("pf-head").innerHTML = `
    <div class="card pf-head">
      <div class="pf-name">${escapeHtml(m.ingameNick)}
        ${ci ? `<span class="ctrl-ico" title="주 컨트롤러: ${ci[1]}">${ci[0]}</span>` : ""} ${roleBadge(m.role)}</div>
      <div class="pf-sub"><b style="color:var(--silver);">${escapeHtml(prof.maxDivisionName || "-")}</b>
        ${prof.level ? ` · Lv.${prof.level}` : ""}
        ${row ? ` · ${escapeHtml(season.name)} 판수 <b>${row.played}</b>/${row.target}` : ""}</div>
      <div class="pf-form">${act ? formDots(act.form) + " " + streakBadge(act.streak) : ""}</div>
      <div class="pf-rec"><span class="wl win">${w}승</span> <span class="wl draw">${d}무</span> <span class="wl lose">${l}패</span>
        · 승률 <b>${rate}%</b> <span class="in-dim">· 인정 매치 누적 ${counted.length}경기</span></div>
      <div class="pf-actions">
        <button class="btn sm ${isMe ? "primary" : ""}" type="button" data-me>${isMe ? "⭐ 내 프로필" : "☆ 내 프로필로 설정"}</button>
      </div>
    </div>`;
  const head = document.getElementById("pf-head");
  head.querySelector("[data-me]").addEventListener("click", () => {
    myProfile.set(myProfile.get() === m.ouid ? null : m.ouid);   // 다시 누르면 해제
    renderHead();
  });
}

/* ---------- 탭 전환 ---------- */
function showTab() {
  const key = (location.hash || "").slice(1);
  const tab = PF_TABS.some(([k]) => k === key) ? key : "overview";
  document.querySelectorAll(".pf-tab").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
  // 탭이 화면 폭보다 많으면(6개) 선택한 탭이 보이도록 가로 스크롤만 이동
  const bar = document.querySelector(".pf-tabs"), act = bar && bar.querySelector(".pf-tab.active");
  if (act) bar.scrollLeft = Math.max(0, act.offsetLeft - (bar.clientWidth - act.offsetWidth) / 2);
  const body = document.getElementById("pf-body");
  const render = { overview: tabOverview, insight: tabInsight, squad: tabSquad, rival: tabRival, matches: tabMatches, manage: tabManage }[tab];
  body.innerHTML = `<div class="loading">불러오는 중…</div>`;
  Promise.resolve(render(body)).then(() => addCaptureBar(body, tab)).catch((e) => {
    console.error(`프로필 탭(${tab}) 표시 실패:`, e);
    body.innerHTML = errorState("이 탭을 표시하지 못했어요. 잠시 후 다시 시도해 주세요.");
  });
}

/* 📸 탭별 캡처 (v2.3.0) — 탭 본문 맨 위 버튼, 보이는 그대로 이미지로 (share.js shareSection)
   빈 탭(경기 없음 등)에는 버튼을 달지 않음 */
function addCaptureBar(body, tab) {
  if (tab === "manage") return;   // 구단운영은 모드별로 자체 📸 버튼이 있음
  if (body.querySelector(".empty") && body.children.length === 1) return;
  body.insertAdjacentHTML("afterbegin", shBarHtml());
  shWarmImages(body);
  const label = (PF_TABS.find(([k]) => k === tab) || [])[1] || tab;
  const m = PF.member, prof = PF.prof;
  body.querySelector("[data-capture]").addEventListener("click", (e) => shareSection(body, {
    btn: e.currentTarget, nick: m.ingameNick, tab: label, fileTag: tab,
    sub: [prof.maxDivisionName, prof.level ? `Lv.${prof.level}` : "", m.role].filter(Boolean).join(" · ")
  }));
}

/* 🩺 구단운영 (v2.4.0) — js/manage.js 부품을 ouid로 붙임. 모듈이 늦게 준비될 수 있어 이벤트로 대기 */
const mgReady = () => window.Dor6Manage ? Promise.resolve(window.Dor6Manage)
  : new Promise((r) => window.addEventListener("dor6-manage-ready", () => r(window.Dor6Manage), { once: true }));
async function tabManage(body) {
  body.innerHTML = `<div class="loading">불러오는 중…</div>`;
  const mg = await mgReady();
  if ((location.hash || "").slice(1) !== "manage") return;   // 준비 중 다른 탭으로 이동
  body.innerHTML = `<div class="mg-mount"></div>`;   // 탭 본문(#pf-body)은 다른 탭과 공유 → 전용 칸에 붙여 클릭 처리가 섞이지 않게
  await mg.mount(body.firstElementChild, { ouid: PF.member.ouid, nickname: PF.member.ingameNick });
}

/* 개요: 최근 15경기(인정 매치) + 🎭 플레이스타일 */
function tabOverview(body) {
  const strip = PF.counted.slice(0, 15).map((m) => `<span class="wl-dot ${m.result}">${fmt.wl(m.result)}</span>`).join("");
  const s = PF.styles;
  const base = s && s.baselineUpdated ? s.baselineUpdated.slice(0, 10) : "-";
  const defs = s ? Object.values(s.metrics || {}).map((x) => `<li><b>${escapeHtml(x.label)}</b> — ${escapeHtml(x.desc)}</li>`).join("") : "";
  body.innerHTML = `
    <div class="card" style="margin-bottom:var(--sp-3);">
      <div class="in-title">📈 최근 15경기 <span class="in-dim">왼쪽이 최신 · 공식·공식친선·리그친선</span></div>
      <div>${strip || `<span class="in-dim">경기 기록이 없어요.</span>`}</div>
    </div>
    <div class="card in-card">
      <div class="in-title">🎭 플레이스타일</div>
      ${psBlock(PF.style, s && s.minGames) || `<span class="in-dim">분석 데이터가 없어요.</span>`}
      ${s ? `<div class="ps-note" style="margin:var(--sp-3) 0 0;">최근 ${s.recentGames}경기 지표를 랭커 평균(${escapeHtml(s.baselineSource || "")}, ${s.baselineSampleSize}명·${base} 기준)과 비교해
        가장 높은 지표 ▲3, 낮은 지표 ▼3을 표시해요. 스타일은 이 중 <b>★ 지표</b>로 정해집니다. 재미로 봐주세요 😎
        <details><summary>지표 기준 보기</summary><ul>${defs}</ul></details></div>` : ""}
    </div>`;
}

/* 인사이트: 에이스 · 골 시간대 · 슈팅맵 (현재 시즌) */
async function tabInsight(body) {
  const ins = PF.ins, me = PF.insMe;
  if (!ins || !me || !me.games) {
    body.innerHTML = emptyState("이번 시즌 분석할 경기가 아직 없어요. 데이터 모으는 중…", "📊");
    return;
  }
  const meta = await sqLoadMeta();
  // 시즌 날짜는 KST, 경기 시각은 UTC(parseTime) — aggregate.js와 같은 범위
  const startT = new Date(ins.seasonStart + "T00:00:00+09:00").getTime();
  const endT = new Date(ins.seasonEnd + "T23:59:59+09:00").getTime();
  const shots = PF.matches
    .filter((m) => Array.isArray(m.shots) && ins.countedTypes.includes(m.matchType) && m.styleRaw && m.styleRaw.end === 0 &&
      parseTime(m.matchDate).getTime() >= startT && parseTime(m.matchDate).getTime() <= endT)
    .flatMap((m) => m.shots);
  body.innerHTML = `
    <div class="in-note" style="margin-bottom:var(--sp-2);">${escapeHtml(ins.seasonName)} ${me.games}경기 기준</div>
    <div class="in-grid">
      ${aceCard(me.ace, meta, ins)}
      ${goalTimeCard(me, ins.buckets)}
      <div class="card in-card" id="shotmap-card"></div>
    </div>`;
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

/* 스쿼드: 최근 경기 라인업 (모달 대신 탭 안에 바로) */
async function tabSquad(body) {
  if (!PF.squad) { body.innerHTML = emptyState("수집된 경기 라인업이 없어요.", "🧩"); return; }
  const meta = await sqLoadMeta();
  body.innerHTML = `<div class="card">${sqSquadHtml(PF.member.ingameNick, PF.squad, meta)}</div>`;
}

/* 라이벌: 😈 천적 · 🍖 먹잇감 · 🔁 자주 붙은 상대 (클럽원끼리 3판 이상) */
function tabRival(body) {
  const r = PF.act && PF.act.rivals;
  if (!r) { body.innerHTML = emptyState("내전 기록이 없어요.", "🆚"); return; }
  const rec = (o) => `<span class="wl win">${o.win}승</span> <span class="wl draw">${o.draw}무</span> <span class="wl lose">${o.lose}패</span>`;
  const big = (label, o, emptyMsg) => `
    <div class="rv-box">
      <div class="rv-label">${label}</div>
      ${o ? `<a class="rv-nick" href="${profileUrl(o.ouid, "rival")}">${escapeHtml(o.nick)}</a><div class="rv-rec">${rec(o)} <span class="in-dim">· 승점률 ${o.rate}%</span></div>`
          : `<div class="in-dim">${emptyMsg}</div>`}
    </div>`;
  const freq = r.frequent.length
    ? r.frequent.map((o) => `<div class="rv-row"><a href="${profileUrl(o.ouid, "rival")}">${escapeHtml(o.nick)}</a><span>${o.games}판 · ${rec(o)}</span></div>`).join("")
    : `<div class="in-dim">클럽원과 3판 이상 붙은 기록이 아직 없어요.</div>`;
  body.innerHTML = `
    <div class="in-note" style="margin-bottom:var(--sp-2);">클럽원끼리 ${r.internalGames}경기 (주로 클래식 1on1) · 3판 이상 붙은 상대 기준 · 승점률 = (승×3+무)÷(판×3)</div>
    <div class="card in-card">
      <div class="rv-grid">
        ${big("😈 천적", r.nemesis, "천적 없음 — 아무도 무섭지 않다")}
        ${big("🍖 먹잇감", r.prey, "먹잇감 없음 — 아직 사냥 전")}
      </div>
      <div class="rv-freq-title">🔁 자주 붙은 상대</div>
      ${freq}
    </div>`;
}

/* 경기: 최근 30경기(클래식 포함) — 탭하면 양팀 스쿼드 */
function tabMatches(body) {
  const recent = PF.matches.slice(0, 30);
  if (!recent.length) { body.innerHTML = emptyState("수집된 경기가 없어요.", "📭"); return; }
  body.innerHTML = `
    <div class="in-note" style="margin-bottom:var(--sp-2);">최근 ${recent.length}경기 · 탭하면 양팀 스쿼드</div>
    <div class="card">${recent.map((m) => {
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
      </div>`;
    }).join("")}</div>`;
  body.querySelectorAll(".match-row").forEach((row, i) => {
    row.addEventListener("click", async () => openMatchModal(recent[i], await sqLoadMeta(), PF.member.ingameNick));
  });
}

initProfile();
