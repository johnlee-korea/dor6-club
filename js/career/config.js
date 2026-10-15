/* ============================================================
   career/config.js — 운영 설정 (CLAUDE.md 26-7-3 권리 보호 · 26-13 저장)
   ============================================================ */

/* ★ 즉시 전환 스위치: false로 바꾸면 화면·내보내기·커리어 요약 전체가 가상 구단명으로 바뀜
   (저장 파일에는 구단 id만 들어가므로 과거 기록도 즉시 가상명) */
export const USE_REAL_NAMES = true;
/* 실행 중 상태 (스모크 테스트가 실명 0건 검사할 때만 바꿈) */
export const namesMode = { useReal: USE_REAL_NAMES };

/* 특정 구단만 가상명으로 (권리자 요청 시 id 추가 — data/career/clubs.json에서 realName으로 id 확인) */
export const fictionalOverrides = [];

/* 저장 키 — 반드시 "dor6.career." 접두어 (다른 기능 저장값과 충돌 방지) */
export const STORE = { save: "dor6.career.save.v1", meta: "dor6.career.meta.v1" };
export const SAVE_VERSION = 1;
export const START_YEAR = 2026;          // 시즌 1 = 2026-27

/* 권리 고지 (career.html 푸터·타이틀) */
export const NOTICE = "본 게임은 구단·협회와 무관한 비공식 팬 게임이며, 구단 명칭은 식별 목적으로만 사용합니다. " +
  "로고·선수 실명은 사용하지 않습니다. Club list based on openfootball (public domain, CC0).";

/* 구단 표시명: 실명이면 한글명(없으면 원문), 아니면 가상명 */
export function clubName(base, opt = {}) {
  if (!base) return "?";
  const real = (opt.useReal ?? namesMode.useReal) && !fictionalOverrides.includes(base.id);
  return real ? (base.koName || base.realName) : base.fictionalName;
}
export const seasonLabel = (n) => `${START_YEAR + n - 1}-${String((START_YEAR + n) % 100).padStart(2, "0")}`;
