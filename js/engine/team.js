/* ============================================================
   team.js — 팀 id(문자열) → 선수단 18명
   - 시드 = "{teamSeed}|{팀 id}" → 같은 팀은 언제 만들어도 같은 능력치 (팀 정체성)
   - 선수 명단(roster)을 주면 그 이름·세부 포지션·선발 11명을 그대로 사용 (v2: 클럽원 실제 스쿼드)
     없으면 가상 이름 + 4-4-2 (v1 방식)
   - 능력치 6종: sht(슈팅) pas(패스) dri(드리블) def(수비) phy(피지컬) spd(스피드)
     ※ 실제 게임 능력치·강화 등급은 반영하지 않음(사용자 결정) — 시드 랜덤 + 팀 균형
   - 균형: 선발 평균 오버롤을 72~78 안으로 맞춤 → 누구나 우승 가능
   ============================================================ */
import { makeRng, clamp } from "./rng.js";
import { makeName } from "./names.js";

export const ATTRS = ["sht", "pas", "dri", "def", "phy", "spd"];
export const ATTR_LABEL = { sht: "슈팅", pas: "패스", dri: "드리블", def: "수비", phy: "피지컬", spd: "스피드" };

/* 세부 포지션(role) → 4그룹. SUB = 교체 명단(실제 포지션 정보 없음, 경기에 나서지 않음) */
export const ROLE_GROUP = {
  GK: "GK",
  SW: "DF", RWB: "DF", RB: "DF", RCB: "DF", CB: "DF", LCB: "DF", LB: "DF", LWB: "DF",
  RDM: "MF", CDM: "MF", LDM: "MF", RM: "MF", RCM: "MF", CM: "MF", LCM: "MF", LM: "MF", RAM: "MF", CAM: "MF", LAM: "MF",
  RF: "FW", CF: "FW", LF: "FW", RW: "FW", RS: "FW", ST: "FW", LS: "FW", LW: "FW",
  SUB: "SUB"
};
/* 포메이션 줄 (표시용): 수비 · 수비형 · 중앙 · 공격형 · 공격 */
const ROLE_LINE = { DF: 0, RDM: 1, CDM: 1, LDM: 1, RM: 2, RCM: 2, CM: 2, LCM: 2, LM: 2, RAM: 3, CAM: 3, LAM: 3, FW: 4 };

// 가상 선수단(명단 없을 때): 그룹별 인원과 세부 포지션 (앞에서부터 주전 후보)
const VIRTUAL = [
  ["GK", ["GK", "GK"]],
  ["DF", ["RB", "RCB", "LCB", "LB", "CB", "RB"]],
  ["MF", ["RM", "RCM", "LCM", "LM", "CDM", "CAM"]],
  ["FW", ["RS", "LS", "ST", "CF"]]
];
const LINEUP = { GK: 1, DF: 4, MF: 4, FW: 2 };

// 그룹별 능력치 성향 (기본값 대비 +/-)
const PROFILE = {
  GK: { sht: -30, pas: -8, dri: -25, def: 8, phy: 4, spd: -10 },
  DF: { sht: -14, pas: -4, dri: -8, def: 8, phy: 5, spd: 0 },
  MF: { sht: -2, pas: 7, dri: 4, def: -6, phy: -2, spd: 0 },
  FW: { sht: 8, pas: -4, dri: 4, def: -24, phy: 0, spd: 5 }
};
// 오버롤 가중치 (%) — 그룹마다 중요한 능력치가 다름
const OVR_W = {
  GK: { sht: 0, pas: 10, dri: 0, def: 55, phy: 25, spd: 10 },
  DF: { sht: 0, pas: 15, dri: 0, def: 45, phy: 25, spd: 15 },
  MF: { sht: 15, pas: 35, dri: 20, def: 15, phy: 0, spd: 15 },
  FW: { sht: 45, pas: 0, dri: 20, def: 0, phy: 15, spd: 20 }
};

export function overall(pos, a) {
  const w = OVR_W[pos];
  let s = 0;
  for (const k of ATTRS) s += a[k] * w[k];
  return Math.round(s / 100);
}

/* 선발 포메이션 문자열 (예: "4-2-3-1") */
export function formationOf(team) {
  const lines = [0, 0, 0, 0, 0];
  for (const i of team.starters) {
    const p = team.players[i];
    if (p.pos === "GK") continue;
    lines[ROLE_LINE[p.pos === "DF" ? "DF" : p.pos === "FW" ? "FW" : p.role] ?? 2]++;
  }
  return lines.filter((n) => n > 0).join("-");
}

/* 팀 생성
   id: 팀 식별 문자열(ouid), teamSeed: 리그 시드(예 "DOR6")
   roster(선택): [{ name, role, starter }] 18명 — 실제 스쿼드. 선발은 정확히 11명·GK 1명이어야 사용, 아니면 가상 */
export function buildTeam(id, teamSeed, roster) {
  const rng = makeRng(`${teamSeed}|${id}`);
  const level = 72 + rng.int(7);          // 이 팀의 목표 선발 오버롤 72~78
  const real = validRoster(roster);
  const used = new Set();
  const players = [];
  const plan = real
    ? roster.map((r) => [ROLE_GROUP[r.role] || "SUB", r.role in ROLE_GROUP ? r.role : "SUB", r])
    : VIRTUAL.flatMap(([g, roles]) => roles.map((role) => [g, role, null]));
  const nth = {};
  for (const [group, role, r] of plan) {
    const g = group === "SUB" ? "MF" : group;            // 교체 선수 능력치는 미드필더 성향으로 생성(경기엔 안 나옴)
    const i = (nth[g] = (nth[g] || 0) + 1) - 1;
    // 앞번호일수록 강함 경향 (실제 명단은 선발이 먼저라 선발이 대체로 강함)
    const base = level - 2 + rng.range(-7, 7) - (real ? (r.starter ? 0 : 3) : i);
    const attrs = {};
    for (const k of ATTRS) attrs[k] = clamp(base + PROFILE[g][k] + rng.range(-6, 6), 25, 99);
    // 이름: 실제 명단이면 그 이름(없으면 "선수N"), 가상이면 생성 — 실제 명단일 땐 rng를 쓰지 않음(이름 유무와 무관하게 결과 동일)
    const name = real ? (r.name || `선수${players.length + 1}`) : makeName(rng, used);
    players.push({ idx: players.length, name, pos: g, role, sub: group === "SUB", attrs, ovr: 0, starter: real ? !!r.starter : false });
  }
  players.forEach((p) => (p.ovr = overall(p.pos, p.attrs)));

  const pick = () => (real ? players.filter((p) => p.starter).map((p) => p.idx) : pickStarters(players));
  let starters = pick();
  // 균형 보정: 선발 평균 오버롤을 level에 맞추도록 전 선수 능력치를 같은 만큼 이동
  const avg = starters.reduce((s, i) => s + players[i].ovr, 0) / starters.length;
  const shift = Math.round(level - avg);
  if (shift) {
    for (const p of players) {
      for (const k of ATTRS) p.attrs[k] = clamp(p.attrs[k] + shift, 25, 99);
      p.ovr = overall(p.pos, p.attrs);
    }
    starters = pick();
  }
  if (!real) players.forEach((p, i) => (p.num = jerseyNumber(p.pos, i, rng)));
  else players.forEach((p, i) => (p.num = i + 1));

  const team = { id, players, starters, level, real };
  team.ovr = Math.round(starters.reduce((s, i) => s + players[i].ovr, 0) / starters.length);
  team.att = attackPower(team);
  team.def = defensePower(team);
  return team;
}

function validRoster(roster) {
  if (!Array.isArray(roster) || roster.length < 11) return false;
  const st = roster.filter((r) => r.starter);
  return st.length === 11 && st.filter((r) => r.role === "GK").length === 1 && st.every((r) => ROLE_GROUP[r.role] && r.role !== "SUB");
}

function pickStarters(players) {
  const out = [];
  for (const pos of ["GK", "DF", "MF", "FW"]) {
    const cand = players.filter((p) => p.pos === pos).sort((a, b) => b.ovr - a.ovr || a.idx - b.idx);
    for (let i = 0; i < LINEUP[pos]; i++) out.push(cand[i].idx);
  }
  return out;
}

// 등번호 — 가상 선수단 표시용 (GK 1·DF 2~5·MF 6~8,10·FW 9,11 우선, 나머지 30~)
const NUMS = { GK: [1, 21], DF: [2, 3, 4, 5, 15, 22], MF: [6, 8, 10, 7, 14, 16], FW: [9, 11, 19, 20] };
function jerseyNumber(pos, i, rng) {
  const before = { GK: 0, DF: 2, MF: 8, FW: 14 }[pos];
  return NUMS[pos][i - before] || 30 + rng.int(60);
}

/* 팀 전력 (커리어 시뮬레이터가 직접 만든 팀 객체에 att·def를 붙일 때 사용, 결과 무관 export) */
export function teamPower(team) {
  return { att: attackPower(team), def: defensePower(team) };
}

/* 공격력: 선발 FW·MF(·DF 조금)의 공격 능력치 가중 평균 */
function attackPower(team) {
  const W = { GK: 0, DF: 0.5, MF: 2, FW: 3 };
  let s = 0, w = 0;
  for (const i of team.starters) {
    const p = team.players[i], a = p.attrs;
    const v = (a.sht * 40 + a.dri * 25 + a.spd * 20 + a.pas * 15) / 100;
    s += v * W[p.pos]; w += W[p.pos];
  }
  return s / w;
}
/* 수비력: 선발 GK·DF·MF의 수비 능력치 가중 평균 */
function defensePower(team) {
  const W = { GK: 3, DF: 3, MF: 1.5, FW: 0 };
  let s = 0, w = 0;
  for (const i of team.starters) {
    const p = team.players[i], a = p.attrs;
    const v = (a.def * 60 + a.phy * 25 + a.spd * 15) / 100;
    s += v * W[p.pos]; w += W[p.pos];
  }
  return s / w;
}
