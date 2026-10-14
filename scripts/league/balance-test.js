/* ============================================================
   balance-test.js — 도륙리그 밸런스·결정론 테스트 (npm run league:test)
   가상 팀으로 하루 리그를 즉시 끝까지 돌려 통계를 출력한다.
     node scripts/league/balance-test.js [--teams 25] [--days 30] [--virtual]
   기본은 클럽원 실제 스쿼드(data/squads.json, 포지션만 사용)로 팀을 만들고, 모자라면 가상 선수 팀으로 채움
   검수 목표 (CLAUDE.md 25-6): 경기당 2.5~3.0골 · 무승부 20~30% · 득점왕 20~35골
     · 하위 절반이 상위 절반을 이기는 비율 25%↑ · 같은 입력 결과 100% 동일
   ============================================================ */
import { runDay, summarizeDay, roundCount, playerStats, leaders, ENGINE_VERSION } from "../../js/engine/index.js";
import { hashSeed } from "../../js/engine/rng.js";
import { intervalSec, endLabel } from "../../js/league/clock.js";
import { squadFromLineup, squadToRoster } from "../../js/league/roster.js";
import fs from "node:fs";

const arg = (name, def) => {
  const i = process.argv.indexOf("--" + name);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const TEAMS = arg("teams", 25), DAYS = arg("days", 30);
const VIRTUAL = process.argv.includes("--virtual");
const SQUADS = VIRTUAL ? [] : Object.values(JSON.parse(fs.readFileSync(new URL("../../data/squads.json", import.meta.url), "utf8")).squads || {})
  .map(squadFromLineup).filter(Boolean);
// 실제 스쿼드를 차례로 배정 (팀 수가 더 많으면 나머지는 가상 선수)
const fakeTeams = (n) => Array.from({ length: n }, (_, i) => ({ id: "team" + String(i).padStart(3, "0"), name: "가상팀" + (i + 1),
  roster: SQUADS[i] ? squadToRoster(SQUADS[i], null) : undefined }));
const pct = (x) => (x * 100).toFixed(1) + "%";

console.log(`도륙리그 밸런스 테스트 — 엔진 v${ENGINE_VERSION}, ${TEAMS}팀 × ${DAYS}일\n`);

let games = 0, goals = 0, draws = 0, homeWins = 0, upsetGames = 0, upsets = 0, ms = 0;
const kings = [], champsLevel = [];
const goalsByRole = {}, kingRoles = {};
const ovrs = [];
for (let d = 0; d < DAYS; d++) {
  const t0 = performance.now();
  const day = runDay({ daySeed: `TEST-${d}`, teamSeed: "TEST", teams: fakeTeams(TEAMS) });
  ms += performance.now() - t0;
  if (d === 0) for (const sq of day.squads.values()) ovrs.push(sq.ovr);
  day.rounds.forEach((rd, r) => rd.matches.forEach((m, i) => {
    const res = day.results[r][i];
    games++; goals += res.hg + res.ag;
    if (res.hg === res.ag) draws++;
    if (res.hg > res.ag) homeWins++;
    // 이변: 선발 오버롤이 낮은 팀(차이 3 이상)이 이긴 경기
    const ho = day.squads.get(m.home).ovr, ao = day.squads.get(m.away).ovr;
    if (Math.abs(ho - ao) >= 3 && res.hg !== res.ag) {
      upsetGames++;
      if ((ho < ao) === (res.hg > res.ag)) upsets++;
    }
  }));
  const st = playerStats(day.rounds, day.results, day.totalRounds);
  const king = leaders(st, "g", 1)[0];
  kings.push(king.g);
  const kr = day.squads.get(king.team).players[king.idx].role;
  kingRoles[kr] = (kingRoles[kr] || 0) + 1;
  for (const p of st.values()) { const role = day.squads.get(p.team).players[p.idx].role; goalsByRole[role] = (goalsByRole[role] || 0) + p.g; }
  const sum = summarizeDay(day);
  champsLevel.push(day.squads.get(sum.table[0].ouid).ovr);
}
const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const R = roundCount(TEAMS);
console.log(`라운드 ${R} · 팀당 ${TEAMS % 2 ? R - 2 : R}경기 · 하루 ${games / DAYS}경기`);
console.log(`팀 오버롤 범위: ${Math.min(...ovrs)} ~ ${Math.max(...ovrs)}`);
console.log(`경기당 골      ${(goals / games).toFixed(2)}   (목표 2.5~3.0)`);
console.log(`무승부         ${pct(draws / games)}   (목표 20~30%)`);
console.log(`홈 승          ${pct(homeWins / games)}`);
console.log(`득점왕 평균    ${avg(kings).toFixed(1)}골 (최소 ${Math.min(...kings)} · 최대 ${Math.max(...kings)}, 목표 20~35)`);
console.log(`이변 비율      ${pct(upsets / upsetGames)}   (오버롤 3↑ 차이 경기 중 약팀 승, 목표 25%↑)`);
console.log(`우승팀 오버롤  평균 ${avg(champsLevel).toFixed(1)} (최소 ${Math.min(...champsLevel)})`);
console.log(`시뮬레이션     하루 평균 ${(ms / DAYS).toFixed(1)}ms`);
const tg = Object.values(goalsByRole).reduce((a, b) => a + b, 0);
console.log(`포지션별 골    ${Object.entries(goalsByRole).sort((a, b) => b[1] - a[1]).map(([r, g]) => `${r} ${(g / tg * 100).toFixed(0)}%`).join(" · ")}`);
console.log(`득점왕 포지션  ${Object.entries(kingRoles).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}회`).join(" · ")}  (GK 골 ${goalsByRole.GK || 0})`);

// 결정론: 같은 입력 2회 + 입력 순서를 뒤집어도 결과 동일
const h = (day) => hashSeed(JSON.stringify(day.results));
const a = runDay({ daySeed: "DET", teamSeed: "DET", teams: fakeTeams(TEAMS) });
const b = runDay({ daySeed: "DET", teamSeed: "DET", teams: fakeTeams(TEAMS).reverse() });
const same = h(a) === h(b);
console.log(`\n결정론 (2회·입력 순서 뒤집기) ${same ? "✅ 동일" : "❌ 다름"}  해시 ${h(a).toString(16)}`);

// 팀 수별 라운드·간격·종료 시각 (CLAUDE.md 25-4 표)
console.log("\n팀 수 | 라운드 | 간격 | 종료 | 휴식 검사");
let okAll = same;
for (const n of [2, 3, 24, 25, 26, 31, 41, 50, 81]) {
  const day = runDay({ daySeed: "T" + n, teamSeed: "T", teams: fakeTeams(n) });
  const R2 = day.totalRounds;
  // 모든 쌍이 홈·원정 한 번씩, 홀수면 팀당 휴식 2회
  const pairs = new Map(), byes = new Map();
  day.rounds.forEach((rd) => {
    rd.matches.forEach((m) => pairs.set(m.home + ">" + m.away, (pairs.get(m.home + ">" + m.away) || 0) + 1));
    if (rd.bye) byes.set(rd.bye, (byes.get(rd.bye) || 0) + 1);
  });
  const pairOk = pairs.size === n * (n - 1) && [...pairs.values()].every((v) => v === 1);
  const byeOk = n % 2 ? byes.size === n && [...byes.values()].every((v) => v === 2) : byes.size === 0;
  const ok = R2 === roundCount(n) && pairOk && byeOk;
  okAll = okAll && ok;
  const I = intervalSec(R2);
  console.log(`${String(n).padStart(4)}  | ${String(R2).padStart(5)}  | ${Math.floor(I / 60)}분${I % 60 ? " " + (I % 60) + "초" : ""} | ${endLabel(R2)} | ${ok ? "✅" : "❌"}`);
}
process.exit(okAll ? 0 : 1);
