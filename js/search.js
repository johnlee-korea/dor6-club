/* search.js — 일반 전적 검색 (Worker 프록시 경유, 키 노출 없음)
   - 검색한 유저는 자동 수집 대상이 아니다. 한 번 조회한 결과는 이 브라우저에 저장해 두고,
     [최신 업데이트]를 눌렀을 때만 넥슨에서 다시 가져온다(스쿼드·전적 스쿼드 포함).
   - 경기 행을 탭하면 양팀 스쿼드, [스쿼드]는 가장 최근 경기 라인업 */

const SEARCH_CACHE_PREFIX = "dor6.search.";      // + 닉네임(소문자) → { fetchedAt, data }
const SEARCH_RECENT_KEY = "dor6.search.recent";  // 최근 검색 닉네임 목록
const SEARCH_RECENT_MAX = 8;

/* ---------- 브라우저 저장소 (사생활 모드 등에서 실패해도 검색은 동작) ---------- */
const cacheKey = (nick) => SEARCH_CACHE_PREFIX + nick.toLowerCase();
function cacheGet(nick) {
  try { return JSON.parse(localStorage.getItem(cacheKey(nick))); } catch { return null; }
}
function cacheSet(nick, data) {
  const entry = { fetchedAt: new Date().toISOString(), data };
  try {
    localStorage.setItem(cacheKey(nick), JSON.stringify(entry));
    const recent = recentList().filter((n) => n.toLowerCase() !== nick.toLowerCase());
    recent.unshift(nick);
    localStorage.setItem(SEARCH_RECENT_KEY, JSON.stringify(recent.slice(0, SEARCH_RECENT_MAX)));
  } catch (e) { console.warn("검색 결과 저장 실패(저장 없이 계속):", e); }
  return entry;
}
function recentList() {
  try { return JSON.parse(localStorage.getItem(SEARCH_RECENT_KEY)) || []; } catch { return []; }
}

/* ---------- 화면 ---------- */
let current = null; // 현재 표시 중인 { nick, fetchedAt, data }

function initSearch() {
  const btn = document.getElementById("search-btn");
  const input = document.getElementById("q");
  btn.addEventListener("click", () => doSearch());
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });

  document.getElementById("search-recent").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    input.value = chip.dataset.nick;
    doSearch();
  });

  // 결과 영역 이벤트 위임: 최신 업데이트 / 스쿼드 / 경기 행
  document.getElementById("search-root").addEventListener("click", onResultClick);

  renderRecent();

  // ?q= 로 진입 시 자동 검색
  const q = new URLSearchParams(location.search).get("q");
  if (q) { input.value = q; doSearch(); }

  if (!window.DOR6.workerUrl) {
    document.getElementById("search-msg").innerHTML =
      `⚙️ 검색 백엔드(Worker)가 아직 연결되지 않았습니다. 배포 후 이용 가능합니다.`;
  }
}

function renderRecent() {
  const list = recentList();
  document.getElementById("search-recent").innerHTML = list.length
    ? `<div class="chip-row" style="margin:var(--sp-3) 0 0;">
         ${list.map((n) => `<button class="chip" type="button" data-nick="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join("")}
       </div>`
    : "";
}

/* force=false: 저장된 결과가 있으면 그대로 표시 / force=true: 넥슨에서 새로 가져옴 */
async function doSearch(force = false) {
  const root = document.getElementById("search-root");
  const msg = document.getElementById("search-msg");
  const nickname = document.getElementById("q").value.trim();
  if (!nickname) { msg.textContent = "닉네임을 입력하세요."; return; }
  msg.textContent = "";

  const cached = force ? null : cacheGet(nickname);
  if (cached && cached.data) {
    show(nickname, cached);
    return;
  }

  if (!window.DOR6.workerUrl) {
    root.innerHTML = errorState("검색 기능은 Worker 배포 후 활성화됩니다.");
    return;
  }

  root.innerHTML = `<div class="loading">🔍 ${force ? "최신 정보 가져오는 중…" : "조회 중…"}</div>`;
  try {
    const data = await auth.call("/search", { nickname });
    show(nickname, cacheSet(nickname, data));
    renderRecent();
  } catch (e) {
    console.error("전적 검색 실패:", e);
    // 업데이트 실패 시 이전 결과가 있으면 그대로 두고 안내만
    const prev = cacheGet(nickname);
    if (force && prev && prev.data) {
      show(nickname, prev);
      msg.textContent = `⚠️ 최신 업데이트 실패: ${e.message} (이전 결과를 표시합니다)`;
    } else {
      root.innerHTML = errorState(escapeHtml(e.message));
    }
  }
}

function show(nick, entry) {
  current = { nick, fetchedAt: entry.fetchedAt, data: entry.data };
  renderResult(document.getElementById("search-root"), entry.data, entry.fetchedAt);
}

/* 가장 최근 경기 중 라인업이 있는 것 = 현재 스쿼드로 간주 (넥슨은 현재 스쿼드 미제공) */
const latestWithLineup = (d) => (d.matches || []).find((m) => (m.lineup || []).length) || null;

async function onResultClick(e) {
  if (!current) return;
  const d = current.data;
  const nick = d.nickname || current.nick;

  if (e.target.closest("[data-refresh]")) {
    document.getElementById("q").value = current.nick;
    doSearch(true);
    return;
  }
  if (e.target.closest("[data-squad]")) {
    const last = latestWithLineup(d);
    if (!last) return;
    const meta = await sqEnsureNames(await sqLoadMeta(), [last.lineup]);
    openSquadModal(nick, last, meta);
    return;
  }
  const row = e.target.closest(".search-row");
  if (row) {
    const m = d.matches[row.dataset.i];
    const meta = await sqEnsureNames(await sqLoadMeta(), [m.lineup, m.oppLineup]);
    openMatchModal(m, meta, nick);
  }
}

function renderResult(root, d, fetchedAt) {
  const s = d.summary || {};
  const strip = (d.matches || []).slice(0, 15).map((m) =>
    `<span class="wl-dot ${m.result}">${fmt.wl(m.result)}</span>`).join("");
  const hasSquad = !!latestWithLineup(d);

  const rows = (d.matches || []).length
    ? d.matches.map((m, i) => `
      <div class="search-row" data-i="${i}" style="display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-3) 0;border-bottom:1px solid var(--border);cursor:pointer;">
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
      <div style="display:flex;align-items:center;gap:var(--sp-2);flex-wrap:wrap;margin-top:var(--sp-3);padding-top:var(--sp-3);border-top:1px solid var(--border);">
        <button class="btn sm" type="button" data-squad ${hasSquad ? "" : "disabled title=\"라인업 정보 없음 — 최신 업데이트 후 이용\""}>스쿼드</button>
        <button class="btn sm" type="button" data-refresh>🔄 최신 업데이트</button>
        <span style="flex:1;min-width:0;text-align:right;font-size:var(--fs-xs);color:var(--text-dim);">
          마지막 업데이트 ${fetchedAt ? fmt.dateTime(fetchedAt) : "-"}</span>
      </div>
    </div>
    <div id="search-analysis"></div>
    <div class="section-title">최근 공식경기 <span style="font-size:var(--fs-xs);color:var(--text-dim);font-weight:400;">· 탭하면 양팀 스쿼드</span></div>
    <div class="card">${rows}</div>
  `;
  renderAnalysis(d).catch((e) => console.error("검색 분석 표시 실패:", e));
}

/* 🎭 플레이스타일 + ⚽ 에이스 (v1.11.0) — Worker가 판정한 d.analysis를 그리기만 함(js/insight-ui.js 공용)
   이전 버전으로 조회해 저장된 결과(analysis 없음)는 [최신 업데이트] 안내만 표시 */
async function renderAnalysis(d) {
  const box = document.getElementById("search-analysis");
  if (!box) return;
  const a = d.analysis;
  if (!a) {
    box.innerHTML = `<div class="ps-note" style="margin-bottom:var(--sp-4);">🔄 <b>최신 업데이트</b>를 누르면 🎭 플레이스타일과 ⚽ 에이스 선수가 표시돼요.</div>`;
    return;
  }
  // 선수 이름: 클럽 경기 선수표 + 없는 선수만 전체 이름표(pnames) 보충
  const meta = await sqEnsureNames(await sqLoadMeta(), [(a.ace || []).map((x) => ({ spId: x.spId }))]);
  const style = a.playstyle ? { games: a.games, ...a.playstyle } : { games: a.games };
  box.innerHTML = `
    <div class="section-title">📊 분석 <span class="in-note">· 공식경기 최근 ${d.summary ? d.summary.games : a.games}경기 중 정상 종료 ${a.games}경기 기준</span></div>
    <div class="card in-card" style="margin-bottom:var(--sp-3);"><div class="in-title">🎭 플레이스타일</div>
      ${psBlock(style, a.minGames)}
      <div class="in-dim" style="margin-top:var(--sp-2);">랭커 평균 대비 가장 높은 지표 ▲3 · 낮은 지표 ▼3 (★ = 스타일 근거)</div></div>
    ${aceCard(a.ace, meta, a, "선수별 주 포지션(선발 최다)에서 같은 포지션 랭커 선수 평균 대비 · 선발 5경기 이상 · 칭호는 눈에 띄게 높을 때만")}
    <div style="height:var(--sp-4);"></div>`;
}

document.addEventListener("DOMContentLoaded", initSearch);
