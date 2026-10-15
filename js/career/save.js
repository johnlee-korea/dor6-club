/* ============================================================
   career/save.js — LocalStorage 저장·불러오기·내보내기/가져오기 (CLAUDE.md 26-13)
   - dor6.career.save.v1 : 진행 중 커리어 1개 (state 그대로)
   - dor6.career.meta.v1 : 기기 누적 — 업적 · 내 선수 명예의 전당 · 설정
   storage는 주입 가능(테스트·카톡 인앱에서 localStorage 접근이 막힐 때 메모리 대체)
   ============================================================ */
import { STORE, SAVE_VERSION } from "./config.js";

export function makeStorage(win) {
  try {
    const ls = win.localStorage;
    const k = "dor6.career.__test";
    ls.setItem(k, "1"); ls.removeItem(k);
    return ls;
  } catch (e) {
    console.warn("[career] localStorage 사용 불가 — 이번 방문 동안만 메모리에 저장합니다", e);
    const mem = new Map();
    return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), memory: true };
  }
}

const read = (storage, key) => {
  try { const t = storage.getItem(key); return t ? JSON.parse(t) : null; }
  catch (e) { console.error("[career] 저장 데이터 읽기 실패", key, e); return null; }
};
/* 쓰기 실패(용량 초과 등) 시 false — 화면이 "내보내기로 백업하세요" 안내 */
const write = (storage, key, val) => {
  try { storage.setItem(key, JSON.stringify(val)); return true; }
  catch (e) { console.error("[career] 저장 실패", key, e); return false; }
};

export const loadSave = (storage) => {
  const s = read(storage, STORE.save);
  return s && s.v === SAVE_VERSION ? s : null;
};
export const writeSave = (storage, state) => write(storage, STORE.save, state);
export const clearSave = (storage) => storage.removeItem(STORE.save);

export function loadMeta(storage) {
  const m = read(storage, STORE.meta) || {};
  return { achievements: m.achievements || {}, hall: m.hall || [], settings: { fast: true, ...(m.settings || {}) } };
}
export const writeMeta = (storage, meta) => write(storage, STORE.meta, meta);

/* 이번 시즌 새 업적을 기기 누적 목록에 합침 → 기기에서 처음 달성한 것만 반환 */
export function mergeAchievements(meta, ids, careerId, at) {
  const fresh = [];
  for (const id of ids || []) {
    if (meta.achievements[id]) continue;
    meta.achievements[id] = { at, career: careerId };
    fresh.push(id);
  }
  return fresh;
}

/* 내보내기: save + meta 한 JSON */
export const exportText = (state, meta) => JSON.stringify({ kind: "dor6-career", v: SAVE_VERSION, save: state, meta });

/* 가져오기: 형식·버전 검사 → { state, meta } 또는 오류 메시지 */
export function parseImport(text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return { error: "JSON 형식이 아니에요. 내보내기로 받은 글을 그대로 붙여 넣어 주세요." }; }
  if (!j || j.kind !== "dor6-career") return { error: "내 선수 키우기 저장 파일이 아니에요." };
  if (j.v !== SAVE_VERSION) return { error: `저장 형식 버전(${j.v})이 지금 게임(${SAVE_VERSION})과 달라요.` };
  if (j.save && (!j.save.player || !j.save.world)) return { error: "저장 내용이 손상됐어요." };
  return { state: j.save || null, meta: j.meta || null };
}
