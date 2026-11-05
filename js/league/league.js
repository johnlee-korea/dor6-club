/* ============================================================
   league/league.js — ⚽ 도륙리그 페이지 컨트롤러 (league.html, ES 모듈)
   - 상태 판정(예정 없음/편성 중/개막 전/진행 중/종료…) · 해시 탭 · 1초 카운트다운
   - 결과는 서버가 아니라 여기서 계산: 스냅샷 + 시드 → 엔진(js/engine) → 지금 시각까지의 라운드만 공개
   - 시간 이동 모드: league.html?now=2026-10-15T13:00 (KST) — 보는 시각만 바뀌고 결과는 같다
   - 🧪 테스트 리그: league.html?test=<시작 ms>&iv=<라운드 간격 초> — 지금 명단·판수로 바로 편성해 짧은 간격으로 진행
       서버·기록·회차에 전혀 남지 않음(브라우저 계산만). 같은 주소를 열면 누구나 같은 진행·결과
   - 🏆 2부제(v2.29.0, 스냅샷 format 2): DPL·DCL 두 리그 + 승강 PO. 화면은 [DPL | DCL] 칩으로 고른 리그 하나를 보여 줌
       ctx = 고른 리그의 화면 컨텍스트(기존 views가 그대로 동작), ctx.L = 두 리그·PO 전체 상태
   - mountLeague(root, { win, fetch, nowParam, myId, testParam, ivParam })로 주입 가능 → 스모크 테스트가 jsdom에서 직접 호출
   ============================================================ */
import * as C from "./clock.js";
import { fetchJSON, loadSnapshot, simulateSnapshot, simulateSplit } from "./data.js";
import { isSplit, dayPlan, divTeams, assignDivisions, koTimeline, DIVS } from "./divisions.js";
import { judgeEligibility } from "./eligibility.js";
import { attachBoost } from "./boost.js";
import { squadFromLineup, hasSquads } from "./roster.js";
import * as V from "./views.js";

const TABS = [["live", "라이브"], ["table", "순위표"], ["players", "개인 순위"], ["fixtures", "일정/결과"], ["myteam", "내 팀"], ["records", "기록실"]];
const FORMING_POLL_MS = 60 * 1000;   // 편성 중이면 1분마다 스냅샷 다시 확인

function readMe(W) {
  try { return W.localStorage.getItem("dor6.me"); } catch { return null; }
}
const DIV_KEY = "dor6.league.div";
function readDiv(W) { try { return W.localStorage.getItem(DIV_KEY); } catch { return null; } }
function saveDiv(W, d) { try { W.localStorage.setItem(DIV_KEY, d); } catch {} }
/* PO 경기 1분 = 실제 ms — 가장 긴 경기(정규+추가시간 94 + 연장 30 + 승부차기 약 15)도 간격 안에 끝나게 */
const poMsPerMin = (ivSec) => Math.min(C.LIVE_SEC_PER_MIN * 1000, (ivSec * 1000 * 0.93) / 141);

export async function mountLeague(root, opts = {}) {
  const W = opts.win || window;
  const fetchFn = opts.fetch || W.fetch.bind(W);
  const travel = C.parseNowParam(opts.nowParam !== undefined ? opts.nowParam : new URLSearchParams(W.location.search).get("now"));
  const t0 = Date.now();
  const now = () => (travel != null ? travel + (Date.now() - t0) : Date.now());
  const myId = opts.myId !== undefined ? opts.myId : readMe(W);
  // 🧪 테스트 리그 — ?test 만 있으면 지금 시각으로 시작 주소를 만들어 바꿔 둠(새로고침·공유해도 같은 진행)
  const qs = new URLSearchParams(W.location.search);
  let testStart = null, testIv = 20;
  if (opts.testParam !== undefined || qs.has("test")) {
    const raw = opts.testParam !== undefined ? opts.testParam : qs.get("test");
    testIv = Math.max(5, Math.min(720, Number(opts.ivParam !== undefined ? opts.ivParam : qs.get("iv")) || 20));
    testStart = /^\d{12,}$/.test(String(raw)) ? Number(raw) : Math.ceil(now() / 1000) * 1000 + 5000;   // 5초 뒤 개막
    if (!/^\d{12,}$/.test(String(raw))) {
      qs.set("test", String(testStart)); qs.set("iv", String(testIv));
      try { W.history.replaceState(null, "", "?" + qs.toString() + W.location.hash); } catch {}
    }
  }
  const sel = {};          // 탭별 선택값 (라운드·부문·팀) — 라운드가 넘어가도 유지
  const snapCache = new Map();
  let ctx = null, lastPoll = 0, timer = null;

  let config, history;
  try {
    [config, history] = await Promise.all([
      fetchJSON(fetchFn, "data/league/config.json"),
      fetchJSON(fetchFn, "data/league/history.json").catch((e) => { console.error("[도륙리그] 기록 로딩 실패:", e); return null; })
    ]);
  } catch (e) {
    console.error("[도륙리그] 설정 로딩 실패:", e);
    root.innerHTML = `<div class="error-box">리그 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</div>`;
    return { destroy() {} };
  }
  config = config || { seed: "DOR6", days: [] };
  config.days = config.days || [];
  history = history || { days: [] };
  history.days = history.days || [];

  const getSnap = async (date, fresh) => {
    if (!fresh && snapCache.has(date)) return snapCache.get(date);
    const s = await loadSnapshot(fetchFn, date);
    snapCache.set(date, s);
    return s;
  };

  /* 실제 스쿼드 선수 이름 (data/meta/players.json, 약 380KB) — 스쿼드가 있는 스냅샷일 때만 1회 로딩 */
  let namesP = null;
  const getNames = (snap) => {
    if (!hasSquads(snap)) return Promise.resolve(null);
    if (!namesP) namesP = fetchJSON(fetchFn, "data/meta/players.json").catch((e) => { console.error("[도륙리그] 선수 이름 로딩 실패:", e); return null; });
    return namesP;
  };

  /* 🧪 테스트 리그 컨텍스트 — members.json + dashboard.json으로 참가 자격 판정(정식과 같은 규칙) */
  let testCache = null;
  async function buildTestCtx() {
    if (!testCache) {
      const [members, dash, squads, daily] = await Promise.all([
        fetchJSON(fetchFn, "data/members.json"),
        fetchJSON(fetchFn, "data/dashboard.json").catch(() => null),
        fetchJSON(fetchFn, "data/squads.json").catch(() => null),
        fetchJSON(fetchFn, "data/daily-games.json").catch(() => null)
      ]);
      const date = C.kstDate(testStart);
      // 2부제(v2.29.0): 정식 편성(Worker)과 같은 규칙 — 판수 미달도 참가(페널티), 리그 명단은 divisions.json
      const j = judgeEligibility(members, dash, date, { penalize: true });
      const divFile = await fetchJSON(fetchFn, "data/league/divisions.json").catch(() => null);
      const as = assignDivisions(j.teams, divFile);
      // 정식 스냅샷(Worker)과 같은 방식으로 실제 스쿼드를 붙임
      const sq = (squads && squads.squads) || {};
      const bt = attachBoost(as.teams.map((t) => { const q = squadFromLineup(sq[t.ouid]); return q ? { ...t, squad: q } : t; }), daily, date);
      const snap = { format: 2, date, no: "테스트", seed: `TEST-${testStart}`, teamSeed: config.seed, teams: bt.teams, excluded: j.excluded, eligibility: j.eligibility, activity: bt.activity, activityDay: bt.activityDay };
      testCache = { snap, out: simulateSplit(snap, config, await getNames(snap)) };
    }
    const { snap, out } = testCache;
    const c = { now, myId, config, history, test: true, iv: testIv, today: C.kstDate(now()), todayEntry: { no: "테스트", date: snap.date }, todaySnap: snap,
      pending: null, viewToday: true, snap, no: "테스트", date: snap.date, day: null, R: 0 };
    const dc = out ? pickDiv(makeSplit(c, snap, out, { start: testStart, iv: testIv }), now()) : null;
    if (dc) return dc;
    c.status = "rest";
    return c;
  }

  /* ---------- 🏆 2부제 컨텍스트 ----------
     L = { plan, divs: { DPL: 리그 ctx, DCL: 리그 ctx }, po, sel } — 리그 ctx는 기존 단일 리그 ctx와 같은 모양(views 재사용) */
  let selDiv = null;
  function makeSplit(base, snap, out, opt = {}) {
    const plan = dayPlan(snap, opt);
    const L = { plan, divs: {}, po: null, out, snap };
    for (const div of DIVS) {
      if (!out || !out[div]) continue;
      L.divs[div] = { ...base, L, div, day: out[div], snap: { ...snap, teams: divTeams(snap, div) }, fullSnap: snap,
        R: out[div].totalRounds, iv: plan.iv, roundAt: (k) => plan.start + k * plan.iv * 1000 };
    }
    if (out && out.playoff) {
      const mpm = poMsPerMin(plan.iv);
      L.po = { ...out.playoff, msPerMin: mpm,
        games: out.playoff.games.map((g) => { const tl = koTimeline(g.res), kick = plan.poKick(g.g); return { ...g, tl, kick, endAt: kick + tl.end * mpm }; }) };
    }
    return L;
  }
  /* 보는 시각 n 기준으로 두 리그·PO 상태 갱신 (viewToday = 오늘 리그 / 테스트 리그) */
  function setSplitTime(L, n, viewToday) {
    for (const c of Object.values(L.divs)) setTime(c, n);
    const po = L.po;
    L.endAt = po ? po.games[po.games.length - 1].endAt : L.plan.poStart;
    if (po) {
      if (!viewToday) { po.done = po.games.length; po.live = null; }
      else {
        po.done = po.games.filter((g) => g.endAt <= n).length;
        const g = po.games.find((x) => x.kick <= n && n < x.endAt);
        po.live = g ? { g: g.g, min: (n - g.kick) / po.msPerMin } : null;
      }
    }
    L.status = !viewToday ? "done" : n < L.plan.start ? "before" : n < L.endAt ? "live" : "done";
    for (const c of Object.values(L.divs)) c.status = statusOf(c, n);
  }
  /* 고른 리그 ctx 반환 — 기본 = 기억한 값 → 내 팀 리그 → DPL */
  function pickDiv(L, n) {
    const has = (d) => !!L.divs[d];
    const mineDiv = L.snap.teams.find((t) => t.ouid === myId);
    if (!selDiv || !has(selDiv)) selDiv = [readDiv(W), mineDiv && mineDiv.div, "DPL", "DCL"].find((d) => d && has(d)) || null;
    if (!selDiv) return null;
    L.sel = selDiv;
    const any = Object.values(L.divs)[0];
    setSplitTime(L, n, !!(any.viewToday || any.test));
    return L.divs[selDiv];
  }
  /* 📻 문자중계 시간 흐름 (v2.19.0): 라운드 r(0부터)은 kick(r)에 킥오프 → 경기 1분 = msPerMin
     → 그 라운드 마지막 분(90 + 추가시간)이 지나면 '끝난 라운드'로 공개 (순위·개인 기록 반영) */
  const kick = (c, r) => (c.roundAt ? c.roundAt(r) : C.roundMs(c.date, r, c.R));
  const ivOf = (c) => (c.iv || C.intervalSec(c.R));
  function endMin(c, r) {
    c._endMin = c._endMin || [];
    if (c._endMin[r] == null) c._endMin[r] = C.roundEndMin(c.day.results[r]);
    return c._endMin[r];
  }
  /* 지금 진행 중인 라운드 { r, min, endMin } — 없으면 null (개막 전·라운드 사이 휴식·종료) */
  function liveOf(c, n) {
    if (!c.day || !c.viewToday || !c.R) return null;
    const t0 = kick(c, 0);
    if (n < t0) return null;
    const r = Math.floor((n - t0) / 1000 / ivOf(c));
    if (r >= c.R) return null;
    const min = Math.floor((n - kick(c, r)) / C.liveMsPerMin(ivOf(c)));
    const end = endMin(c, r);
    return min < end ? { r, min, endMin: end } : null;
  }
  /* 지금까지 끝난(공개된) 라운드 수 */
  function revealed(c, n) {
    if (!c.day) return 0;
    if (!c.viewToday && !c.test) return c.R;
    const t0 = kick(c, 0);
    if (n < t0) return 0;
    const r = Math.min(c.R, Math.floor((n - t0) / 1000 / ivOf(c)));
    if (r >= c.R) return c.R;
    return liveOf(c, n) ? r : r + 1;
  }
  /* ctx에 보는 시각 기준 라운드 상태를 채움 */
  function setTime(c, n) {
    c.live = liveOf(c, n);
    c.k = revealed(c, n);
    c.liveMsPerMin = c.day ? C.liveMsPerMin(ivOf(c)) : 0;
  }

  /* 지금 시각 기준 화면 컨텍스트 구성 — 오늘 리그가 없으면 가장 최근 지난 회차를 보여 줌 */
  async function buildCtx(fresh = false) {
    if (testStart != null) return buildTestCtx();
    const n = now(), today = C.kstDate(n);
    const todayEntry = C.dayEntry(config, today);
    const todaySnap = todayEntry ? await getSnap(today, fresh) : null;
    const c = { now, myId, config, history, todayEntry, todaySnap, pending: C.pendingReservation(config, n), today };
    let day = null, snap = null, entry = null;
    if (todaySnap && todaySnap.teams && todaySnap.teams.length >= 2) {
      snap = todaySnap; entry = todayEntry; c.viewToday = true;
    } else {
      // 지난 회차 중 가장 최근 (스냅샷이 있는 것)
      const past = config.days.filter((d) => d.date < today).sort((a, b) => (a.date < b.date ? 1 : -1));
      for (const d of past.slice(0, 3)) {
        const s = await getSnap(d.date);
        if (s && s.teams && s.teams.length >= 2) { snap = s; entry = d; break; }
      }
      c.viewToday = false;
    }
    if (snap && isSplit(snap)) {
      // 🏆 2부제 — 리그 진행 상태(개막 전·진행 중·종료)는 setSplitTime이 정함
      Object.assign(c, { snap, no: entry.no, date: entry.date, day: null, R: 0 });
      const L = makeSplit(c, snap, simulateSplit(snap, config, await getNames(snap)));
      const dc = pickDiv(L, n);
      if (dc) return dc;
    }
    if (snap && !isSplit(snap)) day = simulateSnapshot(snap, config, await getNames(snap));
    Object.assign(c, { day, snap, no: entry && entry.no, date: entry && entry.date, R: day ? day.totalRounds : 0 });
    setTime(c, n);
    c.status = statusOf(c, n);
    return c;
  }

  function statusOf(c, n) {
    if (c.test) return !c.day ? "rest" : c.L ? c.L.status : n < testStart ? "before" : c.k < c.R ? "live" : "done";
    if (!c.todayEntry) return "none";
    if (!c.todaySnap) return n < C.kstMs(c.today, C.OPEN_H, 10) ? "forming" : "delayed";
    if (!c.todaySnap.teams || c.todaySnap.teams.length < 2) return "rest";
    if (n < C.kstMs(c.today, C.OPEN_H)) return "before";
    if (c.L) return c.L.status;
    return c.k < c.R ? "live" : "done";
  }

  /* ---------- 렌더 ---------- */
  root.innerHTML = `
    ${testStart != null ? `<div class="lg-travel lg-test">🧪 테스트 리그 — 기록·회차에 남지 않아요 · 라운드 ${testIv}초 간격 · 지금 명단·판수로 편성 · <a href="league.html?test&iv=${testIv}">새로 시작</a> · <a href="league.html">나가기</a></div>` : ""}
    ${travel != null ? `<div class="lg-travel">🕒 시간 이동 모드: ${C.dateLabel(C.kstDate(travel))} ${C.hm(travel)} 부터 · <a href="league.html">해제</a></div>` : ""}
    <div id="lg-divs"></div>
    <div id="lg-head"></div>
    <div class="pf-tabs lg-tabs" role="tablist">${TABS.map(([k, l]) => `<a href="#${k}" class="pf-tab" data-tab="${k}" role="tab">${l}</a>`).join("")}</div>
    <div id="lg-body"></div>`;
  const $head = root.querySelector("#lg-head"), $body = root.querySelector("#lg-body"), $divs = root.querySelector("#lg-divs");

  const curTab = () => {
    const key = (W.location.hash || "").slice(1);
    return TABS.some(([k]) => k === key) ? key : "live";
  };

  function renderAll() {
    $divs.innerHTML = ctx && ctx.L ? V.divChips(ctx) : "";
    $head.innerHTML = V.headCard(ctx);
    renderTab();
  }
  function renderTab() {
    const tab = curTab();
    root.querySelectorAll(".pf-tab").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
    try {
      const html = {
        live: () => V.tabLive(ctx, liveOpen()),
        table: () => V.tabTable(ctx, sel.table),
        players: () => V.tabPlayers(ctx, sel.kind),
        fixtures: () => V.tabFixtures(ctx, sel.fixtures),
        myteam: () => V.tabMyTeam(ctx, sel.myteam),
        records: () => V.tabRecords(ctx)
      }[tab]();
      $body.innerHTML = html;
    } catch (e) {
      console.error(`[도륙리그] ${tab} 탭 표시 실패:`, e);
      $body.innerHTML = `<div class="error-box">이 탭을 표시하지 못했어요. 새로고침해 주세요.</div>`;
    }
  }

  // 탭 안 선택상자·칩 (이벤트 위임 — 다시 그려도 연결 유지)
  $body.addEventListener("change", (e) => {
    const s = e.target.closest("[data-sel]");
    if (!s) return;
    const key = s.dataset.sel;
    sel[key] = key === "myteam" ? (s.value || null) : Number(s.value);
    renderTab();
  });
  $body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-kind]");
    if (!b) return;
    sel.kind = b.dataset.kind;
    renderTab();
  });
  // 📻 라이브 경기 펼침 상태 — 경기 1분마다 #lg-live를 다시 그려도 펼친 경기는 그대로 (라운드가 바뀌면 초기화)
  let openLive = { r: -1, set: new Set() };
  function liveOpen() {
    const r = ctx.live ? ctx.live.r : -1;
    if (openLive.r !== r) openLive = { r, set: new Set() };
    return openLive.set;
  }
  // toggle 이벤트는 버블링되지 않아 캡처로 받음
  $body.addEventListener("toggle", (e) => {
    const d = e.target;
    if (!(d instanceof W.HTMLElement) || !d.matches("details[data-live]")) return;
    const i = Number(d.dataset.live);
    if (d.open) liveOpen().add(i); else liveOpen().delete(i);
  }, true);
  // 🏆 리그 칩 [DPL | DCL] — 고른 값 기억, 탭 선택값(라운드 등)은 리그마다 달라 초기화
  $divs.addEventListener("click", (e) => {
    const b = e.target.closest("[data-div]");
    if (!b || !ctx || !ctx.L || !ctx.L.divs[b.dataset.div] || b.dataset.div === selDiv) return;
    selDiv = b.dataset.div; saveDiv(W, selDiv);
    for (const k of ["table", "fixtures", "myteam"]) sel[k] = undefined;
    openLive = { r: -1, set: new Set() };
    ctx = pickDiv(ctx.L, now());
    renderAll();
  });
  const onHash = () => renderTab();
  W.addEventListener("hashchange", onHash);

  /* ---------- 1초 시계: 카운트다운 갱신 · 라운드 넘어가면 다시 그림 · 날짜 바뀌면 다시 구성 ---------- */
  async function tick() {
    const n = now();
    if (!ctx.test && C.kstDate(n) !== ctx.today) { ctx = await buildCtx(true); renderAll(); return; }
    if ((ctx.status === "forming" || ctx.status === "delayed") && n - lastPoll > FORMING_POLL_MS) {
      lastPoll = n;
      const next = await buildCtx(true);
      if (next.todaySnap) { ctx = next; renderAll(); return; }
    }
    const live0 = ctx.live;
    const po0 = ctx.L && ctx.L.po && ctx.L.po.live ? Math.floor(ctx.L.po.live.min * 2) : null;
    if (ctx.day && ctx.viewToday && ctx.L) {
      // 🏆 2부제: 두 리그·PO 중 하나라도 라운드·상태가 바뀌면 전체 다시 그림
      const L = ctx.L;
      const sig = () => [L.status, L.po ? L.po.done : -1, L.po && L.po.live ? L.po.live.g : 0, ...Object.values(L.divs).map((c) => c.k + (c.live ? "L" : ""))].join("|");
      const s0 = sig(), k0 = ctx.k;
      setSplitTime(L, n, true);
      if (sig() !== s0) {
        if (sel.table === k0) sel.table = undefined;
        renderAll();
        return;
      }
      // ⚔️ PO 진행 중: 경기 30초(분 0.5)마다 PO 상자만 다시 그림
      const po1 = L.po && L.po.live ? Math.floor(L.po.live.min * 2) : null;
      if (po1 !== po0) { const box = root.querySelector("#lg-po"); if (box) box.innerHTML = V.poBody(ctx); }
    } else if (ctx.day && ctx.viewToday) {
      const k0 = ctx.k;
      setTime(ctx, n);
      const st = statusOf(ctx, n);
      const k = ctx.k;
      // 라운드 킥오프·종료 → 전체 다시 그림
      if (k !== k0 || st !== ctx.status || !!ctx.live !== !!live0) {
        ctx.status = st;
        // 사용자가 '최신'을 보고 있었으면 따라가도록 라운드 선택 초기화
        if (sel.table === k0) sel.table = undefined;
        renderAll();
        return;
      }
    }
    // 📻 경기 시간이 1분 흐를 때마다 문자중계 부분만 다시 그림 (접어 둔 상자·스크롤 유지)
    if (ctx.live && live0 && ctx.live.min !== live0.min) {
      const box = root.querySelector("#lg-live");
      if (box) box.innerHTML = V.liveRound(ctx, liveOpen());
      const mt = root.querySelector("#lg-myteam-live");
      if (mt) mt.outerHTML = V.myLiveCard(ctx, mt.dataset.team);
    }
    const el = root.querySelector("#lg-count");
    if (el) el.innerHTML = V.countdownText(ctx);
  }

  ctx = await buildCtx();
  lastPoll = now();
  renderAll();
  let busy = false;
  timer = W.setInterval(() => {
    if (busy) return;
    busy = true;
    tick().catch((e) => console.error("[도륙리그] 갱신 실패:", e)).finally(() => (busy = false));
  }, 1000);

  return {
    ctx: () => ctx,
    destroy() { W.clearInterval(timer); W.removeEventListener("hashchange", onHash); }
  };
}

/* 브라우저에서 자동 실행 (Node에서 import할 때는 window가 없어 건너뜀) */
if (typeof window !== "undefined" && typeof document !== "undefined" && !window.__LEAGUE_NO_AUTO) {
  const root = document.getElementById("league-root");
  if (root) mountLeague(root).catch((e) => {
    console.error("[도륙리그] 화면 준비 실패:", e);
    root.innerHTML = `<div class="error-box">도륙리그를 표시하지 못했어요. 새로고침해 주세요.</div>`;
  });
}
