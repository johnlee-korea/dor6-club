/* ============================================================
   league/career-link.js — ⭐ 내 선수 키우기 → 도륙리그 연동 (v2.24.0, CLAUDE.md 25-21)
   - 클럽원의 '역대 최고 OVR 커리어 선수' 1명이 그 클럽원 리그 팀 선발로 입단
   - 포지션·OVR 구간별 전력 보너스: 공격수·윙어·공미 → 팀 공격력 / 수미·수비수 → 팀 수비력(×1.1 — 실측 승점 효과를 맞춤)
   - 개최일 06:40 스냅샷에 star·boostAtt·boostDef로 얼려 둠 → 이후 커리어 진행은 다음 리그부터
   - 순수 함수 — Worker(편성·검사)·커리어 화면(미리보기)·리그 화면·테스트 공용
   ============================================================ */

export const CAREER_POS = ["ST", "WG", "AM", "DM", "CB", "FB"];
export const ATTACK_POS = new Set(["ST", "WG", "AM"]);

/* OVR 구간 → 공격 기준 보너스 (0.001 단위). 수비 포지션은 ×1.1
   시뮬레이션(실제 스냅샷 10회 × 300): 같은 크기면 득실 효과 동일, 승점은 공격이 약 10% 커서 수비에 1.1배 */
export const STAR_TIERS = [[95, 800], [90, 500], [85, 250], [80, 100]];
export const DEF_MUL = 1.1;

/* 커리어 포지션 → 같은 자리로 볼 엔진 세부 포지션 (앞이 우선), 없으면 FALLBACK 순서로 가까운 자리 */
const SLOT_ROLES = {
  ST: ["ST", "CF", "RS", "LS", "RF", "LF"],
  WG: ["RW", "LW", "RM", "LM"],
  AM: ["CAM", "RAM", "LAM"],
  DM: ["CDM", "RDM", "LDM"],
  CB: ["CB", "RCB", "LCB", "SW"],
  FB: ["RB", "LB", "RWB", "LWB"]
};
const FALLBACK = {
  ST: ["ST", "WG", "AM"], WG: ["WG", "ST", "AM"], AM: ["AM", "WG", "ST", "DM"],
  DM: ["DM", "AM", "CB"], CB: ["CB", "DM", "FB"], FB: ["FB", "CB", "WG"]
};
const MID_ROLES = ["CM", "RCM", "LCM"];   // 중앙 미드는 AM·DM 어느 쪽이 없을 때 대체 자리

export function starBoost(star) {
  if (!star) return { boostAtt: 0, boostDef: 0 };
  const tier = STAR_TIERS.find(([min]) => star.ovr >= min);
  const v = tier ? tier[1] : 0;
  return ATTACK_POS.has(star.pos) ? { boostAtt: v, boostDef: 0 } : { boostAtt: 0, boostDef: Math.round(v * DEF_MUL) };
}

/* 화면 문구: "공격력 +0.5" */
export function starBoostText(star) {
  const b = starBoost(star);
  if (b.boostAtt) return `공격력 +${b.boostAtt / 1000}`;
  if (b.boostDef) return `수비력 +${b.boostDef / 1000}`;
  return "보너스 없음 (OVR 80부터)";
}

/* 커리어 쪽 정합성 검사 — 조작 의심 값은 거절 (Worker /career/sync)
   근거: 시작 OVR 46~55 · 시즌당 OVR 상승은 최선 육성 + 이벤트 대폭에도 약 +6 이내 */
export function validStar(star, seasons) {
  if (!star || typeof star !== "object") return "선수 정보가 없어요";
  if (!CAREER_POS.includes(star.pos)) return "포지션이 올바르지 않아요";
  if (!Number.isInteger(star.ovr) || star.ovr < 40 || star.ovr > 99) return "OVR 값이 올바르지 않아요";
  if (typeof star.name !== "string" || !star.name.trim() || star.name.length > 12) return "이름이 올바르지 않아요";
  if (!Number.isInteger(star.seasons) || star.seasons < 0 || star.seasons > 25) return "시즌 수가 올바르지 않아요";
  if (star.ovr > 56 + 6 * star.seasons) return `${star.seasons}시즌 만에 OVR ${star.ovr}까지 오를 수 없어요`;
  if (!Number.isInteger(seasons) || seasons < star.seasons) return "기기 시즌 수가 올바르지 않아요";
  return null;
}

/* 여러 기기 중 반영할 기기: 총 시즌 수 최다(동률이면 최근 전송) — 관리자가 막은 기기는 제외 */
export function pickDevice(rec) {
  if (!rec || !rec.devices) return null;
  const blocked = new Set(rec.blocked || []);
  let best = null;
  for (const [id, d] of Object.entries(rec.devices)) {
    if (blocked.has(id) || !d || !d.star) continue;
    if (!best || d.seasons > best.seasons || (d.seasons === best.seasons && d.at > best.at)) best = { id, ...d };
  }
  return best;
}

/* 엔진 roster에서 커리어 선수가 들어갈 선발 자리 인덱스 (없으면 -1) */
export function starSlot(roster, pos) {
  if (!Array.isArray(roster)) return -1;
  const starters = roster.map((p, i) => [p, i]).filter(([p]) => p.starter && p.role !== "GK");
  for (const g of FALLBACK[pos] || [pos]) {
    const hit = starters.find(([p]) => SLOT_ROLES[g].includes(p.role));
    if (hit) return hit[1];
    if ((g === "AM" || g === "DM")) { const mid = starters.find(([p]) => MID_ROLES.includes(p.role)); if (mid) return mid[1]; }
  }
  return starters.length ? starters[starters.length - 1][1] : -1;
}

/* roster에 커리어 선수 입단 — 그 자리 선수 이름을 "⭐이름"으로 바꿈 (세부 포지션·선발 여부는 그대로 → 엔진 계산 동일) */
export function applyStar(roster, star) {
  if (!star || !Array.isArray(roster)) return roster;
  const i = starSlot(roster, star.pos);
  if (i < 0) return roster;
  const out = roster.slice();
  out[i] = { ...out[i], name: "⭐" + star.name, career: true };
  return out;
}
