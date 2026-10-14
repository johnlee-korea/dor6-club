/* ============================================================
   stats.js — 개인 기록 (득점·도움·공격포인트·평균 평점·MVP)
   선수 키 = "{팀 id}#{선수 idx}"
   ============================================================ */

/* 라운드 1~k의 결과를 모아 선수별 기록 Map */
export function playerStats(rounds, results, k) {
  const map = new Map();
  const get = (team, idx) => {
    const key = team + "#" + idx;
    let s = map.get(key);
    if (!s) map.set(key, (s = { key, team, idx, g: 0, a: 0, apps: 0, rsum: 0 }));
    return s;
  };
  for (let r = 0; r < k && r < rounds.length; r++) {
    rounds[r].matches.forEach((m, i) => {
      const res = results[r][i];
      const tid = { h: m.home, a: m.away };
      for (const side of ["h", "a"]) {
        for (const [idx, r10] of res.rt[side]) { const s = get(tid[side], idx); s.apps++; s.rsum += r10; }
      }
      for (const e of res.ev) {
        get(tid[e.side], e.s).g++;
        if (e.as !== null) get(tid[e.side], e.as).a++;
      }
    });
  }
  for (const s of map.values()) { s.ap = s.g + s.a; s.avg = s.apps ? s.rsum / s.apps / 10 : 0; }
  return map;
}

const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/* 부문별 상위 n — kind: "g" 득점 · "a" 도움 · "ap" 공격포인트 · "avg" 평균 평점(minApps 이상 출전) */
export function leaders(stats, kind, n = 20, minApps = 1) {
  let list = [...stats.values()];
  if (kind === "avg") list = list.filter((s) => s.apps >= minApps);
  else list = list.filter((s) => s[kind] > 0);
  const tie = kind === "g" ? (a, b) => b.a - a.a : kind === "a" ? (a, b) => b.g - a.g : kind === "ap" ? (a, b) => b.g - a.g : (a, b) => b.apps - a.apps;
  return list.sort((a, b) => b[kind] - a[kind] || tie(a, b) || byKey(a, b)).slice(0, n);
}

/* MVP: 출전 minApps 이상 중 평균 평점 최고 */
export function mvp(stats, minApps) {
  return leaders(stats, "avg", 1, minApps)[0] || null;
}
