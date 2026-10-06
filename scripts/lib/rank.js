/* ============================================================
   rank.js — FC온라인 데이터센터 랭킹 닉 검색 파싱 (v2.8.0, 단일 소스)
   - 넥슨 오픈 API엔 '현재 등급'이 없어 데이터센터 랭킹 HTML에서 읽는다
     (Worker /manage/overview · scripts/rank-history.js 공용)
   - 랭킹은 모드별 상위 10,000명까지만 → 밖이면 null
   - 구단주 칸 첫 아이콘 ico_rank{N}(_m).png 의 N = division.json 순서
     (0 슈퍼 챔피언스, 1 챔피언스, 2 슈퍼 챌린지, 3 챌린저1 … — 아이콘 이미지·maxdivision 대조로 확인)
   - 데이터는 1시간 단위 갱신. 페이지 구조가 바뀌면 이 파일의 정규식만 수정
   ============================================================ */

export const RANK_RT = { 50: "1vs1", 52: "manager" };

export const rankSearchUrl = (matchType, nickname) =>
  `https://fconline.nexon.com/datacenter/rank_inner?rt=${RANK_RT[matchType]}&n4pageno=1&strCharacterName=${encodeURIComponent(nickname)}`;

/* 검색 결과 HTML → { div(등급 순서 번호), rank, score, icon } | null(랭킹 밖)
   닉 부분 일치로 여러 명이 나올 수 있어 정확히 같은 닉만 채택 */
export function parseRankSearch(html, nickname) {
  for (const row of String(html).split('<div class="tr">').slice(2)) {   // 첫 조각 = 표 머리
    const name = ((row.match(/profile_pointer"[^>]*>([^<]+)/) || [])[1] || "").trim();
    if (name !== nickname) continue;
    const coach = row.split("rank_r_win_point")[0];
    const icon = coach.match(/https:\/\/ssl\.nexon\.com\/[^"']+ico_rank(\d+)(?:_m)?\.png/);
    if (!icon) return null;
    return {
      div: +icon[1],
      rank: +((row.match(/rank_no">\s*(\d+)/) || [])[1]) || null,
      score: +((row.match(/rank_r_win_point">\s*([\d.]+)/) || [])[1]) || null,   // 랭킹 점수(ELO)
      icon: icon[0]
    };
  }
  return null;
}

/* 페이지 하단 "※ 2026-10-06 21:00:00 기준 데이터" → ISO(KST 표기를 UTC로). 없으면 null */
export function rankDataTime(html) {
  const m = String(html).match(/(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):\d{2} 기준/);
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:00+09:00`).toISOString() : null;
}
