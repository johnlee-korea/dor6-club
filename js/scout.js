/* ============================================================
   scout.js — ⚔️ 상대 분석 (v2.28.0, CLAUDE.md 32장)
   목적: 공식경기 매칭 직후 몇십 초 안에 상대 닉 하나로 "막을 것·노릴 곳·나와 비교한 주의점"을 한 장에.
   - 상대: Worker /search (전적 검색과 같은 응답 — 공식경기 최근 30경기 원본 analysis.guideRows)
   - 나:   같은 /search 결과를 이 기기에 저장해 두고 재사용 (MINE_TTL) → 경기 직전엔 상대 1명만 조회
   - 판정: scripts/lib/scout.js (동적 import, 규칙·문장 템플릿 단일 소스) — 여기서는 그리기만
   - 포메이션·맞대결은 라인업·닉이 필요해 이 파일에서 계산 (포메이션 표기는 squad.js sqFormation 재사용)
   의존: common.js · auth.js · squad.js · insight-ui.js · share.js
   ============================================================ */

const SC_ME_KEY = "dor6.scout.me";            // 내 닉네임
const SC_MINE_KEY = "dor6.scout.mine";        // 내 /search 결과 { nick, fetchedAt, data }
const SC_RECENT_KEY = "dor6.scout.recent";    // 최근 상대 닉 (최대 5)
const SC_SEARCH_PREFIX = "dor6.search.";      // 전적 검색 캐시와 공유 (search.js와 같은 형식)
const MINE_TTL = 6 * 3600 * 1000;             // 내 데이터 재사용 시간
const OPP_TTL = 10 * 60 * 1000;               // 같은 상대를 10분 안에 다시 넣으면 저장본 사용
const SC_ANALYSIS_VERSION = 2;                // guideRows가 들어간 응답 (Worker ANALYSIS_VERSION)

/* ---------- 저장소 (사생활 모드 등에서 실패해도 동작) ---------- */
const scGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const scSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn("[상대 분석] 저장 실패(계속 진행):", e); } };
const fresh = (entry, ttl) => entry && entry.data && entry.data.analysis && entry.data.analysis.version >= SC_ANALYSIS_VERSION
  && entry.data.analysis.guideRows && Date.now() - new Date(entry.fetchedAt).getTime() < ttl;
const sameNick = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

/* 판정 로직·기준값 (페이지당 1회, 미리 불러 둠 — 조회 버튼을 누를 때 대기 없게) */
let _scLib = null;
function scLib() {
  if (!_scLib) {
    _scLib = Promise.all([
      import(new URL("scripts/lib/scout.js", document.baseURI).href),
      import(new URL("scripts/lib/insight.js", document.baseURI).href),
      fetch("data/meta/ranker-baseline.json").then((r) => r.json())
    ]).then(([scout, insight, base]) => ({ ...scout, goalFlow: insight.goalFlow, GOAL_BUCKETS: insight.GOAL_BUCKETS, base: base.stats }));
    _scLib.catch(() => { _scLib = null; });
  }
  return _scLib;
}

/* ---------- 내 데이터 ---------- */
let mine = null;          // { nick, fetchedAt, data }
let mineLoading = null;   // 진행 중 Promise

async function myNick() {
  const n = scGet(SC_ME_KEY);
  if (n) return n;
  // ⭐ 내 프로필(클럽원)이 있으면 그 닉을 기본값으로
  const ouid = myProfile.get();
  if (!ouid) return null;
  try {
    const m = (await loadJSON("data/members.json")).members.find((x) => x.ouid === ouid);
    if (m && m.ingameNick) { scSet(SC_ME_KEY, m.ingameNick); return m.ingameNick; }
  } catch (e) { console.error("[상대 분석] 내 프로필 닉 조회 실패:", e); }
  return null;
}

/* 내 데이터 준비 — 저장본이 오래됐거나 없으면 백그라운드로 조회 (force: 강제 새로고침) */
function loadMine(nick, force = false) {
  const saved = scGet(SC_MINE_KEY);
  if (!force && saved && sameNick(saved.nick, nick) && fresh(saved, MINE_TTL)) { mine = saved; renderMe(); return Promise.resolve(mine); }
  if (mineLoading) return mineLoading;
  renderMe("loading");
  mineLoading = auth.call("/search", { nickname: nick })
    .then((data) => {
      mine = { nick: data.nickname || nick, fetchedAt: new Date().toISOString(), data };
      scSet(SC_MINE_KEY, mine);
      if (data.nickname && data.nickname !== nick) scSet(SC_ME_KEY, data.nickname);
      return mine;
    })
    .catch((e) => {
      console.error("[상대 분석] 내 데이터 조회 실패:", e);
      mine = saved && sameNick(saved.nick, nick) ? saved : null;   // 오래된 저장본이라도 있으면 사용
      renderMe(mine ? null : "error", e.message);
      return mine;
    })
    .finally(() => { mineLoading = null; renderMe(); });
  return mineLoading;
}

function renderMe(state, err) {
  const box = document.getElementById("sc-me");
  if (!box) return;
  const nick = scGet(SC_ME_KEY);
  if (!nick) {
    box.innerHTML = `<div class="sc-me-set">
        <span>👤 내 닉네임을 한 번 넣어 두면 나와 비교해 드려요</span>
        <span class="sc-row"><input id="sc-me-q" class="input" placeholder="내 닉네임" autocomplete="off" autocapitalize="off">
        <button class="btn sm" type="button" data-me-save>저장</button></span></div>`;
    return;
  }
  const st = state === "loading" || mineLoading ? `<span class="sc-dim">⏳ 내 기록 준비 중…</span>`
    : state === "error" ? `<span class="sc-bad">⚠️ 내 기록을 못 불러왔어요 (${escapeHtml(err || "")})</span>`
    : mine ? `<span class="sc-dim">✅ 최근 ${mine.data.analysis ? mine.data.analysis.games : 0}경기 준비됨 · ${fmt.dateTime(mine.fetchedAt)}</span>` : "";
  box.innerHTML = `<div class="sc-me-line">👤 나: <b>${escapeHtml(nick)}</b> ${st}
    <span class="sc-me-act"><button class="btn sm" type="button" data-me-refresh title="내 기록 새로 가져오기">🔄</button>
    <button class="btn sm" type="button" data-me-edit>변경</button></span></div>`;
}

/* ---------- 상대 조회 ---------- */
let current = null;   // { nick, fetchedAt, data }
let scBusy = false;

async function runScout(force = false) {
  const input = document.getElementById("sc-q");
  const msg = document.getElementById("sc-msg");
  const root = document.getElementById("sc-root");
  const nick = input.value.trim();
  if (!nick) { msg.textContent = "상대 닉네임을 입력하세요."; input.focus(); return; }
  if (scBusy) return;
  msg.textContent = "";
  input.blur();   // 모바일 키보드 내리기 → 결과가 바로 보이게
  const meNick = scGet(SC_ME_KEY);
  if (meNick && sameNick(meNick, nick)) { msg.textContent = "내 닉네임이에요. 상대 닉네임을 넣어 주세요."; return; }

  const cached = scGet(SC_SEARCH_PREFIX + nick.toLowerCase());
  let entry = !force && fresh(cached, OPP_TTL) ? cached : null;
  if (!entry) {
    scBusy = true;
    const t0 = Date.now();
    root.innerHTML = `<div class="card"><div class="loading">🔍 ${escapeHtml(nick)} 최근 30경기 분석 중… <b id="sc-sec">0</b>초</div></div>`;
    const timer = setInterval(() => { const s = document.getElementById("sc-sec"); if (s) s.textContent = Math.floor((Date.now() - t0) / 1000); }, 500);
    try {
      const data = await auth.call("/search", { nickname: nick });
      entry = { fetchedAt: new Date().toISOString(), data };
      scSet(SC_SEARCH_PREFIX + nick.toLowerCase(), entry);   // 전적 검색에서도 바로 보이게
    } catch (e) {
      console.error("[상대 분석] 상대 조회 실패:", e);
      root.innerHTML = errorState(escapeHtml(e.message) + (cached && cached.data ? " — 이전에 조회한 결과를 표시합니다." : ""));
      if (cached && cached.data) entry = cached; else return;
    } finally { clearInterval(timer); scBusy = false; }
  }
  addRecent(entry.data.nickname || nick);
  current = { nick: entry.data.nickname || nick, fetchedAt: entry.fetchedAt, data: entry.data };
  if (mineLoading) await mineLoading;   // 내 기록이 거의 다 왔으면 기다렸다 함께 그림
  history.replaceState(null, "", "?q=" + encodeURIComponent(current.nick));
  await render();
}

function addRecent(nick) {
  const list = [nick, ...(scGet(SC_RECENT_KEY) || []).filter((n) => !sameNick(n, nick))].slice(0, 5);
  scSet(SC_RECENT_KEY, list);
  renderRecent();
}
function renderRecent() {
  const list = scGet(SC_RECENT_KEY) || [];
  document.getElementById("sc-recent").innerHTML = list.length
    ? `<div class="chip-row sc-recent">${list.map((n) => `<button class="chip" type="button" data-nick="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join("")}</div>` : "";
}

/* ---------- 화면 계산 (라인업·닉 필요) ---------- */
/* 주 포메이션 — 최근 경기 선발 포지션 → sqFormation, 많이 쓴 순 2개 */
function formations(matches) {
  const cnt = new Map();
  let n = 0;
  for (const m of matches || []) {
    const st = (m.lineup || []).filter((p) => p.spPosition !== SQ_SUB_POSITION).map((p) => ({ pos: p.spPosition }));
    if (st.length !== 11) continue;
    const f = sqFormation(st);
    cnt.set(f, (cnt.get(f) || 0) + 1);
    n++;
  }
  return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([f, c]) => ({ f, c, pct: Math.round((c / n) * 100) }));
}

/* 맞대결 — 상대 기록의 상대 닉 = 나, 내 기록의 상대 닉 = 상대 (matchId로 중복 제거, 결과는 내 기준) */
function headToHead(opp, me) {
  const out = new Map();
  const flip = { win: "lose", lose: "win", draw: "draw" };
  for (const m of opp.matches || []) if (me && sameNick(m.opponentNick, me.nickname))
    out.set(m.matchId, { matchDate: m.matchDate, result: flip[m.result], gf: m.goalAgainst, ga: m.goalFor });
  for (const m of (me && me.matches) || []) if (sameNick(m.opponentNick, opp.nickname))
    out.set(m.matchId, { matchDate: m.matchDate, result: m.result, gf: m.goalFor, ga: m.goalAgainst });
  return [...out.values()].sort((a, b) => String(b.matchDate).localeCompare(String(a.matchDate)));
}

/* ---------- 그리기 ---------- */
const evidTxt = (x) => `${escapeHtml(x.label)} <b>${escapeHtml(x.v)}</b>${x.avg != null ? ` <span class="sc-dim">랭커 ${escapeHtml(x.avg)}</span>` : ""}`;
const itemHtml = (x, kind) => `
  <div class="sc-item ${kind}">
    <div class="sc-item-head">${escapeHtml(x.head)}</div>
    <div class="sc-item-ev">${evidTxt(x)}</div>
    <div class="sc-item-tip">${escapeHtml(x.tip)}</div>
  </div>`;

function barsHtml(bars) {
  return bars.map((b) => {
    const max = Math.max(b.oppRaw, b.meRaw) * 1.15 || 1;
    const w = (v) => Math.max(2, Math.min(100, (v / max) * 100)).toFixed(1);
    return `<div class="sc-bar">
      <div class="sc-bar-label">${escapeHtml(b.label)}${b.avg != null ? ` <span class="sc-dim">랭커 ${escapeHtml(b.avg)}</span>` : ""}</div>
      <div class="sc-bar-line opp"><i style="width:${w(b.oppRaw)}%"></i><b>${escapeHtml(b.opp)}</b></div>
      <div class="sc-bar-line me"><i style="width:${w(b.meRaw)}%"></i><b>${escapeHtml(b.me)}</b></div>
    </div>`;
  }).join("");
}

const vsItem = (x) => `
  <div class="sc-item ${x.kind === "caution" ? "bad" : "good"}">
    <div class="sc-item-head">${escapeHtml(x.text)}</div>
    <div class="sc-item-ev">상대 ${escapeHtml(x.oppLabel)} <b>${escapeHtml(x.oppV)}</b>${x.avgO ? ` <span class="sc-dim">(랭커 ${escapeHtml(x.avgO)})</span>` : ""}
      · 나 ${escapeHtml(x.meLabel)} <b>${escapeHtml(x.meV)}</b>${x.avgM ? ` <span class="sc-dim">(랭커 ${escapeHtml(x.avgM)})</span>` : ""}</div>
  </div>`;

async function render() {
  const root = document.getElementById("sc-root");
  const d = current.data, a = d.analysis;
  if (!a || !a.guideRows) {
    root.innerHTML = errorState("분석 데이터가 없는 응답이에요. 잠시 뒤 다시 시도해 주세요.");
    return;
  }
  let lib;
  try { lib = await scLib(); }
  catch (e) { console.error("[상대 분석] 판정 로직 로딩 실패:", e); root.innerHTML = errorState("분석 도구를 불러오지 못했어요. 새로고침해 주세요."); return; }

  const me = mine && mine.data && mine.data.analysis && mine.data.analysis.guideRows ? mine.data : null;
  const s = lib.buildScout(a.guideRows, lib.base, me ? me.analysis.guideRows : null);
  const form = (d.matches || []).slice(0, 5).map((m) => `<span class="wl-dot ${m.result}">${fmt.wl(m.result)}</span>`).join("");
  const style = a.playstyle && a.playstyle.style;

  if (!s.record) {
    root.innerHTML = `<div class="card sc-head"><div class="sc-nick">${escapeHtml(d.nickname || current.nick)}</div>
      <div class="sc-dim">${escapeHtml(d.maxDivision || "-")} · 최근 공식경기 ${form}</div></div>
      ${emptyState(`공식경기 정상 종료가 ${s.minGames}경기 이상이어야 분석할 수 있어요 (지금 ${s.games}경기). 공식경기를 거의 안 하는 상대예요.`, "🤷")}`;
    return;
  }

  const fms = formations(d.matches);
  const h2h = headToHead(d, me);
  const r = s.record;
  // 한눈 요약: 막을 것 1 · 노릴 곳 1 · 나와 비교 주의 1
  const quick = [
    s.threats[0] && `🛡 <b>${escapeHtml(s.threats[0].head)}</b>`,
    s.holes[0] && `🎯 <b>${escapeHtml(s.holes[0].head)}</b>`,
    s.vs && s.vs.cautions[0] && `⚠️ ${escapeHtml(s.vs.cautions[0].text.split(" → ")[1] || s.vs.cautions[0].text)}`
  ].filter(Boolean);

  // 골 시간대 카드(insight-ui goalTimeCard 형식: 7구간 + 역전승·극장골)
  const flows = a.guideRows.map((x) => lib.goalFlow(x)).filter(Boolean);
  const gt = { goalMins: { for: [...s.goalTime.gf, 0], against: [...s.goalTime.ga, 0] },
    comebacks: flows.filter((f) => f.comeback).length, lateWinners: flows.filter((f) => f.lateWinner).length };
  const shots = a.guideRows.flatMap((x) => x.shots || []);
  const meta = await sqEnsureNames(await sqLoadMeta(), [(a.ace || []).map((x) => ({ spId: x.spId }))]);

  root.innerHTML = `
  <div id="sc-sheet">
    <div class="card sc-head">
      <div class="sc-head-top">
        <span class="sc-vs">VS</span>
        <span class="sc-nick">${escapeHtml(d.nickname || current.nick)}</span>
        <span class="sc-div">${escapeHtml(d.maxDivision || "-")}</span>
      </div>
      <div class="sc-rec">최근 ${s.games}경기 <b>${r.w}승 ${r.d}무 ${r.l}패</b> · 승률 <b>${r.winRate}%</b> · 경기당 <b>${r.gf}</b>득 <b>${r.ga}</b>실</div>
      <div class="sc-form">최근 5경기 ${form}</div>
      ${style ? `<div class="sc-style">🎭 ${escapeHtml(style.name)} <span class="sc-dim">“${escapeHtml(style.line)}”</span></div>` : ""}
      ${quick.length ? `<div class="sc-quick">${quick.map((q) => `<div>${q}</div>`).join("")}</div>` : ""}
    </div>

    <div class="card sc-card">
      <div class="sc-title">🧠 전술 추정</div>
      <div class="sc-tac">
        <div class="sc-tac-row"><span>포메이션</span><b>${fms.length ? fms.map((f, i) => `${escapeHtml(f.f)} <span class="sc-dim">${f.pct}%</span>`).join(" · ") : "-"}</b></div>
        ${s.tactics.map((t) => `<div class="sc-tac-row${t.plain ? " plain" : ""}"><span>${escapeHtml(t.name)}</span><b>${escapeHtml(t.value)}</b>${t.v ? `<em>${escapeHtml(t.label)} ${escapeHtml(t.v)}${t.avg ? ` · 랭커 ${escapeHtml(t.avg)}` : ""}</em>` : ""}</div>`).join("")}
      </div>
    </div>

    <div class="card sc-card">
      <div class="sc-title">🛡 이것만 막아라</div>
      ${s.threats.length ? s.threats.map((x) => itemHtml(x, "bad")).join("") : `<div class="sc-dim">랭커보다 확실히 많이 쓰는 공격 방식은 없어요 — 고르게 섞는 상대예요.</div>`}
    </div>

    <div class="card sc-card">
      <div class="sc-title">🎯 여길 노려라</div>
      ${s.holes.length ? s.holes.map((x) => itemHtml(x, "good")).join("") : `<div class="sc-dim">랭커보다 확실히 약한 곳은 안 보여요 — 탄탄한 상대예요.</div>`}
    </div>

    <div class="card sc-card">
      <div class="sc-title">⚔️ 나 vs 상대</div>
      ${s.vs ? `
        <div class="sc-legend"><span class="opp">■ 상대 ${escapeHtml(d.nickname || "")}</span> <span class="me">■ 나 ${escapeHtml(me.nickname || "")}</span></div>
        ${barsHtml(s.vs.bars)}
        <div class="sc-sub">⚠️ 특히 조심</div>
        ${s.vs.cautions.length ? s.vs.cautions.map(vsItem).join("") : `<div class="sc-dim">상대 강점과 내 약점이 맞물리는 곳은 없어요.</div>`}
        <div class="sc-sub">✅ 내가 유리한 곳</div>
        ${s.vs.chances.length ? s.vs.chances.map(vsItem).join("") : `<div class="sc-dim">상대 약점을 내 강점으로 찌를 조합은 안 보여요.</div>`}`
      : me ? `<div class="sc-dim">내 공식경기 정상 종료가 ${s.myGames}경기라 비교하기엔 적어요 (10경기 이상).</div>`
      : `<div class="sc-dim">위에서 내 닉네임을 저장하면 나와 비교해 드려요.</div>`}
      ${h2h.length ? `<div class="sc-sub">🤝 맞대결 (최근 기록 안)</div><div class="sc-h2h">${h2h.map((m) =>
        `<span class="wl-dot ${m.result}">${fmt.wl(m.result)}</span> ${m.gf}:${m.ga} <span class="sc-dim">${fmt.date(m.matchDate)}</span>`).join("<br>")}</div>` : ""}
    </div>

    ${aceCard(a.ace, meta, a, "경계 선수 — 상대 선수별 주 포지션에서 같은 포지션 랭커 평균 대비 가장 돋보이는 지표 · 선발 5경기 이상").replace("⚽ 에이스 선수", "⚽ 경계 선수 (상대 에이스)")}
    ${goalTimeCard(gt, lib.GOAL_BUCKETS)}
    <div class="card in-card" id="sc-shots">${shotMapCard(shots, false)}</div>
    <div class="sc-note">공식경기 최근 ${s.games}경기(정상 종료) 기준 · 랭커 = 공식경기 상위 랭커 평균.
      넥슨 API에는 팀 전술 설정(공격 성향·수비 스타일 등)이 없어 <b>전술은 포메이션과 실제 플레이 지표로 추정</b>했어요.
      조회 ${fmt.dateTime(current.fetchedAt)}</div>
  </div>
  <div class="sc-actions">
    <button class="btn sm" type="button" data-sc-refresh>🔄 다시 조회</button>
    <button class="btn sm" type="button" data-sc-capture>📸 이미지로</button>
    <a class="btn sm" href="search.html?q=${encodeURIComponent(d.nickname || current.nick)}">📋 전적 자세히</a>
  </div>`;
  root.scrollIntoView && root.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- 이벤트 ---------- */
function onClick(e) {
  const chip = e.target.closest("#sc-recent [data-nick]");
  if (chip) { document.getElementById("sc-q").value = chip.dataset.nick; runScout(); return; }
  if (e.target.closest("[data-me-save]")) {
    const v = (document.getElementById("sc-me-q").value || "").trim();
    if (!v) return;
    scSet(SC_ME_KEY, v);
    loadMine(v, true).then(() => { if (current) render(); });
    return;
  }
  if (e.target.closest("[data-me-edit]")) {
    try { localStorage.removeItem(SC_ME_KEY); localStorage.removeItem(SC_MINE_KEY); } catch {}
    mine = null; renderMe();
    return;
  }
  if (e.target.closest("[data-me-refresh]")) {
    const n = scGet(SC_ME_KEY);
    if (n) loadMine(n, true).then(() => { if (current) render(); });
    return;
  }
  if (e.target.closest("[data-sc-refresh]")) { runScout(true); return; }
  const cap = e.target.closest("[data-sc-capture]");
  if (cap && current) {
    shareSection(document.getElementById("sc-sheet"), {
      btn: cap, nick: current.data.nickname || current.nick, tab: "⚔️ 상대 분석", fileTag: "scout",
      sub: [current.data.maxDivision, scGet(SC_ME_KEY) ? `vs ${scGet(SC_ME_KEY)}` : ""].filter(Boolean).join(" · ")
    });
    return;
  }
  const sf = e.target.closest("#sc-shots [data-shotfilter]");
  if (sf && current) {
    const shots = current.data.analysis.guideRows.flatMap((x) => x.shots || []);
    document.getElementById("sc-shots").innerHTML = shotMapCard(shots, sf.dataset.shotfilter === "goal");
  }
}

async function initScout() {
  const input = document.getElementById("sc-q");
  document.getElementById("sc-go").addEventListener("click", () => runScout());
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") runScout(); });
  document.querySelector("main").addEventListener("click", onClick);
  document.querySelector("main").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "sc-me-q") document.querySelector("[data-me-save]").click();
  });
  renderRecent();
  scLib().catch((e) => console.error("[상대 분석] 미리 불러오기 실패:", e));
  sqLoadMeta();

  const nick = await myNick();
  renderMe();
  if (nick) loadMine(nick);

  const q = new URLSearchParams(location.search).get("q");
  if (q) { input.value = q; runScout(); }
  else input.focus();
}

document.addEventListener("DOMContentLoaded", initScout);
