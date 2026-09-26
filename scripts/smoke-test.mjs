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
  { file: "index.html",     scripts: ["js/common.js", "js/activity-ui.js", "js/home.js"], root: "summary", expect: ".copyright" },
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
  { file: "admin.html",     scripts: ["js/common.js", "js/auth.js", "js/admin.js"], root: null },
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
    if (process.env.MG_DEBUG) console.log(window.document.querySelector("main").textContent.replace(/\s+/g, " ").slice(0, 400));
    const click = (sel) => { const el = window.document.querySelector(sel); if (el) el.dispatchEvent(new window.MouseEvent("click", { bubbles: true })); };
    click(".mg-row"); await sleep(200);
    const detail = q(".mg-detail").length;
    for (const m of ["official", "friendly", "manager"]) { click(`[data-mode="${m}"]`); await sleep(500); }
    const capBtn = q("#mg-body [data-capture]").length;   // 모드 📸 (v2.3.0)
    const hasHeader = !!window.document.querySelector(".app-header");
    const ok = errors.length === 0 && hasHeader && rowsShown > 0 && detail > 0 && capBtn > 0;
    console.log(`${ok ? "✅" : "❌"} ${c.label.padEnd(15)} header:${hasHeader} 진단 행:${rowsShown} 상세:${detail} 📸:${capBtn}`);
    [...new Set(errors)].slice(0, 3).forEach((e) => console.log("   ⚠ " + String(e).split("\n")[0]));
    ok ? pass++ : fail++;
  }
}


console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
