/* ============================================================
   career/views/cards.js — 선수 카드 · 구단 카드 (시작 구단·영입 제안·임대 공용)
   ============================================================ */
import { CATS, ROLE_LABEL } from "../rules.js";
import { catValues } from "../attrs.js";
import { playerOvr } from "../career.js";
import { leagueOf } from "../world.js";
import { esc, money, clubLabel, leagueShort, roleBadge, catLabel, posLabel, typeLabel, typeIdLabel, trustDots } from "../ui.js";

/* 상단 선수 카드: OVR 가장 크게 · 유형 · 나이 · 소속 · 역할 · 신뢰도 · 자금 */
export function playerCard(app, extra = "") {
  const s = app.state, p = s.player;
  const ovr = Math.round(playerOvr(s));
  const pen = p.penaltySeason === s.world.season;
  const cv = catValues(p.subs);
  return `<section class="card cr-player">
    <div class="cr-player-top">
      <div class="cr-ovr" title="포지션 OVR — 이적·역할·훈련 가격·성장 둔화의 기준">${ovr}<small>OVR${pen ? " (적응 −3)" : ""}</small></div>
      <div class="cr-player-info">
        <div class="cr-player-name">${esc(p.name)} <span class="cr-dim">${p.age}세 · ${posLabel(p.pos)}</span></div>
        <div class="cr-type">${esc(typeLabel(p.pos, p.typeKey))}</div>
        <div class="cr-player-club">${p.clubId ? clubLabel(app.base, p.clubId) + ` <span class="cr-dim">${leagueShort(s.world.clubs[p.clubId].league)}</span>` : ""}</div>
        <div class="cr-player-meta"><span>💰 ${money(p.money)}</span><span>감독 신뢰 ${trustDots(p.trust)}</span></div>
      </div>
    </div>
    <div class="cr-cats">${CATS.map((c) => `<span class="cr-cat"><b>${Math.round(cv[c])}</b><small>${catLabel(c)}</small></span>`).join("")}</div>
    ${extra}
  </section>`;
}

/* 구단 카드 — card: market.clubCard 결과 */
/* 간결 카드 (v2.13.2): 이름·역할 / 리그·요구·연봉·성장 / 나와 맞는 점만 배지 */
export function clubCardHtml(app, card, opts = {}) {
  const p = app.state.player;
  const c = app.state.world.clubs[card.clubId];
  const tags = [];
  if (card.short) tags.push("🔍 내 포지션 부족");
  if (card.coachHit.length) tags.push("🏋️ " + card.coachHit.map((k) => catLabel(k).split(" ")[1]).join("·") + " 코치진");
  // 감독이 원하는 유형은 항상 표시 (같은 포지션일 때) — 일치하면 ✅
  const prefLine = card.prefPos === p.pos
    ? `<span class="${card.prefMatch ? "cr-hit" : "cr-dim"}">🎯 원하는 유형: ${esc(typeIdLabel(c.pref))}${card.prefMatch === "full" ? " ✅" : card.prefMatch === "partial" ? " (부분 일치)" : ""}</span>`
    : "";
  return `<div class="cr-clubcard${opts.selected ? " selected" : ""}${opts.dim ? " dim" : ""}">
    <div class="cr-cc-head">${clubLabel(app.base, card.clubId, { strong: true })} ${roleBadge(card.role)}${opts.tag ? ` <span class="cr-tag">${esc(opts.tag)}</span>` : ""}</div>
    <div class="cr-cc-line">${leagueShort(card.league)} · 요구 <b>${card.R}</b> · 선발 약 <b>${card.expStarts}</b>/${card.games}경기 · ${money(card.salary)} · <span class="cr-eff">성장 ${card.efficiency}%${card.stage < 1 ? "⚠️" : ""}</span></div>
    ${tags.length || prefLine ? `<div class="cr-cc-badges">${tags.map((t) => `<span>${esc(t)}</span>`).join("")}${prefLine}</div>` : ""}
    ${opts.act ? `<button class="btn sm ${opts.selected ? "primary" : ""}" data-act="${opts.act}" ${opts.data || ""}>${esc(opts.btn || "선택")}</button>` : ""}
  </div>`;
}
export const roleName = (r) => ROLE_LABEL[r];
export { leagueOf };
