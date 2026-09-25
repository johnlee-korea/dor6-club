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
    scripts: ["js/common.js", "js/squad.js", "js/insight-ui.js", "js/activity-ui.js", "js/share.js", "js/member.js"], root: "profile-root", expect: ".pf-tab.active",
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
console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
