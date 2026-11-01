/* ============================================================
   career/avatar.js — 👕 선수 아바타 (인라인 SVG, 외부 이미지·라이브러리 없음 — CLAUDE.md 30-1)
   avatarSvg({ look, equip, color, size, label, face }) → SVG 문자열 (face: true면 얼굴만 잘라 정사각형 — 표·중계 줄용)
   - look: { skin, hair, hairColor, number } (costume.js cleanLook) · equip: { 부위: 아이템 id }
   - color: 유니폼 바탕 = 소속 구단 배지 색(clubs.json color, 시드로 정한 가상 색 — 실제 구단 색 아님)
   - 부위별 모양은 아이템(부위·대분류·등급)으로 정해짐: 색 = 대분류 색, 등급 2 = 흰 장식, 3 = 금색 장식 + 반짝
   - CSS 클래스 없이 속성으로 색을 칠함 (📸 캡처·밝은/다크 모드 모두 그대로 보이게)
   ============================================================ */
import { SKINS, HAIR_COLORS, cleanLook, parseItem } from "./costume.js";

export const CAT_COLOR = { spd: "#f2c518", sht: "#e5323b", dri: "#3987e5", pas: "#2fbf71", phy: "#ff8a1f", def: "#8a5cf6" };
const GOLD = "#d9b04a", LINE = "rgba(0,0,0,.38)", WHITE = "#f4f5f7";

/* 색 도우미 */
function rgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  const n = m ? parseInt(m[1], 16) : 0x5a6270;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const hex = (r, g, b) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const shade = (c, k) => { const [r, g, b] = rgb(c); return hex(r * k, g * k, b * k); };
const lum = (c) => { const [r, g, b] = rgb(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || "") ? c : "#5a6270");

/* 머리 모양 (얼굴 위에 그림) */
function hairSvg(style, c) {
  const top = `M45 31 Q45 15 60 15 Q75 15 75 31 Q71 22 60 22 Q49 22 45 31 Z`;
  switch (style) {
    case "short": return `<path d="${top}" fill="${c}"/>`;
    case "twoblock": return `<path d="M45 30 L46 26 Q47 12 60 12 Q73 12 74 26 L75 30 Q72 23 60 21 Q48 23 45 30 Z" fill="${c}"/><path d="M45 31 L45 27 M75 31 L75 27" stroke="${c}" stroke-width="2" opacity=".5"/>`;
    case "long": return `<path d="M43 52 L44 30 Q44 13 60 13 Q76 13 76 30 L77 52 L71 50 L71 30 Q66 21 60 21 Q53 21 49 30 L49 50 Z" fill="${c}"/>`;
    case "curly": return [[47, 26, 6], [52, 19, 6.5], [60, 16, 7], [68, 19, 6.5], [73, 26, 6], [45, 33, 4], [75, 33, 4]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}"/>`).join("");
    case "buzz": return `<path d="${top}" fill="${c}" opacity=".55"/>`;
    case "ponytail": return `<path d="${top}" fill="${c}"/><ellipse cx="78" cy="31" rx="4" ry="9" fill="${c}"/><rect x="75" y="24" width="4" height="3" rx="1" fill="#e5323b"/>`;
    case "mohawk": return `<path d="M55 30 L56 9 Q60 6 64 9 L65 30 Q60 26 55 30 Z" fill="${c}"/><path d="${top}" fill="${c}" opacity=".25"/>`;
    default: return "";   // bald
  }
}

/* 안경 (pas 전용 — 등급별 모양) */
function glassesSvg(it) {
  if (!it) return "";
  const acc = CAT_COLOR[it.cat];
  if (it.grade === 1) return `<g fill="none" stroke="#2a2d33" stroke-width="1.4"><circle cx="54" cy="35" r="4"/><circle cx="66" cy="35" r="4"/><path d="M58 35 L62 35 M50 34 L45 33 M70 34 L75 33"/></g>`;
  if (it.grade === 2) return `<rect x="45" y="31" width="30" height="8" rx="4" fill="${acc}" opacity=".85" stroke="#2a2d33" stroke-width="1"/><path d="M45 35 L44 35 M75 35 L76 35" stroke="#2a2d33" stroke-width="2"/>`;
  return `<g stroke="${GOLD}" stroke-width="1.4"><rect x="48" y="31" width="10" height="7" rx="3" fill="#15171b"/><rect x="62" y="31" width="10" height="7" rx="3" fill="#15171b"/><path d="M58 33 L62 33 M48 33 L45 32 M72 33 L75 32" fill="none"/></g>`;
}

/* 유니폼 상의 무늬 (바탕은 구단 색 유지) */
function topPattern(it, base) {
  if (!it) return "";
  const acc = CAT_COLOR[it.cat];
  if (it.grade === 1) return `<path d="M28 64 L40 58 L36 78 L34 84 L22 80 Z" fill="${acc}"/><path d="M92 64 L80 58 L84 78 L86 84 L98 80 Z" fill="${acc}"/>`;
  if (it.grade === 2) return [46, 54, 62, 70].map((x) => `<rect x="${x}" y="64" width="4" height="50" fill="${acc}" opacity=".85"/>`).join("") +
    `<path d="M22 80 L34 84 M98 80 L86 84" stroke="${acc}" stroke-width="3"/>`;
  return `<path d="M40 62 L48 59 L82 106 L82 114 L74 114 L38 66 Z" fill="${acc}"/><path d="M40 62 L48 59 L82 106 M38 66 L74 114" stroke="${GOLD}" stroke-width="1.5" fill="none"/>` +
    `<path d="M22 80 L34 84 M98 80 L86 84" stroke="${GOLD}" stroke-width="3"/>`;
}

export function avatarSvg(opts = {}) {
  const look = cleanLook(opts.look, opts.pos);
  const eq = opts.equip || {};
  const item = (slot) => { const it = parseItem(eq[slot]); return it && it.slot === slot ? it : null; };
  const skin = SKINS[look.skin], hairC = HAIR_COLORS[look.hairColor];
  const jersey = safeColor(opts.color);
  const numC = lum(jersey) > 0.6 ? "#1b1d22" : WHITE;
  const boots = item("boots"), socks = item("socks"), top = item("top"), shorts = item("shorts"), gloves = item("gloves"), glasses = item("glasses"), ball = item("ball");
  const c = (it, dflt) => (it ? (it.grade === 3 && (it.slot === "boots" || it.slot === "ball") ? GOLD : CAT_COLOR[it.cat]) : dflt);
  const deco = (it) => (it ? (it.grade === 3 ? GOLD : it.grade === 2 ? WHITE : null) : null);

  const shortsC = c(shorts, shade(jersey, 0.45));
  const socksC = c(socks, jersey);
  const bootsC = c(boots, "#202226");
  const ballC = ball && ball.grade === 3 ? GOLD : WHITE;
  const ballMark = ball ? (ball.grade === 3 ? "#15171b" : CAT_COLOR[ball.cat]) : "#222";
  const sparkle = [boots, socks, top, shorts, gloves, glasses, ball].some((x) => x && x.grade === 3);
  const size = opts.size || 120;
  const label = opts.label || "선수 아바타";
  const box = opts.face ? "36 4 48 48" : "0 0 120 200";
  const height = opts.face ? size : Math.round(size * 200 / 120);

  return `<svg class="cr-av${opts.face ? " face" : ""}" viewBox="${box}" width="${size}" height="${height}" role="img" aria-label="${label.replace(/"/g, "")}" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="60" cy="191" rx="34" ry="4.5" fill="rgba(0,0,0,.22)"/>
  <!-- 다리 -->
  <rect x="45" y="128" width="11" height="26" fill="${skin}"/><rect x="64" y="128" width="11" height="26" fill="${skin}"/>
  <!-- 스타킹 -->
  <rect x="44" y="150" width="13" height="29" rx="2" fill="${socksC}" stroke="${LINE}"/><rect x="63" y="150" width="13" height="29" rx="2" fill="${socksC}" stroke="${LINE}"/>
  ${deco(socks) ? `<rect x="44" y="154" width="13" height="2.5" fill="${deco(socks)}"/><rect x="44" y="159" width="13" height="2.5" fill="${deco(socks)}"/><rect x="63" y="154" width="13" height="2.5" fill="${deco(socks)}"/><rect x="63" y="159" width="13" height="2.5" fill="${deco(socks)}"/>` : `<rect x="44" y="152" width="13" height="2" fill="${WHITE}" opacity=".5"/><rect x="63" y="152" width="13" height="2" fill="${WHITE}" opacity=".5"/>`}
  <!-- 축구화 -->
  <path d="M38 186 Q37 179 44 178 L57 178 L57 187 L40 187 Z" fill="${bootsC}" stroke="${LINE}"/><path d="M82 186 Q83 179 76 178 L63 178 L63 187 L80 187 Z" fill="${bootsC}" stroke="${LINE}"/>
  ${deco(boots) ? `<path d="M42 182 L55 181 M78 182 L65 181" stroke="${deco(boots)}" stroke-width="1.8"/>` : ""}
  <path d="M41 188 L43 188 M47 188 L49 188 M53 188 L55 188 M65 188 L67 188 M71 188 L73 188 M77 188 L79 188" stroke="${boots && boots.grade === 3 ? CAT_COLOR[boots.cat] : "#888"}" stroke-width="1.6"/>
  <!-- 하의 -->
  <path d="M38 112 L82 112 L85 136 L63 138 L60 127 L57 138 L35 136 Z" fill="${shortsC}" stroke="${LINE}"/>
  ${deco(shorts) ? `<path d="M39 114 L37 135 M81 114 L83 135" stroke="${deco(shorts)}" stroke-width="2.4"/>` : ""}
  <!-- 팔 -->
  <path d="M30 72 L21 106 L29 108 L37 78 Z" fill="${skin}"/><path d="M90 72 L99 106 L91 108 L83 78 Z" fill="${skin}"/>
  ${gloves ? `<circle cx="25" cy="110" r="5.6" fill="${CAT_COLOR[gloves.cat]}" stroke="${LINE}"/><circle cx="95" cy="110" r="5.6" fill="${CAT_COLOR[gloves.cat]}" stroke="${LINE}"/>${deco(gloves) ? `<path d="M20 106 L30 106 M90 106 L100 106" stroke="${deco(gloves)}" stroke-width="2.2"/>` : ""}`
           : `<circle cx="25" cy="110" r="5" fill="${skin}"/><circle cx="95" cy="110" r="5" fill="${skin}"/>`}
  <!-- 목 -->
  <rect x="54" y="46" width="12" height="15" fill="${shade(skin, 0.92)}"/>
  <!-- 상의 -->
  <path d="M40 58 Q60 64 80 58 L92 64 L98 80 L86 84 L84 78 L82 114 L38 114 L36 78 L34 84 L22 80 L28 64 Z" fill="${jersey}"/>
  ${topPattern(top, jersey)}
  <path d="M40 58 Q60 64 80 58 L92 64 L98 80 L86 84 L84 78 L82 114 L38 114 L36 78 L34 84 L22 80 L28 64 Z" fill="none" stroke="${LINE}"/>
  <path d="M52 59 L60 69 L68 59" fill="none" stroke="${top && top.grade === 3 ? GOLD : WHITE}" stroke-width="2.2"/>
  <text x="60" y="100" text-anchor="middle" font-size="20" font-weight="800" font-family="Arial, sans-serif" fill="${numC}" stroke="${shade(jersey, 0.6)}" stroke-width=".6">${look.number}</text>
  <!-- 머리 -->
  <circle cx="45" cy="36" r="3" fill="${skin}"/><circle cx="75" cy="36" r="3" fill="${skin}"/>
  <ellipse cx="60" cy="34" rx="15" ry="17" fill="${skin}"/>
  ${hairSvg(look.hair, hairC)}
  <circle cx="54" cy="35" r="1.8" fill="#222"/><circle cx="66" cy="35" r="1.8" fill="#222"/>
  <path d="M54 26.5 L57.5 26 M62.5 26 L66 26.5" stroke="${look.hair === "bald" ? shade(skin, 0.6) : hairC}" stroke-width="1.4"/>
  <path d="M55 43 Q60 46.5 65 43" fill="none" stroke="#7a3b2e" stroke-width="1.4"/>
  ${glassesSvg(glasses)}
  <!-- 공 -->
  <circle cx="96" cy="182" r="8.5" fill="${ballC}" stroke="${LINE}"/>
  <path d="M96 178 L99.8 180.8 L98.4 185.2 L93.6 185.2 L92.2 180.8 Z" fill="${ballMark}"/>
  ${ball && ball.grade >= 2 ? `<circle cx="96" cy="182" r="6" fill="none" stroke="${ball.grade === 3 ? "#15171b" : CAT_COLOR[ball.cat]}" stroke-width=".8" opacity=".8"/>` : ""}
  ${sparkle ? `<g fill="${GOLD}"><path d="M13 30 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 Z"/><path d="M106 60 l1.4 3.6 l3.6 1.4 l-3.6 1.4 l-1.4 3.6 l-1.4 -3.6 l-3.6 -1.4 l3.6 -1.4 Z"/></g>` : ""}
</svg>`;
}

/* 아이템 하나만 작게 그린 아이콘 (상점 카드용) — 아바타의 해당 부위만 돋보이게 같은 그림을 씀 */
export function itemPreviewEquip(baseEquip, it) {
  const eq = { ...(baseEquip || {}) };
  eq[it.slot] = it.id;
  return eq;
}
