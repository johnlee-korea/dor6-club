/* ============================================================
   career/views/offseason.js — 오프시즌 허브 (CLAUDE.md 26-12 ④, 시즌당 1분)
   한 화면 카드 탭: [구단] [훈련] [집중 육성] [포지션] + 하단 [지난 시즌 선택 그대로] [시즌 시작]
   ============================================================ */
import { CATS, W, GROWTH, MAX_CONVERSIONS, CONVERT_PENALTY, SHOP, levelCoef } from "../rules.js";
import { catValues } from "../attrs.js";
import { reevaluateType, typeName, parseType, prefMatch } from "../types.js";
import { decisionPreview, playerOvr, canRetire } from "../career.js";
import { clubCard, conversionOptions, shopPrice } from "../market.js";
import { previewTraining } from "../growth.js";
import { goalText } from "../goals.js";
import { seasonLabel } from "../config.js";
import { esc, money, catLabel, posLabel, clubLabel, typeIdLabel, roleBadge } from "../ui.js";
import { playerCard, clubCardHtml } from "./cards.js";

export function offseason(app) {
  const s = app.state, p = s.player, off = s.off;
  const last = s.history[s.history.length - 1];
  const tab = app.view.offTab || "club";
  const pv = decisionPreview(s);
  const news = myNews(app);
  const tabs = [["club", `🔁 구단${off.offers.length ? ` <span class="cr-new">${off.offers.length}</span>` : ""}`], ["shop", `🏋️ 훈련${off.shopUsed ? " ✔" : ""}`],
    ["focus", "🎯 집중 육성"], ["pos", "🔄 포지션"]];
  const body = { club: clubTab, shop: shopTab, focus: focusTab, pos: posTab }[tab](app, pv);
  const d = off.decision;
  return `${playerCard(app)}
    <div class="cr-season-head"><b>시즌 ${s.world.season}</b> <span class="cr-dim">${seasonLabel(s.world.season)} · ${p.age}세 오프시즌</span>
      ${last ? `<button class="btn sm" data-act="go" data-to="report">지난 시즌 리포트</button>` : ""}
      ${s.history.length ? `<button class="btn sm" data-act="go" data-to="career">커리어 기록</button>` : ""}</div>
    ${news}
    ${app.saveFailed ? `<div class="cr-note warn">저장 공간이 부족해 자동 저장에 실패했어요 — ⚙ 설정에서 내보내기로 백업해 주세요.</div>` : ""}
    <div class="chip-row cr-tabs">${tabs.map(([k, l]) => `<button class="chip ${tab === k ? "active" : ""}" data-act="off-tab" data-tab="${k}">${l}</button>`).join("")}</div>
    ${body}
    <section class="card cr-plan">
      <div class="cr-plan-line">${d.type === "stay" ? "잔류" : d.type === "loan" ? "🏖 임대" : "✈️ 이적"} → ${clubLabel(app.base, d.clubId)} · 예상 ${roleBadge(pv.card.role)} · 성장 효율 약 ${pv.card.efficiency}%</div>
      <div class="cr-plan-line">🎯 집중 육성: ${off.focus.map(catLabel).join(" · ")}</div>
      <div class="cr-plan-line">📋 감독의 시즌 목표: <b>${esc(goalText(pv.goal))}</b> <span class="cr-dim">(달성 시 신뢰도 +1·보너스, 실패 시 −1)</span></div>
    </section>
    <div class="cr-actions">
      ${last && p.lastFocus ? `<button class="btn" data-act="same-again" title="잔류 + 지난 시즌 집중 육성 그대로">⏩ 지난 시즌 선택 그대로</button>` : ""}
      <button class="btn primary" data-act="play" ${off.focus.length === 3 ? "" : "disabled"}>▶ 시즌 시작</button>
    </div>
    ${canRetire(s) ? `<button class="btn block danger cr-retire" data-act="retire-now">🏁 은퇴하기 (${p.age}세)</button>` : ""}
    ${p.age >= 35 && clubCard(s, p.clubId, { trust: p.trust }).role === "B" ? `<p class="cr-note">💭 소속 구단에서 후보로 밀렸어요. 은퇴를 고려해 보세요.</p>` : ""}`;
}

function myNews(app) {
  const s = app.state, p = s.player, out = [];
  for (const n of s.world.news || []) {
    if (n.club !== p.clubId) continue;
    if (n.type === "up") out.push("⬆️ 우리 구단이 승격했어요!");
    if (n.type === "down") out.push("⬇️ 우리 구단이 강등됐어요…");
    if (n.type === "manager") out.push("🔄 감독 교체 — 코치진 특화가 바뀌었을 수 있어요");
    if (n.type === "pref") out.push("🎯 감독이 당신에게 맞춰 선호 유형을 " + typeName(p.pos, p.typeKey) + "(으)로 바꿨어요 — 잔류하면 역할 점수 +3");
  }
  const own = clubCard(s, p.clubId, { trust: p.trust, penalty: p.penaltySeason === s.world.season ? CONVERT_PENALTY : 0 });
  if (own.stage < 1) out.push(`⚠️ 지금 무대가 너무 쉬워요 (성장 효율 −${Math.round((1 - own.stage) * 100)}%) — 더 높은 무대가 필요해요`);
  if (s.off.converted) out.push(`🔄 ${posLabel(s.off.converted.from)} → ${posLabel(s.off.converted.to)} 전환 (이번 시즌 OVR −${CONVERT_PENALTY})`);
  return out.length ? `<div class="cr-news">${out.map((t) => `<div>${esc(t)}</div>`).join("")}</div>` : "";
}

/* ---------- 구단 (잔류·영입 제안·임대) ---------- */
function clubTab(app) {
  const s = app.state, p = s.player, off = s.off, d = off.decision;
  const own = clubCard(s, p.clubId, { trust: p.trust, penalty: p.penaltySeason === s.world.season ? CONVERT_PENALTY : 0 });
  let h = `<h3 class="cr-h3">소속 구단 (잔류)</h3>` +
    clubCardHtml(app, own, { act: "off-decide", data: `data-type="stay" data-club="${p.clubId}"`, selected: d.type === "stay", btn: "잔류", tag: "현 소속" });
  h += `<h3 class="cr-h3">📨 영입 제안 <span class="cr-dim">${off.offers.length}개</span></h3>`;
  h += off.offers.length ? off.offers.map((c) => clubCardHtml(app, c, { act: "off-decide", data: `data-type="transfer" data-club="${c.clubId}"`, selected: d.type === "transfer" && d.clubId === c.clubId, btn: "이적" })).join("")
    : `<p class="cr-note">${s.history.length ? "이번 오프시즌엔 영입 제안이 없어요." : "첫 시즌은 입단한 구단에서 뛰어요. 다음 오프시즌부터 영입 제안이 와요."}</p>`;
  if (off.loans.length) {
    h += `<h3 class="cr-h3">🏖 임대 <span class="cr-dim">24세 이하 · 후보일 때 · 1시즌, 연봉은 원 소속 기준</span></h3>` +
      off.loans.map((c) => clubCardHtml(app, c, { act: "off-decide", data: `data-type="loan" data-club="${c.clubId}"`, selected: d.type === "loan" && d.clubId === c.clubId, btn: "임대 가기" })).join("");
  }
  h += `<p class="cr-note">성장 효율 = 출전 계수 × 경기 수준 계수. 내 OVR보다 조금 낮아 <b>주전으로 뛸 수 있는 구단</b>이 보통 가장 빨리 커요. 너무 쉬운 무대(내 OVR이 요구 OVR보다 6 이상 높음)는 배울 게 적어요.</p>`;
  return h;
}

/* ---------- 훈련 (상점, 시즌당 1회) ---------- */
function shopTab(app) {
  const s = app.state, p = s.player, off = s.off;
  const ovr = Math.round(playerOvr(s, false));
  const price = shopPrice(ovr);
  if (off.shopUsed) {
    const u = off.shopUsed;
    return `<section class="card"><b>이번 오프시즌 훈련 완료 ✔</b><p class="cr-note">${u.kind === "special" ? "특급 훈련 캠프" : "일반 훈련"} · ${catLabel(u.cat)} +${u.amount.toFixed(1)} (${money(u.price)})</p>${app.view.shopMsg ? `<p class="cr-hit">${esc(app.view.shopMsg)}</p>` : ""}</section>`;
  }
  const kind = app.view.shopKind || "normal";
  const cat = app.view.shopCat;
  const L = levelCoef(playerOvr(s, false));
  const kinds = [["normal", "일반 훈련", SHOP.normal, price.normal], ["special", "특급 훈련 캠프", SHOP.special, price.special]];
  let prev = "";
  if (cat) {
    const r = previewTraining(p, kind, cat);
    const cv = catValues(r.subs);
    const key = reevaluateType(p.typeKey, cv);
    const after = Math.round(playerOvr({ ...s, player: { ...p, subs: r.subs } }, false));
    prev = `<div class="cr-note">${catLabel(cat)} +${r.amount.toFixed(1)} → OVR ${ovr} → <b>${after}</b>${key !== p.typeKey ? ` · 🧬 유형 변화: ${esc(typeName(p.pos, key))}` : ""}</div>`;
  }
  const cost = price[kind];
  const lack = p.money < cost;
  const save = lack ? Math.ceil((cost - p.money) / Math.max(1, s.history.length ? s.history[s.history.length - 1].income : 1)) : 0;
  return `<section class="card">
    <div class="chip-row">${kinds.map(([k, n, amt, pr]) => `<button class="chip ${kind === k ? "active" : ""}" data-act="shop-kind" data-kind="${k}">${n} +${amt} · ${money(pr)}</button>`).join("")}</div>
    <p class="cr-dim">보유 ${money(p.money)} · 지금 OVR ${ovr}에선 효과 ×${L.toFixed(2)} (OVR이 높을수록 줄어요) · 가격은 OVR 기준</p>
    <div class="chip-row">${CATS.map((c) => `<button class="chip ${cat === c ? "active" : ""}" data-act="shop-cat" data-cat="${c}">${catLabel(c)} <small>${W[p.pos][c]}%</small></button>`).join("")}</div>
    ${prev}
    ${lack ? `<p class="cr-warn">자금이 ${money(cost - p.money)} 부족해요${save ? ` — 약 ${save}시즌 더 모으면 돼요` : ""}.</p>` : ""}
    ${app.view.shopMsg ? `<p class="cr-warn">${esc(app.view.shopMsg)}</p>` : ""}
    <button class="btn primary block" data-act="shop-buy" ${cat && !lack ? "" : "disabled"}>${kind === "special" ? "특급 훈련 캠프" : "일반 훈련"} 구매 (${money(cost)})</button>
    <p class="cr-note">훈련은 "더 높이"가 아니라 "더 빨리, 덜 떨어지게" 하는 도구예요. 코치진·레전드 효과는 붙지 않아요 — 99는 경기력으로만!</p>
  </section>`;
}

/* ---------- 집중 육성 (정확히 3개) ---------- */
function focusTab(app) {
  const s = app.state, p = s.player, off = s.off;
  const clubId = off.decision.clubId;
  const c = s.world.clubs[clubId];
  const cv = catValues(p.subs);
  // 예상: 집중 +4 · 나머지 +1.2로 키웠을 때 유형
  const sim = {};
  for (const k of CATS) sim[k] = cv[k] + (off.focus.includes(k) ? GROWTH.baseFocus : GROWTH.baseRest) * 2;
  const key = reevaluateType(p.typeKey, sim);
  const pm = prefMatch(p.pos, p.typeKey, c.pref);
  const pref = parseType(c.pref);
  return `<section class="card">
    <p class="cr-dim">정확히 3개를 골라요. 고른 대분류는 크게, 나머지는 조금 자라요(30세 이후엔 빠르게 떨어져요).</p>
    <div class="cr-focus">${CATS.map((k) => `<button class="cr-focus-b ${off.focus.includes(k) ? "on" : ""}" data-act="off-focus" data-cat="${k}">
      <span>${catLabel(k)}</span><b>${Math.round(cv[k])}</b><small>${posLabel(p.pos)} 중요도 ${W[p.pos][k]}%${c.coach.includes(k) ? " · 🏋️ 코치진 ×1.3" : ""}</small></button>`).join("")}</div>
    <p class="cr-note">🏋️ ${clubLabel(app.base, clubId)} 코치진 특화: ${c.coach.map(catLabel).join(" · ")} — 집중 육성에 넣으면 그 대분류 성장 ×1.3</p>
    <p class="cr-note">🎯 감독 선호 유형: ${esc(typeIdLabel(c.pref))}${pref.pos !== p.pos ? " (다른 포지션)" : pm === "full" ? " — 지금 완전 일치! (역할 점수 +3)" : pm === "partial" ? " — 부분 일치 (+1)" : ""}</p>
    ${key !== p.typeKey ? `<p class="cr-hit">🧬 이 조합으로 키우면 유형이 <b>${esc(typeName(p.pos, key))}</b>(으)로 바뀔 수 있어요</p>` : ""}
    <button class="btn sm" data-act="off-focus-reco">추천 조합으로 (포지션 중요도 × 코치진)</button>
  </section>`;
}

/* ---------- 포지션 전환 ---------- */
function posTab(app) {
  const s = app.state, p = s.player;
  const left = MAX_CONVERSIONS - (p.conversions || 0);
  if (s.off.converted) return `<section class="card"><b>이번 오프시즌에 포지션을 바꿨어요.</b><p class="cr-note">${posLabel(s.off.converted.from)} → ${posLabel(s.off.converted.to)} · 이번 시즌 OVR −${CONVERT_PENALTY}</p></section>`;
  const opts = conversionOptions(p);
  const now = Math.round(playerOvr(s, false));
  return `<section class="card">
    <p class="cr-dim">인접 포지션으로만 · 커리어 중 ${MAX_CONVERSIONS}번 (남은 ${left}번) · 전환 첫 시즌 OVR −${CONVERT_PENALTY}. 노장기에 더 좋은 구단에 남는 수단이 될 수 있어요.</p>
    ${left > 0 ? opts.map((o) => `<div class="cr-conv"><div><b>${posLabel(o.pos)}</b> · ${esc(typeName(o.pos, o.typeKey))}<br><span class="cr-dim">OVR ${now} → 첫 시즌 ${o.ovr} → 적응 후 ${o.ovrAfter}</span></div>
      <button class="btn sm" data-act="convert" data-pos="${o.pos}">전환</button></div>`).join("") : `<p class="cr-note">포지션 전환 기회를 모두 썼어요.</p>`}
  </section>`;
}
