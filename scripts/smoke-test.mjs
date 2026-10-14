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
  { file: "search.html",    scripts: ["js/common.js", "js/auth.js", "js/squad.js", "js/insight-ui.js", "js/search.js"], root: null }
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
    ["2026-10-15T22:00", "done", ".lg-final"],
    ["2026-10-16T10:00", "none", ".lg-final"],      // 리그 없는 날 → 지난 회차(10-15) 최종 결과 + 다음 예약 안내
    ["2026-10-17T06:50", "forming", ".lg-head"],
    ["2026-10-17T08:00", "delayed", ".lg-head"],
    ["2026-10-15T13:05", "live", ".lg-test", Date.UTC(2026, 9, 15, 4, 0)]   // 🧪 테스트 리그: 13:00 시작·20초 간격 → 5분 뒤 15라운드
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

console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
