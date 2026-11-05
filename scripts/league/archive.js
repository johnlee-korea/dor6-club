/* ============================================================
   archive.js — 도륙리그 기록 보관 (CLAUDE.md 25-7)
   지난 개최일 중 history.json에 아직 없는 회차를 전부 같은 엔진으로 시뮬레이션해 최종 결과를 추가한다.
   - 매일 00:30 KST: Worker Cron → league.yml(workflow_dispatch) → 이 스크립트 (GitHub schedule 01:10 예비)
   - 누락된 날도 자동 복구 · 이미 기록된 회차는 건드리지 않음(엔진이 바뀌어도 과거 기록 보존)
   - 🏆 2부제(v2.29.0, 스냅샷 format 2): 두 리그 + 승강 PO 요약을 기록하고 data/league/divisions.json(다음 편성 명단)을 갱신
     2부제 이전 회차가 마지막이면 그 최종 순위로 첫 명단을 만듦(상위 14 = DPL). 날짜 순서대로 처리 → 누락일 복구 때도 명단 체인 유지
   - 실행: node scripts/league/archive.js [--today YYYY-MM-DD] [--dir 데이터 폴더]
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDay, summarizeDay, ENGINE_VERSION } from "../../js/engine/index.js";
import { kstDate } from "../../js/league/clock.js";
import { snapshotTeams } from "../../js/league/roster.js";
import { isSplit, runLeagueDay, summarizeLeagueDay, nextDivisions, divisionsFromLegacy } from "../../js/league/divisions.js";

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
  return archiveDay(entry, snap, config, names).rec;
}
/* → { rec: history 항목, divisions: 다음 편성 명단 | null } */
export function archiveDay(entry, snap, config, names) {
  if (!snap) return { rec: { no: entry.no, date: entry.date, status: "none", teams: 0 }, divisions: null };              // 편성 실패(미개최)
  if (!snap.teams || snap.teams.length < 2) return { rec: { no: entry.no, date: entry.date, status: "rest", teams: (snap.teams || []).length }, divisions: null };
  if (isSplit(snap)) {
    const out = runLeagueDay(snap, config, names);
    const { next, ...sum } = summarizeLeagueDay(snap, out);
    return { rec: { no: entry.no, date: entry.date, engine: ENGINE_VERSION, ...sum }, divisions: nextDivisions(snap, out) };
  }
  const day = runDay({ daySeed: snap.seed, teamSeed: snap.teamSeed || config.seed, teams: snapshotTeams(snap, names) });
  return { rec: { no: entry.no, date: entry.date, engine: ENGINE_VERSION, teams: snap.teams.length, ...summarizeDay(day) }, divisions: divisionsFromLegacy(snap, day) };
}
/* 회차 요약 한 줄 (콘솔) */
export function recLine(rec) {
  if (rec.status) return rec.status === "none" ? "스냅샷 없음(미개최)" : "휴무";
  if (rec.format === 2) {
    const d = rec.DPL && rec.DPL.table[0], l = rec.DCL && rec.DCL.table[0], po = rec.playoff;
    return `${rec.teams}팀 · DPL 우승 ${d ? d.name : "-"} · DCL 우승 ${l ? l.name : "-"}${po ? ` · PO 승자 ${po.names[po.winner]}` : ""}`;
  }
  const c = rec.table && rec.table[0];
  return `${rec.teams}팀 · 우승 ${c.name} (승점 ${c.pts})`;
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
  const divFile = path.join(DIR, "divisions.json");
  let divisions = readJSON(divFile, null);
  todo.sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const entry of todo) {
    const snap = readJSON(path.join(DIR, "days", entry.date + ".json"), null);
    const { rec, divisions: nd } = archiveDay(entry, snap, config, names);
    history.days.push(rec);
    console.log(`제${rec.no}회 ${rec.date}: ${recLine(rec)}`);
    // 다음 편성 명단: 더 최근 회차 기준일 때만 갱신 (옛 회차 재처리로 되돌아가지 않게)
    if (nd && (!divisions || !divisions.basedOn || divisions.basedOn < entry.date)) {
      divisions = nd;
      console.log(`  → divisions.json 갱신 (DPL ${nd.DPL.length} · DCL ${nd.DCL.length}${nd.from === "legacy" ? " · 2부제 첫 명단" : ""})`);
    }
  }
  if (divisions) fs.writeFileSync(divFile, JSON.stringify(divisions, null, 2) + "\n");
  history.days.sort((a, b) => a.no - b.no || (a.date < b.date ? -1 : 1));
  fs.writeFileSync(histFile, JSON.stringify(history, null, 2) + "\n");
  console.log(`✅ history.json 갱신 — ${todo.length}회차 추가 (총 ${history.days.length})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
