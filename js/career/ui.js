/* ============================================================
   career/ui.js — 화면 공용 조각 (표기·배지·카드)
   ============================================================ */
import { CAT_LABEL, CAT_ICON, POS_LABEL, ROLE_LABEL, COUNTRIES } from "./rules.js";
import { clubName } from "./config.js";
import { leagueOf } from "./world.js";
import { typeName, parseType } from "./types.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* 금액: 내부 단위 만 € → "5천 €" · "12만 €" · "1.3억 €" */
export function money(v) {
  if (!v || v < 0.05) return "0 €";
  if (v >= 10000) return (Math.round(v / 1000) / 10) + "억 €";
  if (v >= 10) return Math.round(v).toLocaleString("ko-KR") + "만 €";
  if (v >= 1) return (Math.round(v * 10) / 10) + "만 €";
  return Math.round(v * 10) + "천 €";
}
export const countryName = (c) => (COUNTRIES.find((x) => x[0] === c) || [, c])[1];
export const leagueShort = (id) => { const l = leagueOf(id); return l ? `${countryName(l.country)} ${l.tier}부` : id; };

/* 구단 표시: 시드 단색 원형 배지 + 이름 (로고·엠블럼 미사용 — 26-7-3) */
export function clubLabel(base, id, opt = {}) {
  const b = base.get(id);
  const name = clubName(b);
  const ini = name.replace(/^(FC|AS|SV|SC|RC|CD|UD|AC|US|TSV|1\.)\s*/, "").slice(0, 2);
  return `<span class="cr-club${opt.strong ? " strong" : ""}"><span class="cr-crest" style="background:${esc(b ? b.color : "#555")}">${esc(ini)}</span><span class="cr-club-n">${esc(name)}</span></span>`;
}
export const clubText = (base, id) => clubName(base.get(id));
export const roleBadge = (r) => r ? `<span class="cr-role cr-role-${r}">${ROLE_LABEL[r]}</span>` : "";
export const catLabel = (c) => `${CAT_ICON[c]} ${CAT_LABEL[c]}`;
export const posLabel = (p) => POS_LABEL[p];
export const typeLabel = (pos, key) => typeName(pos, key);
export const typeIdLabel = (id) => { if (!id) return "-"; const t = parseType(id); return typeName(t.pos, t.key); };
export const trustDots = (t) => { const n = t + 3; return `<span class="cr-trust" title="감독 신뢰도 ${t > 0 ? "+" : ""}${t}">${"●".repeat(n)}${"○".repeat(6 - n)}</span>`; };
export const ordinal = (n) => `${n}위`;
export const fmt1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
export const pct = (v) => Math.round(v * 100) + "%";
