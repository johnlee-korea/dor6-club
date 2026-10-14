/* ============================================================
   verify.js — history.json 기록 vs 현재 엔진 재계산 비교 (npm run league:verify)
   엔진(js/engine)을 고친 뒤 배포 전에 실행: "다름"이 나오면 결과가 바뀌는 수정
   → ENGINE_VERSION을 올리고, 리그가 없는 시간(00:40~06:30 KST)에만 배포 (CLAUDE.md 25-6)
   ※ 과거 기록은 history.json에 고정 저장돼 있어 엔진이 바뀌어도 기록실은 그대로
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { archiveEntry } from "./archive.js";
import { ENGINE_VERSION } from "../../js/engine/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(ROOT, "data/league");
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

const config = read(path.join(DIR, "config.json")) || { days: [] };
const history = read(path.join(DIR, "history.json")) || { days: [] };
const pick = (r) => JSON.stringify({ t: r.table, s: r.scorers, a: r.assists, m: r.mvp });

console.log(`현재 엔진 v${ENGINE_VERSION} — 기록 ${history.days.length}회차 비교`);
let diff = 0, checked = 0;
for (const h of history.days) {
  if (!h.table) continue;
  const snap = read(path.join(DIR, "days", h.date + ".json"));
  if (!snap) { console.log(`  제${h.no}회 ${h.date}: 스냅샷 없음 — 건너뜀`); continue; }
  const now = archiveEntry(h, snap, config);
  const same = pick(now) === pick(h);
  checked++;
  if (!same) diff++;
  console.log(`  제${h.no}회 ${h.date} (기록 엔진 v${h.engine}): ${same ? "✅ 동일" : "❌ 다름 — 우승 " + h.table[0].name + " → " + now.table[0].name}`);
}
console.log(checked ? (diff ? `\n⚠ ${diff}회차 결과가 달라짐 → 결과가 바뀌는 엔진 수정입니다 (ENGINE_VERSION 올리기·배포 시간 확인)` : "\n✅ 모든 기록과 일치") : "\n비교할 기록 없음");
