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
export function clubCardHtml(app, card, opts = {}) {
  const p = app.state.player;
  const c = app.state.world.clubs[card.clubId];
  const short = card.short ? `<span class="cr-hit">🔍 부족 포지션: ${posLabel(p.pos)} ✅</span>` : `<span class="cr-dim">🔍 부족: ${c.short.map(posLabel).join("·")}</span>`;
  const pm = card.prefMatch === "full" ? `<span class="cr-hit">🎯 선호 유형: ${esc(typeIdLabel(c.pref))} (일치 +3)</span>`
    : card.prefMatch === "partial" ? `<span class="cr-hit">🎯 선호 유형: ${esc(typeIdLabel(c.pref))} (부분 일치 +1)</span>`
    : `<span class="cr-dim">🎯 선호: ${esc(typeIdLabel(c.pref))}</span>`;
  const coach = `<span class="${card.coachHit.length ? "cr-hit" : "cr-dim"}">🏋️ 코치진: ${c.coach.map(catLabel).join(" · ")}</span>`;
  const eff = `<span class="cr-eff" title="예상 성장 효율 = 출전 계수 × 경기 수준 계수">성장 효율 ${card.efficiency}%${card.stage < 1 ? " ⚠️" : ""}</span>`;
  return `<div class="cr-clubcard${opts.selected ? " selected" : ""}${opts.dim ? " dim" : ""}">
    <div class="cr-cc-head">
      ${clubLabel(app.base, card.clubId, { strong: true })}
      ${opts.tag ? `<span class="cr-tag">${esc(opts.tag)}</span>` : ""}
    </div>
    <div class="cr-cc-line"><span class="cr-dim">${leagueShort(card.league)}</span> · 요구 OVR <b>${card.R}</b> · 예상 ${roleBadge(card.role)} · 연봉 ${money(card.salary)} · ${eff}</div>
    <div class="cr-cc-badges">${short}${pm}${coach}</div>
    ${opts.act ? `<button class="btn sm ${opts.selected ? "primary" : ""}" data-act="${opts.act}" ${opts.data || ""}>${opts.selected ? "✔ 선택됨" : esc(opts.btn || "선택")}</button>` : ""}
  </div>`;
}
export const roleName = (r) => ROLE_LABEL[r];
export { leagueOf };
