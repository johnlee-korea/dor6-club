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

/* ---------- 본문 전문 (v2.10.1, 사용자 결정: 출처를 밝히고 전문 표시) ----------
   상세 페이지 <div class="content_body"> 안의 넥슨 편집기 HTML(대문자 태그·MS Word 인라인 스타일)을
   허용 태그·속성만 남기는 화이트리스트 방식으로 정리 → 사이트(다크 테마)에 그대로 넣어도 안전·읽기 좋게.
   - 스크립트·스타일·폼 등은 내용째 제거, 모르는 태그는 태그만 지우고 글자는 남김
   - 글자색은 다크 배경에서 안 보이는 검정 계열이 많아 버리고, 유채색 강조만 class="hl"로 표시
   - 동영상(iframe)은 넣을 수 없으니 '▶ 영상 보기' 링크로 바꿈 */
const DROP_WITH_CONTENT = ["script", "style", "noscript", "object", "embed", "form", "select", "textarea", "button", "xml", "head", "title", "svg", "video", "audio"];
const ALLOWED = new Set(["p", "br", "b", "strong", "u", "i", "em", "span", "a", "img", "table", "thead", "tbody", "tfoot", "tr", "td", "th",
  "ul", "ol", "li", "div", "hr", "sup", "sub", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "caption"]);
const RENAME = { font: "span", center: "div", strike: "span", s: "span" };
const VOID = new Set(["br", "img", "hr"]);

// 속성 문자열 → { 이름(소문자): 값 }  (따옴표 ' " · 따옴표 없음 모두)
function parseAttrs(s) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = cleanText(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

// 색 문자열이 '눈에 띄는 유채색'인지 (검정·회색·흰색 계열이면 false)
const NAMED = { red: [255, 0, 0], blue: [0, 0, 255], green: [0, 128, 0], orange: [255, 165, 0], purple: [128, 0, 128], navy: [0, 0, 128], maroon: [128, 0, 0], olive: [128, 128, 0], teal: [0, 128, 128], fuchsia: [255, 0, 255], magenta: [255, 0, 255], darkorange: [255, 140, 0], crimson: [220, 20, 60] };
function isAccentColor(c) {
  c = String(c || "").trim().toLowerCase();
  let rgb = NAMED[c];
  let m;
  if (!rgb && (m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/))) {
    const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1];
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  if (!rgb && (m = c.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/))) rgb = [+m[1], +m[2], +m[3]];
  if (!rgb) return false;
  const max = Math.max(...rgb), min = Math.min(...rgb);
  return max - min > 60;   // 채도가 있는 색만 강조로 인정
}
const styleColor = (style) => { const m = String(style || "").match(/(?:^|;)\s*color\s*:\s*([^;]+)/i); return m && m[1]; };
const safeUrl = (u) => /^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : null;
const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

export function sanitizeBody(html) {
  let s = String(html || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[if[\s\S]*?<!\[endif\]>/gi, "");
  for (const t of DROP_WITH_CONTENT) s = s.replace(new RegExp(`<${t}\\b[\\s\\S]*?</${t}\\s*>`, "gi"), "").replace(new RegExp(`<${t}\\b[^>]*>`, "gi"), "");
  // 동영상 iframe → 링크
  s = s.replace(/<iframe\b([^>]*)>[\s\S]*?<\/iframe\s*>|<iframe\b([^>]*)\/?>/gi, (_, a1, a2) => {
    const src = safeUrl(parseAttrs(a1 || a2 || "").src);
    return src ? `<p><a href="${escAttr(src)}" target="_blank" rel="noopener">▶ 영상 보기</a></p>` : "";
  });

  const stack = [];   // 열린 태그 (닫는 태그 짝 맞추기용)
  s = s.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9:]*)([^>]*)>/g, (_, close, rawName, rawAttrs) => {
    let name = rawName.toLowerCase();
    name = RENAME[name] || name;
    if (!ALLOWED.has(name)) return "";
    if (/^h[1-6]$/.test(name)) name = "h4";      // 제목 크기 통일 (여는·닫는 태그 모두)
    if (close) {
      if (VOID.has(name)) return "";
      let i = stack.lastIndexOf(name);
      if (name === "span") i = Math.max(i, stack.lastIndexOf("~span"));
      if (i < 0) return "";                       // 짝 없는 닫는 태그는 버림
      const closing = stack.splice(i).reverse();  // 사이에 안 닫힌 태그도 함께 닫음
      return closing.filter((t) => t[0] !== "~").map((t) => `</${t}>`).join("");
    }
    const a = parseAttrs(rawAttrs);
    const attrs = [];
    if (name === "a") {
      const href = safeUrl(a.href);
      if (href) attrs.push(`href="${escAttr(href)}"`, 'target="_blank"', 'rel="noopener"');
    } else if (name === "img") {
      const src = safeUrl(a.src);
      if (!src) return "";
      attrs.push(`src="${escAttr(src)}"`, 'loading="lazy"', `alt="${escAttr(a.alt || "")}"`);
    } else if (name === "td" || name === "th") {
      for (const k of ["colspan", "rowspan"]) if (/^\d+$/.test(a[k] || "")) attrs.push(`${k}="${a[k]}"`);
    }
    if (isAccentColor(styleColor(a.style) || a.color)) attrs.push('class="hl"');
    // 꾸밈 없는 span은 태그를 버리고 글자만 (넥슨 편집기가 글자 조각마다 span을 둘러 용량이 큼) — 닫는 짝은 ~span으로 추적
    if (name === "span" && !attrs.length) { stack.push("~span"); return ""; }
    if (name === "table") { stack.push("table"); return `<div class="nw-tbl"><table>`; }
    if (!VOID.has(name)) stack.push(name);
    return `<${name}${attrs.length ? " " + attrs.join(" ") : ""}>`;
  });
  s += stack.reverse().filter((t) => t[0] !== "~").map((t) => `</${t}>`).join("");
  // 표 래퍼 닫기: </table> 뒤에 </div>
  s = s.replace(/<\/table>/g, "</table></div>");
  // 빈 단락·연속 줄바꿈 정리
  return s
    .replace(/<(span|b|strong|u|i|em)( class="hl")?><\/\1>/g, "")   // 완전히 빈 꾸밈 태그만 (공백은 단어 사이 띄어쓰기라 유지)
    .replace(/(\s*<br>\s*){3,}/g, "<br><br>")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

// 상세 HTML → 정리된 본문 HTML (구역을 못 찾으면 null)
export function parseBody(html) {
  const start = html.indexOf('<div class="content_body">');
  if (start < 0) return null;
  const from = start + '<div class="content_body">'.length;
  const ends = ["<!-- 설문 -->", '<div class="article_utils_wrap">'].map((k) => html.indexOf(k, from)).filter((i) => i > 0);
  if (!ends.length) return null;
  const inner = html.slice(from, Math.min(...ends)).replace(/<\/div>\s*$/i, "");   // content_body 자신의 닫는 태그 제거
  return sanitizeBody(inner);
}

// 상세 HTML → 게시 시각 ISO (JSON-LD datePublished, KST 오프셋 포함)
export function parsePublished(html) {
  const m = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
  if (!m) return null;
  const d = new Date(m[1].replace(/\.\d+(?=[+-]\d\d:\d\d$)/, ""));   // 소수 7자리 → 제거 후 파싱
  return isNaN(d) ? null : d.toISOString();
}
