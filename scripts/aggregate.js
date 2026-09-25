/* ============================================================
   aggregate.js — 수집 매치 → 화면용 집계 JSON 생성
   실행: node scripts/aggregate.js   (API 호출 없음, 로컬 JSON만 사용)
   산출: data/dashboard.json, internal.json, hall.json, squads.json, playstyles.json, insights.json
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeMemberSeason, toDate } from "./lib/season.js";
import { latestLineupMatch } from "./lib/squad.js";
import { computeMetrics, judge, METRICS } from "./lib/playstyle.js";
import { GOAL_BUCKETS, SHOT_RESULT, bucketOf, goalFlow, PI, rankPlayers,
  GROUP_LABEL, P_METRICS } from "./lib/insight.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = (...s) => path.join(ROOT, ...s);
const readJSON = (f, def) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : def);
const writeJSON = (f, o) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(o, null, 2) + "\n");
};

const now = new Date();
const config = readJSON(p("config.json"), {});
const membersFile = readJSON(p("data", "members.json"), { members: [] });
const seasonsFile = readJSON(p("data", "seasons.json"), { seasons: [] });
const members = (membersFile.members || []).filter((m) => m.ouid);
const counted = config.countedMatchTypes || [50, 60, 30];

/* 회원별 매치 로딩 */
const matchesByOuid = {};
for (const m of members) {
  const f = p("data", "matches", `${m.ouid}.json`);
  matchesByOuid[m.ouid] = readJSON(f, { matches: [] }).matches || [];
}
const memberByOuid = Object.fromEntries(members.map((m) => [m.ouid, m]));

/* ---------- ① 대시보드 (현재 시즌) ---------- */
function buildDashboard() {
  const out = [];
  for (const season of seasonsFile.seasons || []) {
    const rows = members.map((m) => {
      const s = computeMemberSeason(m, matchesByOuid[m.ouid], season, counted, now);
      return {
        ouid: m.ouid, ingameNick: m.ingameNick, talkNick: m.talkNick,
        role: m.role, manager: m.manager, isSub: m.isSub, ...s
      };
    });
    out.push({ seasonId: season.id, seasonName: season.name,
      start: season.start, midCheck: season.midCheck, end: season.end,
      targetGames: season.targetGames, midTargetGames: season.midTargetGames, rows });
  }
  const curId = (seasonsFile.meta && seasonsFile.meta.currentSeasonId);
  const cur = out.find((o) => o.seasonId === curId) || out[out.length - 1] || { rows: [] };
  writeJSON(p("data", "dashboard.json"),
    { updated: now.toISOString(), current: cur, seasons: out });
  return cur;
}

/* (구 ② 플레이스타일 탭·stats.json은 v1.7.2에서 제거 — 명단 플레이스타일(⑥ buildPlaystyles)로 대체) */

/* ---------- ③ 내전 ---------- */
function buildInternal() {
  const seen = new Set();
  const matches = [];
  const h2h = {}; // key "ouidA|ouidB"(정렬) → {a,b,aWin,bWin,draw}

  for (const m of members) {
    for (const x of matchesByOuid[m.ouid]) {
      if (!x.opponentOuid || !memberByOuid[x.opponentOuid]) continue; // 상대가 클럽원인 경우만
      if (seen.has(x.matchId)) continue;
      seen.add(x.matchId);
      matches.push({
        matchId: x.matchId, matchDate: x.matchDate, matchType: x.matchType,
        aOuid: m.ouid, aNick: m.ingameNick,
        bOuid: x.opponentOuid, bNick: memberByOuid[x.opponentOuid].ingameNick,
        result: x.result, goalFor: x.goalFor, goalAgainst: x.goalAgainst,
        // 내전 당시 양팀 스쿼드 (A 기록의 lineup = A팀, oppLineup = B팀)
        aLineup: x.lineup || [], bLineup: x.oppLineup || []
      });
      const [k1, k2] = [m.ouid, x.opponentOuid].sort();
      const key = `${k1}|${k2}`;
      if (!h2h[key]) h2h[key] = { a: k1, b: k2, aWin: 0, bWin: 0, draw: 0 };
      const rec = h2h[key];
      if (x.result === "draw") rec.draw++;
      else if (x.result === "win") (m.ouid === k1 ? rec.aWin++ : rec.bWin++);
      else (m.ouid === k1 ? rec.bWin++ : rec.aWin++);
    }
  }
  matches.sort((a, b) => new Date(b.matchDate) - new Date(a.matchDate));
  writeJSON(p("data", "internal.json"),
    { updated: now.toISOString(), matches, headToHead: Object.values(h2h) });
}

/* ---------- ④ 명예의 전당 (시즌별) ---------- */
function buildHall() {
  const MIN_GAMES = 5; // 최고 승률 자격 최소 판수
  const seasons = [];
  for (const season of seasonsFile.seasons || []) {
    const stats = members.map((m) => {
      const startT = toDate(season.start).getTime();
      const endT = toDate(season.end).getTime() + (86400000 - 1000);
      const ms = matchesByOuid[m.ouid].filter((x) => {
        const t = toDate(x.matchDate).getTime();
        return t >= startT && t <= endT && counted.includes(x.matchType);
      });
      const wins = ms.filter((x) => x.result === "win").length;
      return { ouid: m.ouid, nick: m.ingameNick, games: ms.length, wins,
        winRate: ms.length ? (wins / ms.length) * 100 : 0 };
    }).filter((s) => s.games > 0);

    const top = (arr, key, n = 3) => [...arr].sort((a, b) => b[key] - a[key]).slice(0, n);
    seasons.push({
      seasonId: season.id, seasonName: season.name,
      mostGames: top(stats, "games"),
      mostWins: top(stats, "wins"),
      bestWinRate: top(stats.filter((s) => s.games >= MIN_GAMES), "winRate")
        .map((s) => ({ ...s, winRate: round1(s.winRate) }))
    });
  }
  writeJSON(p("data", "hall.json"), { updated: now.toISOString(), minGames: MIN_GAMES, seasons });
}

/* ---------- ⑤ 스쿼드 (회원별 최근 경기 라인업) ---------- */
/* 선수 이름·시즌·포메이션 변환은 화면(js/squad.js sqBuildTeam·sqFormation)에서 메타로 처리 —
   명단/전적 두 화면이 같은 변환 로직을 쓰도록 여기서는 원본 라인업만 담는다 */
function buildSquads() {
  const squads = {};
  for (const m of members) {
    const last = latestLineupMatch(matchesByOuid[m.ouid]);
    if (!last) continue;
    squads[m.ouid] = {
      matchId: last.matchId, matchDate: last.matchDate, matchType: last.matchType,
      result: last.result, goalFor: last.goalFor, goalAgainst: last.goalAgainst,
      opponentNick: last.opponentNick,
      lineup: last.lineup
    };
  }
  writeJSON(p("data", "squads.json"), { updated: now.toISOString(), squads });
  return Object.keys(squads).length;
}

/* ---------- ⑥ 플레이스타일 (랭커 기준값 대비) ---------- */
/* 최근 인정 경기(정상 종료, styleRaw 있는 것)로 지표 계산 → 랭커 평균과 비교해 높은/낮은 지표 3개 + 스타일
   기준값(data/meta/ranker-baseline.json)은 scripts/ranker-baseline.js가 주 1회 갱신 */
function buildPlaystyles() {
  const baseline = readJSON(p("data", "meta", "ranker-baseline.json"), null);
  if (!baseline) { console.warn("⚠ 랭커 기준값 없음 — playstyles.json 생략"); return 0; }
  const opt = { recentGames: 50, minGames: 10, ...(config.playstyle || {}) };
  const players = {};
  for (const m of members) {
    const raws = matchesByOuid[m.ouid]
      .filter((x) => counted.includes(x.matchType) && x.styleRaw && x.styleRaw.end === 0)
      .sort((a, b) => new Date(b.matchDate) - new Date(a.matchDate))
      .slice(0, opt.recentGames)
      .map((x) => x.styleRaw);
    if (raws.length < opt.minGames) { players[m.ouid] = { games: raws.length }; continue; }
    players[m.ouid] = { games: raws.length, ...judge(computeMetrics(raws), baseline.stats) };
  }
  writeJSON(p("data", "playstyles.json"), {
    updated: now.toISOString(), baselineUpdated: baseline.updated, baselineSource: baseline.source,
    baselineSampleSize: baseline.sampleSize, recentGames: opt.recentGames, minGames: opt.minGames,
    // 화면 '지표 기준' 안내용 — 지표 정의는 lib/playstyle.js METRICS 단일 소스
    metrics: Object.fromEntries(Object.entries(METRICS).map(([k, m]) => [k, { label: m.label, desc: m.desc }])),
    players
  });
  return Object.values(players).filter((x) => x.style).length;
}

/* ---------- ⑦ 경기 상세 인사이트 (v1.9.0, 현재 시즌) ---------- */
/* 집계 범위: 현재 시즌 · 인정 매치유형 · 정상 종료(styleRaw.end === 0) · 인사이트 필드(shots) 저장된 경기
   회원별: 컨트롤러·에이스 선수(v1.10.0 포지션 랭커 대비)·골 시간대·역전승·극장골·매너
   클럽 전체: 명예의 전당 6부문 + 포지션 스페셜리스트 */
function buildInsights() {
  const season = (seasonsFile.seasons || []).find((s) => s.id === (seasonsFile.meta || {}).currentSeasonId)
    || (seasonsFile.seasons || []).slice(-1)[0];
  if (!season) return 0;
  const minGames = (config.playstyle && config.playstyle.minGames) || 10;
  const startT = toDate(season.start).getTime();
  const endT = toDate(season.end).getTime() + (86400000 - 1000);
  const players = {};
  const scorerRows = [], assistRows = [], flowRows = [], mannerRows = [], specialistRows = [];
  // 포지션 그룹별 랭커 기준값 (ranker-baseline.js, 없으면 에이스 비움)
  const rankerBase = readJSON(p("data", "meta", "ranker-baseline.json"), {});
  const posBaseline = rankerBase.positions || null;
  if (!posBaseline) console.warn("⚠ 랭커 포지션 기준값 없음 — 에이스 판정 생략");

  for (const m of members) {
    const all = matchesByOuid[m.ouid];
    // 컨트롤러: 시즌 무관 최근 20경기 최빈값
    const ctrls = all.filter((x) => x.ctrl).slice(0, 20).map((x) => x.ctrl);
    const ctrl = ctrls.length ? mode(ctrls) : null;

    const ms = all.filter((x) => {
      const t = toDate(x.matchDate).getTime();
      return t >= startT && t <= endT && counted.includes(x.matchType) &&
        Array.isArray(x.shots) && x.styleRaw && x.styleRaw.end === 0;
    });
    if (!ms.length) { players[m.ouid] = { ctrl, games: 0 }; continue; }

    // 선수별 골·도움 합계 (득점왕·도움왕 선수용, 교체 출전 포함) — 같은 선수라도 시즌 카드(spId)별로 구분
    const pRows = ms.flatMap((x) => x.pStats || []);
    const bySp = new Map();
    for (const r of pRows) {
      const spId = r[PI.spId];
      const s = bySp.get(spId) || { spId, games: 0, goals: 0, assists: 0 };
      s.games++; s.goals += r[PI.gol]; s.assists += r[PI.ast];
      bySp.set(spId, s);
    }
    const spList = [...bySp.values()];

    // 에이스 (v1.10.0): 선수별 주 포지션 그룹에서 같은 그룹 랭커 대비 가장 돋보이는 지표(Z) 상위 3명
    // 판정 규칙은 lib/insight.js rankPlayers 단일 소스 (전적 검색 Worker와 공유)
    const ranked = rankPlayers(pRows, posBaseline);
    const ace = ranked.slice(0, 3).map((b) => {
      const s = bySp.get(b.spId);
      return { ...b, goals: s.goals, assists: s.assists };
    });
    for (const b of ranked) if (b.title) specialistRows.push({ ouid: m.ouid, nick: m.ingameNick, ...b });
    for (const s of spList) {
      if (s.goals) scorerRows.push({ ouid: m.ouid, nick: m.ingameNick, spId: s.spId, goals: s.goals, games: s.games });
      if (s.assists) assistRows.push({ ouid: m.ouid, nick: m.ingameNick, spId: s.spId, assists: s.assists, games: s.games });
    }

    // 골 시간대·역전승·극장골
    const goalFor = GOAL_BUCKETS.map(() => 0), goalAgainst = GOAL_BUCKETS.map(() => 0);
    let comebacks = 0, lateWinners = 0;
    for (const x of ms) {
      for (const s of x.shots) if (s[3] === SHOT_RESULT.GOAL) goalFor[bucketOf(s[0])]++;
      for (const t of x.oppGoals || []) goalAgainst[bucketOf(t)]++;
      const flow = goalFlow(x);
      if (flow && flow.comeback) comebacks++;
      if (flow && flow.lateWinner) lateWinners++;
    }
    flowRows.push({ ouid: m.ouid, nick: m.ingameNick, comebacks, lateWinners, games: ms.length });

    // 매너: 카드(옐로+레드)·파울
    const manner = { games: ms.length, yellow: 0, red: 0, foul: 0 };
    for (const x of ms) {
      manner.yellow += (x.cards && x.cards.y) || 0;
      manner.red += (x.cards && x.cards.r) || 0;
      manner.foul += (x.stats && x.stats.foul) || 0;
    }
    // 매너 점수 = 경기당 (카드×3 + 파울) — 낮을수록 신사
    manner.score = Math.round(((manner.yellow + manner.red) * 3 + manner.foul) / ms.length * 100) / 100;
    if (ms.length >= minGames) mannerRows.push({ ouid: m.ouid, nick: m.ingameNick, ...manner });

    players[m.ouid] = { ctrl, games: ms.length, ace, goalMins: { for: goalFor, against: goalAgainst },
      comebacks, lateWinners, manner };
  }

  const top = (arr, cmp, n) => [...arr].sort(cmp).slice(0, n);
  const clubTop = {
    topScorers: top(scorerRows, (a, b) => b.goals - a.goals || a.games - b.games, 5),
    topAssists: top(assistRows, (a, b) => b.assists - a.assists || a.games - b.games, 5),
    comebackKing: top(flowRows.filter((r) => r.comebacks), (a, b) => b.comebacks - a.comebacks, 3),
    lateHero: top(flowRows.filter((r) => r.lateWinners), (a, b) => b.lateWinners - a.lateWinners, 3),
    gentleman: top(mannerRows, (a, b) => a.score - b.score || b.games - a.games, 3),
    toughGuy: top(mannerRows.filter((r) => r.score > 0), (a, b) => b.score - a.score, 3),
    specialists: top(specialistRows, (a, b) => b.z - a.z, 5)   // 🏅 포지션 스페셜리스트 (칭호 받은 선수 중 Z 상위)
  };
  writeJSON(p("data", "insights.json"), {
    updated: now.toISOString(), seasonId: season.id, seasonName: season.name,
    seasonStart: season.start, seasonEnd: season.end, countedTypes: counted,   // 전적 화면 슈팅맵이 같은 범위로 거르도록
    minGames, buckets: GOAL_BUCKETS,
    // 에이스 카드 표기용 — 그룹명·지표명·랭커 표본 수 (정의는 lib/insight.js 단일 소스)
    groupLabels: GROUP_LABEL, metricLabels: P_METRICS,
    rankerUnits: posBaseline ? Object.fromEntries(Object.entries(posBaseline).map(([g, b]) => [g, b.n])) : {},
    players, clubTop
  });
  return Object.values(players).filter((x) => x.games).length;
}

/* 최빈값 (동률이면 먼저 나온 값 = 최신 경기 쪽) */
function mode(arr) {
  const cnt = new Map();
  for (const v of arr) cnt.set(v, (cnt.get(v) || 0) + 1);
  return [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function round1(n) { return n == null ? null : Math.round(n * 10) / 10; }

/* ---------- 실행 ---------- */
const cur = buildDashboard();
buildInternal();
buildHall();
const squadCount = buildSquads();
const styleCount = buildPlaystyles();
const insightCount = buildInsights();
console.log(`✅ 집계 완료 — 현재 시즌 '${cur.seasonName || "-"}' ${cur.rows.length}명, 스쿼드 ${squadCount}명, 플레이스타일 ${styleCount}명, 인사이트 ${insightCount}명, ` +
  `dashboard/internal/hall/squads/playstyles/insights.json 갱신`);
