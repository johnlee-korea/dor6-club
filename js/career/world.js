/* ============================================================
   career/world.js — 게임 세계: clubs.json → 시즌별 구단 상태 (CLAUDE.md 26-7-1·26-7-2)
   world = { season, clubs: { id: { league, R, coach, style, pref, short } }, news: [] }
   구단 이름은 저장하지 않는다(권리 전환 스위치) — 화면에서 base(clubs.json)로 붙임
   ============================================================ */
import { makeRng } from "../engine/rng.js";
import { LEAGUES, CATS, POSITIONS, STYLES, STYLE_CATS } from "./rules.js";
import { comboKey, typeId } from "./types.js";

export const leagueOf = (id) => LEAGUES.find((l) => l.id === id);
export const leagueLabel = (id) => (leagueOf(id) || {}).label || id;

/* clubs.json → 기본 정보 맵 */
export function indexBase(clubsJson) {
  const map = new Map();
  for (const c of clubsJson.clubs) map.set(c.id, c);
  return map;
}

/* 새 커리어의 세계 (시즌 1 직전) */
export function createWorld(clubsJson, seed) {
  const clubs = {};
  for (const c of clubsJson.clubs) clubs[c.id] = { league: c.league, R: c.R, coach: c.coach.slice(), style: c.style, pref: null, short: [] };
  const world = { season: 1, clubs, news: [] };
  prepareSeason(world, seed);
  return world;
}

/* 리그별 구단 id 목록 (id 정렬 — 결정론) */
export function leagueClubs(world, leagueId) {
  return Object.keys(world.clubs).filter((id) => world.clubs[id].league === leagueId).sort();
}

/* 시즌 시작 전 공개 정보: 부족 포지션 1~2 · 감독 선호 유형 1 (26-7-2) */
export function prepareSeason(world, seed) {
  for (const id of Object.keys(world.clubs).sort()) {
    const c = world.clubs[id];
    const rng = makeRng(`${seed}|S${world.season}|prep|${id}`);
    c.short = rng.shuffle(POSITIONS).slice(0, rng.chance(0.5) ? 2 : 1);
    const pos = rng.chance(0.5) ? c.short[0] : POSITIONS[rng.int(POSITIONS.length)];
    const fav = STYLE_CATS[c.style] || CATS;
    const a = fav[rng.int(fav.length)];
    const rest = CATS.filter((x) => x !== a);
    const b = rest[rng.weighted(rest.map((x) => (fav.includes(x) ? 2 : 1)))];
    c.pref = typeId(pos, comboKey(a, b));
  }
}

/* 시즌 종료: 승강 · 요구 OVR 재배분 · 감독 교체 (finals: { leagueId: [clubId 순위순] }) */
export function endSeason(world, finals, seed, baseMap) {
  const rng = makeRng(`${seed}|S${world.season}|end`);
  const news = [];
  const moves = {};   // id → 새 리그
  for (const lg of LEAGUES) {
    if (!lg.down) continue;
    const lower = LEAGUES.find((x) => x.country === lg.country && x.tier === lg.tier + 1);
    if (!lower) continue;
    const up = finals[lower.id].filter((id) => !(baseMap && baseMap.get(id) && baseMap.get(id).reserve)).slice(0, lg.down);
    const down = finals[lg.id].slice(-lg.down);
    for (const id of down) moves[id] = lower.id;
    for (const id of up) moves[id] = lg.id;
  }
  // 요구 OVR 갱신: 리그별 등급 분포(값 집합)는 그대로 두고, '이전 등급 70% + 이번 순위 30%' 점수 순서로 다시 배분
  //   → 빅클럽 수가 시즌마다 늘거나 줄지 않고, 순위에 따라 구단끼리 자리만 바뀜 (승격팀은 새 리그 하위권, 강등팀은 상위권에서 시작)
  const dist = {}, score = {};
  for (const lg of LEAGUES) dist[lg.id] = finals[lg.id].map((id) => world.clubs[id].R).sort((x, y) => y - x);
  for (const lg of LEAGUES) {
    const order = finals[lg.id];
    const n = order.length;
    const stayers = order.filter((id) => !moves[id]);
    order.forEach((id, i) => {
      const c = world.clubs[id];
      const to = moves[id] || lg.id;
      const band = leagueOf(to).band, w = band[1] - band[0];
      const si = stayers.indexOf(id);
      const target = to === lg.id ? dist[lg.id][stayers.length > 1 ? Math.round(si * (n - 1) / (stayers.length - 1)) : 0]
        : leagueOf(to).tier < lg.tier ? band[0] + w * 0.2 : band[1] - w * 0.2;
      score[id] = 0.7 * c.R + 0.3 * target;
      if (moves[id]) news.push({ type: leagueOf(to).tier < lg.tier ? "up" : "down", club: id, from: lg.id, to });
      c.league = to;
      // 감독 교체: 하위 3위 50% · 그 외 10%
      if (rng.chance(i >= n - 3 ? 0.5 : 0.1)) {
        const keep = c.coach.length > 1 ? c.coach.slice(0, 1) : [];
        const pick = CATS.filter((k) => !keep.includes(k) && !c.coach.includes(k));
        c.coach = keep.concat(pick[rng.int(pick.length)]).slice(0, Math.max(1, c.coach.length));
        c.style = STYLES[rng.int(STYLES.length)];
        news.push({ type: "manager", club: id });
      }
    });
  }
  for (const lg of LEAGUES) {
    const members = leagueClubs(world, lg.id).sort((x, y) => score[y] - score[x] || (x < y ? -1 : 1));
    members.forEach((id, i) => (world.clubs[id].R = dist[lg.id][Math.min(i, dist[lg.id].length - 1)]));
  }
  world.season++;
  world.news = news;
  prepareSeason(world, seed);
  return news;
}
