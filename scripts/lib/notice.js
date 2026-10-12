/* ============================================================
   lib/notice.js — FC온라인 공식 홈페이지 게시판 파서 (v2.10.0)
   - 목록 페이지(/news/{board}/list) HTML에서 글 번호·분류·제목·미리보기 추출
   - 목록 날짜는 "9시간 전"·"10.1(목)"처럼 연도가 없음 → 글 상세의 datePublished(JSON-LD)로 확정
   - 미리보기는 목록의 hidden_desc(넥슨이 잘라 둔 본문 앞부분)를 그대로 사용 → 본문 전체는 전재하지 않음
   ============================================================ */

export const NOTICE_BASE = "https://fconline.nexon.com";

// 가져올 게시판 (사용자 결정: 공지사항 + 개발자 노트)
export const NOTICE_BOARDS = {
  notice: { label: "공지사항", path: "/news/notice" },
  play:   { label: "개발자 노트", path: "/news/play" }
};

export const listUrl = (board) => `${NOTICE_BASE}${NOTICE_BOARDS[board].path}/list`;
export const viewUrl = (board, sn) => `${NOTICE_BASE}${NOTICE_BOARDS[board].path}/view?n4ArticleSN=${sn}`;

// HTML 엔티티·태그 정리
export function cleanText(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, "&");
}

// 미리보기: 줄 앞뒤 공백 제거 + 빈 줄 합치기 (줄바꿈은 유지)
function cleanPreview(s) {
  return cleanText(s)
    .split(/\r?\n/).map((l) => l.trim())
    .join("\n").replace(/\n{2,}/g, "\n").trim();
}

/**
 * 목록 HTML → [{ sn, category, title, pinned, preview }]
 * 행 구조: <div class="tr [notice]"><a href="…/view?n4ArticleSN=N"> sort·subject·date·count </a><div class="hidden_desc">…</div></div>
 */
export function parseNoticeList(html, board) {
  const out = [];
  const re = new RegExp(`<div class="tr([^"]*)">\\s*<a href="${NOTICE_BOARDS[board].path}/view\\?n4ArticleSN=(\\d+)">([\\s\\S]*?)</a>`, "g");
  let m;
  while ((m = re.exec(html))) {
    const body = m[3];
    const pick = (cls) => {
      const r = body.match(new RegExp(`<span class="td ${cls}">([\\s\\S]*?)</span>\\s*(?=<span class="td|$)`));
      return r ? r[1] : "";
    };
    // 제목 안 '새 글' 아이콘 span 제거
    const title = cleanText(pick("subject").replace(/<span class='ico[^>]*>[\s\S]*?<\/span>/g, "")).replace(/\s+/g, " ").trim();
    // 바로 뒤 hidden_desc (다음 행 전까지만 탐색)
    const rest = html.slice(re.lastIndex, re.lastIndex + 8000);
    const next = rest.search(/<div class="tr/);
    const scope = next >= 0 ? rest.slice(0, next) : rest;
    const desc = scope.match(/<div class="text_box">([\s\S]*?)<\/div>/);
    out.push({
      sn: +m[2],
      category: cleanText(pick("sort")).trim(),
      title,
      pinned: /\bnotice\b/.test(m[1]),
      preview: desc ? cleanPreview(desc[1]) : ""
    });
  }
  return out;
}

// 상세 HTML → 게시 시각 ISO (JSON-LD datePublished, KST 오프셋 포함)
export function parsePublished(html) {
  const m = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
  if (!m) return null;
  const d = new Date(m[1].replace(/\.\d+(?=[+-]\d\d:\d\d$)/, ""));   // 소수 7자리 → 제거 후 파싱
  return isNaN(d) ? null : d.toISOString();
}
