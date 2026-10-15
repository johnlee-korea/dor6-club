/* ============================================================
   career/season.js — 시즌 1회 시뮬레이션 (CLAUDE.md 26-11)
   - 12개 리그 전부 엔진(doubleRoundRobin + simulateMatch + buildTables)으로 계산
   - 내 리그만 경기별 상세·개인 순위·개인상을 반환, 나머지는 최종 순위만
   - 내 출전(선발/교체/벤치)은 역할 확률 + 부족 포지션 + 최근 평점으로 경기마다 결정 (엔진은 모름)
   시드: `${seed}|S${n}|…` → 같은 저장 + 같은 선택 → 같은 결과
   ============================================================ */
import { makeRng } from "../engine/rng.js";
import { doubleRoundRobin } from "../engine/schedule.js";
import { simulateMatch } from "../engine/match.js";
import { buildTables } from "../engine/table.js";
import { playerStats, leaders } from "../engine/stats.js";
import { LEAGUES, ROLE, SLOTS, POSITIONS, MATCH, TRUST_MIN, TRUST_MAX, clamp } from "./rules.js";
import { leagueClubs } from "./world.js";
import { aiSquad, decorate, defaultLineup, engineTeam, roleFor, roleScore } from "./squad.js";
import { goalKind } from "./types.js";

/* me: { clubId, name, pos, ovr(정수, 적응 페널티 반영), attrs(엔진 6종, 선호 보너스 포함), sht, pas,
         fx(유형 효과), pref("full"|"partial"|null), trust, age }
   반환: { leagues: { id: { order, champion } }, mine: {...}, squads(내 리그) } */
export function simulateSeason({ world, seed, me, onLeague }) {
  const n = world.season;
  const out = { leagues: {}, mine: null };
  const myLeague = me ? world.clubs[me.clubId].league : null;
  for (const lg of LEAGUES) {
    const ids = leagueClubs(world, lg.id);
    const squads = new Map(ids.map((id) => [id, decorate(aiSquad(world, id, seed))]));
    const teams = new Map(ids.map((id) => {
      const sq = squads.get(id);
      return [id, engineTeam(id, sq.players, defaultLineup(sq))];
    }));
    const order0 = makeRng(`${seed}|S${n}|${lg.id}|draw`).shuffle(ids);
    const rounds = doubleRoundRobin(order0);
    const isMine = lg.id === myLeague;
    const ctl = isMine ? meController({ world, seed, me, squad: squads.get(me.clubId), rounds: rounds.length }) : null;
    const results = [];
    rounds.forEach((rd, r) => {
      // 시즌 절반 시점 재평가 (그때까지의 결과로)
      if (ctl && r === Math.floor(rounds.length / 2)) ctl.midReview(rounds, results);
      results.push(rd.matches.map((m) => {
        const home = ctl && m.home === me.clubId ? ctl.teamFor(r + 1) : teams.get(m.home);
        const away = ctl && m.away === me.clubId ? ctl.teamFor(r + 1) : teams.get(m.away);
        const seedStr = `${seed}|S${n}|${lg.id}|R${r + 1}|${m.home}|${m.away}`;
        const res = simulateMatch(home, away, seedStr);
        if (ctl && (m.home === me.clubId || m.away === me.clubId)) ctl.record(r + 1, m, res, seedStr);
        return res;
      }));
    });
    const tables = buildTables(ids, rounds, results);
    const final = tables[rounds.length];
    out.leagues[lg.id] = { order: final.map((r) => r.id), table: final };
    if (isMine) out.mine = summarizeMine({ me, ctl, squads, rounds, results, tables, leagueId: lg.id });
    if (onLeague) onLeague(lg.id);
  }
  return out;
}

/* ---------- 내 선수 출전 결정·기록 ---------- */
function meController({ world, seed, me, squad, rounds }) {
  const n = world.season;
  const club = world.clubs[me.clubId];
  const short = club.short.includes(me.pos);
  const meIdx = squad.players.length;
  const typeRb = me.fx ? me.fx.rb : 0;
  const mePlayer = {
    idx: meIdx, name: me.name, cpos: me.pos, pos: squad.players.find((p) => p.cpos === me.pos).pos, role: null,
    ovr: me.ovr, tier: "ME", attrs: me.attrs, me: true,
    sw: clamp(1 + MATCH.swK * (me.attrs.sht - squad.R), MATCH.swMin, MATCH.swMax) * (me.fx ? me.fx.sw : 1),
    aw: clamp(1 + MATCH.swK * (me.attrs.pas - squad.R), MATCH.swMin, MATCH.swMax) * (me.fx ? me.fx.aw : 1),
    rb: clamp(Math.round(MATCH.rbK * (me.ovr - squad.avgOvr)), -MATCH.rbCap, MATCH.rbCap) + typeRb
  };
  squad.players.push(mePlayer);
  let trust = me.trust;
  let role = roleFor(squad, me.pos, roleScore(me.ovr, me.pref, trust));
  const startRole = role;
  const base = defaultLineup(squad);
  // 내 포지션 주전 중 가장 약한 선수(교체·선발 시 내가 그 자리)
  const posStarters = squad.players.filter((p) => p.cpos === me.pos && p.tier === "S").sort((a, b) => a.ovr - b.ovr);
  const target = posStarters[0];
  const matches = [];
  const recent = [];
  let current = null;
  const ctl = {
    meIdx, startRole, get role() { return role; }, get trust() { return trust; }, short, matches, mid: null,
    teamFor(k) {
      const rng = makeRng(`${seed}|S${n}|me|R${k}`);
      const [ps0, psub] = ROLE.prob[role];
      const avg3 = recent.length >= 3 ? (recent[recent.length - 1] + recent[recent.length - 2] + recent[recent.length - 3]) / 30 : 0;
      let bonus = (short ? ROLE.shortageBonus : 0) + (avg3 >= 7 ? ROLE.formBonus : avg3 && avg3 <= 6 ? -ROLE.formBonus : 0);
      bonus = Math.min(ROLE.bonusCap, bonus);
      const ps = Math.min(ROLE.maxStart, Math.max(0, ps0 + bonus));
      const players = squad.players.slice();
      players[meIdx] = { ...mePlayer, role: target.role };
      let starters = base, subs = null, app = "N", min = 0;
      if (rng.chance(ps)) { starters = base.map((i) => (i === target.idx ? meIdx : i)); app = "S"; min = 90; }
      else if (rng.chance(psub)) {
        min = rng.range(ROLE.subMin[0], ROLE.subMin[1]);
        subs = [{ min, in: meIdx, out: target.idx }];
        app = "U"; min = 90 - min;
      } else if (me.age <= 18) app = "Y";      // 18세 이하 1군 미출전 = 2군 출전
      current = { k, app, min };
      return engineTeam(me.clubId, players, starters, subs);
    },
    record(k, m, res, seedStr) {
      const side = m.home === me.clubId ? "h" : "a";
      const gf = side === "h" ? res.hg : res.ag, ga = side === "h" ? res.ag : res.hg;
      const mine = res.ev.filter((e) => e.side === side);
      const g = mine.filter((e) => e.s === meIdx), a = mine.filter((e) => e.as === meIdx);
      const rt = (res.rt[side].find(([i]) => i === meIdx) || [])[1] || null;
      const krng = makeRng(seedStr + "|kind");
      const kinds = g.map(() => goalKind(krng, me.pos, me.fx));
      // 결승골: 이긴 경기에서 상대 득점 + 1번째 우리 골이 내 골
      let winner = false;
      if (gf > ga) { const dec = mine[ga]; winner = !!dec && dec.s === meIdx; }
      const row = { k, opp: side === "h" ? m.away : m.home, home: side === "h", gf, ga, app: current.app, min: current.min,
                    g: g.length, a: a.length, r: rt, kinds, mins: g.map((e) => e.min + (e.add ? "+" + e.add : "")), winner };
      matches.push(row);
      if (rt !== null) recent.push(rt);
    },
    /* 시즌 중 재평가: 전반기 평균 평점이 팀 내 같은 포지션 1위면 신뢰도 +1, 최하위면 −1 (역할은 한 단계까지만) */
    midReview(roundsAll, resultsHalf) {
      const mine = matches.filter((x) => x.r !== null);
      if (mine.length < 3) { ctl.mid = { trust: 0, from: role, to: role }; return; }
      const myAvg = mine.reduce((s, x) => s + x.r, 0) / mine.length;
      const avgs = new Map();
      resultsHalf.forEach((rr, r) => rr.forEach((res, i) => {
        const mt = roundsAll[r].matches[i];
        const side = mt.home === me.clubId ? "h" : mt.away === me.clubId ? "a" : null;
        if (!side) return;
        for (const [idx, v] of res.rt[side]) {
          const p = squad.players[idx];
          if (!p || p.me || p.cpos !== me.pos) continue;
          const s = avgs.get(idx) || { s: 0, c: 0 }; s.s += v; s.c++; avgs.set(idx, s);
        }
      }));
      const others = [...avgs.values()].filter((x) => x.c >= 3).map((x) => x.s / x.c);
      let d = 0;
      if (others.length && myAvg >= Math.max(...others)) d = 1;
      else if (others.length && myAvg <= Math.min(...others)) d = -1;
      const before = role;
      trust = clamp(trust + d, TRUST_MIN, TRUST_MAX);
      const next = roleFor(squad, me.pos, roleScore(me.ovr, me.pref, trust));
      const rank = { B: 0, R: 1, S: 2 };
      role = rank[next] > rank[role] ? (role === "B" ? "R" : "S") : rank[next] < rank[role] ? (role === "S" ? "R" : "B") : role;
      ctl.mid = { trust: d, from: before, to: role };
    }
  };
  return ctl;
}

/* ---------- 내 리그 요약 (리포트·성장·업적 입력) ---------- */
function summarizeMine({ me, ctl, squads, rounds, results, tables, leagueId }) {
  const R = rounds.length;
  const st = playerStats(rounds, results, R);
  const key = me.clubId + "#" + ctl.meIdx;
  const cposOf = (s) => squads.get(s.team).players[s.idx].cpos;
  const nameOf = (s) => squads.get(s.team).players[s.idx].name;
  const games = R;            // 짝수 리그 → 팀당 경기 수 = 라운드 수
  const half = Math.ceil(games / 2);
  const pl = (s, extra) => ({ name: nameOf(s), club: s.team, me: s.key === key, ...extra });
  // 개인상: 득점왕·도움왕·MVP(절반 이상 출전 평균 평점 최고)·베스트11(포지션별 평점, 절반 이상 출전)
  const top = (kind) => leaders(st, kind, 10, half);
  const scorers = top("g"), assists = top("a");
  const ratings = leaders(st, "avg", 10, half);
  const allRated = leaders(st, "avg", 100000, half);
  const leagueRatingRank = allRated.findIndex((s) => s.key === key) + 1 || null;
  const awards = [];
  if (scorers[0] && scorers[0].key === key) awards.push("득점왕");
  if (assists[0] && assists[0].key === key) awards.push("도움왕");
  if (ratings[0] && ratings[0].key === key) awards.push("시즌 MVP");
  const best11 = {};
  for (const pos of [...POSITIONS, "GK"]) {
    const list = [...st.values()].filter((s) => s.apps >= half && cposOf(s) === pos).sort((a, b) => b.avg - a.avg || b.apps - a.apps || (a.key < b.key ? -1 : 1));
    best11[pos] = list.slice(0, pos === "GK" ? 1 : SLOTS[pos]).map((s) => pl(s, { avg: s.avg }));
    if (list.slice(0, pos === "GK" ? 1 : SLOTS[pos]).some((s) => s.key === key)) awards.push("베스트11");
  }
  // 같은 포지션 평점 순위 (레전드 시즌 판정)
  const samePos = [...st.values()].filter((s) => s.apps >= half && cposOf(s) === me.pos).sort((a, b) => b.avg - a.avg || (a.key < b.key ? -1 : 1));
  const posRank = samePos.findIndex((s) => s.key === key) + 1 || null;
  // 팀 내 순위 (슬럼프 판정): 같은 팀 필드 선수(1/3 이상 출전) 중 평균 평점 순위
  const team = [...st.values()].filter((s) => s.team === me.clubId && s.apps >= Math.ceil(games / 3) && cposOf(s) !== "GK").sort((a, b) => b.avg - a.avg);
  const teamRank = team.findIndex((s) => s.key === key) + 1 || null;
  // 팀 평균 대비 평점 차 (슬럼프·부활 판정): 같은 팀 필드 선수(1/3 이상 출전, 나 제외) 평균 평점과 비교
  const mates = team.filter((s) => s.key !== key);
  const teamAvg = mates.length ? mates.reduce((a, s) => a + s.avg, 0) / mates.length : null;
  const vsTeam = myStatAvg(st, key) !== null && teamAvg !== null ? Math.round((myStatAvg(st, key) - teamAvg) * 100) / 100 : null;
  const m = ctl.matches;
  const cnt = (app) => m.filter((x) => x.app === app).length;
  const rated = m.filter((x) => x.r !== null);
  const myStat = st.get(key);
  return {
    leagueId, games, startRole: ctl.startRole, endRole: ctl.role, trust: ctl.trust, mid: ctl.mid, short: ctl.short,
    starts: cnt("S"), subs: cnt("U"), bench: cnt("N"), youth: cnt("Y"),
    goals: m.reduce((s, x) => s + x.g, 0), assists: m.reduce((s, x) => s + x.a, 0),
    avg: rated.length ? rated.reduce((s, x) => s + x.r, 0) / rated.length / 10 : 0,
    apps: rated.length, hatTricks: m.filter((x) => x.g >= 3).length, winners: m.filter((x) => x.winner).length,
    kinds: m.flatMap((x) => x.kinds), cleanSheets: m.filter((x) => x.app === "S" && x.ga === 0).length,
    posRank, posCount: samePos.length, leagueRatingRank, teamRank, teamCount: team.length, vsTeam, awards,
    matches: m,
    roundRanks: tables.slice(1).map((t) => t.find((r) => r.id === me.clubId).rank),
    table: tables[R].map((r) => ({ id: r.id, p: r.p, w: r.w, d: r.d, l: r.l, gf: r.gf, ga: r.ga, pts: r.pts })),
    scorers: scorers.map((s) => pl(s, { v: s.g })), assistLeaders: assists.map((s) => pl(s, { v: s.a })),
    ratingLeaders: ratings.map((s) => pl(s, { v: Math.round(s.avg * 100) / 100 })), best11,
    myAvgEngine: myStat ? myStat.avg : 0
  };
}

const myStatAvg = (st, key) => { const m = st.get(key); return m && m.apps ? m.avg : null; };
