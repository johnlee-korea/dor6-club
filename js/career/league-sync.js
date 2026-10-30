/* ============================================================
   career/league-sync.js — ⭐ 도륙리그 자동 연동 (v2.24.0, CLAUDE.md 25-21)
   - ⭐ 내 프로필(dor6.me)이 설정된 기기만: 시즌 종료·은퇴·앱 시작 때 Worker /career/sync로 자동 전송
   - 보내는 것: 기기 ID(무작위) · 이 기기 총 플레이 시즌 수 · 역대 최고 OVR 선수 1명 요약 — 개인정보 없음
   - 같은 내용은 다시 보내지 않음 · 실패해도 게임 진행엔 영향 없음(콘솔 로그만)
   - 클럽원이 아니거나 내 프로필이 없으면 아무것도 보내지 않음 → 지금처럼 그냥 게임
   ============================================================ */

const K = { device: "dor6.career.device", last: "dor6.career.sync.last", res: "dor6.career.sync.res" };
const ME_KEY = "dor6.me";   // common.js myProfile과 같은 키 (읽기만)

const get = (storage, k) => { try { return storage.getItem(k); } catch (e) { return null; } };
const set = (storage, k, v) => { try { storage.setItem(k, v); } catch (e) { /* 저장 막힘 — 다음에 다시 보냄 */ } };

export function deviceId(storage, win) {
  let id = get(storage, K.device);
  if (id && /^[a-z0-9]{8,32}$/.test(id)) return id;
  const a = new Uint32Array(3);
  (win.crypto || globalThis.crypto).getRandomValues(a);
  id = [...a].map((x) => x.toString(36)).join("").slice(0, 20).padEnd(8, "0");
  set(storage, K.device, id);
  return id;
}

/* 이 기기 총 플레이 시즌 수 — 예전 기기(카운터 도입 전)는 명예의 전당 + 진행 중 시즌으로 시작값 추정 */
export function deviceSeasons(state, meta) {
  if (Number.isInteger(meta.seasonsPlayed)) return meta.seasonsPlayed;
  const hall = (meta.hall || []).reduce((s, h) => s + (h.seasons || 0), 0);
  const cur = state && state.totals && !(meta.hall || []).some((h) => h.id === state.seed) ? state.totals.seasons || 0 : 0;
  return hall + cur;
}

/* 역대 최고 OVR 선수 (기기에 기억한 최고 선수 + 명예의 전당 + 진행 중 선수) — 동률이면 시즌 많은 쪽 */
export function bestStar(state, meta) {
  const list = meta.leagueBest ? [meta.leagueBest] : [];
  list.push(...(meta.hall || []).map((h) => ({
    name: h.name, pos: String((h.types || []).slice(-1)[0] || "").split(":")[0], type: String((h.types || []).slice(-1)[0] || "").split(":")[1],
    ovr: h.maxOvr, seasons: h.seasons || 0, retired: true
  })));
  if (state && state.player && state.totals && state.phase !== "start-club") {
    list.push({ name: state.player.name, pos: state.player.pos, type: state.player.typeKey, ovr: state.totals.maxOvr, seasons: state.totals.seasons || 0, retired: state.phase === "retired" });
  }
  return list.filter((s) => s.pos && Number.isInteger(s.ovr))
    .sort((a, b) => b.ovr - a.ovr || b.seasons - a.seasons)[0] || null;
}

export const linkedProfile = (storage) => get(storage, ME_KEY);
export const lastResult = (storage) => { try { return JSON.parse(get(storage, K.res)) || null; } catch (e) { return null; } };

/* 자동 전송 — 내 프로필 없으면 아무것도 안 함. 반환: 결과 객체 | null */
export async function syncLeague({ storage, win, state, meta, workerUrl, fetchFn, force }) {
  const ouid = linkedProfile(storage);
  if (!ouid || !workerUrl) return null;
  const star = bestStar(state, meta);
  if (!star) return null;
  const body = { ouid, device: deviceId(storage, win), seasons: deviceSeasons(state, meta), star };
  const sig = JSON.stringify(body);
  if (!force && get(storage, K.last) === sig) return lastResult(storage);
  try {
    const res = await (fetchFn || win.fetch.bind(win))(`${workerUrl}/career/sync`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: sig
    });
    const j = await res.json();
    const out = j.error ? { error: j.error, at: Date.now() } : { ...j, at: Date.now() };
    set(storage, K.res, JSON.stringify(out));
    if (!j.error) set(storage, K.last, sig);
    return out;
  } catch (e) {
    console.error("[career] 도륙리그 연동 전송 실패 — 다음 시즌 종료 때 다시 보냄", e);
    return null;
  }
}
