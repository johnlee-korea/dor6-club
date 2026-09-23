/* ============================================================
   aggregate.js — 수집 매치 → 화면용 집계 JSON 생성
   실행: node scripts/aggregate.js   (API 호출 없음, 로컬 JSON만 사용)
   산출: data/dashboard.json, stats.json, internal.json, hall.json
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeMemberSeason, toDate } from "./lib/season.js";

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

/* ---------- ② 플레이스타일 (누적) ---------- */
function avg(arr) { const v = arr.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }

function styleTags(st) {
  const t = config.styleTagThresholds || {};
  const tags = [];
  if (st.avgPossession != null) {
    if (st.avgPossession >= (t.possessionHigh || 55)) tags.push("점유형");
    else if (st.avgPossession <= (t.possessionLow || 45)) tags.push("역습형");
    else tags.push("밸런스형");
  }
  if (st.avgShoot != null && st.avgShoot >= (t.shootHigh || 15)) tags.push("多슈팅");
  if (st.passSuccessRate != null && st.passSuccessRate >= (t.passRateHigh || 85)) tags.push("정교패스");
  return tags;
}

function buildStats() {
  const players = {};
  for (const m of members) {
    const ms = matchesByOuid[m.ouid].filter((x) => counted.includes(x.matchType));
    if (!ms.length) { players[m.ouid] = { games: 0, tags: [] }; continue; }
    const st = {
      games: ms.length,
      wins: ms.filter((x) => x.result === "win").length,
      draws: ms.filter((x) => x.result === "draw").length,
      loses: ms.filter((x) => x.result === "lose").length,
      avgPossession: round1(avg(ms.map((x) => x.stats.possession))),
      avgShoot: round1(avg(ms.map((x) => x.stats.shootTotal))),
      avgEffectiveShoot: round1(avg(ms.map((x) => x.stats.effectiveShoot))),
      avgFoul: round1(avg(ms.map((x) => x.stats.foul))),
      goalPerGame: round1(avg(ms.map((x) => x.goalFor)))
    };
    const passTry = ms.reduce((a, x) => a + (x.stats.passTry || 0), 0);
    const passOk = ms.reduce((a, x) => a + (x.stats.passSuccess || 0), 0);
    st.passSuccessRate = passTry ? round1((passOk / passTry) * 100) : null;
    st.winRate = st.games ? round1((st.wins / st.games) * 100) : null;
    st.tags = styleTags(st);
    players[m.ouid] = st;
  }
  writeJSON(p("data", "stats.json"), { updated: now.toISOString(), players });
}

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
        result: x.result, goalFor: x.goalFor, goalAgainst: x.goalAgainst
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

function round1(n) { return n == null ? null : Math.round(n * 10) / 10; }

/* ---------- 실행 ---------- */
const cur = buildDashboard();
buildStats();
buildInternal();
buildHall();
console.log(`✅ 집계 완료 — 현재 시즌 '${cur.seasonName || "-"}' ${cur.rows.length}명, ` +
  `dashboard/stats/internal/hall.json 갱신`);
