/* ============================================================
   career/rules.js — 커리어 시뮬레이터 계수 단일 소스 (CLAUDE.md 26장 표와 1:1)
   ★ 숫자를 바꾸면 CLAUDE.md 26장 표도 함께 고칠 것
   ★ scripts/career/growth-sim.js · balance-test.js도 이 파일을 import
   ★ 결정론: 초월함수·Math.random 금지 (저장 파일을 다른 기기로 옮겨도 같은 결과) — 사칙연산·비교만
   ============================================================ */

/* ---------- 대분류 6 · 세부 29 (26-3) ---------- */
export const CATS = ["spd", "sht", "pas", "dri", "def", "phy"];
export const CAT_LABEL = { spd: "스피드", sht: "슛", pas: "패스", dri: "드리블", def: "수비", phy: "피지컬" };
export const CAT_ICON = { spd: "⚡", sht: "🎯", pas: "🎼", dri: "🌀", def: "🛡", phy: "💪" };
export const SUBS = {
  spd: [["spd", "속력"], ["acc", "가속력"]],
  sht: [["fin", "골 결정력"], ["spw", "슛 파워"], ["lsh", "중거리 슛"], ["pos", "위치 선정"], ["vol", "발리슛"], ["pen", "페널티 킥"]],
  pas: [["spa", "짧은 패스"], ["vis", "시야"], ["crs", "크로스"], ["lpa", "긴 패스"], ["fk", "프리킥"], ["cur", "커브"]],
  dri: [["dri", "드리블"], ["bc", "볼 컨트롤"], ["agi", "민첩성"], ["bal", "밸런스"], ["rea", "반응 속도"], ["com", "침착성"]],
  def: [["mar", "대인 수비"], ["tac", "태클"], ["int", "가로채기"], ["hea", "헤더"], ["sli", "슬라이딩 태클"]],
  phy: [["str", "몸싸움"], ["sta", "스태미너"], ["agg", "적극성"], ["jum", "점프"]]
};
// 세부 키는 대분류 사이에 겹치는 이름이 있어(spd·dri) 저장 시 "대분류.세부"로 구분
export const SUB_KEYS = CATS.flatMap((c) => SUBS[c].map(([k]) => `${c}.${k}`));

/* ---------- 포지션 (26-3) ---------- */
export const POSITIONS = ["ST", "WG", "AM", "DM", "CB", "FB"];
export const POS_LABEL = { ST: "스트라이커", WG: "윙어", AM: "공격형 미드필더", DM: "수비형 미드필더", CB: "센터백", FB: "풀백" };
export const POS_SHORT = { ST: "ST", WG: "WG", AM: "AM", DM: "DM", CB: "CB", FB: "FB" };
export const SLOTS = { ST: 1, WG: 2, AM: 1, DM: 2, CB: 2, FB: 2 };
// 엔진 세부 포지션 (4-2-3-1) — 슬롯 순서대로
export const ENGINE_ROLES = { ST: ["ST"], WG: ["RW", "LW"], AM: ["CAM"], DM: ["RDM", "LDM"], CB: ["RCB", "LCB"], FB: ["RB", "LB"] };
export const ENGINE_GROUP = { ST: "FW", WG: "FW", AM: "MF", DM: "MF", CB: "DF", FB: "DF" };
// 포지션 OVR 대분류 가중치(%) — 핵심 1 + 준핵심 3(3·4위 차이 1.3배 이내) + 보조 1, 무관 0
export const W = {
  ST: { sht: 40, spd: 21, dri: 18, phy: 16, pas: 5, def: 0 },
  WG: { spd: 31, dri: 29, pas: 19, sht: 16, phy: 5, def: 0 },
  AM: { pas: 33, dri: 27, sht: 19, spd: 16, phy: 5, def: 0 },
  DM: { def: 34, pas: 28, phy: 18, dri: 15, spd: 5, sht: 0 },
  CB: { def: 40, phy: 24, spd: 16, pas: 15, dri: 5, sht: 0 },
  FB: { spd: 31, def: 29, pas: 19, phy: 16, dri: 5, sht: 0 }
};
// 포지션 핵심 세부 (×2)
export const KEY_SUBS = {
  ST: ["sht.fin", "sht.pos", "sht.spw", "spd.acc", "dri.bc", "phy.str"],
  WG: ["spd.spd", "spd.acc", "dri.dri", "dri.agi", "pas.crs", "sht.fin"],
  AM: ["pas.vis", "pas.spa", "dri.bc", "dri.dri", "sht.lsh", "dri.com"],
  DM: ["def.int", "def.tac", "def.mar", "pas.spa", "pas.lpa", "phy.sta"],
  CB: ["def.mar", "def.tac", "def.hea", "phy.str", "phy.jum", "spd.spd"],
  FB: ["spd.spd", "spd.acc", "def.mar", "def.tac", "pas.crs", "phy.sta"]
};
export const STAR_SHARE = 52;     // 강점 2개 가중치 합 ≥ 52% → ★추천 조합
// 포지션 전환: 인접만 (26-7-5)
export const ADJACENT = { ST: ["WG", "AM"], WG: ["ST", "AM", "FB"], AM: ["ST", "WG", "DM"], DM: ["AM", "CB"], CB: ["DM", "FB"], FB: ["CB", "WG"] };
export const MAX_CONVERSIONS = 2, CONVERT_PENALTY = 3;

/* ---------- 시작 능력치 (26-5) ---------- */
export const START = { age: 16, total: 300, strongMin: 57, strongMax: 59, ratio: 1.3, subSpread: 5 };

/* ---------- 성장 (26-6) ---------- */
export const GROWTH = {
  baseFocus: 4, baseRest: 1.2,
  G: { 16: 1, 17: 1, 18: 1, 19: 1, 20: 0.95, 21: 0.88, 22: 0.78, 23: 0.64, 24: 0.56, 25: 0.6, 26: 0.66,
       27: 0.58, 28: 0.4, 29: 0.3, 30: 0.2, 31: 0.12 },
  // 노화 [집중, 미집중]
  D: { 31: [0, -0.6], 32: [-2, -3], 33: [-3, -4.2], 34: [-3, -4.2], 35: [-3, -4.2],
       36: [-3.2, -4.4], 37: [-3.4, -4.6], 38: [-3.6, -4.8], 39: [-3.8, -5], 40: [-4, -5.2] },
  L: [[0, 1], [60, 1], [75, 0.9], [80, 0.8], [85, 0.6], [90, 0.35], [99, 0.15]],
  playFloor: 0.25, youthBench: 0.5, youthAge: 18,
  coach: 1.3, spill: true
};
export const stageCoef = (gap) => (gap <= 0 ? 1.1 : gap <= 5 ? 1 : gap <= 9 ? 0.85 : gap <= 14 ? 0.7 : 0.5);
export const rateCoef = (avg) => clamp(1 + (avg - 6.6) / 6, 0.9, 1.1);
export const ageCoef = (age) => GROWTH.G[age] || 0;
export const agingOf = (age) => GROWTH.D[age] || (age > 40 ? GROWTH.D[40] : [0, 0]);
export const levelCoef = (ovr) => lerp(GROWTH.L, ovr)[0];
export const playCoef = (ratio) => GROWTH.playFloor + (1 - GROWTH.playFloor) * ratio;

/* ---------- 레전드·슬럼프 (26-6) ---------- */
export const LEGEND = { minAge: 25, startShare: 0.75, posRankTop: 3, needTitle: true, noRepeat: true, extra: 2, lateAge: 32, lateDeclineScale: 0.5 };
export const SLUMP = { trustLoss: 2, offerCut: [1, 2], below: 0.35, revive: 0.2 };

/* ---------- 역할·출전 (26-7-4) ---------- */
export const ROLE = {
  starterGap: { 1: 5, 2: 3 }, rotGap: -1, backupGap: -4,
  prob: { S: [0.9, 0.7], R: [0.4, 0.45], B: [0.08, 0.3] },     // [선발, 선발 아니면 교체]
  shortageBonus: 0.1, formBonus: 0.05, bonusCap: 0.15, maxStart: 0.97,
  subMin: [55, 85]
};
export const ROLE_LABEL = { S: "주전", R: "로테이션", B: "후보" };
export const TRUST_MIN = -3, TRUST_MAX = 3;
export const PREF_BONUS = { full: 3, partial: 1 };   // 역할 점수 보너스(능력치 보너스는 +2 / +1)
// 잘한 시즌 뒤 원 소속 감독이 선호 유형을 내 유형으로 바꾸는 조건 (목표 달성 + 팀 평균 대비 평점 차 ≥ minVsTeam)
export const PREF_ADOPT = { minVsTeam: 0 };

/* ---------- 영입·임대 (26-7-5) ---------- */
export const MARKET = {
  offerMargin: 3, youthMargin: { 16: 7, 17: 5, 18: 3 },
  maxOffers: 5, starterPool: 6, starterRange: 15,
  loanMaxAge: 24, loanCount: 3, loanReturnRating: 6.9
};
export const entryMargin = (age) => MARKET.offerMargin + (MARKET.youthMargin[age] || 0);

/* ---------- 경제 (26-8, 단위 만 €) ---------- */
export const SALARY = [[45, 3], [50, 4], [55, 8], [60, 18], [65, 40], [70, 90], [75, 220], [80, 600], [84, 1300], [90, 2000]];
export const SALARY_ROLE = { S: 1, R: 0.7, B: 0.5 };
export const salaryAge = (a) => (a <= 18 ? 0.3 : a <= 20 ? 0.6 : a >= 33 ? 0.8 : 1);
export const salaryOf = (R, role, age) => round1(lerp(SALARY, R)[0] * SALARY_ROLE[role] * salaryAge(age));
export const BONUS = { perPoint: 0.005, award: 0.2, goal: 0.1 };
export const SHOP = {
  normal: 2, special: 4,
  price: [[45, 0.5, 3], [55, 0.9, 6], [60, 2, 12], [65, 7, 45], [70, 25, 160], [75, 100, 600],
          [80, 300, 1400], [85, 550, 2400], [90, 800, 3400], [99, 1200, 5000]]
};
export const shopPrice = (ovr) => { const [n, s] = lerp(SHOP.price, ovr); return { normal: round1(n), special: round1(s) }; };

/* ---------- 리그 (26-7-1) ---------- */
export const LEAGUES = [
  { id: "en.1", country: "en", tier: 1, label: "잉글랜드 1부 리그", band: [72, 84], down: 3 },
  { id: "en.2", country: "en", tier: 2, label: "잉글랜드 2부 리그", band: [64, 72], down: 3 },
  { id: "en.3", country: "en", tier: 3, label: "잉글랜드 3부 리그", band: [57, 65], down: 4 },
  { id: "en.4", country: "en", tier: 4, label: "잉글랜드 4부 리그", band: [50, 58], down: 0 },
  { id: "es.1", country: "es", tier: 1, label: "스페인 1부 리그", band: [71, 84], down: 3 },
  { id: "es.2", country: "es", tier: 2, label: "스페인 2부 리그", band: [62, 69], down: 0 },
  { id: "de.1", country: "de", tier: 1, label: "독일 1부 리그", band: [70, 83], down: 3 },
  { id: "de.2", country: "de", tier: 2, label: "독일 2부 리그", band: [63, 70], down: 0 },
  { id: "it.1", country: "it", tier: 1, label: "이탈리아 1부 리그", band: [70, 83], down: 3 },
  { id: "it.2", country: "it", tier: 2, label: "이탈리아 2부 리그", band: [61, 68], down: 0 },
  { id: "fr.1", country: "fr", tier: 1, label: "프랑스 1부 리그", band: [68, 82], down: 3 },
  { id: "fr.2", country: "fr", tier: 2, label: "프랑스 2부 리그", band: [60, 67], down: 0 }
];
export const COUNTRIES = [["en", "잉글랜드"], ["de", "독일"], ["es", "스페인"], ["it", "이탈리아"], ["fr", "프랑스"]];
export const BIG_CLUB = 80, TOP_CLUB = 83;
export const STYLES = ["attack", "build", "press", "power", "balance"];
// 감독 성향 → 선호하는 강점 대분류 (선호 유형 추첨 가중)
export const STYLE_CATS = { attack: ["sht", "spd", "dri"], build: ["pas", "dri"], press: ["spd", "def", "phy"], power: ["phy", "sht", "def"], balance: CATS };

/* ---------- 시즌 목표 (26-9) ---------- */
export const GOALS = {
  S: { ST: ["goals", 0.32], WG: ["points", 0.3], AM: ["points", 0.3], DM: ["rating", 6.8], CB: ["rating", 6.9], FB: ["rating", 6.9] },
  R: { ST: ["goals", 0.16], WG: ["points", 0.2], AM: ["points", 0.2], DM: ["apps", 0.6], CB: ["apps", 0.6], FB: ["apps", 0.6] },
  B: { ST: ["apps", 0.4], WG: ["apps", 0.4], AM: ["apps", 0.4], DM: ["apps", 0.4], CB: ["apps", 0.4], FB: ["apps", 0.4] },
  raise: 1.15, raiseOver: 1.3
};

/* ---------- 은퇴 ---------- */
export const RETIRE = { canFrom: 35, forceAge: 40, hintFrom: 35, minOvr: 50 };

/* ---------- 경기 연동 (26-11) — ③ 밸런스 테스트로 조정 ---------- */
export const MATCH = {
  powerShift: 2.7,      // 커리어 팀 공격력 보정 (CAREER_POWER_SHIFT) — 경기당 2.5~3.0골 맞춤
  swK: 0.04, swMin: 0.4, swMax: 2.2,
  rbK: 1.2, rbCap: 6
};

/* ---------- 도우미 (사칙연산만) ---------- */
export function lerp(pts, x) {
  if (x <= pts[0][0]) return pts[0].slice(1);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (x <= b[0]) {
      const t = (x - a[0]) / (b[0] - a[0]);
      const out = [];
      for (let j = 1; j < a.length; j++) out.push(a[j] + (b[j] - a[j]) * t);
      return out;
    }
  }
  return pts[pts.length - 1].slice(1);
}
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const round1 = (v) => Math.round(v * 10) / 10;
