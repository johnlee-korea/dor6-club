/* ============================================================
   career/views/offseason.js — 오프시즌 단계형 화면 (CLAUDE.md 26-12 ④, v2.13.2 사용자 피드백 반영)
   ⓪ 🎲 시즌 이벤트(v2.15.0, 고르기 전엔 다음 단계로 못 감) → ① 구단(잔류 기본 · 제안/임대는 접어 둠) → ② 훈련(건너뛰기)
   → ③ 👕 코스튬(v2.26.0, 시즌당 1개 구매 · 옷장 갈아입기 무료, 건너뛰기) → ④ 집중 육성(추천 미리 선택) → ▶ 시즌 시작
   고르면 다음 단계로 바로 넘어감. 설명 문구는 최소한으로.
   ============================================================ */
import { CATS, W, MAX_CONVERSIONS, CONVERT_PENALTY, SHOP, levelCoef } from "../rules.js";
import { catValues } from "../attrs.js";
import { reevaluateType, typeName, prefMatch } from "../types.js";
import { decisionPreview, playerOvr, ensureEvent } from "../career.js";
import { eventDef, pendingEvent, TIERS } from "../events.js";
import { EVENT } from "../rules.js";
import { clubCard, conversionOptions, shopPrice } from "../market.js";
import { previewTraining } from "../growth.js";
import { goalText } from "../goals.js";
import { esc, money, catLabel, posLabel, clubLabel, roleBadge } from "../ui.js";
import { playerCard, clubCardHtml } from "./cards.js";
import { avatarSvg, CAT_COLOR } from "../avatar.js";
import { SLOTS, SLOT_LABEL, GRADE_LABEL, slotItems, parseItem, itemName, equipBonus, gearDelta, ensureCostume } from "../costume.js";

const STEPS = [["event", "이벤트"], ["club", "구단"], ["shop", "훈련"], ["costume", "코스튬"], ["focus", "집중 육성"]];

export function offseason(app) {
  const s = app.state, p = s.player;
  ensureEvent(s);                                   // 예전 저장분(이벤트 도입 전)도 이번 시즌 이벤트를 만듦
  const step = pendingEvent(s) ? "event" : (app.view.offStep || "club");
  const body = { event: eventStep, club: clubStep, shop: shopStep, costume: costumeStep, focus: focusStep, pos: posStep }[step](app);
  const at = STEPS.findIndex((x) => x[0] === step);
  return `${playerCard(app)}
    <div class="cr-season-head"><b>시즌 ${s.world.season} 준비</b> <span class="cr-dim">${p.age}세</span>
      <span class="cr-head-links">${s.history.length ? `<button class="btn sm" data-act="go" data-to="report">지난 시즌</button><button class="btn sm" data-act="go" data-to="career">기록</button>` : ""}</span></div>
    ${myNews(app)}
    ${app.saveFailed ? `<div class="cr-note warn">자동 저장 실패 — ⚙ 설정에서 내보내기로 백업해 주세요.</div>` : ""}
    <div class="cr-steps">${STEPS.map(([k, l], i) => `<button class="cr-step ${step === k ? "on" : ""} ${at > i ? "done" : ""}" data-act="off-step" data-step="${k}">${i + 1}. ${l}</button>`).join("")}</div>
    ${body}`;
}

function myNews(app) {
  const s = app.state, p = s.player, out = [];
  for (const n of s.world.news || []) {
    if (n.club !== p.clubId) continue;
    if (n.type === "up") out.push("⬆️ 승격!");
    if (n.type === "down") out.push("⬇️ 강등");
    if (n.type === "grow") out.push(`📈 팀 전력 보강 (요구 ${n.from}→${n.to})`);
    if (n.type === "pref") out.push("🎯 감독이 내 유형을 선호");
    if (n.type === "manager") out.push("🔄 감독 교체");
  }
  const own = clubCard(s, p.clubId, { trust: p.trust, penalty: p.penaltySeason === s.world.season ? CONVERT_PENALTY : 0 });
  if (own.stage < 1) out.push(`⚠️ 무대가 쉬워요 (성장 −${Math.round((1 - own.stage) * 100)}%)`);
  if (s.off.converted) out.push(`🔄 ${posLabel(s.off.converted.to)} 전환 (이번 시즌 −${CONVERT_PENALTY})`);
  return out.length ? `<div class="cr-news">${out.map((t) => `<span>${esc(t)}</span>`).join("")}</div>` : "";
}

/* ---------- ⓪ 🎲 시즌 이벤트 ---------- */
function eventStep(app) {
  const e = app.state.off.event, d = eventDef(e);
  if (!d) return `<button class="btn primary block" data-act="off-step" data-step="club">다음: 구단 →</button>`;
  const tag = e.major ? `<div class="cr-ev-tag major">⭐ 인생의 갈림길 · 초대폭 상승 기회</div>` : `<div class="cr-ev-tag">🎲 시즌 이벤트</div>`;
  const q = `<div class="cr-ev-q"><span class="cr-ev-icon">${d.icon}</span><span>${esc(d.q)}</span></div>`;
  if (e.choice === null) {
    const odds = (e.major ? EVENT.major : EVENT.normal).map(([t]) => t === "keep" ? "유지" : `${TIERS[t].label.replace(" 상승", "")} +${EVENT.amount[t][0]}~${EVENT.amount[t][1]}`).join(" · ");
    return `<section class="card cr-event ${e.major ? "major" : ""}">${tag}${q}
      <div class="cr-ev-choices">${d.choices.map((c, i) => `<button class="cr-ev-c" data-act="event-pick" data-i="${i}"><b>${i + 1}</b>${esc(c)}</button>`).join("")}</div>
      <p class="cr-dim cr-ev-odds">결과는 랜덤 — ${odds}</p></section>`;
  }
  const t = TIERS[e.tier];
  const damped = e.target > 0 && e.damp < 1;
  return `<section class="card cr-event done ${e.major ? "major" : ""} tier-${e.tier}">${tag}${q}
    <div class="cr-ev-pick">→ ${esc(d.choices[e.choice])}</div>
    <div class="cr-ev-res"><span class="cr-ev-big">${t.icon}</span><div><b>${t.label}${e.target ? ` +${e.target}` : ""}</b><br><span class="cr-dim">${esc(t.texts[e.text])}</span></div></div>
    ${e.target ? `<p class="cr-ev-ovr">OVR ${Math.round(e.ovrBefore)} → <b>${Math.round(e.ovrAfter)}</b> <span class="cr-hit">(+${e.gain.toFixed(1)})</span>${damped ? ` <span class="cr-dim">· 높은 OVR 효과 ×${e.damp}</span>` : ""}</p>` : ""}
  </section>
  <button class="btn primary block" data-act="off-step" data-step="club">다음: 구단 →</button>`;
}

/* ---------- ① 구단 ---------- */
function clubStep(app) {
  const s = app.state, p = s.player, off = s.off, d = off.decision;
  const own = clubCard(s, p.clubId, { trust: p.trust, penalty: p.penaltySeason === s.world.season ? CONVERT_PENALTY : 0 });
  const last = s.history.length && p.lastFocus;
  const offerCards = off.offers.map((c) => clubCardHtml(app, c, { act: "off-decide", data: `data-type="transfer" data-club="${c.clubId}" data-next="1"`, selected: d.type === "transfer" && d.clubId === c.clubId, btn: "이적 →" })).join("");
  const loanCards = off.loans.map((c) => clubCardHtml(app, c, { act: "off-decide", data: `data-type="loan" data-club="${c.clubId}" data-next="1"`, selected: d.type === "loan" && d.clubId === c.clubId, btn: "임대 →" })).join("");
  return `${clubCardHtml(app, own, { act: "off-decide", data: `data-type="stay" data-club="${p.clubId}" data-next="1"`, selected: d.type === "stay", btn: "잔류 →", tag: "현 소속" })}
    ${last ? `<button class="btn block" data-act="same-again">⏩ 잔류 + 지난 시즌 육성 그대로 바로 시작</button>` : ""}
    ${off.offers.length ? `<details class="cr-fold" ${own.stage < 1 ? "open" : ""}><summary>📨 영입 제안 ${off.offers.length}개</summary>${offerCards}</details>` : ""}
    ${off.loans.length ? `<details class="cr-fold"><summary>🏖 임대 가능 ${off.loans.length}개</summary>${loanCards}</details>` : ""}
    <div class="cr-mini-links">
      ${(p.conversions || 0) < MAX_CONVERSIONS && !s.off.converted ? `<button class="btn sm" data-act="off-step" data-step="pos">🔄 포지션 전환</button>` : ""}
      <button class="btn sm" data-act="retire-now">🏁 은퇴·새로 시작</button>
    </div>`;
}

/* ---------- ② 훈련 ---------- */
function shopStep(app) {
  const s = app.state, p = s.player, off = s.off;
  if (off.shopUsed) {
    const u = off.shopUsed;
    return `<section class="card"><b>✔ ${u.kind === "special" ? "특급 훈련 캠프" : "일반 훈련"}</b> ${catLabel(u.cat)} +${u.amount.toFixed(1)}</section>
      <button class="btn primary block" data-act="off-step" data-step="costume">다음: 코스튬 →</button>`;
  }
  const ovr = Math.round(playerOvr(s, false));
  const price = shopPrice(ovr);
  const kind = app.view.shopKind || (p.money >= price.special && p.age >= 19 ? "special" : "normal");
  const cat = app.view.shopCat || null;
  const cost = price[kind], lack = p.money < cost;
  let prev = "";
  if (cat) {
    const r = previewTraining(p, kind, cat);
    const key = reevaluateType(p.typeKey, catValues(r.subs));
    const after = Math.round(playerOvr({ ...s, player: { ...p, subs: r.subs } }, false));
    prev = `<p class="cr-prev">${catLabel(cat)} +${r.amount.toFixed(1)} → OVR <b>${after}</b>${key !== p.typeKey ? ` · 🧬 ${esc(typeName(p.pos, key))}` : ""}</p>`;
  }
  return `<section class="card">
    <div class="chip-row">${[["normal", "일반", SHOP.normal], ["special", "특급", SHOP.special]].map(([k, n, amt]) =>
      `<button class="chip ${kind === k ? "active" : ""}" data-act="shop-kind" data-kind="${k}">${n} +${amt} · ${money(price[k])}</button>`).join("")}</div>
    <div class="chip-row">${CATS.filter((c) => W[p.pos][c] > 0).map((c) => `<button class="chip ${cat === c ? "active" : ""}" data-act="shop-cat" data-cat="${c}">${catLabel(c)}</button>`).join("")}</div>
    ${prev}
    <p class="cr-dim">보유 ${money(p.money)}${levelCoef(ovr) < 1 ? ` · 효과 ×${levelCoef(ovr).toFixed(2)}` : ""}${lack ? ` · <span class="cr-warn">${money(cost - p.money)} 부족</span>` : ""}</p>
    ${app.view.shopMsg ? `<p class="cr-warn">${esc(app.view.shopMsg)}</p>` : ""}
    <div class="cr-actions-inline">
      <button class="btn" data-act="off-step" data-step="costume">건너뛰기 →</button>
      <button class="btn primary" data-act="shop-buy" ${cat && !lack ? "" : "disabled"}>구매하고 다음 →</button>
    </div>
  </section>`;
}

/* ---------- ③ 👕 코스튬 (30-4) ---------- */
const bonusText = (b) => Object.keys(b).filter((c) => b[c] > 0).map((c) => `${catLabel(c)} +${b[c].toFixed(1)}`).join(" · ");
export function costumeStep(app) {
  const s = app.state, p = s.player, off = s.off;
  ensureCostume(s);
  const slot = SLOTS.includes(app.view.cosSlot) ? app.view.cosSlot : "boots";
  const tryIt = parseItem(app.view.cosTry);
  const eq = { ...p.equip };
  if (tryIt) eq[tryIt.slot] = tryIt.id;
  // 이번 시즌 뛸 구단 색 (이적·임대를 골랐으면 그 구단)
  const color = (app.base.get(off.decision.clubId) || {}).color;
  const used = off.costumeUsed ? parseItem(off.costumeUsed) : null;
  const gNow = gearDelta(p), gTry = tryIt ? gearDelta({ ...p, equip: eq }) : null;
  const b = equipBonus(p);
  const items = slotItems(slot).map((it) => {
    const owned = p.wardrobe.includes(it.id), worn = p.equip[slot] === it.id, trying = tryIt && tryIt.id === it.id;
    const lack = p.money < it.price;
    const btns = owned
      ? (worn ? `<button class="btn sm" data-act="cos-equip" data-slot="${slot}" data-id="">벗기</button>` : `<button class="btn sm primary" data-act="cos-equip" data-slot="${slot}" data-id="${it.id}">착용</button>`)
      : `<button class="btn sm ${trying ? "active" : ""}" data-act="cos-try" data-id="${trying ? "" : it.id}">${trying ? "그만 입기" : "입어 보기"}</button>
         <button class="btn sm primary" data-act="cos-buy" data-id="${it.id}" ${used || lack ? "disabled" : ""}>${money(it.price)} 구매</button>`;
    return `<div class="cr-cos-item g${it.grade}${worn ? " worn" : ""}${trying ? " trying" : ""}">
      <span class="cr-cos-sw" style="background:${it.grade === 3 ? `linear-gradient(135deg,${CAT_COLOR[it.cat]} 55%,#d9b04a 55%)` : CAT_COLOR[it.cat]}"></span>
      <div class="cr-cos-info"><b>${esc(itemName(it))}</b>
        <small><span class="cr-cos-g">${GRADE_LABEL[it.grade]}</span> · ${catLabel(it.cat)} +${it.amt.toFixed(1)}${owned ? " · ✔ 보유" : lack ? ` · <span class="cr-warn">${money(it.price - p.money)} 부족</span>` : ""}</small></div>
      <div class="cr-cos-btns">${btns}</div></div>`;
  }).join("");
  const owned = p.wardrobe.map(parseItem).filter(Boolean);
  return `<section class="card cr-cos">
    <div class="cr-cos-top">
      <div class="cr-cos-av">${avatarSvg({ look: p.look, equip: eq, color, size: 132, label: p.name + " 아바타" })}</div>
      <div class="cr-cos-side">
        <p>${used ? `✔ 이번 시즌 구매: <b>${esc(itemName(used))}</b>` : `🛍 이번 시즌 <b>1개</b> 구매 가능`}<br><span class="cr-dim">보유 ${money(p.money)}</span></p>
        <p class="cr-dim">장비 효과: ${bonusText(b) || "없음"}<br>→ 경기 OVR <b>+${gNow.toFixed(1)}</b>${gTry !== null && Math.abs(gTry - gNow) > 0.001 ? ` <span class="cr-hit">(입어 보기 +${gTry.toFixed(1)})</span>` : ""}</p>
      </div>
    </div>
    <div class="chip-row cr-cos-slots">${SLOTS.map((k) => `<button class="chip ${slot === k ? "active" : ""}" data-act="cos-slot" data-slot="${k}">${SLOT_LABEL[k]}${p.equip[k] ? " •" : ""}</button>`).join("")}</div>
    <div class="cr-cos-list">${items}</div>
    ${app.view.cosMsg ? `<p class="cr-warn">${esc(app.view.cosMsg)}</p>` : ""}
    ${owned.length ? `<details class="cr-fold"><summary>👔 옷장 ${owned.length}개 — 눌러서 갈아입기 (무료)</summary><div class="chip-row">${owned.map((it) =>
      `<button class="chip ${p.equip[it.slot] === it.id ? "active" : ""}" data-act="cos-equip" data-slot="${it.slot}" data-id="${p.equip[it.slot] === it.id ? "" : it.id}">${SLOT_LABEL[it.slot].split(" ")[0]} ${esc(itemName(it))}</button>`).join("")}</div></details>` : ""}
    <p class="cr-note">장비 효과는 경기 안 활약(득점·도움·평점)과 시즌 목표에만 반영돼요. 출전 역할·성장·훈련 가격·업적 OVR은 맨몸 기준이에요.</p>
  </section>
  <button class="btn primary block" data-act="off-step" data-step="focus">다음: 집중 육성 →</button>`;
}

/* ---------- ④ 집중 육성 + 시즌 시작 ---------- */
function focusStep(app) {
  const s = app.state, p = s.player, off = s.off;
  const pv = decisionPreview(s);
  const c = s.world.clubs[off.decision.clubId];
  const cv = catValues(p.subs);
  const sim = {};
  for (const k of CATS) sim[k] = cv[k] + (off.focus.includes(k) ? 8 : 2.4);
  const key = reevaluateType(p.typeKey, sim);
  const pm = prefMatch(p.pos, p.typeKey, c.pref);
  const d = off.decision;
  return `${off.shopUsed && app.view.shopMsg ? `<p class="cr-hit">${esc(app.view.shopMsg)}</p>` : ""}
    <section class="card">
    <div class="cr-focus">${CATS.map((k) => `<button class="cr-focus-b ${off.focus.includes(k) ? "on" : ""}" data-act="off-focus" data-cat="${k}">
      <span>${catLabel(k)}${c.coach.includes(k) ? " 🏋️" : ""}</span><b>${Math.round(cv[k])}</b><small>중요도 ${W[p.pos][k]}%</small></button>`).join("")}</div>
    <p class="cr-dim">3개 선택 · 🏋️ 코치진 특화(성장 ×1.3)${pm === "full" ? " · 🎯 감독 선호 유형 일치" : ""} <button class="btn sm" data-act="off-focus-reco">추천</button></p>
    ${key !== p.typeKey ? `<p class="cr-hit">🧬 ${esc(typeName(p.pos, key))}(으)로 진화할 수 있어요</p>` : ""}
    </section>
    <section class="card cr-plan">
      <div>${d.type === "stay" ? "잔류" : d.type === "loan" ? "🏖 임대" : "✈️ 이적"} ${clubLabel(app.base, d.clubId)} ${roleBadge(pv.card.role)} <span class="cr-dim">성장 ${pv.card.efficiency}%</span></div>
      <div>📋 목표: <b>${esc(goalText(pv.goal))}</b></div>
    </section>
    <div class="cr-actions"><button class="btn primary" data-act="play" ${off.focus.length === 3 ? "" : "disabled"}>▶ 시즌 시작</button></div>`;
}

/* ---------- 포지션 전환 (구단 단계에서 들어옴) ---------- */
function posStep(app) {
  const s = app.state, p = s.player;
  const now = Math.round(playerOvr(s, false));
  return `<section class="card">
    <p class="cr-dim">인접 포지션만 · 남은 ${MAX_CONVERSIONS - (p.conversions || 0)}번 · 첫 시즌 OVR −${CONVERT_PENALTY}</p>
    ${conversionOptions(p).map((o) => `<div class="cr-conv"><div><b>${posLabel(o.pos)}</b> · ${esc(typeName(o.pos, o.typeKey))}<br><span class="cr-dim">OVR ${now} → ${o.ovr} → 적응 후 ${o.ovrAfter}</span></div>
      <button class="btn sm" data-act="convert" data-pos="${o.pos}">전환</button></div>`).join("")}
  </section>
  <button class="btn block" data-act="off-step" data-step="club">← 구단 선택으로</button>`;
}
