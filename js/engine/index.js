/* ============================================================
   engine/index.js — 경기 엔진 진입점
   runDay({ daySeed, teamSeed, teams }) → 하루치 리그 전체(대진·결과·순위표)

   ★ 이 폴더(js/engine)는 DOM·fetch·현재 시각·저장소에 의존하지 않는다.
     → 브라우저·Node(기록 보관)·다른 프로젝트(축구 커리어 시뮬레이터)가 그대로 가져다 씀
   ★ 결과가 바뀌는 수정(계수·추첨 순서 등)을 하면 ENGINE_VERSION을 +1
     → 배포는 리그가 없는 시간(00:40~06:30 KST)에만 (CLAUDE.md 25-6)
   ============================================================ */
import { makeRng } from "./rng.js";
import { buildTeam, formationOf, teamPower } from "./team.js";
import { doubleRoundRobin, roundCount } from "./schedule.js";
import { simulateMatch } from "./match.js";
import { buildTables } from "./table.js";
import { playerStats, leaders, mvp } from "./stats.js";

// v1: 가상 선수 · v2(2026-10-14): 실제 스쿼드 명단(roster) + 포지션별 득점·도움 확률
// v3(2026-10-27): 모든 팀 전력 동일(순수 운) + 전날 판수 보너스만 차이 (CLAUDE.md 25-18)
export const ENGINE_VERSION = 3;

/* 리그 팀 공통 전력 (v3) — 팀 시드 능력치(72~78)·포메이션과 무관하게 모든 팀이 같은 값
   ATT − DEF = TUNE.gap(−1.2) → 보너스 없는 팀끼리 기대 득점 = TUNE.base (v2 평균 팀과 같은 득점 수준) */
export const EVEN_POWER = { att: 73.8, def: 75 };
export { roundCount, buildTeam, formationOf, teamPower, playerStats, leaders, mvp };

/* daySeed: 일일 시드(예 "DOR6-2026-10-15") — 대진·경기 결과
   teamSeed: 리그 시드(예 "DOR6") — 선수단 능력치 (날짜와 무관하게 팀 정체성 유지)
   teams: [{ id, name, roster?, boost? }] — roster: [{ name, role, starter }] 실제 스쿼드(없으면 가상 선수)
   boost: 팀 공격력·수비력 보정(0.001 단위 정수, 선택값) — 없으면 기존과 같은 결과(난수 소비 순서 불변) */
export function runDay({ daySeed, teamSeed, teams }) {
  // 입력 순서와 무관하게 같은 결과가 나오도록 id로 정렬 후 일일 시드로 섞음
  const sorted = teams.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const ids = sorted.map((t) => t.id);
  const squads = new Map(sorted.map((t) => [t.id, withBoost(evenPower(buildTeam(t.id, teamSeed, t.roster)), t.boost)]));
  const names = new Map(sorted.map((t) => [t.id, t.name]));
  const order = makeRng(daySeed + "|draw").shuffle(ids);
  const rounds = doubleRoundRobin(order);
  // 경기마다 독립 시드 → 몇 라운드까지 계산하든, 어떤 순서로 계산하든 같은 결과
  const results = rounds.map((rd, r) => rd.matches.map((m) =>
    simulateMatch(squads.get(m.home), squads.get(m.away), `${daySeed}|R${r + 1}|${m.home}|${m.away}`)));
  const tables = buildTables(ids, rounds, results);
  return { ids, names, squads, rounds, results, tables, totalRounds: rounds.length };
}

/* 도륙리그는 순수 운 (사용자 결정 2026-10-26): 선수 이름·포지션(득점자·도움 추첨)은 그대로 두고
   경기 계산용 공격·수비력만 모든 팀 같게 — 기본 전력 고정(강팀 영구화)·공격수 많은 포메이션 유리 문제 제거.
   buildTeam은 커리어 시뮬레이터 등 다른 용도를 위해 그대로 둠 */
function evenPower(team) {
  team.att = EVEN_POWER.att;
  team.def = EVEN_POWER.def;
  return team;
}

/* 팀 전력 보정 (선택값) — 선수 능력치는 그대로, 경기 계산용 공격·수비력만 */
function withBoost(team, boost) {
  const b = Math.floor(Number(boost) || 0);
  if (b > 0) { team.boost = b; team.att += b / 1000; team.def += b / 1000; }
  return team;
}

/* 하루 최종 요약 (기록 보관 history.json·종료 화면 공용) */
export function summarizeDay(day, top = 5) {
  const R = day.totalRounds;
  const st = playerStats(day.rounds, day.results, R);
  const gamesPerTeam = R ? day.rounds.reduce((s, rd) => s + rd.matches.length * 2, 0) / day.ids.length : 0;
  const pl = (s, extra) => s && ({ player: day.squads.get(s.team).players[s.idx].name, ouid: s.team, team: day.names.get(s.team), ...extra });
  const best = mvp(st, Math.ceil(gamesPerTeam / 2));
  return {
    rounds: R,
    table: day.tables[R].map((r) => ({ ouid: r.id, name: day.names.get(r.id), p: r.p, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga, pts: r.pts })),
    scorers: leaders(st, "g", top).map((s) => pl(s, { goals: s.g })),
    assists: leaders(st, "a", top).map((s) => pl(s, { assists: s.a })),
    mvp: best ? pl(best, { avg: Math.round(best.avg * 100) / 100, apps: best.apps }) : null
  };
}
