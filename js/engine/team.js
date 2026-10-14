/* ============================================================
   team.js — 팀 id(문자열) → 가상 선수단 18명
   - 시드 = "{teamSeed}|{팀 id}" → 같은 팀은 언제 만들어도 같은 선수 (팀 정체성)
   - 능력치 6종: sht(슈팅) pas(패스) dri(드리블) def(수비) phy(피지컬) spd(스피드)
   - 오버롤 = 포지션별 가중평균, 선발 11명 = 4-4-2 포지션별 오버롤 상위
   - 균형: 선발 평균 오버롤을 72~78 안으로 맞춤 → 누구나 우승 가능
   ============================================================ */
import { makeRng, clamp } from "./rng.js";
import { makeName } from "./names.js";

export const ATTRS = ["sht", "pas", "dri", "def", "phy", "spd"];
export const ATTR_LABEL = { sht: "슈팅", pas: "패스", dri: "드리블", def: "수비", phy: "피지컬", spd: "스피드" };
export const POS_LABEL = { GK: "GK", DF: "DF", MF: "MF", FW: "FW" };

// 선수단 구성 (18명) · 선발 포메이션 4-4-2
const SQUAD = [["GK", 2], ["DF", 6], ["MF", 6], ["FW", 4]];
const LINEUP = { GK: 1, DF: 4, MF: 4, FW: 2 };

// 포지션별 능력치 성향 (기본값 대비 +/-)
const PROFILE = {
  GK: { sht: -30, pas: -8, dri: -25, def: 8, phy: 4, spd: -10 },
  DF: { sht: -14, pas: -4, dri: -8, def: 8, phy: 5, spd: 0 },
  MF: { sht: -2, pas: 7, dri: 4, def: -6, phy: -2, spd: 0 },
  FW: { sht: 8, pas: -4, dri: 4, def: -24, phy: 0, spd: 5 }
};
// 오버롤 가중치 (%) — 포지션마다 중요한 능력치가 다름
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

/* 팀 생성 — id: 팀 식별 문자열(ouid), teamSeed: 리그 시드(예 "DOR6") */
export function buildTeam(id, teamSeed) {
  const rng = makeRng(`${teamSeed}|${id}`);
  const level = 72 + rng.int(7);          // 이 팀의 목표 선발 오버롤 72~78
  const used = new Set();
  const players = [];
  for (const [pos, count] of SQUAD) {
    for (let i = 0; i < count; i++) {
      // 같은 포지션 안에서도 주전·후보 실력 차이를 둠 (앞번호일수록 강함 경향)
      const base = level - 2 + rng.range(-7, 7) - i;
      const attrs = {};
      for (const k of ATTRS) attrs[k] = clamp(base + PROFILE[pos][k] + rng.range(-6, 6), 25, 99);
      players.push({ idx: players.length, name: makeName(rng, used), pos, attrs, ovr: 0 });
    }
  }
  players.forEach((p) => (p.ovr = overall(p.pos, p.attrs)));

  // 선발: 포지션별 오버롤 상위 (동점이면 번호순 — 결정성)
  let starters = pickStarters(players);
  // 균형 보정: 선발 평균 오버롤을 level에 맞추도록 전 선수 능력치를 같은 만큼 이동
  const avg = starters.reduce((s, i) => s + players[i].ovr, 0) / starters.length;
  const shift = Math.round(level - avg);
  if (shift) {
    for (const p of players) {
      for (const k of ATTRS) p.attrs[k] = clamp(p.attrs[k] + shift, 25, 99);
      p.ovr = overall(p.pos, p.attrs);
    }
    starters = pickStarters(players);
  }
  players.forEach((p, i) => (p.num = jerseyNumber(p.pos, i, rng)));

  const team = { id, players, starters, level };
  team.ovr = Math.round(starters.reduce((s, i) => s + players[i].ovr, 0) / starters.length);
  team.att = attackPower(team);
  team.def = defensePower(team);
  return team;
}

function pickStarters(players) {
  const out = [];
  for (const pos of ["GK", "DF", "MF", "FW"]) {
    const cand = players.filter((p) => p.pos === pos).sort((a, b) => b.ovr - a.ovr || a.idx - b.idx);
    for (let i = 0; i < LINEUP[pos]; i++) out.push(cand[i].idx);
  }
  return out;
}

// 등번호 — 표시용 (GK 1·DF 2~5·MF 6~8,10·FW 9,11 우선, 나머지 12~)
const NUMS = { GK: [1, 21], DF: [2, 3, 4, 5, 15, 22], MF: [6, 8, 10, 7, 14, 16], FW: [9, 11, 19, 20] };
function jerseyNumber(pos, i, rng) {
  const before = { GK: 0, DF: 2, MF: 8, FW: 14 }[pos];
  return NUMS[pos][i - before] || 30 + rng.int(60);
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
