/* ============================================================
   career/types.js — 90유형 명칭 · 유형 판정(문턱 2) · 유형 효과 (CLAUDE.md 26-4)
   조합 키 = 대분류 코드 2개를 CATS 순서(spd·sht·pas·dri·def·phy)로 이은 것, 예 "spd+dri"
   ============================================================ */
import { CATS } from "./rules.js";

export const comboKey = (a, b) => (CATS.indexOf(a) <= CATS.indexOf(b) ? `${a}+${b}` : `${b}+${a}`);
export const comboPair = (key) => key.split("+");
export const ALL_COMBOS = (() => {
  const out = [];
  for (let i = 0; i < CATS.length; i++) for (let j = i + 1; j < CATS.length; j++) out.push(`${CATS[i]}+${CATS[j]}`);
  return out;
})();

// 마스터 기획서 4장 표 그대로 (열: ST WG AM DM CB FB)
const ROWS = {
  "spd+sht": ["침투형 스트라이커", "인사이드 포워드", "섀도 스트라이커", "전진형 수미", "공격가담형 센터백", "공격형 윙백"],
  "spd+pas": ["역습형 스트라이커", "크로서형 윙어", "역습 전개형 공미", "전환형 수미", "전진 패스형 센터백", "오버래핑 풀백"],
  "spd+dri": ["드리블러형 스트라이커", "돌파형 윙어", "프리롤 공미", "탈압박형 수미", "볼 운반형 센터백", "돌파형 윙백"],
  "spd+def": ["전방 압박형 스트라이커", "투웨이 윙어", "압박형 공미", "커버형 수미", "스위퍼형 센터백", "커버형 풀백"],
  "spd+phy": ["스프린터형 스트라이커", "활동형 윙어", "박스 침투형 공미", "활동형 수미", "대인마크형 센터백", "왕복형 풀백"],
  "sht+pas": ["완성형 스트라이커", "플레이메이킹 윙어", "10번형 공미", "중거리포 수미", "세트피스형 센터백", "킥력형 풀백"],
  "sht+dri": ["기교형 해결사", "테크니컬 윙어", "판타지스타", "공격형 수미", "테크니컬 센터백", "컷인형 풀백"],
  "sht+def": ["수비가담형 스트라이커", "투지형 윙어", "공수겸장 공미", "공수겸장 수미", "득점형 센터백", "공수겸장 풀백"],
  "sht+phy": ["타겟맨", "파워 윙어", "박스 타격형 공미", "파워형 수미", "헤더 득점형 센터백", "파워형 풀백"],
  "pas+dri": ["폴스나인", "플레이메이커형 윙어", "플레이메이커", "레지스타", "빌드업형 센터백", "인버티드 풀백"],
  "pas+def": ["연계형 스트라이커", "수비형 윙어", "압박 전개형 공미", "딥라잉 수미", "리베로", "밸런스형 풀백"],
  "pas+phy": ["포스트 플레이어", "크로스 머신", "박스투박스 공미", "중원 사령관", "롱볼형 센터백", "크로스형 풀백"],
  "dri+def": ["투지형 스트라이커", "탈압박형 윙어", "탈압박형 공미", "볼 탈취형 수미", "탈압박형 센터백", "탈압박형 풀백"],
  "dri+phy": ["파워 드리블러", "파워 돌파형 윙어", "파워형 공미", "볼 운반형 수미", "파워 빌드업형 센터백", "파워 돌파형 풀백"],
  "def+phy": ["전투형 스트라이커", "헌신형 윙어", "전투형 공미", "파이터형 수미", "스토퍼", "수비 전담 풀백"]
};
const COL = { ST: 0, WG: 1, AM: 2, DM: 3, CB: 4, FB: 5 };
export const typeName = (pos, key) => ROWS[key][COL[pos]];
export const typeId = (pos, key) => `${pos}:${key}`;
export function parseType(id) { const [pos, key] = id.split(":"); return { pos, key }; }

/* 대분류 값 상위 2개 (동점은 CATS 순서) */
export function topCombo(cv) {
  const s = CATS.slice().sort((a, b) => cv[b] - cv[a] || CATS.indexOf(a) - CATS.indexOf(b));
  return comboKey(s[0], s[1]);
}
const comboSum = (cv, key) => { const [a, b] = comboPair(key); return cv[a] + cv[b]; };

/* 유형 재판정: 새 상위 2개 합이 현재 조합 합보다 2 이상 클 때만 변경 (깜빡임 방지) */
export const TYPE_THRESHOLD = 2;
export function reevaluateType(currentKey, cv) {
  const next = topCombo(cv);
  if (next === currentKey) return currentKey;
  return comboSum(cv, next) >= comboSum(cv, currentKey) + TYPE_THRESHOLD ? next : currentKey;
}

/* 선호 유형 일치: full(포지션+조합 완전 일치) · partial(포지션 같고 강점 1개 일치) · null */
export function prefMatch(pos, key, prefId) {
  if (!prefId) return null;
  const p = parseType(prefId);
  if (p.pos !== pos) return null;
  if (p.key === key) return "full";
  const a = comboPair(key), b = comboPair(p.key);
  return a.some((c) => b.includes(c)) ? "partial" : null;
}

/* ---------- 유형 효과 (26-4) — 초기값, ③ 밸런스 테스트로 조정 ---------- */
const STRENGTH_FX = {
  sht: { sw: 1.15, lsh: 1.3 },
  pas: { aw: 1.15 },
  dri: { sw: 1.05, aw: 1.05, rb: 1 },
  spd: { sw: 1.05, aw: 1.05 },
  def: { rbDef: 2 },
  phy: { rb: 1, hea: 1.5 }
};
const SPECIAL_FX = {
  "ST:sht+phy": { hea: 2 },                          // 타겟맨
  "DM:pas+dri": { aw: 1.25 },                         // 레지스타
  "AM:sht+dri": { sw: 1.1, aw: 1.1 },                 // 판타지스타
  "CB:def+phy": { rb: 3 },                            // 스토퍼
  "CB:sht+pas": { sw: 1.5 }, "CB:sht+phy": { sw: 1.5 },   // 세트피스형·헤더 득점형 센터백
  "WG:pas+phy": { aw: 1.2 }, "WG:spd+pas": { aw: 1.2 },   // 크로스 머신·크로서형 윙어
  "ST:pas+dri": { aw: 1.2 }                           // 폴스나인
};
export function typeEffects(pos, key) {
  const fx = { sw: 1, aw: 1, rb: 0, hea: 1, lsh: 1 };
  for (const c of comboPair(key)) {
    const f = STRENGTH_FX[c];
    if (f.sw) fx.sw *= f.sw;
    if (f.aw) fx.aw *= f.aw;
    if (f.rb) fx.rb += f.rb;
    if (f.rbDef && (pos === "DM" || pos === "CB" || pos === "FB")) fx.rb += f.rbDef;
    if (f.hea) fx.hea *= f.hea;
    if (f.lsh) fx.lsh *= f.lsh;
  }
  const sp = SPECIAL_FX[typeId(pos, key)];
  if (sp) {
    if (sp.sw) fx.sw *= sp.sw;
    if (sp.aw) fx.aw *= sp.aw;
    if (sp.rb) fx.rb += sp.rb;
    if (sp.hea) fx.hea *= sp.hea;
  }
  return fx;
}

/* 골 유형 추첨 (표시·세부 성장 배분용 — 엔진 난수와 별개의 시드 사용)
   기본 비율: 헤더 · 중거리 (포지션별), PK 6%, 나머지 일반 */
const BASE_GOAL_MIX = { ST: [0.18, 0.1], WG: [0.08, 0.18], AM: [0.08, 0.28], DM: [0.15, 0.32], CB: [0.55, 0.1], FB: [0.15, 0.2] };
export function goalKind(rng, pos, fx) {
  const [h, l] = BASE_GOAL_MIX[pos] || [0.12, 0.15];
  const hea = Math.min(0.75, h * (fx ? fx.hea : 1)), lsh = Math.min(0.5, l * (fx ? fx.lsh : 1));
  const x = rng.next();
  if (x < 0.06) return "pen";
  if (x < 0.06 + hea * 0.94) return "head";
  if (x < 0.06 + (hea + lsh) * 0.94) return "long";
  return "normal";
}
export const GOAL_KIND_LABEL = { pen: "PK", head: "헤더", long: "중거리", normal: "" };
