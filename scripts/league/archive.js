/* ============================================================
   archive.js — 도륙리그 기록 보관 (CLAUDE.md 25-7)
   지난 개최일 중 history.json에 아직 없는 회차를 전부 같은 엔진으로 시뮬레이션해 최종 결과를 추가한다.
   - 매일 00:30 KST: Worker Cron → league.yml(workflow_dispatch) → 이 스크립트 (GitHub schedule 01:10 예비)
   - 누락된 날도 자동 복구 · 이미 기록된 회차는 건드리지 않음(엔진이 바뀌어도 과거 기록 보존)
   - 실행: node scripts/league/archive.js [--today YYYY-MM-DD] [--dir 데이터 폴더]
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDay, summarizeDay, ENGINE_VERSION } from "../../js/engine/index.js";
import { kstDate } from "../../js/league/clock.js";
import { snapshotTeams } from "../../js/league/roster.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (name) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : null; };
const DIR = path.resolve(arg("dir") || path.join(ROOT, "data/league"));
const TODAY = arg("today") || kstDate(Date.now());

const readJSON = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); }
  catch (e) { if (e.code === "ENOENT") return fallback; throw e; }
};

/* 실제 스쿼드 선수 이름표 (spId → 이름) */
export const loadNames = () => readJSON(path.join(ROOT, "data/meta/players.json"), {});

/* 스냅샷 하나 → history 항목 (names: 선수 이름표 — 기록에 실제 선수 이름이 남음) */
export function archiveEntry(entry, snap, config, names) {
  if (!snap) return { no: entry.no, date: entry.date, status: "none", teams: 0 };              // 편성 실패(미개최)
  if (!snap.teams || snap.teams.length < 2) return { no: entry.no, date: entry.date, status: "rest", teams: (snap.teams || []).length };
  const day = runDay({ daySeed: snap.seed, teamSeed: snap.teamSeed || config.seed, teams: snapshotTeams(snap, names) });
  return { no: entry.no, date: entry.date, engine: ENGINE_VERSION, teams: snap.teams.length, ...summarizeDay(day) };
}

function main() {
  const config = readJSON(path.join(DIR, "config.json"), null);
  if (!config) { console.error("❌ config.json 없음:", DIR); process.exit(1); }
  const histFile = path.join(DIR, "history.json");
  const history = readJSON(histFile, { days: [] });
  history.days = history.days || [];
  const done = new Set(history.days.filter((d) => !d.test).map((d) => d.date));   // 🧪 테스트 기록(archive-test.js)은 제외

  // 오늘(KST)보다 이전 개최일만 — 오늘 리그는 아직 진행 중일 수 있음
  const todo = (config.days || []).filter((d) => d.date < TODAY && !done.has(d.date));
  if (!todo.length) { console.log(`기록할 회차 없음 (기준일 ${TODAY})`); return; }

  const names = loadNames();
  for (const entry of todo) {
    const snap = readJSON(path.join(DIR, "days", entry.date + ".json"), null);
    const rec = archiveEntry(entry, snap, config, names);
    history.days.push(rec);
    const c = rec.table && rec.table[0];
    console.log(`제${rec.no}회 ${rec.date}: ${rec.status ? (rec.status === "none" ? "스냅샷 없음(미개최)" : "휴무") : `${rec.teams}팀 · 우승 ${c.name} (승점 ${c.pts})`}`);
  }
  history.days.sort((a, b) => a.no - b.no || (a.date < b.date ? -1 : 1));
  fs.writeFileSync(histFile, JSON.stringify(history, null, 2) + "\n");
  console.log(`✅ history.json 갱신 — ${todo.length}회차 추가 (총 ${history.days.length})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
