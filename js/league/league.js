/* ============================================================
   league/league.js — ⚽ 도륙리그 페이지 컨트롤러 (league.html, ES 모듈)
   - 상태 판정(예정 없음/편성 중/개막 전/진행 중/종료…) · 해시 탭 · 1초 카운트다운
   - 결과는 서버가 아니라 여기서 계산: 스냅샷 + 시드 → 엔진(js/engine) → 지금 시각까지의 라운드만 공개
   - 시간 이동 모드: league.html?now=2026-10-15T13:00 (KST) — 보는 시각만 바뀌고 결과는 같다
   - 🧪 테스트 리그: league.html?test=<시작 ms>&iv=<라운드 간격 초> — 지금 명단·판수로 바로 편성해 짧은 간격으로 진행
       서버·기록·회차에 전혀 남지 않음(브라우저 계산만). 같은 주소를 열면 누구나 같은 진행·결과
   - mountLeague(root, { win, fetch, nowParam, myId, testParam, ivParam })로 주입 가능 → 스모크 테스트가 jsdom에서 직접 호출
   ============================================================ */
import * as C from "./clock.js";
import { fetchJSON, loadSnapshot, simulateSnapshot } from "./data.js";
import { judgeEligibility } from "./eligibility.js";
import { attachBoost } from "./boost.js";
import { squadFromLineup, hasSquads } from "./roster.js";
import * as V from "./views.js";

const TABS = [["live", "라이브"], ["table", "순위표"], ["players", "개인 순위"], ["fixtures", "일정/결과"], ["myteam", "내 팀"], ["records", "기록실"]];
const FORMING_POLL_MS = 60 * 1000;   // 편성 중이면 1분마다 스냅샷 다시 확인

function readMe(W) {
  try { return W.localStorage.getItem("dor6.me"); } catch { return null; }
}

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
      const j = judgeEligibility(members, dash, date);
      // 정식 스냅샷(Worker)과 같은 방식으로 실제 스쿼드를 붙임
      const sq = (squads && squads.squads) || {};
      const bt = attachBoost(j.teams.map((t) => { const q = squadFromLineup(sq[t.ouid]); return q ? { ...t, squad: q } : t; }), daily, date);
      const snap = { date, no: "테스트", seed: `TEST-${testStart}`, teamSeed: config.seed, teams: bt.teams, excluded: j.excluded, eligibility: j.eligibility, activity: bt.activity, activityDay: bt.activityDay };
      testCache = { snap, day: simulateSnapshot(snap, config, await getNames(snap)) };
    }
    const { snap, day } = testCache;
    const R = day ? day.totalRounds : 0;
    const roundAt = (k) => testStart + k * testIv * 1000;
    const c = { now, myId, config, history, test: true, roundAt, today: C.kstDate(now()), todayEntry: { no: "테스트", date: snap.date }, todaySnap: snap,
      pending: null, viewToday: true, day, snap, no: "테스트", date: snap.date, R };
    c.k = revealed(c, now());
    c.status = statusOf(c, now());
    return c;
  }
  /* 지금까지 공개된 라운드 수 */
  function revealed(c, n) {
    if (!c.day) return 0;
    if (c.test) return Math.max(0, Math.min(c.R, Math.floor((n - testStart) / 1000 / testIv)));
    return c.viewToday ? C.revealedRounds(c.date, c.R, n) : c.R;
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
      snap = todaySnap; entry = todayEntry; day = simulateSnapshot(snap, config, await getNames(snap)); c.viewToday = true;
    } else {
      // 지난 회차 중 가장 최근 (스냅샷이 있는 것)
      const past = config.days.filter((d) => d.date < today).sort((a, b) => (a.date < b.date ? 1 : -1));
      for (const d of past.slice(0, 3)) {
        const s = await getSnap(d.date);
        if (s && s.teams && s.teams.length >= 2) { snap = s; entry = d; day = simulateSnapshot(s, config, await getNames(s)); break; }
      }
      c.viewToday = false;
    }
    Object.assign(c, { day, snap, no: entry && entry.no, date: entry && entry.date, R: day ? day.totalRounds : 0 });
    c.k = revealed(c, n);
    c.status = statusOf(c, n);
    return c;
  }

  function statusOf(c, n) {
    if (c.test) return !c.day ? "rest" : n < testStart ? "before" : c.k < c.R ? "live" : "done";
    if (!c.todayEntry) return "none";
    if (!c.todaySnap) return n < C.kstMs(c.today, C.OPEN_H, 10) ? "forming" : "delayed";
    if (!c.todaySnap.teams || c.todaySnap.teams.length < 2) return "rest";
    if (n < C.kstMs(c.today, C.OPEN_H)) return "before";
    return c.k < c.R ? "live" : "done";
  }

  /* ---------- 렌더 ---------- */
  root.innerHTML = `
    ${testStart != null ? `<div class="lg-travel lg-test">🧪 테스트 리그 — 기록·회차에 남지 않아요 · 라운드 ${testIv}초 간격 · 지금 명단·판수로 편성 · <a href="league.html?test&iv=${testIv}">새로 시작</a> · <a href="league.html">나가기</a></div>` : ""}
    ${travel != null ? `<div class="lg-travel">🕒 시간 이동 모드: ${C.dateLabel(C.kstDate(travel))} ${C.hm(travel)} 부터 · <a href="league.html">해제</a></div>` : ""}
    <div id="lg-head"></div>
    <div class="pf-tabs lg-tabs" role="tablist">${TABS.map(([k, l]) => `<a href="#${k}" class="pf-tab" data-tab="${k}" role="tab">${l}</a>`).join("")}</div>
    <div id="lg-body"></div>`;
  const $head = root.querySelector("#lg-head"), $body = root.querySelector("#lg-body");

  const curTab = () => {
    const key = (W.location.hash || "").slice(1);
    return TABS.some(([k]) => k === key) ? key : "live";
  };

  function renderAll() {
    $head.innerHTML = V.headCard(ctx);
    renderTab();
  }
  function renderTab() {
    const tab = curTab();
    root.querySelectorAll(".pf-tab").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
    try {
      const html = {
        live: () => V.tabLive(ctx),
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
    if (ctx.day && ctx.viewToday) {
      const k = revealed(ctx, n);
      const st = statusOf(ctx, n);
      if (k !== ctx.k || st !== ctx.status) {
        ctx.k = k; ctx.status = st;
        // 사용자가 '최신'을 보고 있었으면 따라가도록 라운드 선택 초기화
        if (sel.table === k - 1) sel.table = undefined;
        renderAll();
        return;
      }
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
