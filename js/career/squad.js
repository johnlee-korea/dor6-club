/* ============================================================
   career/squad.js — 구단 가상 선수단(24명) · 역할 판정 · 엔진 팀 객체 (CLAUDE.md 26-7-4·26-11)
   AI 선수는 (구단 id · 시즌) 시드로 매 시즌 다시 만든다 (1차는 개별 AI 선수 커리어를 추적하지 않음)
   ============================================================ */
import { makeRng } from "../engine/rng.js";
import { teamPower } from "../engine/team.js";
import { CATS, POSITIONS, SLOTS, ENGINE_ROLES, ENGINE_GROUP, W, ROLE, MATCH, PREF_BONUS, clamp } from "./rules.js";
import { makePersonName } from "./names.js";
import { leagueOf } from "./world.js";

/* AI 선수 능력치 성향: 포지션 가중치가 큰 대분류일수록 높게, 가중 평균이 OVR과 같아지도록 보정 */
const PROFILE = (() => {
  const out = {};
  for (const pos of POSITIONS) {
    const off = {};
    let mean = 0;
    for (const c of CATS) { off[c] = (W[pos][c] - 100 / 6) * 0.5; mean += W[pos][c] * off[c] / 100; }
    for (const c of CATS) off[c] -= mean;
    out[pos] = off;
  }
  out.GK = { spd: -8, sht: -30, pas: -6, dri: -22, def: 10, phy: 6 };
  return out;
})();
const attrsFor = (pos, ovr) => {
  const a = {};
  for (const c of CATS) a[c] = clamp(Math.round(ovr + PROFILE[pos][c]), 20, 99);
  return a;
};

/* 구단 선수단: GK 2 + 포지션별 [주전 슬롯수 · 로테이션 1 · 후보 1] */
export function aiSquad(world, clubId, seed) {
  const c = world.clubs[clubId];
  const R = c.R;
  const country = leagueOf(c.league).country;
  const rng = makeRng(`${seed}|S${world.season}|squad|${clubId}`);
  const used = new Set();
  const players = [];
  const add = (cpos, ovr, tier, role) => {
    players.push({ idx: players.length, name: makePersonName(rng, country, used), cpos, pos: cpos === "GK" ? "GK" : ENGINE_GROUP[cpos],
                   role, ovr, tier, attrs: attrsFor(cpos, ovr) });
  };
  add("GK", R + 4, "S", "GK");
  add("GK", R - 3, "B", "GK");
  const v = {};
  for (const pos of POSITIONS) {
    v[pos] = c.short.includes(pos) ? -1 : rng.range(-1, 1);
    const roles = ENGINE_ROLES[pos];
    add(pos, R + ROLE.starterGap[1] + v[pos], "S", roles[0]);
    if (SLOTS[pos] === 2) add(pos, R + ROLE.starterGap[2] + v[pos], "S", roles[1]);
    add(pos, R + ROLE.rotGap + v[pos], "R", roles[roles.length - 1]);
    add(pos, R + ROLE.backupGap + v[pos], "B", roles[roles.length - 1]);
  }
  return { id: clubId, R, players, v };
}

/* 역할 판정: 역할 점수 ≥ 가장 약한 주전 → 주전 / ≥ 로테이션 선수 → 로테이션 / 그 외 후보 (동점은 내 선수 우선) */
export function roleFor(squad, cpos, score) {
  const same = squad.players.filter((p) => p.cpos === cpos);
  const st = Math.min(...same.filter((p) => p.tier === "S").map((p) => p.ovr));
  const rot = same.find((p) => p.tier === "R").ovr;
  return score >= st ? "S" : score >= rot ? "R" : "B";
}
/* 역할 점수 = 포지션 OVR + 선호 유형 보너스 + 감독 신뢰도 */
export const roleScore = (ovr, pref, trust) => ovr + (pref === "full" ? PREF_BONUS.full : pref === "partial" ? PREF_BONUS.partial : 0) + trust;

/* 기본 선발 11 (AI만): GK 주전 + 포지션별 주전 */
export function defaultLineup(squad) {
  return squad.players.filter((p) => p.tier === "S").map((p) => p.idx);
}

/* 득점·도움 배율·평점 보정을 AI 선수에게 부여 (팀 선발 평균 대비) */
export function decorate(squad) {
  const st = squad.players.filter((p) => p.tier === "S" && p.cpos !== "GK");
  const avg = st.reduce((s, p) => s + p.ovr, 0) / st.length;
  for (const p of squad.players) {
    if (p.cpos === "GK") continue;
    p.sw = clamp(1 + MATCH.swK * (p.attrs.sht - squad.R), MATCH.swMin, MATCH.swMax);
    p.aw = clamp(1 + MATCH.swK * (p.attrs.pas - squad.R), MATCH.swMin, MATCH.swMax);
    p.rb = clamp(Math.round(MATCH.rbK * (p.ovr - avg)), -MATCH.rbCap, MATCH.rbCap);
  }
  squad.avgOvr = avg;
  return squad;
}

/* 엔진 팀 객체: { id, players, starters, att, def, subs? } */
export function engineTeam(id, players, starters, subs) {
  const team = { id, players, starters };
  if (subs && subs.length) team.subs = subs;
  const pw = teamPower(team);
  team.att = pw.att + MATCH.powerShift;
  team.def = pw.def;
  return team;
}
