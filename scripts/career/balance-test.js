/* ============================================================
   scripts/career/balance-test.js — 커리어 시뮬레이터 실제 엔진 검증 (CLAUDE.md 26-17, ④ 검수용)
   npm run career:test                → 리그 밸런스(내 선수 없이 세계 N시즌): 경기당 득점·무승부·득점왕·속도·결정론
   npm run career:test -- --careers 200 [--policy best,normal,passive] → 실제 엔진 커리어 자동 플레이 통계
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashSeed } from "../../js/engine/rng.js";
import { LEAGUES } from "../../js/career/rules.js";
import { createWorld, endSeason, indexBase } from "../../js/career/world.js";
import { simulateSeason } from "../../js/career/season.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const clubsJson = JSON.parse(fs.readFileSync(path.join(ROOT, "data/career/clubs.json"), "utf8"));
const base = indexBase(clubsJson);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };

export function leagueBalance(seasons, seed) {
  const world = createWorld(clubsJson, seed);
  const agg = {};
  let ms = 0, hash = 0;
  for (let s = 0; s < seasons; s++) {
    const t0 = performance.now();
    const res = simulateSeason({ world, seed });
    ms += performance.now() - t0;
    for (const lg of LEAGUES) {
      const tb = res.leagues[lg.id].table;
      const a = (agg[lg.id] = agg[lg.id] || { goals: 0, games: 0, draws: 0 });
      a.games += tb.reduce((x, r) => x + r.p, 0) / 2;
      a.goals += tb.reduce((x, r) => x + r.gf, 0);
      a.draws += tb.reduce((x, r) => x + r.d, 0) / 2;
    }
    hash = hashSeed(hash + JSON.stringify(Object.values(res.leagues).map((l) => l.order)));
    endSeason(world, Object.fromEntries(Object.entries(res.leagues).map(([k, v]) => [k, v.order])), seed, base);
  }
  return { agg, ms: ms / seasons, hash, world };
}

if (!args.includes("--careers")) {
  const seasons = +opt("seasons", 5), seed = opt("seed", "BAL");
  const a = leagueBalance(seasons, seed);
  const b = leagueBalance(Math.min(2, seasons), seed);
  const c = leagueBalance(Math.min(2, seasons), seed);
  console.log(`커리어 리그 밸런스 — 세계 ${seasons}시즌 (내 선수 없음), 시드 ${seed}\n`);
  for (const lg of LEAGUES) {
    const x = a.agg[lg.id];
    console.log(`${lg.label.padEnd(10)} 경기당 ${(x.goals / x.games).toFixed(2)}골 · 무승부 ${(100 * x.draws / x.games).toFixed(1)}%`);
  }
  const all = Object.values(a.agg).reduce((s, x) => ({ g: s.g + x.goals, n: s.n + x.games, d: s.d + x.draws }), { g: 0, n: 0, d: 0 });
  console.log(`\n전체 경기당 ${(all.g / all.n).toFixed(2)}골 · 무승부 ${(100 * all.d / all.n).toFixed(1)}% · 시즌 1회 ${a.ms.toFixed(0)}ms`);
  console.log(`결정론(같은 시드 2회) ${b.hash === c.hash ? "✅ 동일" : "❌ 다름"} 해시 ${b.hash.toString(16)}`);
  const hist = {}; for (const cl of Object.values(a.world.clubs)) { const k = Math.floor(cl.R / 5) * 5; hist[k] = (hist[k] || 0) + 1; }
  console.log(`${seasons}시즌 뒤 요구 OVR 분포:`, JSON.stringify(hist));
}

/* ============================================================
   커리어 자동 플레이 (--careers N --policy best,normal,passive)
   growth-sim.js의 정책을 실제 게임 코드(career.js)로 그대로 수행
   ============================================================ */
import { makeRng as mk } from "../../js/engine/rng.js";
import { POSITIONS, W as PW, CATS as PC } from "../../js/career/rules.js";
import { newCareer, chooseStartClub, startClubOptions, playSeason, decide, setFocus, buyTraining, defaultFocus, playerOvr } from "../../js/career/career.js";
import { clubCard, shopPrice } from "../../js/career/market.js";
import { catsByWeight } from "../../js/career/attrs.js";

const POLICY = {
  best: { combo: "top", focus: "opt", club: "growth", shop: true },
  bestNoShop: { combo: "top", focus: "opt", club: "growth", shop: false },
  normal: { combo: "top", focus: "half", club: "rotation", shop: false },
  passive: { combo: "top", focus: "random", club: "bench", shop: false },
  stay: { combo: "top", focus: "opt", club: "stay", shop: true }
};
const coachScore = (state, card) => {
  const f = defaultFocus(state, card.clubId);
  const c = state.world.clubs[card.clubId].coach;
  const p = state.player.pos;
  return f.reduce((s, k) => s + PW[p][k] * (c.includes(k) ? 1.3 : 1), 0) / f.reduce((s, k) => s + PW[p][k], 0);
};
function pickClub(state, cards, pol, rng) {
  const g = (c) => c.efficiency * coachScore(state, c);
  if (pol.club === "growth" || pol.club === "stay") {
    const st = cards.filter((c) => c.role === "S");
    if (state.player.age >= 27 && st.length) return st.sort((a, b) => b.R - a.R || g(b) - g(a))[0];
    return cards.slice().sort((a, b) => g(b) - g(a) || b.R - a.R)[0];
  }
  if (pol.club === "rotation") { const r = cards.filter((c) => c.role === "R"); return r.length ? r[rng.int(r.length)] : cards[rng.int(cards.length)]; }
  return cards.slice().sort((a, b) => b.R - a.R)[0];
}
function runCareerAuto(seed, pos, pol) {
  const rng = mk(seed + "|policy");
  const order = catsByWeight(pos);
  const pair = pol.combo === "top" ? order.slice(0, 2) : order.slice(4);
  const state = newCareer({ name: "테스트", pos, pair, seed, clubsJson });
  const starts = startClubOptions(state);
  chooseStartClub(state, pickClub(state, starts, pol, rng).clubId);
  const log = [];
  while (state.phase !== "retired") {
    const p = state.player;
    if (pol.shop) {
      const top = defaultFocus(state)[0];
      const price = shopPrice(Math.round(playerOvr(state, false)));
      if (p.age >= 19 && p.money >= price.special) buyTraining(state, "special", top);
      else if (p.money >= price.normal) buyTraining(state, "normal", top);
    }
    const own = { ...clubCard(state, p.clubId, { trust: p.trust }), stay: true };
    let choice = own;
    if (pol.club !== "stay") {
      const cards = [own, ...state.off.offers, ...state.off.loans.map((c) => ({ ...c, loan: true }))];
      choice = pickClub(state, cards, pol, rng);
    }
    decide(state, choice.stay ? { type: "stay", clubId: p.clubId } : choice.loan ? { type: "loan", clubId: choice.clubId } : { type: "transfer", clubId: choice.clubId });
    let f = defaultFocus(state, choice.clubId);
    if (pol.focus === "half" && rng.chance(0.5)) f = [f[0], ...rng.shuffle(PC.filter((k) => k !== f[0])).slice(0, 2)];
    if (pol.focus === "random") f = rng.shuffle(PC).slice(0, 3);
    setFocus(state, f);
    const { summary: s } = playSeason(state, clubsJson);
    log.push(s);
    if (args.includes("--diag") && s.tier === 1 && s.age >= 25 && s.starts >= s.games * 0.75) console.log("diag", s.age, "ovr-R", Math.round(s.ovr) - s.R, "pos", s.posRank + "/" + s.posCount, "lg", s.leagueRatingRank, "avg", s.avg, s.awards.join(","), s.legend ? "★" : "");
    // 은퇴 정책(시뮬 가정): 36세부터 후보거나 정점 대비 −8
    if (state.phase !== "retired" && state.player.age >= 36 && (s.role === "B" || s.ovrEnd < Math.max(...log.map((x) => x.ovrEnd)) - 8)) state.phase = "retired";
  }
  return log;
}
if (args.includes("--careers")) {
  const N = +opt("careers", 100), SEED = opt("seed", "CAREER-TEST");
  const pols = opt("policy", "best,normal,passive").split(",");
  const t0 = performance.now();
  for (const pn of pols) {
    const at = {}, peaks = [], peakAges = [], big27 = [], b25 = [], topAge = [], ret = [];
    let legP = 0, legN = 0, slumpN = 0, slumpBase = 0, statDiffs = [];
    for (let r = 0; r < N; r++) {
      const pos = POSITIONS[r % POSITIONS.length];
      const log = runCareerAuto(`${SEED}|${pn}|${r}`, pos, POLICY[pn]);
      let peak = 0, pa = 16, big = null, top = null;
      for (const s of log) {
        (at[s.age] = at[s.age] || []).push(s.ovr);
        if (s.ovr > peak) { peak = s.ovr; pa = s.age; }
        if (s.role === "S" && s.R >= 80 && big === null) big = s.age;
        if (s.role === "S" && s.R >= 83 && top === null) top = s.age;
        if (s.age >= 27 && s.age <= 32) { legN++; if (s.legend) legP++; }
        if (s.role !== "B") { slumpBase++; if (s.slump) slumpN++; }
      }
      peaks.push(Math.round(peak)); peakAges.push(pa); big27.push(big !== null && big <= 27); b25.push(big !== null && big < 25);
      if (top !== null) topAge.push(top);
      ret.push(log[log.length - 1].age);
      if ((r + 1) % 20 === 0) process.stderr.write(`  ${pn} ${r + 1}/${N}\r`);
    }
    const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
    const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const dist = { "≤87": 0, "88~92": 0, "93~96": 0, "97~98": 0, "99": 0 };
    for (const p of peaks) dist[p <= 87 ? "≤87" : p <= 92 ? "88~92" : p <= 96 ? "93~96" : p <= 98 ? "97~98" : "99"]++;
    const pct = (k) => (100 * k / N).toFixed(1);
    console.log(`\n[${pn}] ${N}회 — OVR(시즌 시작): ` + [16, 18, 21, 24, 27, 30, 31, 33, 36].map((a) => `${a}세 ${at[a] ? mean(at[a]).toFixed(1) : "-"}`).join(" · "));
    console.log(`  정점 평균 ${mean(peaks).toFixed(1)} · 분포 ${Object.entries(dist).map(([k, v]) => `${k} ${pct(v)}%`).join(" · ")}`);
    console.log(`  정점 27~32세 ${pct(peakAges.filter((a) => a >= 27 && a <= 32).length)}% · 27세까지 빅클럽 주전 ${pct(big27.filter(Boolean).length)}% · 25세 전 ${pct(b25.filter(Boolean).length)}% · 최상위 주전 중앙 ${topAge.length ? med(topAge) + "세" : "-"}(${pct(topAge.length)}%)`);
    console.log(`  레전드(27~32세 시즌당) ${(100 * legP / (legN || 1)).toFixed(1)}% · 슬럼프(주전·로테이션 시즌당) ${(100 * slumpN / (slumpBase || 1)).toFixed(1)}% · 은퇴 평균 ${mean(ret).toFixed(1)}세`);
  }
  // 결정론: 같은 시드·같은 선택 → 커리어 전체 결과 동일
  const h1 = hashSeed(JSON.stringify(runCareerAuto(SEED + "|det", "AM", POLICY.best)));
  const h2 = hashSeed(JSON.stringify(runCareerAuto(SEED + "|det", "AM", POLICY.best)));
  console.log(`\n결정론(같은 시드 커리어 2회) ${h1 === h2 ? "✅ 동일" : "❌ 다름"} 해시 ${h1.toString(16)}`);
  console.log(`소요 ${((performance.now() - t0) / 1000).toFixed(0)}초`);
}
