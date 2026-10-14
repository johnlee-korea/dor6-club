/* ============================================================
   league/data.js — 도륙리그 데이터 로딩 + 하루치 시뮬레이션 준비
   config → (개최일이면) 그날 스냅샷 → 엔진 runDay. history는 기록실용.
   fetch는 주입 가능(스모크 테스트가 로컬 파일로 흉내)
   ============================================================ */
import { runDay, ENGINE_VERSION } from "../engine/index.js";
import { snapshotTeams } from "./roster.js";

export async function fetchJSON(fetchFn, path) {
  const res = await fetchFn(path, { cache: "no-cache" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path} 로딩 실패 (${res.status})`);
  return res.json();
}

/* 스냅샷 → 엔진 결과 (없거나 2팀 미만이면 null)
   names: { spId: 선수 이름 } (data/meta/players.json) — 실제 스쿼드 이름 표시용, 결과에는 영향 없음 */
export function simulateSnapshot(snap, config, names) {
  if (!snap || !snap.teams || snap.teams.length < 2) return null;
  if (snap.engine != null && snap.engine !== ENGINE_VERSION)
    console.warn(`[도륙리그] 스냅샷 엔진 v${snap.engine} ≠ 현재 엔진 v${ENGINE_VERSION} — 결과가 기록과 다를 수 있음`);
  const t0 = (typeof performance !== "undefined" ? performance : Date).now();
  const day = runDay({ daySeed: snap.seed, teamSeed: snap.teamSeed || config.seed, teams: snapshotTeams(snap, names) });
  const ms = (typeof performance !== "undefined" ? performance : Date).now() - t0;
  console.log(`[도륙리그] ${snap.date} 시뮬레이션 ${day.totalRounds}라운드 ${ms.toFixed(0)}ms`);
  return day;
}

/* 하루 스냅샷 로딩 (없으면 null) */
export const loadSnapshot = (fetchFn, date) => fetchJSON(fetchFn, `data/league/days/${date}.json`).catch((e) => {
  console.error("[도륙리그] 스냅샷 로딩 실패:", e);
  return null;
});
