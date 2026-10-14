/* ============================================================
   schedule.js — 더블 라운드로빈 대진 (홈 & 어웨이)
   - 짝수 n팀: 2(n−1) 라운드 / 홀수 n팀: 가상 팀(휴식)을 넣어 2n 라운드, 매 라운드 1팀 휴식
   - 원형 방식(circle method): 첫 팀 고정, 나머지를 한 칸씩 돌림
   - 후반기 = 전반기와 같은 순서, 홈·원정만 바꿈 → 모든 팀이 서로 홈·원정 한 번씩
   ============================================================ */

export function roundCount(n) {
  if (n < 2) return 0;
  return n % 2 ? 2 * n : 2 * (n - 1);
}

/* ids: 팀 id 배열(이미 시드로 섞인 순서) → [{ matches: [{ home, away }], bye: id|null }] */
export function doubleRoundRobin(ids) {
  if (ids.length < 2) return [];
  const arr = ids.slice();
  if (arr.length % 2) arr.push(null);      // null = 휴식
  const n = arr.length;
  const first = [];
  let rot = arr.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const line = [arr[0], ...rot];
    const matches = [];
    let bye = null;
    for (let i = 0; i < n / 2; i++) {
      let h = line[i], a = line[n - 1 - i];
      // 홈·원정 번갈아 (고정 팀은 라운드마다, 나머지는 자리마다)
      if (i === 0 ? r % 2 === 1 : i % 2 === 1) { const t = h; h = a; a = t; }
      if (h === null || a === null) { bye = h === null ? a : h; continue; }
      matches.push({ home: h, away: a });
    }
    first.push({ matches, bye });
    rot = [rot[rot.length - 1], ...rot.slice(0, -1)];
  }
  const second = first.map((rd) => ({ matches: rd.matches.map((m) => ({ home: m.away, away: m.home })), bye: rd.bye }));
  return [...first, ...second];
}
