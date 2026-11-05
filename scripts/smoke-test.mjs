/* ============================================================
   smoke-test.mjs — 페이지 렌더 스모크 테스트 (jsdom)
   실행: npm test
   목적: 각 HTML을 실데이터로 렌더해 런타임 오류/헤더·네비/루트 채움을 검증.
   (실브라우저 전용 API인 scrollIntoView 등은 방어 코드로 처리됨)
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rd = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

const FIRST_OUID = JSON.parse(rd("data/members.json")).members.find((m) => m.ouid).ouid;
const GUIDE_OUID = Object.entries(JSON.parse(rd("data/insights.json")).players).find(([, p]) => p.guide && p.guide.summary)?.[0] || FIRST_OUID;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = [
  { file: "index.html",     scripts: ["js/common.js", "js/activity-ui.js", "js/home.js"], root: "summary", expect: "#fc-news .nw-item" },   // v2.10.0 FC온라인 소식
  // 클럽원 탭: 검색 우선 + 접힌 전체 명단(행 = 프로필 링크)
  { file: "members.html",   scripts: ["js/common.js", "js/activity-ui.js", "js/members.js"], root: "members-root", expect: "a.ms-row",
    act: (w) => { const q = w.document.getElementById("member-q"); q.value = "dor6"; q.dispatchEvent(new w.Event("input")); } },
  // 개인 프로필: 실제 회원 ouid로 열고 탭 5개를 차례로 전환해 오류 없는지 확인
  { file: "member.html", url: "http://localhost/member.html?id=" + FIRST_OUID,
    scripts: ["js/common.js", "js/squad.js", "js/insight-ui.js", "js/activity-ui.js", "js/share.js", "js/member.js"], root: "profile-root", expect: ".pf-tab.active + * [data-capture], #pf-body [data-capture]",   // 탭마다 📸 버튼 (v2.3.0)
    act: async (w) => { for (const t of ["insight", "squad", "rival", "matches", "overview"]) { w.location.hash = t; w.dispatchEvent(new w.HashChangeEvent("hashchange")); await sleep(250); } } },
  { file: "dashboard.html", scripts: ["js/common.js", "js/squad.js", "js/activity-ui.js", "js/share.js", "js/dashboard.js"], root: "dash-root", expect: "[data-dash-share]" },
  { file: "tournament.html", scripts: ["js/common.js", "js/tournament.js"], root: "tn-root", expect: ".tn-pick" },
  { file: "internal.html",  scripts: ["js/common.js", "js/squad.js", "js/internal.js"], root: "internal-root" },
  { file: "hall.html",      scripts: ["js/common.js", "js/squad.js", "js/hall.js"], root: "hall-root", expect: ".sq-chip" },
  { file: "rules.html",     scripts: ["js/common.js"],                          root: null },
  { file: "patchnotes.html", scripts: ["js/common.js", "js/patchnotes.js"], root: "pn-root", expect: ".pn-tag" },
  { file: "admin.html",     scripts: ["js/common.js", "js/auth.js", "js/admin-league.js", "js/admin.js"], root: null },
  { file: "search.html",    scripts: ["js/common.js", "js/auth.js", "js/squad.js", "js/insight-ui.js", "js/search.js"], root: null },
  { file: "scout.html",     scripts: ["js/common.js", "js/auth.js", "js/squad.js", "js/insight-ui.js", "js/share.js", "js/scout.js"], root: null },   // v2.28.0 조회 전 빈 화면
  // 🧭 내 플레이 가이드 (v2.18.0): 가이드가 있는 회원의 인사이트 탭
  { file: "member.html", url: "http://localhost/member.html?id=" + GUIDE_OUID + "#insight",
    scripts: ["js/common.js", "js/squad.js", "js/insight-ui.js", "js/activity-ui.js", "js/share.js", "js/member.js"], root: "profile-root", expect: ".gd-sum" }
];

const localFetch = async (url) => {
  const p = String(url).replace(/^https?:\/\/localhost\//, "").replace(/^\//, "").split("?")[0];
  try {
    const t = rd(p);
    return { ok: true, status: 200, json: async () => JSON.parse(t), text: async () => t };
  } catch { return { ok: false, status: 404, json: async () => ({}), text: async () => "" }; }
};

let pass = 0, fail = 0;
for (const pg of PAGES) {
  const dom = new JSDOM(rd(pg.file), { url: pg.url || "http://localhost/", pretendToBeVisual: true, runScripts: "outside-only" });
  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (e) => errors.push(e.error?.message || e.message));
  window.addEventListener("unhandledrejection", (e) => errors.push("reject: " + (e.reason?.message || e.reason)));
  window.fetch = localFetch;
  window.confirm = () => true;
  window.alert = () => {};

  const bundle = pg.scripts.map((s) => rd(s)).join("\n;\n");
  try {
    window.eval(bundle);
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
  } catch (e) { errors.push("eval: " + e.message); }
  await sleep(400);
  if (pg.act) { try { await pg.act(window); } catch (e) { errors.push("act: " + e.message); } await sleep(400); }

  const hasHeader = !!window.document.querySelector(".app-header");
  const nav = window.document.querySelectorAll(".app-nav a").length;
  // expect: 데이터가 있을 때 반드시 렌더돼야 하는 요소(예: 명단의 플레이스타일 블록)
  const expectCount = pg.expect ? window.document.querySelectorAll(pg.expect).length : null;
  const ok = errors.length === 0 && hasHeader && nav >= 1 && (expectCount === null || expectCount > 0);
  console.log(`${ok ? "✅" : "❌"} ${pg.file.padEnd(15)} header:${hasHeader} nav:${nav}${pg.expect ? ` ${pg.expect}:${expectCount}` : ""}`);
  [...new Set(errors)].slice(0, 3).forEach((e) => console.log("   ⚠ " + String(e).split("\n")[0]));
  ok ? pass++ : fail++;
}
/* ---------- 🧭 전적 검색 플레이 가이드 (v2.18.0): Worker guideRows 형식 → lib/guide.js → guideCard ---------- */
{
  const { buildGuide } = await import(new URL("./lib/guide.js", import.meta.url));
  const { withShots } = await import(new URL("./lib/playstyle.js", import.meta.url));
  const base = JSON.parse(rd("data/meta/ranker-baseline.json")).stats;
  const ms = JSON.parse(rd("data/matches/" + GUIDE_OUID + ".json")).matches
    .filter((x) => x.matchType === 50 && x.styleRaw && x.styleRaw.end === 0 && Array.isArray(x.shots)).slice(0, 30);
  const g = buildGuide(ms.map((x) => ({ result: x.result, raw: withShots(x.styleRaw, x.shots), shots: x.shots, oppGoals: x.oppGoals,
    goalFor: x.goalFor, goalAgainst: x.goalAgainst })), base, { minSide: 8, wl: JSON.parse(rd("data/meta/guide-baseline.json")) });
  const few = buildGuide(ms.slice(0, 5).map((x) => ({ result: x.result, raw: withShots(x.styleRaw, x.shots) })), base);
  const { window } = new JSDOM("<div id=r></div>", { runScripts: "outside-only" });
  window.eval([rd("js/common.js"), rd("js/insight-ui.js")].join(";\n"));
  window.document.getElementById("r").innerHTML = window.guideCard(g, "") + window.guideCard(few, "");
  const ok = ms.length < 15 || (!!g.summary && window.document.querySelectorAll(".gd-sum").length === 1 && !few.summary && /경기 이상 쌓이면/.test(window.document.body.textContent));
  console.log(`${ok ? "✅" : "❌"} 플레이 가이드(전적 검색 형식) ${ms.length}경기 요약:${!!g.summary} 장점${(g.strengths || []).length}·보완${(g.weaknesses || []).length}·이길때${(g.winSpecial || []).length}·질때${(g.loseSpecial || []).length} 부족 안내:${!few.summary}`);
  ok ? pass++ : fail++;
}
/* ---------- 구단운영 부품 (v2.2.0 → v2.4.0: 프로필 #manage 탭 · 전적 검색 #manage 탭) ----------
   js/manage.js는 ES 모듈이라 eval 불가 → import 줄을 미리 불러온 lib 객체로 바꾸고 블록으로 감싸 실행.
   Worker(/search, /manage/*)는 픽스처(실데이터 40경기 압축 행)로 흉내 내고, 모드 칩 3개를 모두 눌러 본다 */
{
  const lib = await import(new URL("./lib/manage.js", import.meta.url));
  const fx = JSON.parse(rd("scripts/fixtures/manage-rows.json"));
  const workerFetch = async (url, opt) => {
    const u = String(url);
    if (!/\/(manage\/|search$)/.test(u)) return localFetch(url);
    const body = JSON.parse((opt && opt.body) || "{}");
    let data;
    if (u.endsWith("/search")) data = { ouid: fx.ouid, nickname: fx.nickname, level: 1, maxDivision: "챔피언스", matches: [], summary: { games: 0, wins: 0 } };
    else if (u.endsWith("/overview")) data = { ouid: body.ouid || fx.ouid, nickname: fx.nickname, level: 1, maxDivision: { 50: "챔피언스", 52: "슈퍼 챔피언스" },
      curDivision: { 50: { name: "챌린저1", rank: 2207, score: 2576.57, icon: "https://ssl.nexon.com/s2/game/fo4/obt/rank/large/update_2026/ico_rank3.png" }, 52: null },   // v2.8.0 현재 등급(52 = 랭킹 밖)
      ids: { 50: [], 60: [], 30: [], 52: fx.rows.map((r) => r.id) } };
    else if (u.endsWith("/details")) data = { rows: fx.rows.filter((r) => body.ids.includes(r.id)) };
    else if (u.endsWith("/ranker")) data = { ranker: {} };
    else data = { ids: [] };
    return { ok: true, status: 200, json: async () => data };
  };
  const mgSrc = "\n;\n{\n" + rd("js/manage.js").replace(/^import \{([^}]+)\} from "[^"]+";$/m, "const {$1} = window.__mgLib;") + "\n}";   // 블록으로 모듈 스코프 흉내
  const CASES = [
    { label: "search#manage", file: "search.html", url: "http://localhost/search.html?q=" + encodeURIComponent(fx.nickname) + "#manage",
      scripts: ["js/common.js", "js/auth.js", "js/squad.js", "js/insight-ui.js", "js/share.js", "js/search.js"] },
    { label: "member#manage", file: "member.html", url: "http://localhost/member.html?id=" + FIRST_OUID + "#manage",
      scripts: ["js/common.js", "js/auth.js", "js/squad.js", "js/insight-ui.js", "js/activity-ui.js", "js/share.js", "js/member.js"] }
  ];
  for (const c of CASES) {
    const dom = new JSDOM(rd(c.file), { url: c.url, pretendToBeVisual: true, runScripts: "outside-only" });
    const { window } = dom;
    const errors = [];
    window.addEventListener("error", (e) => errors.push(e.error?.message || e.message));
    window.addEventListener("unhandledrejection", (e) => errors.push("reject: " + (e.reason?.message || e.reason)));
    window.fetch = workerFetch;
    window.__mgLib = lib;
    try {
      window.eval(c.scripts.map((s) => rd(s)).join("\n;\n") + mgSrc);
      window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
    } catch (e) { errors.push("eval: " + e.message); }
    await sleep(1800);
    const q = (sel) => window.document.querySelectorAll(sel);
    const rowsShown = q(".mg-row").length;
    const divTxt = (window.document.querySelector(".mg-divs") || {}).textContent || "";
    if (process.env.MG_DEBUG) console.log("DIV:", divTxt.replace(/s+/g, " "));
    const divOk = divTxt.includes("현재 챌린저1 (2,207위 · 2,576.57점)") && /랭킹 1만 위 밖/.test(divTxt);   // v2.8.0 현재 등급
    if (process.env.MG_DEBUG) console.log(window.document.querySelector("main").textContent.replace(/\s+/g, " ").slice(0, 400));
    const click = (sel) => { const el = window.document.querySelector(sel); if (el) el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); };
    click(".mg-row"); await sleep(200);
    const detail = q(".mg-detail").length;
    for (const m of ["official", "friendly", "manager"]) { click(`[data-mode="${m}"]`); await sleep(500); }
    const capBtn = q("#mg-body [data-capture]").length;   // 모드 📸 (v2.3.0)
    const hasHeader = !!window.document.querySelector(".app-header");
    const ok = errors.length === 0 && hasHeader && rowsShown > 0 && detail > 0 && capBtn > 0 && divOk;
    console.log(`${ok ? "✅" : "❌"} ${c.label.padEnd(15)} header:${hasHeader} 진단 행:${rowsShown} 상세:${detail} 📸:${capBtn} 현재등급:${divOk}`);
    [...new Set(errors)].slice(0, 3).forEach((e) => console.log("   ⚠ " + String(e).split("\n")[0]));
    ok ? pass++ : fail++;
  }
}


/* ---------- ⚽ 도륙리그 (v2.11.0) ----------
   league.js는 ES 모듈 → Node에서 직접 import해 jsdom 창에 mountLeague로 붙임.
   데이터는 픽스처(scripts/fixtures/league: 10-13 지난 회차·10-15 오늘·10-17 예약, 실제 명단·판수로 편성)
   시간 이동(nowParam)으로 상태 6가지를 만들고 탭 6개·선택상자를 모두 돌려 오류 없는지 확인 */
{
  const { mountLeague } = await import(new URL("../js/league/league.js", import.meta.url));
  const FX = "scripts/fixtures/league/";
  const leagueFetch = async (url) => {
    const p = String(url).replace(/^https?:\/\/localhost\//, "").replace(/^\//, "").split("?")[0];
    return localFetch(p.startsWith("data/league/") ? FX + p.slice("data/league/".length) : url);
  };
  const fxSnap = JSON.parse(rd(FX + "days/2026-10-15.json"));
  const ME = fxSnap.teams[0].ouid;
  const CASES = [
    ["2026-10-15T06:20", "before", ".lg-match"],
    ["2026-10-15T13:00", "live", ".lg-score"],
    ["2026-10-15T13:05", "live", "#lg-live .lg-feed-item.goal"],   // 📻 문자중계: 킥오프 5분 뒤 = 경기 50분, 골 줄 표시
    ["2026-10-15T13:10", "live", ".lg-note"],                       // 라운드 사이 휴식: 결과 + 다음 킥오프 안내
    ["2026-10-15T22:00", "done", ".lg-final"],
    ["2026-10-16T10:00", "none", ".lg-final"],      // 리그 없는 날 → 지난 회차(10-15) 최종 결과 + 다음 예약 안내
    ["2026-10-17T06:50", "forming", ".lg-head"],
    ["2026-10-17T08:00", "delayed", ".lg-head"],
    ["2026-10-15T13:05", "live", ".lg-test", Date.UTC(2026, 9, 15, 4, 0)],   // 🧪 테스트 리그(2부제): 13:00 시작·20초 간격 → 5분 뒤 15라운드
    // 🏆 2부제 픽스처 10-19 (DPL 14 ~13:30 · DCL 8 ~10:30 · PO 13:30·13:45·14:00 3경기)
    ["2026-10-19T06:20", "before", ".lg-divs [data-div]"],
    ["2026-10-19T10:05", "live", "#lg-live .lg-match"],
    ["2026-10-19T13:36", "live", "#lg-po .lg-live-match"],                  // ⚔️ PO 1차전 진행 중
    ["2026-10-19T22:00", "done", ".lg-moves"],                              // 내일 리그 변동 카드
    ["2026-10-20T10:00", "none", ".lg-moves"]                               // 다음 날(리그 없음) → 지난 2부제 회차 결과
  ];
  for (const [nowParam, want, expectSel, testStart] of CASES) {
    const dom = new JSDOM(rd("league.html"), { url: "http://localhost/league.html", pretendToBeVisual: true, runScripts: "outside-only" });
    const { window } = dom;
    const errors = [];
    window.addEventListener("error", (e) => errors.push(e.error?.message || e.message));
    window.fetch = localFetch;
    let app = null;
    try {
      window.eval(rd("js/common.js"));
      window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
      app = await mountLeague(window.document.getElementById("league-root"), { win: window, fetch: leagueFetch, nowParam, myId: ME, ...(testStart ? { testParam: String(testStart), ivParam: 20 } : {}) });
    } catch (e) { errors.push("mount: " + e.message); }
    const doc = window.document;
    const status = app && app.ctx ? app.ctx().status : "-";
    const expectOk = doc.querySelectorAll(expectSel).length > 0;
    // 📻 v2.19.1 경기별 문자중계: 펼친 경기는 경기 시계가 흘러 다시 그려져도 펼친 채 유지
    if (want === "live" && expectSel.includes("lg-feed") && app) {
      const d0 = doc.querySelector("#lg-live details[data-live]");
      if (!d0) errors.push("라이브 경기 펼침 없음");
      else {
        d0.open = true; d0.dispatchEvent(new window.Event("toggle"));
        window.dispatchEvent(new window.HashChangeEvent("hashchange")); await sleep(30);   // 탭 전체 다시 그림
        const d1 = doc.querySelector(`#lg-live details[data-live="${d0.dataset.live}"]`);
        if (!d1 || !d1.open) errors.push("다시 그린 뒤 펼침 풀림");
      }
    }
    const change = (sel, v) => { const el = doc.querySelector(sel); if (el) { el.value = v; el.dispatchEvent(new window.Event("change", { bubbles: true })); } };
    const tabsOk = [];
    for (const t of ["live", "table", "players", "fixtures", "myteam", "records"]) {
      window.location.hash = t;
      window.dispatchEvent(new window.HashChangeEvent("hashchange"));
      await sleep(30);
      if (t === "table") change("[data-sel=table]", "1");
      if (t === "players") { const c = doc.querySelector('[data-kind="avg"]'); if (c) c.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); }
      if (t === "fixtures") change("[data-sel=fixtures]", "2");
      if (t === "myteam") change("[data-sel=myteam]", fxSnap.teams[1].ouid);
      await sleep(20);
      const bad = doc.querySelector("#lg-body .error-box");
      if (bad) errors.push(`${t} 탭 오류 표시`);
      tabsOk.push(doc.querySelector(`.pf-tab.active[data-tab="${t}"]`) ? "✓" : "✗");
    }
    if (app) app.destroy();
    const hasHeader = !!doc.querySelector(".app-header");
    const navOk = !!doc.querySelector('.app-nav a[href="league.html"].active');
    const ok = errors.length === 0 && hasHeader && navOk && status === want && expectOk && !tabsOk.includes("✗");
    console.log(`${ok ? "✅" : "❌"} league${testStart ? "(테스트)" : ""} ${nowParam.slice(5).replace("T", " ")} 상태:${status}(기대 ${want}) ${expectSel}:${expectOk} 탭:${tabsOk.join("")} 네비:${navOk}`);
    [...new Set(errors)].slice(0, 3).forEach((e) => console.log("   ⚠ " + String(e).split("\n")[0]));
    ok ? pass++ : fail++;
  }

  // 🏆 2부제 (v2.29.0): 리그 칩 전환 · 구역 표시 · 페널티 · 편성 규칙 · 승강 · 옛 스냅샷 불변
  {
    const D = await import(new URL("../js/league/divisions.js", import.meta.url));
    const { judgeEligibility } = await import(new URL("../js/league/eligibility.js", import.meta.url));
    const errors = [];
    const dom = new JSDOM(rd("league.html"), { url: "http://localhost/league.html", pretendToBeVisual: true, runScripts: "outside-only" });
    const { window } = dom;
    window.addEventListener("error", (e) => errors.push(e.error?.message || e.message));
    window.fetch = localFetch;
    window.eval(rd("js/common.js"));
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
    const app = await mountLeague(window.document.getElementById("league-root"), { win: window, fetch: leagueFetch, nowParam: "2026-10-19T22:00", myId: ME });
    const doc = window.document;
    const div0 = app.ctx().div;
    doc.querySelector('[data-div="DCL"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    await sleep(20);
    const div1 = app.ctx().div;
    window.location.hash = "table"; window.dispatchEvent(new window.HashChangeEvent("hashchange")); await sleep(20);
    const zoneOk = !!doc.querySelector(".lg-z-pro") && !!doc.querySelector(".lg-z-po");
    const penOk = doc.body.innerHTML.includes("⚠️");
    window.location.hash = "records"; window.dispatchEvent(new window.HashChangeEvent("hashchange")); await sleep(20);
    const recOk = doc.body.innerHTML.includes("2부제") && doc.body.innerHTML.includes("DCL 우승");
    window.location.hash = "myteam"; window.dispatchEvent(new window.HashChangeEvent("hashchange")); await sleep(20);
    const myNote = doc.body.innerHTML.includes("에서 뛰어요");     // 내 팀은 DPL — DCL을 보면 안내
    app.destroy();
    // 편성 규칙: 새 클럽원 DCL 맨 뒤 · 탈퇴 시 DPL 14 채우기 · 페널티
    const ids = Array.from({ length: 20 }, (_, i) => "o" + String(i).padStart(2, "0"));
    const divFile = { DPL: ids.slice(0, 14), DCL: ids.slice(14, 19) };
    const teams = [...ids.filter((x) => x !== "o03"), "zz"].map((ouid) => ({ ouid, name: ouid, ...(ouid === "o15" ? { short: { played: 1, need: 5 } } : {}) }));
    const as = D.assignDivisions(teams, divFile);
    const assignOk = as.order.DPL.length === 14 && as.order.DPL[13] === "o14" && as.order.DCL[as.order.DCL.length - 1] === "zz"
      && as.teams.find((t) => t.ouid === "o15").penalty === D.PENALTY && !as.teams.find((t) => t.ouid === "o01").penalty;
    // 판정: 판수 미달·휴식도 참가(penalize), 기본은 예전처럼 제외
    const mem = { members: [{ ouid: "a", ingameNick: "A" }, { ouid: "b", ingameNick: "B" }, { ouid: "c", ingameNick: "C", isSub: true }] };
    const dash = { current: { start: "2026-10-01", end: "2026-10-30", rows: [{ ouid: "a", played: 0, target: 50 }, { ouid: "b", resting: true, played: 0, target: 10 }] } };
    const jp = judgeEligibility(mem, dash, "2026-10-20", { penalize: true }), j0 = judgeEligibility(mem, dash, "2026-10-20");
    const judgeOk = jp.teams.length === 2 && !!jp.teams.find((t) => t.ouid === "a").short && !jp.teams.find((t) => t.ouid === "b").short && jp.excluded.length === 1 && j0.teams.length === 0;
    // 승강: PO 승자 DPL, 강등·승격 맞교환, 인원 보존
    const fx19 = JSON.parse(rd(FX + "days/2026-10-19.json"));
    const out = D.runLeagueDay(fx19, { seed: "DOR6" }, null);
    const nd = D.nextDivisions(fx19, out);
    const moveOk = nd.DPL.length === 14 && nd.DPL.includes(nd.moves.promoted) && nd.DCL.includes(nd.moves.relegated) && nd.DPL.includes(out.playoff.winner) && nd.DCL.includes(out.playoff.loser)
      && new Set([...nd.DPL, ...nd.DCL]).size === fx19.teams.length && out.playoff.games.every((g) => g.res.win);
    const ok = !errors.length && div0 === "DPL" && div1 === "DCL" && zoneOk && penOk && recOk && myNote && assignOk && judgeOk && moveOk;
    console.log(`${ok ? "✅" : "❌"} league 🏆2부제 칩:${div0}→${div1} 구역:${zoneOk} 페널티:${penOk} 기록실:${recOk} 내팀 안내:${myNote} 편성:${assignOk} 판정:${judgeOk} 승강:${moveOk}`);
    errors.slice(0, 3).forEach((e) => console.log("   ⚠ " + e));
    ok ? pass++ : fail++;
  }

  // 🔥 전날 판수 보너스 (v2.14.0): 보너스 식 · 보너스 없으면 결과 불변 · 있으면 반영 · 화면 표시
  {
    const { activityBoost, countedGames, attachBoost, prevDay } = await import(new URL("../js/league/boost.js", import.meta.url));
    const { runDay } = await import(new URL("../js/engine/index.js", import.meta.url));
    const { snapshotTeams } = await import(new URL("../js/league/roster.js", import.meta.url));
    const formulaOk = activityBoost(0) === 0 && activityBoost(5) === 400 && activityBoost(10) === 800 && activityBoost(30) === 2400 && activityBoost(99) === 2400
      && countedGames([2, 0, 0, 5, 1]) === 5 && countedGames([0, 0, 0, 70, 0]) === 35 && prevDay("2026-11-01") === "2026-10-31";
    const daily = { days: { "2026-10-14": { [fxSnap.teams[0].ouid]: [12, 3, 0, 20], [fxSnap.teams[1].ouid]: [2, 0, 1, 0] } } };
    const att = attachBoost(fxSnap.teams, daily, "2026-10-15");
    const boosted = { ...fxSnap, teams: att.teams, activity: att.activity, activityDay: att.activityDay };
    const sig = (snap) => { const d = runDay({ daySeed: snap.seed, teamSeed: snap.teamSeed, teams: snapshotTeams(snap) }); return JSON.stringify(d.tables[d.totalRounds].map((r) => [r.id, r.pts, r.gf])); };
    const plain = attachBoost(fxSnap.teams, { days: {} }, "2026-10-15");
    const sameOk = plain.activity === "skipped" && sig({ ...fxSnap, teams: plain.teams }) === sig(fxSnap) && sig({ ...fxSnap, teams: fxSnap.teams.map((t) => ({ ...t, act: [0, 0, 0, 0] })) }) === sig(fxSnap);
    const diffOk = att.teams[0].boost === 2000 && att.teams[1].boost === 240 && !att.teams[2].boost && sig(boosted) !== sig(fxSnap);
    // 화면: 10-15 스냅샷을 보너스 붙인 것으로 바꿔 진행 중 화면·내 팀 탭 확인
    const dom = new JSDOM(rd("league.html"), { url: "http://localhost/league.html", pretendToBeVisual: true, runScripts: "outside-only" });
    const { window } = dom;
    window.fetch = localFetch;
    window.eval(rd("js/common.js"));
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
    const fx2 = async (url) => String(url).includes("days/2026-10-15.json")
      ? { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(boosted)) } : leagueFetch(url);
    const app = await mountLeague(window.document.getElementById("league-root"), { win: window, fetch: fx2, nowParam: "2026-10-15T13:00", myId: ME });
    const doc = window.document;
    const liveOk = doc.querySelectorAll(".lg-fire").length > 0 && /판수 보너스 2팀/.test(doc.querySelector("#lg-body").textContent);
    window.location.hash = "myteam"; window.dispatchEvent(new window.HashChangeEvent("hashchange")); await sleep(30);
    const myOk = /35판 · 인정 25판 → 전력 \+2(?![.\d])/.test(doc.querySelector("#lg-body").textContent);
    app.destroy();
    const ok = formulaOk && sameOk && diffOk && liveOk && myOk;
    console.log(`${ok ? "✅" : "❌"} league 🔥판수 보너스 식:${formulaOk} 없으면 불변:${sameOk} 반영:${diffOk} 화면:${liveOk} 내팀:${myOk}`);
    ok ? pass++ : fail++;
  }

  // v2.24.0 평점 v2 · ⭐ 커리어 선수 입단·공수 보너스 · 커리어 자동 전송
  {
    const { runDay, playerStats, mvp } = await import(new URL("../js/engine/index.js", import.meta.url));
    const { snapshotTeams } = await import(new URL("../js/league/roster.js", import.meta.url));
    const { starBoost, applyStar, validStar } = await import(new URL("../js/league/career-link.js", import.meta.url));
    const { syncLeague, bestStar } = await import(new URL("../js/career/league-sync.js", import.meta.url));
    const run = (snap) => runDay({ daySeed: snap.seed, teamSeed: snap.teamSeed, teams: snapshotTeams(snap) });
    const d0 = run(fxSnap);
    const gpt = d0.rounds.reduce((s, rd) => s + rd.matches.length * 2, 0) / d0.ids.length;
    const best = mvp(playerStats(d0.rounds, d0.results, d0.totalRounds), Math.ceil(gpt / 2));
    const rateOk = best && best.avg >= 7.8 && best.avg <= 9.6;
    const sq = fxSnap.teams.find((t) => t.squad);
    const st = { name: "테스트", pos: "CB", ovr: 92, seasons: 15, retired: true, yday: 3 };
    const b = starBoost(st);
    const starred = { ...fxSnap, teams: fxSnap.teams.map((t) => (t === sq ? { ...t, star: st, boostDef: b.boostDef } : t)) };
    const d1 = run(starred);
    const team = d1.squads.get(sq.ouid);
    const starOk = b.boostDef === 495 && !b.boostAtt && team.players.some((p) => p.starter && p.name === "⭐테스트" && /CB/.test(p.role))
      && Math.abs(team.def - d0.squads.get(sq.ouid).def - 0.495) < 1e-9
      && starBoost({ ...st, pos: "ST", yday: 12 }).boostAtt === 1500 && !starBoost({ ...st, yday: 0 }).boostDef
      && starBoost({ name: "옛", pos: "ST", ovr: 85 }).boostAtt === 250
      && validStar({ ...st, ovr: 95, seasons: 4 }, 30) && !validStar(st, 30)
      && applyStar(undefined, st) === undefined;
    // 커리어 자동 전송: 내 프로필 없으면 안 보냄 / 있으면 명예의 전당·진행 중 중 최고 OVR 1명
    const mem = new Map(); const sent = [];
    const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
    const meta = { hall: [{ id: "C-a", name: "옛 전설", types: ["ST:sht+spd", "WG:dri+spd"], maxOvr: 93, seasons: 18 }] };
    const state = { seed: "C-b", phase: "offseason", player: { name: "현역", pos: "DM", typeKey: "def+pas" }, totals: { maxOvr: 88, seasons: 9 } };
    const fake = async (url, o) => { sent.push(JSON.parse(o.body)); return { json: async () => ({ ok: true, used: true, star: JSON.parse(o.body).star }) }; };
    const win = { crypto: globalThis.crypto };
    const r0 = await syncLeague({ storage, win, state, meta, workerUrl: "https://w", fetchFn: fake });
    mem.set("dor6.me", "abc");
    await syncLeague({ storage, win, state, meta, workerUrl: "https://w", fetchFn: fake });
    await syncLeague({ storage, win, state, meta, workerUrl: "https://w", fetchFn: fake });   // 같은 내용 → 다시 안 보냄
    const syncOk = r0 === null && sent.length === 1 && sent[0].star.name === "옛 전설" && sent[0].star.pos === "WG" && sent[0].seasons === 27
      && /^[a-z0-9]{8,32}$/.test(sent[0].device) && bestStar(state, { hall: [] }).name === "현역";
    const ok = rateOk && starOk && syncOk;
    console.log(`${ok ? "✅" : "❌"} league v4 평점 MVP ${best && best.avg.toFixed(2)}:${rateOk} ⭐입단·보너스:${starOk} 커리어 전송:${syncOk}`);
    ok ? pass++ : fail++;

    // v2.27.0 ⭐ 커리어 선수 아바타: 전송에 외모 포함 · Worker 정리 · 리그 화면 표시 · 결과 불변
    const { clean } = await import(new URL("../worker/src/career.js", import.meta.url));
    const look = { skin: 2, hair: "curly", hairColor: 1, number: 7 };
    const st2 = { ...state, player: { ...state.player, look, equip: { boots: "boots-spd-3" }, clubId: "x" } };
    const bs = bestStar(st2, { hall: [] }, (id) => (id === "x" ? "#123abc" : null));
    const sendOk = bs.look === look && bs.equip.boots === "boots-spd-3" && bs.color === "#123abc";
    const cl = clean({ name: "A", pos: "ST", ovr: 80, seasons: 5, look: { skin: 99, hair: "<x>", number: 500 }, equip: { boots: "boots-pas-3", ball: "ball-sht-2", hat: "x" }, color: "red" });
    const cleanOk = cl.look.skin === 1 && cl.look.hair === "short" && cl.look.number === 9 && !cl.equip.boots && cl.equip.ball === "ball-sht-2" && !cl.equip.hat && !("color" in cl)
      && !("look" in clean({ name: "B", pos: "CB", ovr: 70, seasons: 3 }));
    const avStar = { ...st, look, equip: { top: "top-pas-3" }, color: "#2255aa" };
    const avSnap = { ...fxSnap, teams: fxSnap.teams.map((t) => (t === sq ? { ...t, star: avStar, boostDef: b.boostDef } : t)) };
    const sameRes = JSON.stringify(run(avSnap).results) === JSON.stringify(d1.results);
    const dom = new JSDOM(rd("league.html"), { url: "http://localhost/league.html", pretendToBeVisual: true, runScripts: "outside-only" });
    const { window } = dom;
    window.fetch = localFetch;
    window.eval(rd("js/common.js"));
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
    const fx3 = async (url) => String(url).includes("days/2026-10-15.json")
      ? { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(avSnap)) } : leagueFetch(url);
    const lapp = await mountLeague(window.document.getElementById("league-root"), { win: window, fetch: fx3, nowParam: "2026-10-15T13:00", myId: sq.ouid });
    const doc = window.document;
    const liveAv = !!doc.querySelector("#lg-body .lg-boost .lg-av svg.cr-av");
    window.location.hash = "myteam"; window.dispatchEvent(new window.HashChangeEvent("hashchange")); await sleep(30);
    const myAv = !!doc.querySelector(".lg-star-card .lg-av svg") && !!doc.querySelector(".lg-squad .lg-av.face svg");
    lapp.destroy();
    const ok2 = sendOk && cleanOk && sameRes && liveAv && myAv;
    console.log(`${ok2 ? "✅" : "❌"} league ⭐아바타 전송:${sendOk} Worker 정리:${cleanOk} 결과 불변:${sameRes} 라이브:${liveAv} 내팀·선수단:${myAv}`);
    ok2 ? pass++ : fail++;
  }

  // 엔진 금지 함수 검사 (주석 제외) — 기기마다 결과가 달라질 수 있는 함수·현재 시각 사용 금지 (CLAUDE.md 25-5)
  const bad = [];
  for (const f of fs.readdirSync(path.join(ROOT, "js/engine"))) {
    const src = rd("js/engine/" + f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const m = src.match(/Math\.(random|exp|log|pow|sqrt|sin|cos|tan|atan|cbrt|hypot)\b|\bDate\b|performance\.|localStorage|document\./g);
    if (m) bad.push(`${f}: ${[...new Set(m)].join(", ")}`);
  }
  console.log(`${bad.length ? "❌" : "✅"} 엔진 금지 함수 검사 ${bad.length ? bad.join(" / ") : "없음"}`);
  bad.length ? fail++ : pass++;
}

/* ---------- ✏️ 닉네임 변경 자동 반영 (v2.29.1) ---------- */
{
  const { syncNicks } = await import(new URL("./sync-nicks.js", import.meta.url));
  const mf = { members: [
    { ouid: "a", ingameNick: "Dor6문선생" },
    { ouid: "b", ingameNick: "같음" },
    { ouid: "c", ingameNick: "조회실패" },
    { ouid: "d", ingameNick: "새닉2", prevNicks: ["새닉1", "원래"] }
  ] };
  const pf = { profiles: { a: { nickname: "문선생" }, b: { nickname: "같음" }, c: {}, d: { nickname: "원래" } } };
  const ch = syncNicks(mf, pf);
  const [a, b, c, d] = mf.members;
  const ok = ch.length === 2 && a.ingameNick === "문선생" && a.prevNicks[0] === "Dor6문선생" && !b.prevNicks && c.ingameNick === "조회실패"
    && d.ingameNick === "원래" && JSON.stringify(d.prevNicks) === JSON.stringify(["새닉2", "새닉1"]);   // 예전 닉으로 되돌리면 목록에서 빠짐
  // 클럽원 검색: 예전 닉으로도 찾힘
  const msSrc = rd("js/members.js");
  const searchOk = msSrc.includes("m.prevNicks || []");
  console.log(`${ok && searchOk ? "✅" : "❌"} 닉 변경 반영 변경:${ch.length}명 예전 닉 보관:${ok} 예전 닉 검색:${searchOk}`);
  ok && searchOk ? pass++ : fail++;
}

/* ---------- ⭐ 내 선수 키우기 (v2.13.0) ----------
   app.js는 ES 모듈 → Node에서 import해 jsdom 창에 mountCareer로 붙임 (저장소는 메모리 대체)
   흐름: 타이틀 → 선수 생성 → 시작 구단 → 오프시즌 탭 4개 → 시즌 2회 → 리포트 탭 4개 → 기록·업적·명예의 전당·설정(내보내기/가져오기)
   + USE_REAL_NAMES 전환 검사: 가상명 모드에서 화면·내보내기 글에 실제 구단명 0건 */
{
  const { mountCareer } = await import(new URL("../js/career/app.js", import.meta.url));
  const { namesMode } = await import(new URL("../js/career/config.js", import.meta.url));
  const clubsJson = JSON.parse(rd("data/career/clubs.json"));
  const realNames = clubsJson.clubs.flatMap((c) => [c.realName, c.koName].filter(Boolean)).filter((n) => n.length >= 3);
  const run = async (useReal) => {
    namesMode.useReal = useReal;
    const dom = new JSDOM(rd("career.html"), { url: "http://localhost/career.html", pretendToBeVisual: true, runScripts: "outside-only" });
    const { window } = dom;
    const errors = [];
    window.addEventListener("error", (e) => errors.push(e.error?.message || e.message));
    window.confirm = () => true;
    window.navigator.clipboard = { writeText: async () => {} };
    const mem = new Map();
    const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
    const doc = window.document;
    const html = [];
    const steps = [];
    let app = null;
    const click = async (sel, wait = 10) => {
      const el = doc.querySelector(sel);
      if (!el) { errors.push("없음: " + sel); return false; }
      el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await sleep(wait);
      if (doc.querySelector("#career-root .error-box")) errors.push("오류 화면: " + sel);
      html.push(doc.getElementById("career-root").innerHTML);
      return true;
    };
    try {
      window.eval(rd("js/common.js"));
      doc.dispatchEvent(new window.Event("DOMContentLoaded"));
      app = await mountCareer(doc.getElementById("career-root"), { win: window, fetch: localFetch, storage, now: () => "2026-10-15T00:00:00Z", seedFn: () => "C-smoke" + (useReal ? "" : "2") });
      app.meta.settings.fast = false;           // 연출 없이 바로 리포트
      steps.push(doc.querySelector('[data-act="go"][data-to="create"]') ? "타이틀" : "타이틀✗");
      await click('[data-act="go"][data-to="create"]');
      await click('[data-act="create-pos"][data-pos="WG"]');
      await click('[data-act="create-cat"][data-cat="spd"]'); await click('[data-act="create-cat"][data-cat="dri"]');
      steps.push(doc.querySelector(".cr-result-type") ? "생성" : "생성✗");
      // 👕 외모 선택 (v2.26.0)
      await click('[data-act="look-hair"][data-h="curly"]'); await click('[data-act="look-skin"][data-i="3"]');
      if (!doc.querySelector(".cr-look-av svg.cr-av") || app.view.draft.look.hair !== "curly") errors.push("외모 선택 안 됨");
      await click('[data-act="create-start"]');
      steps.push(doc.querySelectorAll('[data-act="start-pick"]').length ? "시작구단" : "시작구단✗");
      await click('[data-act="start-tab"][data-c="it"]');
      await click('[data-act="start-pick"]');
      // 🎲 시즌 이벤트: 고르기 전엔 다른 단계로 못 감 → 선택 → 결과 카드
      await click('[data-act="off-step"][data-step="club"]');
      if (!doc.querySelector('[data-act="event-pick"]')) errors.push("오프시즌 첫 화면에 이벤트 선택지 없음");
      app.acts.play(); await sleep(10);                                  // 하단 버튼이 없어도 직접 호출 시 막혀야 함
      if (app.view.playing) errors.push("이벤트 전에 시즌 시작됨");
      await click('[data-act="event-pick"][data-i="0"]');
      if (!doc.querySelector(".cr-ev-res") || !app.state.off.event || app.state.off.event.choice !== 0) errors.push("이벤트 결과 표시 안 됨");
      steps.push(doc.querySelector(".cr-ev-res") ? "이벤트" : "이벤트✗");
      await click('[data-act="off-step"][data-step="club"]');
      for (const t of ["pos", "club", "shop", "focus", "club"]) await click(`[data-act="off-step"][data-step="${t}"]`);
      await click('[data-act="off-decide"][data-type="stay"]');            // 고르면 훈련 단계로 자동 이동
      if (app.view.offStep !== "shop") errors.push("잔류 선택 후 훈련 단계로 안 넘어감");
      await click('[data-act="off-step"][data-step="focus"]');
      steps.push(doc.querySelector(".cr-plan") ? "오프시즌" : "오프시즌✗");
      for (let season = 0; season < 2; season++) {
        await click('[data-act="off-step"][data-step="focus"]');
        await click('[data-act="play"]', 30);
        for (let i = 0; i < 300 && app.route !== "report"; i++) await sleep(20);   // 시즌 계산 대기
        steps.push(app.route === "report" ? `시즌${season + 1}` : `시즌${season + 1}✗(${app.route})`);
        for (const t of ["rank", "leaders", "table", "matches"]) await click(`[data-act="report-tab"][data-tab="${t}"]`);
        if (!doc.querySelector(".cr-matches")) errors.push("경기별 기록 표 없음");
        await click('[data-act="to-offseason"]');
        await click('[data-act="event-pick"][data-i="2"]');
        if (!app.state.off.event || app.state.off.event.n !== season + 2 || app.state.off.event.choice !== 2) errors.push("다음 시즌 이벤트 없음");
        if (season === 0) {
          // 👕 코스튬: 시즌당 1개 구매 · 옷장 갈아입기 · 아바타
          const p = app.state.player;
          if (p.look.hair !== "curly" || p.look.skin !== 3) errors.push("외모가 저장되지 않음");
          p.money = Math.max(p.money, 30);
          await click('[data-act="off-step"][data-step="costume"]');
          if (!doc.querySelector(".cr-cos-av svg.cr-av") || !doc.querySelector(".cr-player-av svg")) errors.push("아바타 없음");
          await click('[data-act="cos-try"][data-id="boots-spd-3"]');
          if (app.state.player.equip.boots) errors.push("입어 보기가 저장됨");
          const m0 = p.money;
          await click('[data-act="cos-buy"][data-id="boots-spd-3"]');
          if (p.equip.boots !== "boots-spd-3" || Math.abs(m0 - p.money - 20) > 0.01) errors.push("코스튬 구매 안 됨");
          app.acts["cos-buy"]({ id: "socks-phy-1" }); await sleep(5);
          if (p.wardrobe.length !== 1 || !app.view.cosMsg) errors.push("시즌당 1개 제한 안 됨");
          await click('[data-act="cos-equip"][data-slot="boots"][data-id=""]');
          if (p.equip.boots) errors.push("벗기 안 됨");
          await click('[data-act="cos-equip"][data-slot="boots"][data-id="boots-spd-3"]');
          if (!doc.querySelector(".cr-gear")) errors.push("장비 보정 표시 없음");
          const { ensureCostume, gearDelta } = await import(new URL("../js/career/costume.js", import.meta.url));
          const old = ensureCostume({ seed: "C-old", player: { pos: "ST", subs: p.subs } });
          if (!old.player.look || gearDelta(old.player) !== 0 || !(gearDelta(p) > 0)) errors.push("예전 저장 외모 자동 생성/장비 보정 오류");
          steps.push("코스튬");
        }
        await click('[data-act="off-step"][data-step="club"]');
        if (doc.querySelector('[data-act="off-decide"][data-type="transfer"]')) await click('[data-act="off-decide"][data-type="transfer"]');
      }
      for (const r of ["career", "achievements", "hall", "settings"]) {
        app.go(r); await sleep(10); html.push(doc.getElementById("career-root").innerHTML);
        if (doc.querySelector("#career-root .error-box")) errors.push("오류 화면: " + r);
      }
      if (!doc.querySelector("#cr-ovr-chart, .cr-ach-grid, .cr-ta")) { /* 마지막은 설정 */ }
      await click('[data-act="export"]');
      const exp = doc.querySelector("#cr-export")?.value || "";
      html.push(exp);
      const imp = doc.querySelector("#cr-import");
      if (imp) { imp.value = exp; await click('[data-act="import"]'); }
      steps.push(exp.includes("dor6-career") && app.state && app.state.history.length === 2 ? "내보내기/가져오기" : "내보내기✗");
      // 은퇴 → 명예의 전당
      app.go("offseason", { offStep: "club" }); await sleep(10);
      await click('[data-act="retire-now"]');                                  // 나이 제한 없음 (조기 은퇴)
      await click('[data-act="hall-register"]');
      steps.push(app.meta.hall.length === 1 && app.route === "hall" ? "은퇴·전당" : "은퇴✗");
      html.push(doc.getElementById("career-root").innerHTML);
    } catch (e) { errors.push("mount: " + e.stack); }
    const keys = [...mem.keys()].filter((k) => !k.startsWith("dor6.career."));
    if (keys.length) errors.push("dor6.career. 접두어 아닌 저장 키: " + keys.join(","));
    const leaked = useReal ? [] : realNames.filter((n) => html.some((h) => h.includes(n)));
    const navOk = !!doc.querySelector('.app-nav a[href="career.html"].active');
    const ok = errors.length === 0 && navOk && !steps.some((s) => s.includes("✗")) && !leaked.length;
    console.log(`${ok ? "✅" : "❌"} career(${useReal ? "실명" : "가상명"}) ${steps.join(" → ")} 네비:${navOk}${useReal ? "" : ` 실명 노출:${leaked.length}건`}`);
    [...new Set(errors)].slice(0, 4).forEach((e) => console.log("   ⚠ " + String(e).split("\n").slice(0, 3).join(" | ")));
    if (leaked.length) console.log("   ⚠ 노출: " + leaked.slice(0, 5).join(", "));
    ok ? pass++ : fail++;
  };
  await run(true);
  await run(false);
  namesMode.useReal = true;
}

/* ---------- ⚔️ 상대 분석 (v2.28.0): Worker /search 형식 픽스처(클럽원 2명 공식 30경기) → scout.html 장표 ----------
   js/scout.js의 동적 import(lib)는 jsdom에서 못 쓰므로 미리 불러온 lib로 바꿔 실행 */
{
  const scout = await import(new URL("./lib/scout.js", import.meta.url));
  const insight = await import(new URL("./lib/insight.js", import.meta.url));
  const { withShots } = await import(new URL("./lib/playstyle.js", import.meta.url));
  const membersAll = JSON.parse(rd("data/members.json")).members;
  const official = (o) => { try { return JSON.parse(rd("data/matches/" + o + ".json")).matches.filter((x) => x.matchType === 50 && x.styleRaw && x.styleRaw.end === 0 && Array.isArray(x.shots)).slice(0, 30); } catch { return []; } };
  const pair = membersAll.filter((m) => m.ouid && official(m.ouid).length >= 15).slice(0, 2);
  const fake = (m) => {
    const ms = official(m.ouid);
    return { ouid: m.ouid, nickname: m.ingameNick, level: 1, maxDivision: "챌린저1",
      matches: ms.map((x) => ({ matchId: x.matchId, matchType: 50, matchDate: x.matchDate, result: x.result, goalFor: x.goalFor, goalAgainst: x.goalAgainst,
        opponentNick: x.opponentNick, possession: null, lineup: x.lineup || [], oppLineup: [] })),
      summary: { games: ms.length, wins: ms.filter((x) => x.result === "win").length },
      analysis: { version: 2, games: ms.length, minGames: 10, playstyle: null, ace: [], groupLabels: {}, metricLabels: {},
        guideRows: ms.map((x) => ({ result: x.result, raw: withShots(x.styleRaw, x.shots), shots: x.shots, oppGoals: x.oppGoals, goalFor: x.goalFor, goalAgainst: x.goalAgainst })) } };
  };
  const errors = [];
  let ok = pair.length === 2, detail = "클럽원 표본 부족";
  if (ok) {
    const [opp, me] = pair.map(fake);
    // 순수 계산: 장표 구성·속도
    const t0 = performance.now();
    const s = scout.buildScout(opp.analysis.guideRows, JSON.parse(rd("data/meta/ranker-baseline.json")).stats, me.analysis.guideRows);
    const ms = performance.now() - t0;
    const few = scout.buildScout(opp.analysis.guideRows.slice(0, 5), {}, null);
    const calcOk = !!s.record && s.tactics.length === 4 && !!s.vs && s.vs.bars.length >= 8 && !few.record && few.minGames === 10;
    // 화면
    const store = new Map([["dor6.scout.me", JSON.stringify(me.nickname)]]);
    const dom = new JSDOM(rd("scout.html"), { url: "http://localhost/scout.html?q=" + encodeURIComponent(opp.nickname), pretendToBeVisual: true, runScripts: "outside-only" });
    const { window } = dom;
    window.addEventListener("error", (e) => errors.push(e.error?.message || e.message));
    window.addEventListener("unhandledrejection", (e) => errors.push("reject: " + (e.reason?.message || e.reason)));
    Object.defineProperty(window, "localStorage", { value: { getItem: (k) => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) } });
    let calls = 0;
    window.fetch = async (url, opt) => {
      if (!String(url).endsWith("/search")) return localFetch(url);
      calls++;
      const nick = JSON.parse(opt.body).nickname;
      const data = nick === me.nickname ? me : opp;
      return { ok: true, status: 200, json: async () => data };
    };
    window.__scLib = { scout, insight };
    const src = rd("js/scout.js")
      .replace('import(new URL("scripts/lib/scout.js", document.baseURI).href)', "Promise.resolve(window.__scLib.scout)")
      .replace('import(new URL("scripts/lib/insight.js", document.baseURI).href)', "Promise.resolve(window.__scLib.insight)");
    try {
      window.eval(["js/common.js", "js/auth.js", "js/squad.js", "js/insight-ui.js", "js/share.js"].map(rd).join("\n;\n") + "\n;\n" + src);
      window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
    } catch (e) { errors.push("eval: " + e.message); }
    await sleep(1200);
    const q = (sel) => window.document.querySelectorAll(sel).length;
    const txt = window.document.getElementById("sc-root").textContent;
    const domOk = q("#sc-sheet .sc-head") === 1 && q(".sc-tac-row") === 5 && /이것만 막아라/.test(txt) && /여길 노려라/.test(txt)
      && q(".sc-bar") >= 8 && q("#sc-shots svg.shotmap") === 1 && q('.app-nav a[href="scout.html"].active') === 1
      && store.has("dor6.scout.mine") && store.has("dor6.search." + opp.nickname.toLowerCase());
    // 같은 상대 다시 → 저장본 사용(추가 호출 없음)
    const before = calls;
    window.document.getElementById("sc-go").click();
    await sleep(300);
    ok = calcOk && domOk && calls === before && errors.length === 0;
    detail = `계산 ${ms.toFixed(1)}ms 막아라${s.threats.length}·노려라${s.holes.length}·주의${s.vs.cautions.length}·유리${s.vs.chances.length} 부족 안내:${!few.record} 화면:${domOk} 재조회 생략:${calls === before} 호출${calls}회`;
  }
  console.log(`${ok ? "✅" : "❌"} scout.html 상대 분석 ${detail}`);
  [...new Set(errors)].slice(0, 3).forEach((e) => console.log("   ⚠ " + String(e).split("\n")[0]));
  ok ? pass++ : fail++;
}

console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
