/* ============================================================
   league/divisions.js — 🏆 도륙리그 2부제 (v2.29.0, CLAUDE.md 33) — 순수 함수
   DPL(도륙 프리미어리그, 14구단) · DCL(도륙 챔피언십리그, 나머지)
   - 편성: data/league/divisions.json 명단 → 스냅샷 팀마다 div · 판수 미달 penalty
   - 하루 실행: 리그마다 runDay(시드 "<일일시드>|DPL") + 두 리그가 끝난 뒤 승강 PO(DPL 13위 vs DCL 2위, 3판 2선승)
   - 승강: DPL 꼴찌 ↔ DCL 1위 맞교환, PO 승자가 다음 날 DPL
   Worker(편성·진행 판정)·기록 보관(archive.js)·화면(league.js)·테스트가 같은 규칙을 공유한다.
   ※ 스냅샷 format 2만 2부제. 그 이전 스냅샷은 지금까지처럼 한 리그(data.js simulateSnapshot)
   ============================================================ */
import { runDay, summarizeDay, simulateKnockout, roundCount } from "../engine/index.js";
import { snapshotTeams } from "./roster.js";
import * as C from "./clock.js";

export const DIVS = ["DPL", "DCL"];
export const DIV_NAME = { DPL: "도륙 프리미어리그", DCL: "도륙 챔피언십리그" };
export const DIV_ICON = { DPL: "🏆", DCL: "🥈" };
export const DPL_SIZE = 14;
// 판수 미달 페널티 — 팀 공격력·수비력 −10 (0.001 단위, 사용자 결정 2026-11-05 "판수 보너스 받듯 거꾸로")
// 실측(14팀 × 600일, 한 팀만): 평균 13.9위 · 꼴찌 94% — 값을 바꾸면 다음 편성부터 적용(지난 스냅샷은 얼린 값 그대로)
export const PENALTY = 10000;
export const PO_GAMES = 3, PO_WINS = 2;

export const isSplit = (snap) => !!(snap && snap.format === 2);
export const divTeams = (snap, div) => ((snap && snap.teams) || []).filter((t) => t.div === div);
export const penaltyText = (p) => "−" + String(Number(((p || 0) / 1000).toFixed(3)));

/* ---------- 편성 ----------
   teams: 참가 판정 결과(ouid 정렬, 판수 미달이면 short) · divFile: divisions.json(없으면 null)
   규칙: 명단 순서 유지 · 명단에 없는 새 클럽원은 DCL 맨 뒤(ouid 순) · 탈퇴자는 빠짐 · DPL이 14 미만이면 DCL 앞에서 채움
   반환: { teams: [{ …, div, penalty? }] (입력 순서 그대로), order: { DPL: [ouid], DCL: [ouid] } } */
export function assignDivisions(teams, divFile) {
  const ids = new Set(teams.map((t) => t.ouid));
  const dpl = [...new Set(((divFile && divFile.DPL) || []).filter((id) => ids.has(id)))];
  const inDpl = new Set(dpl);
  const dcl = [...new Set(((divFile && divFile.DCL) || []).filter((id) => ids.has(id) && !inDpl.has(id)))];
  const known = new Set([...dpl, ...dcl]);
  const fresh = teams.map((t) => t.ouid).filter((id) => !known.has(id)).sort();
  const rest = [...dcl, ...fresh];
  while (dpl.length > DPL_SIZE) rest.unshift(dpl.pop());   // (명단이 14를 넘는 일은 없지만 안전장치)
  while (dpl.length < DPL_SIZE && rest.length) dpl.push(rest.shift());
  const div = new Map([...dpl.map((id) => [id, "DPL"]), ...rest.map((id) => [id, "DCL"])]);
  return {
    teams: teams.map((t) => ({ ...t, div: div.get(t.ouid), ...(t.short ? { penalty: PENALTY } : {}) })),
    order: { DPL: dpl, DCL: rest }
  };
}

/* ---------- 시각 ----------
   두 리그 모두 07:00(또는 opt.start) 개막, 같은 간격(15분 — 큰 리그가 16시간을 넘으면 줄어듦).
   PO 1차전 = 두 리그 중 늦게 끝나는 시각, 이후 한 경기씩 간격마다. 3차전은 1승 1패일 때만.
   dayEnd = 하루 종료 상한(3차전까지 했을 때) — Worker는 경기 결과를 계산하지 않으므로 이 값으로 진행 중 판정 */
export function dayPlan(snap, opt = {}) {
  const n = { DPL: divTeams(snap, "DPL").length, DCL: divTeams(snap, "DCL").length };
  const R = { DPL: n.DPL >= 2 ? roundCount(n.DPL) : 0, DCL: n.DCL >= 2 ? roundCount(n.DCL) : 0 };
  const iv = opt.iv || C.intervalSec(Math.max(R.DPL, R.DCL), C.MAX_I2);
  const start = opt.start != null ? opt.start : C.kstMs(snap.date, C.OPEN_H);
  const end = { DPL: start + R.DPL * iv * 1000, DCL: start + R.DCL * iv * 1000 };
  const hasPO = n.DPL >= 3 && n.DCL >= 2;
  const poStart = Math.max(end.DPL, end.DCL);
  const poKick = (g) => poStart + (g - 1) * iv * 1000;
  return { start, iv, n, R, end, hasPO, poStart, poKick, dayEnd: hasPO ? poKick(PO_GAMES) + iv * 1000 : poStart };
}
/* 스냅샷(옛 형식 포함) → 하루 종료 상한 UTC ms (clock.todayRunning에 { end }로 넘김) */
export function dayEndMs(snap) {
  if (!snap || !snap.teams) return null;
  if (isSplit(snap)) return dayPlan(snap).dayEnd;
  return C.endMs(snap.date, roundCount(snap.teams.length));
}

/* ---------- 하루 실행 ----------
   반환: { DPL: day|null, DCL: day|null, playoff: po|null } — day = engine runDay 결과 */
export function runLeagueDay(snap, config, names) {
  const teamSeed = snap.teamSeed || (config && config.seed) || "DOR6";
  const out = {};
  for (const div of DIVS) {
    const ts = divTeams(snap, div);
    out[div] = ts.length >= 2 ? runDay({ daySeed: `${snap.seed}|${div}`, teamSeed, teams: snapshotTeams({ teams: ts }, names) }) : null;
  }
  out.playoff = playoff(out, snap.seed);
  return out;
}

const finalOrder = (day) => day.tables[day.totalRounds].map((r) => r.id);

/* 승강 PO: DPL 끝에서 두 번째(13위) vs DCL 2위 — 1차전 DCL 홈, 2·3차전 DPL 홈, 2승하면 끝 */
export function playoff(out, seed) {
  const D = out.DPL, L = out.DCL;
  if (!D || !L || D.ids.length < 3 || L.ids.length < 2) return null;
  const dOrd = finalOrder(D), lOrd = finalOrder(L);
  const up = dOrd[dOrd.length - 2], dn = lOrd[1];
  const sq = { [up]: D.squads.get(up), [dn]: L.squads.get(dn) };
  const names = { [up]: D.names.get(up), [dn]: L.names.get(dn) };
  const wins = { [up]: 0, [dn]: 0 }, games = [];
  for (let g = 1; g <= PO_GAMES; g++) {
    if (wins[up] >= PO_WINS || wins[dn] >= PO_WINS) break;
    const home = g === 1 ? dn : up, away = home === up ? dn : up;
    const res = simulateKnockout(sq[home], sq[away], `${seed}|PO|G${g}|${home}|${away}`);
    const winner = res.win === "h" ? home : away;
    wins[winner]++;
    games.push({ g, home, away, res, winner });
  }
  const winner = wins[up] >= PO_WINS ? up : dn;
  return { dpl: up, dcl: dn, names, squads: sq, games, wins, winner, loser: winner === up ? dn : up };
}

/* PO 경기 시간 흐름(경기 분 단위): 정규 90분(+추가시간) → 연장 30분 → 승부차기(킥마다 0.5분) */
export function koTimeline(res) {
  const regEnd = 90 + res.ev.filter((e) => !e.et).reduce((m, e) => Math.max(m, e.add || 0), 0);
  const etEnd = res.et ? regEnd + 30 : regEnd;
  const pkN = res.pens ? res.pens.kicks.length : 0;
  return {
    regEnd, etEnd,
    at: (e) => (e.et ? regEnd + (e.min - 90) : e.min + (e.add || 0)),   // 이벤트가 보이는 경기 분
    kickAt: (i) => etEnd + 1 + i * 0.5,                                 // 승부차기 i번째 킥
    end: res.pens ? etEnd + 1 + pkN * 0.5 + 0.5 : etEnd
  };
}

/* ---------- 승강 → 다음 날 명단 (divisions.json) ---------- */
export function nextDivisions(snap, out) {
  const order = (div) => (out[div] ? finalOrder(out[div]) : divTeams(snap, div).map((t) => t.ouid));
  let D = order("DPL"), L = order("DCL");
  let moves = null;
  const po = out.playoff;
  if (po) {
    const rel = D[D.length - 1], pro = L[0];
    D = [...D.slice(0, -2), po.winner, pro];
    L = [po.loser, rel, ...L.slice(2)];
    moves = { relegated: rel, promoted: pro, playoff: { winner: po.winner, loser: po.loser, dpl: po.dpl, dcl: po.dcl } };
  }
  return { basedOn: snap.date, DPL: D, DCL: L, moves };
}

/* 2부제 이전(한 리그) 회차 → 첫 명단: 최종 순위 상위 14 = DPL, 나머지 + 그날 불참자 = DCL (사용자 결정: 11-05 제16회 기준) */
export function divisionsFromLegacy(snap, day) {
  const ord = finalOrder(day);
  const absent = ((snap.excluded || []).map((x) => x.ouid)).filter((id) => !ord.includes(id)).sort();
  return { basedOn: snap.date, DPL: ord.slice(0, DPL_SIZE), DCL: [...ord.slice(DPL_SIZE), ...absent], moves: null, from: "legacy" };
}

/* ---------- 기록(history.json) 요약 ---------- */
export function summarizePlayoff(po) {
  if (!po) return null;
  return {
    dpl: po.dpl, dcl: po.dcl, names: po.names, winner: po.winner, loser: po.loser, wins: po.wins,
    games: po.games.map(({ g, home, away, res, winner }) => ({
      g, home, away, hg: res.hg, ag: res.ag, ft: res.ft,
      ...(res.et ? { et: res.et } : {}), ...(res.pens ? { pens: { h: res.pens.h, a: res.pens.a } } : {}), win: winner
    }))
  };
}
export function summarizeLeagueDay(snap, out, top = 5) {
  const nd = nextDivisions(snap, out);
  const sum = (div) => {
    if (!out[div]) return null;
    return { teams: out[div].ids.length, ...summarizeDay(out[div], top) };
  };
  return { format: 2, teams: snap.teams.length, DPL: sum("DPL"), DCL: sum("DCL"), playoff: summarizePlayoff(out.playoff), moves: nd.moves, next: { DPL: nd.DPL, DCL: nd.DCL } };
}
