/* ============================================================
   archive-test.js — 🧪 테스트 리그 결과를 기록실(history.json)에 남기기 (수동 실행)
   사용자 요청(2026-10-14): "테스트 리그도 홈페이지에 기록해줘, 어떻게 나오나 보게"
     node scripts/league/archive-test.js <시작 ms> [--remove]
   - 테스트 리그 화면과 같은 입력(지금 members.json·dashboard.json, 시드 TEST-<시작 ms>)으로 다시 계산
     ※ 테스트 이후 명단·판수가 바뀌었다면 편성이 달라질 수 있음 → 끝난 직후에 실행할 것
   - 항목에 test: true 표시 → 기록실에 '🧪 테스트'로 구분. 정식 회차 번호와 무관
   - --remove: 테스트 기록 전부 삭제 (정식 운영 전 정리용)
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runDay, summarizeDay, ENGINE_VERSION } from "../../js/engine/index.js";
import { judgeEligibility } from "../../js/league/eligibility.js";
import { kstDate } from "../../js/league/clock.js";
import { squadFromLineup, snapshotTeams } from "../../js/league/roster.js";
import { attachBoost } from "../../js/league/boost.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const HIST = path.join(ROOT, "data/league/history.json");
const history = JSON.parse(fs.readFileSync(HIST, "utf8"));
history.days = history.days || [];

if (process.argv.includes("--remove")) {
  const before = history.days.length;
  history.days = history.days.filter((d) => !d.test);
  fs.writeFileSync(HIST, JSON.stringify(history, null, 2) + "\n");
  console.log(`테스트 기록 ${before - history.days.length}건 삭제`);
  process.exit(0);
}

const start = Number(process.argv[2]);
if (!start) { console.error("사용법: node scripts/league/archive-test.js <시작 ms> [--remove]"); process.exit(1); }
const seed = `TEST-${start}`;
if (history.days.some((d) => d.seed === seed)) { console.log("이미 기록된 테스트 리그"); process.exit(0); }

const config = read("data/league/config.json");
const date = kstDate(start);
const j = judgeEligibility(read("data/members.json"), read("data/dashboard.json"), date);
// 테스트 리그 화면과 같은 방식: 실제 스쿼드(squads.json) 첨부 + 선수 이름표
const sq = read("data/squads.json").squads || {};
let dg = null; try { dg = read("data/daily-games.json"); } catch { /* 없으면 보너스 없음 */ }
const snap = { teams: attachBoost(j.teams.map((t) => { const q = squadFromLineup(sq[t.ouid]); return q ? { ...t, squad: q } : t; }), dg, date).teams };
const day = runDay({ daySeed: seed, teamSeed: config.seed, teams: snapshotTeams(snap, read("data/meta/players.json")) });
const rec = { no: "테스트", test: true, date, seed, startedAt: new Date(start).toISOString(), engine: ENGINE_VERSION, teams: j.teams.length, ...summarizeDay(day) };
history.days.push(rec);
fs.writeFileSync(HIST, JSON.stringify(history, null, 2) + "\n");
console.log(`🧪 테스트 리그 기록 — ${rec.teams}팀 · 우승 ${rec.table[0].name}(승점 ${rec.table[0].pts}) · 득점왕 ${rec.scorers[0].player} ${rec.scorers[0].goals}골`);
