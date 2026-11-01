/* ============================================================
   career/costume.js — 👕 선수 외모 · 코스튬 구매·착용 · 장비 보정 (CLAUDE.md 30장, DOM 없음)
   - 아이템 id = "<부위>-<대분류>-<등급>" (예 boots-spd-2). 정의·가격·효과는 rules.js COSTUME 단일 소스
   - 장비 보정은 '경기 OVR'(경기 엔진 입력 = 득점·도움 가중·평점 보정, 시즌 목표)에만 쓴다.
     역할 판정·성장·노화·수준 둔화·훈련 가격·영입 범위·유형 재판정·업적·명예의 전당 OVR은 맨몸 그대로
     (역할 판정에 넣으면 주전 기회 → 성장으로 복리처럼 커짐: 보통 정책 27세 빅클럽 주전 11.7% → 45%, 검수 실측)
   - 결정론: 장비는 저장 상태의 일부 → 같은 저장 + 같은 선택이면 같은 결과. 코스튬이 없으면 이전과 완전히 같은 계산
   ============================================================ */
import { makeRng } from "../engine/rng.js";
import { COSTUME, CATS, W, round1 } from "./rules.js";
import { catValues } from "./attrs.js";

export const SLOTS = COSTUME.slots.map(([k]) => k);
export const SLOT_CATS = Object.fromEntries(COSTUME.slots);
export const SLOT_LABEL = { boots: "👟 축구화", socks: "🧦 스타킹", top: "👕 유니폼 상의", shorts: "🩳 하의", gloves: "🧤 장갑", glasses: "🕶 안경", ball: "⚽ 축구공" };
export const GRADE_LABEL = [null, "일반", "고급", "한정판"];
const GRADE_PREFIX = [null, "베이직", "프로", "✨ 리미티드"];
/* 가상 이름 (실존 브랜드 금지 — 26-7-3) */
const BASE_NAME = {
  boots: { spd: "윈드러너", sht: "캐논부트", dri: "실크터치" },
  socks: { phy: "아이언삭스" },
  top: { dri: "플렉스 저지", pas: "비전 저지" },
  shorts: { spd: "에어 쇼츠" },
  gloves: { def: "가디언 글러브" },
  glasses: { pas: "호크아이 고글" },
  ball: { sht: "스트라이커 볼", pas: "메트로놈 볼", dri: "매직터치 볼" }
};

/* ---------- 외모 ---------- */
export const SKINS = ["#f6d7c3", "#e8b896", "#c98e65", "#9a6644", "#6b4429"];
export const HAIRS = ["short", "twoblock", "long", "curly", "buzz", "ponytail", "mohawk", "bald"];
export const HAIR_LABEL = { short: "짧은 머리", twoblock: "투블록", long: "장발", curly: "곱슬", buzz: "삭발", ponytail: "포니테일", mohawk: "모히칸", bald: "민머리" };
export const HAIR_COLORS = ["#1d1a18", "#4a3020", "#8a5a2b", "#d9b25f", "#b8b8b8", "#c0392b"];
export const POS_NUMBER = { ST: 9, WG: 7, AM: 10, DM: 6, CB: 4, FB: 2 };

export function randomLook(rng, pos) {
  return { skin: rng.int(SKINS.length), hair: HAIRS[rng.int(HAIRS.length)], hairColor: rng.int(HAIR_COLORS.length), number: POS_NUMBER[pos] || 8 };
}
export function cleanLook(look, pos) {
  const l = look || {};
  const n = Math.round(+l.number);
  return {
    skin: Number.isInteger(l.skin) && l.skin >= 0 && l.skin < SKINS.length ? l.skin : 1,
    hair: HAIRS.includes(l.hair) ? l.hair : "short",
    hairColor: Number.isInteger(l.hairColor) && l.hairColor >= 0 && l.hairColor < HAIR_COLORS.length ? l.hairColor : 0,
    number: n >= 1 && n <= 99 ? n : POS_NUMBER[pos] || 8
  };
}

/* 예전 저장분(코스튬 도입 전)에도 외모·옷장을 채움 — 외모는 커리어 시드로 고정 */
export function ensureCostume(state) {
  if (!state || !state.player) return state;
  const p = state.player;
  if (!p.look) p.look = randomLook(makeRng(state.seed + "|look"), p.pos);
  if (!Array.isArray(p.wardrobe)) p.wardrobe = [];
  if (!p.equip) p.equip = {};
  return state;
}

/* ---------- 아이템 ---------- */
export function parseItem(id) {
  const m = /^([a-z]+)-([a-z]{3})-([1-3])$/.exec(id || "");
  if (!m || !SLOT_CATS[m[1]] || !SLOT_CATS[m[1]].includes(m[2])) return null;
  const grade = +m[3];
  return { id, slot: m[1], cat: m[2], grade, amt: COSTUME.grades[grade].amt, price: COSTUME.grades[grade].price };
}
export const itemName = (it) => `${GRADE_PREFIX[it.grade]} ${BASE_NAME[it.slot][it.cat]}`;
export function slotItems(slot) {
  const out = [];
  for (const cat of SLOT_CATS[slot]) for (let g = 1; g <= 3; g++) out.push(parseItem(`${slot}-${cat}-${g}`));
  return out;
}

/* 착용 장비의 대분류 보정 { cat: + } */
export function equipBonus(player) {
  const b = {};
  for (const c of CATS) b[c] = 0;
  const eq = (player && player.equip) || {};
  for (const slot of SLOTS) {
    const it = parseItem(eq[slot]);
    if (it && it.slot === slot) b[it.cat] = round1(b[it.cat] + it.amt);
  }
  return b;
}
/* 장비 보정 OVR (소수) = Σ 포지션 가중치 × 대분류 보정 (99 상한 고려) */
export function gearDelta(player, pos) {
  if (!player || !player.equip) return 0;
  const b = equipBonus(player);
  const cv = catValues(player.subs);
  let s = 0;
  for (const c of CATS) if (b[c] && W[pos || player.pos][c]) s += W[pos || player.pos][c] * Math.max(0, Math.min(b[c], 99 - cv[c]));
  return s / 100;
}

/* ---------- 구매 · 착용 (오프시즌) ---------- */
export const costumeUsed = (state) => !!(state.off && state.off.costumeUsed);
export function canBuy(state, id) {
  const it = parseItem(id);
  const p = state.player;
  if (!it) return { ok: false, reason: "없는 아이템이에요" };
  if (!state.off) return { ok: false, reason: "오프시즌에만 살 수 있어요" };
  if (state.off.costumeUsed) return { ok: false, reason: "코스튬은 시즌당 1개만 살 수 있어요" };
  if ((p.wardrobe || []).includes(id)) return { ok: false, reason: "이미 가지고 있어요" };
  if (p.money < it.price) return { ok: false, reason: "자금이 부족해요" };
  return { ok: true, item: it };
}
export function buyCostume(state, id) {
  ensureCostume(state);
  const chk = canBuy(state, id);
  if (!chk.ok) return chk;
  const p = state.player, it = chk.item;
  const before = gearDelta(p);
  p.money = round1(p.money - it.price);
  p.wardrobe.push(id);
  p.equip[it.slot] = id;                 // 사면 바로 착용
  state.off.costumeUsed = id;
  return { ok: true, item: it, price: it.price, gearBefore: before, gearAfter: gearDelta(p) };
}
/* 갈아입기 (무료, 횟수 제한 없음) — id가 null이면 그 부위 벗기 */
export function equipItem(state, slot, id) {
  ensureCostume(state);
  const p = state.player;
  if (!SLOTS.includes(slot)) return false;
  if (id === null) { delete p.equip[slot]; return true; }
  const it = parseItem(id);
  if (!it || it.slot !== slot || !p.wardrobe.includes(id)) return false;
  p.equip[slot] = id;
  return true;
}

/* 업적용: 착용 부위 수 · 한정판 착용 부위 수 */
export function equipStats(player) {
  let worn = 0, limited = 0;
  for (const slot of SLOTS) {
    const it = parseItem(player && player.equip && player.equip[slot]);
    if (it) { worn++; if (it.grade === 3) limited++; }
  }
  return { worn, limited };
}
