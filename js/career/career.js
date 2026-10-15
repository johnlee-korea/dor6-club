/* ============================================================
   career/career.js — 커리어 상태와 흐름 (화면·자동 플레이 테스트 공용, DOM 없음)
   흐름: newCareer → chooseStartClub → [오프시즌 선택 → playSeason] 반복 → retire
   상태(state)는 그대로 LocalStorage에 저장된다 (save.js). 구단 이름은 저장하지 않음(구단 id만).
   ============================================================ */
import { makeRng } from "../engine/rng.js";
import { CATS, W, CONVERT_PENALTY, LEGEND, SLUMP, PREF_ADOPT, CLUB_GROW, RETIRE, BONUS, TOP_CLUB, BIG_CLUB, round1 } from "./rules.js";
import { SAVE_VERSION } from "./config.js";
import { makeStart, posOvr, catValues, isStar } from "./attrs.js";
import { comboKey, reevaluateType, prefMatch, typeEffects, typeName } from "./types.js";
import { createWorld, endSeason, leagueOf, indexBase } from "./world.js";
import { simulateSeason } from "./season.js";
import { applySeasonGrowth, applyTraining, isLegend } from "./growth.js";
import { makeGoal, goalMet, addTrust } from "./goals.js";
import { clubCard, makeOffers, loanOptions, startOptions, shopPrice, salaryOf } from "./market.js";
import { checkAchievements } from "./achievements.js";

const ri = (v) => Math.round(v);

/* ---------- 새 커리어 ---------- */
export function newCareer({ name, pos, pair, seed, clubsJson, createdAt }) {
  const rng = makeRng(seed + "|player");
  const subs = makeStart(pos, pair, rng);
  const key = comboKey(pair[0], pair[1]);
  const state = {
    v: SAVE_VERSION, seed, createdAt: createdAt || null, phase: "start-club",
    world: createWorld(clubsJson, seed),
    player: { name, pos, typeKey: key, startType: `${pos}:${key}`, star: isStar(pos, pair), subs, age: 16,
              clubId: null, loan: null, trust: 0, money: 0, conversions: 0, penaltySeason: 0, lastFocus: null },
    off: null, history: [], recent: [],
    totals: { seasons: 0, apps: 0, goals: 0, assists: 0, hatTricks: 0, income: 0, titles: 0, awards: {}, legends: 0, slumps: 0,
              typeChanges: 0, maxOvr: ri(posOvr(subs, pos)), clubs: {}, countries: [], debut: null, tier1Debut: null, firstGoal: null,
              convertedTitle: false, prefStarter: false },
    flags: { slumpLast: false }
  };
  return state;
}

export const playerOvr = (state, withPenalty = true) => {
  const p = state.player;
  return posOvr(p.subs, p.pos, withPenalty && p.penaltySeason === state.world.season ? CONVERT_PENALTY : 0);
};
export const startClubOptions = (state) => startOptions(state);

export function chooseStartClub(state, clubId) {
  state.player.clubId = clubId;
  state.player.joined = state.world.season;
  state.phase = "offseason";
  prepareOffseason(state, null);
  return state;
}

/* ---------- 오프시즌 ---------- */
export function defaultFocus(state, clubId) {
  const p = state.player;
  const coach = state.world.clubs[clubId || p.clubId].coach;
  const cv = catValues(p.subs);
  const w = (k) => W[p.pos][k] * (coach.includes(k) ? 1.3 : 1);
  return CATS.slice().sort((a, b) => (cv[a] >= 98.9) - (cv[b] >= 98.9) || w(b) - w(a)).slice(0, 3);
}

export function prepareOffseason(state, last) {
  const p = state.player;
  const own = clubCard(state, p.clubId, { trust: p.trust, penalty: p.penaltySeason === state.world.season ? CONVERT_PENALTY : 0 });
  state.off = {
    offers: last ? makeOffers(state, last) : [],
    loans: last ? loanOptions(state, own.role) : [],
    shopUsed: null,
    focus: (p.lastFocus && p.lastFocus.length === 3) ? p.lastFocus.slice() : defaultFocus(state),
    decision: { type: "stay", clubId: p.clubId },
    converted: null
  };
  return state.off;
}

/* 지금 선택(잔류·이적·임대) 기준 뛸 구단의 카드 + 시즌 목표 미리보기 */
export function decisionPreview(state) {
  const p = state.player, d = state.off.decision;
  const clubId = d.clubId;
  const trust = d.type === "stay" ? p.trust : 0;
  const card = clubCard(state, clubId, { trust, penalty: p.penaltySeason === state.world.season ? CONVERT_PENALTY : 0 });
  const games = 2 * (leagueClubCount(state, card.league) - 1);
  const goal = makeGoal(card.role, p.pos, games, state.history[state.history.length - 1]);
  return { card, goal, games };
}
const leagueClubCount = (state, lg) => Object.values(state.world.clubs).filter((c) => c.league === lg).length;

export function decide(state, decision) { state.off.decision = decision; return decisionPreview(state); }
export function setFocus(state, focus) { if (focus.length === 3) state.off.focus = focus.slice(); }

/* 상점: 시즌당 1회 */
export function buyTraining(state, kind, cat) {
  const p = state.player;
  if (state.off.shopUsed) return { ok: false, reason: "이번 오프시즌엔 이미 훈련했어요" };
  const price = shopPrice(ri(playerOvr(state, false)))[kind];
  if (p.money < price) return { ok: false, reason: "자금이 부족해요" };
  p.money = round1(p.money - price);
  const before = ri(playerOvr(state));
  const amount = applyTraining(p, kind, cat);
  const prevType = p.typeKey;
  p.typeKey = reevaluateType(p.typeKey, catValues(p.subs));
  state.off.shopUsed = { kind, cat, amount, price };
  return { ok: true, amount, price, ovrBefore: before, ovrAfter: ri(playerOvr(state)), typeChanged: prevType !== p.typeKey ? p.typeKey : null };
}

/* 포지션 전환 (인접, 커리어 2회, 첫 시즌 −3) */
export function convertPosition(state, pos) {
  const p = state.player;
  const from = p.pos;
  p.pos = pos;
  p.conversions = (p.conversions || 0) + 1;
  p.penaltySeason = state.world.season;
  p.typeKey = reevaluateType(p.typeKey, catValues(p.subs));
  state.off.converted = { from, to: pos };
  state.off.focus = defaultFocus(state, state.off.decision.clubId);
  // 전환하면 역할·제안 조건이 바뀌므로 다시 계산
  const last = state.history[state.history.length - 1];
  const keep = state.off.decision;
  const own = clubCard(state, p.clubId, { trust: p.trust, penalty: CONVERT_PENALTY });
  state.off.offers = last ? makeOffers(state, last) : [];
  state.off.loans = last ? loanOptions(state, own.role) : [];
  if (keep.type !== "stay" && !state.off.offers.concat(state.off.loans).some((c) => c.clubId === keep.clubId)) state.off.decision = { type: "stay", clubId: p.clubId };
  return state;
}

/* ---------- 시즌 진행 ---------- */
export function playSeason(state, clubsJson) {
  const base = indexBase(clubsJson);
  const p = state.player, world = state.world, n = world.season;
  const d = state.off.decision;
  const prevClub = p.clubId;
  if (d.type === "transfer") { p.clubId = d.clubId; p.trust = 0; p.joined = n; }
  p.loan = d.type === "loan" ? { clubId: d.clubId } : null;
  const playId = p.loan ? p.loan.clubId : p.clubId;
  const club = world.clubs[playId];
  const lg = leagueOf(club.league);
  const leagueId = club.league, clubR = club.R;   // 시즌 종료 처리(승강·등급 재배분) 전에 고정
  const penalty = p.penaltySeason === n ? CONVERT_PENALTY : 0;
  const ovrStart = posOvr(p.subs, p.pos);
  const ovrShown = ri(ovrStart - penalty);
  const pm = prefMatch(p.pos, p.typeKey, club.pref);
  const cv = catValues(p.subs);
  const attrs = {};
  const [a, b] = p.typeKey.split("+");
  for (const c of CATS) attrs[c] = ri(cv[c]) + (pm === "full" && (c === a || c === b) ? 2 : 0);
  if (pm === "partial") { const pc = club.pref.split(":")[1].split("+"); for (const c of [a, b]) if (pc.includes(c)) attrs[c] += 1; }
  const fx = typeEffects(p.pos, p.typeKey);
  const trustIn = p.loan ? 0 : p.trust;
  const last = state.history[state.history.length - 1];
  const focus = state.off.focus.slice();

  const res = simulateSeason({ world, seed: state.seed,
    me: { clubId: playId, name: p.name, pos: p.pos, ovr: ovrShown, attrs, fx, pref: pm, trust: trustIn, age: p.age } });
  const mine = res.mine;
  const goal = makeGoal(mine.startRole, p.pos, mine.games, last);
  const met = goalMet(goal, mine);
  const champion = res.leagues[club.league].order[0] === playId;
  // 레전드 시즌은 2시즌 연속 나오지 않음 (다음 시즌은 견제가 심해짐)
  const legend = !(LEGEND.noRepeat && last && last.legend) && isLegend({ age: p.age, tier: lg.tier, mine, champion });
  // 슬럼프: 주전·로테이션으로 시작 + 팀 필드 선수 평균보다 평점이 SLUMP.below 이상 낮음 + 목표 실패 (능력치는 깎지 않음)
  const slump = (mine.startRole === "S" || mine.startRole === "R") && mine.vsTeam !== null && mine.vsTeam <= -SLUMP.below && !met;
  const revival = state.flags.slumpLast && mine.vsTeam !== null && mine.vsTeam >= SLUMP.revive;

  const subsBefore = { ...p.subs };
  const growth = applySeasonGrowth({ player: p, mine, clubR: club.R, coach: club.coach, focus, legend, ovrStart, ovrShown });
  const ovrEnd = posOvr(p.subs, p.pos);

  // 신뢰도 (임대 중엔 원 소속 신뢰도 유지, 복귀 평점 좋으면 +1)
  let trustAfter = p.trust;
  if (!p.loan) {
    trustAfter = mine.trust;
    trustAfter = addTrust(trustAfter, met ? 1 : slump ? -2 : -1);
    if (revival) trustAfter = addTrust(trustAfter, 2);
  } else if (mine.avg >= 6.9) trustAfter = addTrust(trustAfter, 1);
  p.trust = trustAfter;

  // 수입: 연봉(임대는 원 소속 기준) + 공격포인트·개인상·목표 보너스
  const payR = world.clubs[p.clubId].R;
  const payRole = p.loan ? "B" : mine.startRole;
  const salary = salaryOf(payR, payRole, p.age);
  const income = round1(salary * (1 + BONUS.perPoint * (mine.goals + mine.assists) + BONUS.award * mine.awards.length + (met ? BONUS.goal : 0)));
  p.money = round1(p.money + income);

  // 유형 재판정
  const prevType = p.typeKey;
  p.typeKey = reevaluateType(p.typeKey, catValues(p.subs));

  const order = res.leagues[leagueId].order;
  const finish = order.indexOf(playId) + 1;
  const finals = Object.fromEntries(Object.entries(res.leagues).map(([k, v]) => [k, v.order]));
  const news = endSeason(world, finals, state.seed, base);
  const promoted = news.some((x) => x.type === "up" && x.club === playId);
  const relegated = news.some((x) => x.type === "down" && x.club === playId);
  // 감독이 내게 전술을 맞춤: 원 소속에서 뛰며(임대 X) 목표 달성 + 팀 평균 평점 이상 → 다음 시즌 선호 유형 = 내 유형 (잔류 시 역할 점수 +3)
  const prefAdopted = !p.loan && met && mine.vsTeam !== null && mine.vsTeam >= PREF_ADOPT.minVsTeam;
  if (prefAdopted) {
    world.clubs[p.clubId].pref = `${p.pos}:${p.typeKey}`;
    news.push({ type: "pref", club: p.clubId });
  }
  // 내가 키우는 팀: 원 소속에서 주전으로 잘하면(목표 달성 또는 팀 평균 이상) 구단이 전력 보강 → 요구 OVR이 내 수준을 따라옴 (원클럽 레전드 가능)
  const own = world.clubs[p.clubId];
  const starred = !p.loan && (mine.startRole === "S" || mine.endRole === "S") && (met || (mine.vsTeam !== null && mine.vsTeam >= 0));
  let clubGrowth = 0;
  if (starred) {
    const band = leagueOf(own.league).band;
    clubGrowth = Math.max(0, Math.min(CLUB_GROW.max, Math.round((ri(ovrEnd) - CLUB_GROW.gap - own.R) * CLUB_GROW.rate), band[1] + 1 - own.R));
    if (clubGrowth > 0) { news.push({ type: "grow", club: p.clubId, from: own.R, to: own.R + clubGrowth }); own.R += clubGrowth; }
  }

  const summary = {
    n, age: p.age, club: playId, parent: p.loan ? p.clubId : null, league: leagueId, tier: lg.tier, R: clubR,
    pos: p.pos, type: prevType, typeAfter: p.typeKey, role: mine.startRole, roleEnd: mine.endRole, mid: mine.mid,
    games: mine.games, starts: mine.starts, subs: mine.subs, bench: mine.bench, youth: mine.youth,
    goals: mine.goals, assists: mine.assists, avg: Math.round(mine.avg * 100) / 100, apps: mine.apps, hatTricks: mine.hatTricks,
    winners: mine.winners, posRank: mine.posRank, leagueRatingRank: mine.leagueRatingRank, posCount: mine.posCount, teamRank: mine.teamRank, teamCount: mine.teamCount, vsTeam: mine.vsTeam,
    awards: mine.awards, finish, champion, promoted, relegated,
    ovr: round1(ovrStart), ovrShown, ovrEnd: round1(ovrEnd), cats: mapRound(growth.before), catsAfter: mapRound(growth.after),
    efficiency: growth.efficiency, ratio: Math.round(growth.ratio * 100) / 100, stage: growth.S, focus, coach: club.coach.slice(),
    legend, slump: !!slump, revival: !!revival, goal, met, trust: p.trust, salary, income, money: p.money,
    pref: pm, short: mine.short, converted: state.off.converted, shop: state.off.shopUsed,
    subTop: Object.keys(p.subs).map((k) => [k, round1(p.subs[k] - subsBefore[k])]).sort((x, y) => y[1] - x[1]).slice(0, 5)
  };
  const totalsBefore = JSON.parse(JSON.stringify(state.totals));
  updateTotals(state, summary, mine);
  summary.prefAdopted = prefAdopted;
  summary.clubGrowth = clubGrowth;
  summary.highlights = highlights(state, summary, mine, totalsBefore);
  state.history.push(summary);
  state.recent.push({ n, matches: mine.matches, roundRanks: mine.roundRanks, table: mine.table, scorers: mine.scorers,
                      assistLeaders: mine.assistLeaders, ratingLeaders: mine.ratingLeaders, best11: mine.best11, league: club.league });
  if (state.recent.length > 3) state.recent.shift();
  state.flags.slumpLast = !!slump;
  summary.achievements = checkAchievements(state, summary);

  // 나이·임대 종료·은퇴
  p.age++;
  p.lastFocus = focus;
  if (p.loan) p.loan = null;
  if (prevClub !== p.clubId) summary.transferredFrom = prevClub;
  const forced = forcedRetire(state);
  if (forced) { state.phase = "retired"; summary.forcedRetire = forced; }
  else prepareOffseason(state, summary);
  return { summary, mine, growth, news };
}
const mapRound = (cv) => { const o = {}; for (const c of CATS) o[c] = round1(cv[c]); return o; };

function forcedRetire(state) {
  const p = state.player;
  if (p.age > RETIRE.forceAge) return "age";
  if (p.age >= RETIRE.canFrom) {
    const ovr = ri(playerOvr(state));
    const role = clubCard(state, p.clubId, { trust: p.trust }).role;
    const offers = makeOffers(state, state.history[state.history.length - 1]);
    if (ovr < RETIRE.minOvr && role === "B" && !offers.length) return "level";
  }
  return null;
}
export const canRetire = (state) => state.player.age >= RETIRE.canFrom;
export function retire(state) { state.phase = "retired"; return careerSummary(state); }

/* ---------- 누적 기록 ---------- */
function updateTotals(state, s, mine) {
  const t = state.totals, p = state.player;
  t.seasons++;
  t.apps += s.starts + s.subs;
  t.goals += s.goals; t.assists += s.assists; t.hatTricks += s.hatTricks; t.income = round1(t.income + s.income);
  if (s.champion) t.titles++;
  for (const a of s.awards) t.awards[a] = (t.awards[a] || 0) + 1;
  if (s.legend) t.legends++;
  if (s.slump) t.slumps++;
  if (s.typeAfter !== s.type) t.typeChanges++;
  t.maxOvr = Math.max(t.maxOvr, ri(s.ovrEnd));
  const c = (t.clubs[s.club] = t.clubs[s.club] || { seasons: 0, goals: 0, promotions: 0 });
  c.seasons++; c.goals += s.goals; if (s.promoted) c.promotions++;
  const country = leagueOf(s.league).country;
  if (!t.countries.includes(country)) t.countries.push(country);
  if (t.debut === null && s.starts + s.subs > 0) t.debut = s.n;
  if (t.tier1Debut === null && s.tier === 1 && s.starts + s.subs > 0) t.tier1Debut = s.n;
  if (t.firstGoal === null && s.goals > 0) t.firstGoal = s.n;
  if (t.startLeague === undefined) t.startLeague = s.league;
  if (s.champion && p.conversions > 0) t.convertedTitle = true;
  if (s.pref === "full" && s.role === "S") t.prefStarter = true;
  if (s.role === "S" && s.age <= 18) t.youngStarter = true;
  if (s.role === "S" && s.R >= BIG_CLUB) { t.bigStarter = t.bigStarter || s.age; }
  if (s.role === "S" && s.R >= TOP_CLUB) { t.topStarter = t.topStarter || s.age; }
  if (s.R >= BIG_CLUB) t.bigJoined = true;
  if (s.role === "S" && s.tier === 1 && s.age >= 36) t.veteranStarter = true;
  if (s.champion && s.tier === 1 && !p.star) t.underdogTitle = true;
  if (s.champion && mine.table && mine.table[0] && mine.table[0].l === 0) t.unbeaten = true;
  t.best11 = t.awards["베스트11"] || 0;
}

/* ---------- 하이라이트 (리포트 맨 위, 최대 5) ---------- */
function highlights(state, s, mine, before) {
  const h = [];
  const t = state.totals;
  if (s.legend) h.push({ icon: "🌟", title: "레전드 시즌", text: `같은 포지션 평점 ${s.posRank}위 · ${s.awards.join("·")}` });
  if (s.champion) h.push({ icon: "🏆", title: "리그 우승!", text: `${leagueOf(s.league).label} 1위` });
  if (s.promoted) h.push({ icon: "⬆️", title: "승격 확정", text: `${s.finish}위로 시즌 마감` });
  for (const a of s.awards) h.push({ icon: a === "득점왕" ? "👟" : a === "도움왕" ? "🎯" : a === "시즌 MVP" ? "🥇" : "⭐", title: a, text: a === "득점왕" ? `${s.goals}골` : a === "도움왕" ? `${s.assists}도움` : `평균 평점 ${s.avg.toFixed(2)}` });
  if (before.debut === null && t.debut !== null) h.push({ icon: "👟", title: "1군 데뷔전", text: "첫 1군 경기에 나섰어요" });
  if (before.firstGoal === null && t.firstGoal !== null) {
    const m = mine.matches.find((x) => x.g > 0);
    h.push({ icon: "⚽", title: "데뷔골!", text: m ? `${m.k}라운드 ${m.mins[0]}분` : "" });
  }
  if (before.tier1Debut === null && t.tier1Debut !== null) h.push({ icon: "🏟", title: "1부 리그 데뷔", text: leagueOf(s.league).label });
  const hist = state.history;
  if (s.role === "S" && !hist.some((x) => x.role === "S")) h.push({ icon: "📌", title: "1군 정착", text: "첫 주전 시즌" });
  if (s.hatTricks) h.push({ icon: "🎩", title: s.hatTricks > 1 ? `해트트릭 ${s.hatTricks}회` : "해트트릭", text: "" });
  if (s.winners) h.push({ icon: "💥", title: `결승골 ${s.winners}개`, text: "" });
  if (s.typeAfter !== s.type) h.push({ icon: "🧬", title: "유형 진화!", text: `${typeName(s.pos, s.type)} → ${typeName(s.pos, s.typeAfter)}` });
  if (s.clubGrowth) h.push({ icon: "📈", title: "팀이 나와 함께 성장", text: `구단 전력 보강 · 요구 OVR +${s.clubGrowth}` });
  if (s.prefAdopted) h.push({ icon: "🎯", title: "감독이 나에게 맞춘 전술", text: "다음 시즌 선호 유형 = 내 유형 (잔류하면 역할 점수 +3)" });
  if (s.revival) h.push({ icon: "🔥", title: "부활", text: "슬럼프를 딛고 팀 상위권 평점" });
  if (s.slump) h.push({ icon: "💧", title: "슬럼프 시즌", text: "감독 신뢰도 −2, 다음 오프시즌 제안이 줄어요" });
  for (const mark of [90, 95, 99]) if (ri(s.ovr) < mark && ri(s.ovrEnd) >= mark) h.push({ icon: "🚀", title: `OVR ${mark} 돌파`, text: "" });
  if (s.mid && s.mid.from !== s.mid.to) h.push({ icon: s.mid.to === "S" || (s.mid.to === "R" && s.mid.from === "B") ? "⬆️" : "⬇️", title: "후반기 역할 변화", text: "" });
  return h.slice(0, 6);
}

/* ---------- 은퇴 요약 (명예의 전당) ---------- */
export function careerSummary(state) {
  const p = state.player, t = state.totals, hs = state.history;
  const types = [];
  for (const s of hs) { const id = `${s.pos}:${s.typeAfter}`; if (!types.length || types[types.length - 1] !== id) types.push(id); }
  if (!types.length) types.push(`${p.pos}:${p.typeKey}`);
  return {
    id: `${state.seed}`, name: p.name, startType: p.startType, star: p.star, types, retiredAge: p.age - 1 < 16 ? 16 : p.age - 1,
    maxOvr: t.maxOvr, seasons: t.seasons, apps: t.apps, goals: t.goals, assists: t.assists, titles: t.titles,
    awards: t.awards, legends: t.legends, income: t.income,
    clubs: Object.keys(t.clubs), bestClub: hs.reduce((m, s) => (!m || s.R > m.R ? s : m), null)?.club || null,
    history: hs.map((s) => ({ n: s.n, age: s.age, club: s.club, league: s.league, role: s.role, apps: s.starts + s.subs, g: s.goals, a: s.assists, avg: s.avg, ovr: s.ovrShown, legend: s.legend, champion: s.champion }))
  };
}
