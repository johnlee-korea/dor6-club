/* ============================================================
   career/views/setup.js — 타이틀 · 선수 생성 · 시작 구단 선택 (CLAUDE.md 26-12 ①~③)
   ============================================================ */
import { makeRng } from "../../engine/rng.js";
import { CATS, POSITIONS, START, LEAGUES, COUNTRIES, entryMargin } from "../rules.js";
import { predictedStartOvr, isStar, comboShare } from "../attrs.js";
import { ALL_COMBOS, comboKey, comboPair, typeName } from "../types.js";
import { makeMyName } from "../names.js";
import { startClubOptions, playerOvr } from "../career.js";
import { ACHIEVEMENTS } from "../achievements.js";
import { NOTICE } from "../config.js";
import { esc, money, catLabel, posLabel, countryName, clubLabel, leagueShort } from "../ui.js";
import { playerCard, clubCardHtml } from "./cards.js";

let nameSeq = 0;
export const randomName = () => makeMyName(makeRng("name|" + Date.now() + "|" + nameSeq++));

/* ---------- 타이틀 ---------- */
export function home(app) {
  const s = app.state;
  const done = Object.keys(app.meta.achievements).length;
  const cont = s && s.phase !== "retired"
    ? `${s.phase === "start-club" ? `<section class="card"><b>${esc(s.player.name)}</b> — 시작 구단을 고르는 중이에요.</section>` : playerCard(app)}
       <button class="btn primary block" data-act="go" data-to="${s.phase === "start-club" ? "start-club" : "offseason"}">▶ 이어하기 (${s.player.age}세)</button>`
    : s && s.phase === "retired" ? `<button class="btn primary block" data-act="go" data-to="retire">🏁 은퇴 요약 보기</button>` : "";
  return `<div class="cr-home">
    <p class="cr-lead">포지션과 강점을 직접 골라 만든 16세 유망주를, 매 시즌 <b>구단 · 집중 육성 · 훈련</b>을 선택하며 키워 보세요. 숨겨진 잠재력은 없어요 — <b>선택이 결과를 만들어요.</b></p>
    ${cont}
    <button class="btn block ${cont ? "" : "primary"}" data-act="go" data-to="create">✨ 새 커리어</button>
    <div class="cr-home-links">
      <button class="btn" data-act="go" data-to="hall">🏛 내 선수 명예의 전당 (${app.meta.hall.length})</button>
      <button class="btn" data-act="go" data-to="achievements">🏅 업적 ${done}/${ACHIEVEMENTS.length}</button>
      <button class="btn" data-act="go" data-to="settings">⚙ 설정·저장</button>
    </div>
    <p class="cr-note">기록은 이 기기(브라우저)에만 저장돼요. 기기를 바꾸려면 ⚙ 설정에서 내보내기/가져오기를 쓰세요.</p>
  </div>`;
}

/* ---------- 선수 생성 ---------- */
export function create(app) {
  const d = app.view.draft;
  const R0 = app.clubsJson.clubs.map((c) => [c.R, c.league]);
  const entryCount = (ovr) => R0.filter(([R]) => R <= Math.round(ovr) + entryMargin(START.age)).length;
  const byCountry = (ovr) => {
    const m = {};
    for (const [R, lg] of R0) if (R <= Math.round(ovr) + entryMargin(START.age)) { const c = lg.slice(0, 2); m[c] = (m[c] || 0) + 1; }
    return m;
  };
  const pair = d.pair.length === 2 ? d.pair : null;
  const key = pair ? comboKey(pair[0], pair[1]) : null;
  const pred = pair ? predictedStartOvr(d.pos, pair) : null;
  const star = pair && isStar(d.pos, pair);
  const bc = pair ? byCountry(pred) : {};
  const rows = ALL_COMBOS.map((k) => ({ k, ovr: predictedStartOvr(d.pos, comboPair(k)), star: isStar(d.pos, comboPair(k)) }))
    .sort((a, b) => b.ovr - a.ovr);
  const todo = ACHIEVEMENTS.filter((a) => !app.meta.achievements[a.id]).slice(0, 3);
  return `<div class="cr-create">
    <h2 class="section-title">1. 이름</h2>
    <div class="cr-row"><input id="cr-name" class="input" maxlength="10" value="${esc(d.name)}" aria-label="선수 이름 (가상)"><button class="btn sm" data-act="create-name" title="랜덤 이름">🎲</button></div>
    <h2 class="section-title">2. 포지션</h2>
    <div class="chip-row">${POSITIONS.map((p) => `<button class="chip ${d.pos === p ? "active" : ""}" data-act="create-pos" data-pos="${p}">${posLabel(p)}</button>`).join("")}</div>
    <p class="cr-note">골키퍼는 없어요. 포지션마다 중요한 능력치가 달라요.</p>
    <h2 class="section-title">3. 강점 2개</h2>
    <div class="chip-row">${CATS.map((c) => `<button class="chip ${d.pair.includes(c) ? "active" : ""}" data-act="create-cat" data-cat="${c}">${catLabel(c)}</button>`).join("")}</div>
    ${pair ? `<section class="card cr-result">
      <div class="cr-result-type">${star ? "★ " : ""}${esc(typeName(d.pos, key))}</div>
      <div class="cr-result-line">예상 시작 OVR <b>${pred.toFixed(0)}</b> · 강점 비중 ${comboShare(d.pos, pair)}% · ${star ? "<span class='cr-hit'>★ 추천 조합</span>" : "<span class='cr-warn'>🧗 도전 모드 — 시작 구단 선택지가 적어요</span>"}</div>
      <div class="cr-result-line">입단 가능 구단 <b>${entryCount(pred)}</b>개 · ${COUNTRIES.map(([c, n]) => `${n} ${bc[c] || 0}`).join(" · ")}</div>
      <div class="cr-result-line cr-dim">시작 능력치: 강점 ${START.strongMin}~${START.strongMax} · 나머지 약 45~47 (평균 50)</div>
    </section>` : `<p class="cr-note">강점을 2개 골라 주세요.</p>`}
    <details class="cr-combos"><summary>${posLabel(d.pos)}의 15가지 조합 한눈에 보기</summary>
      <div class="table-wrap"><table class="cr-table"><thead><tr><th>유형</th><th>강점</th><th>예상 OVR</th><th>입단 가능</th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="${r.k === key ? "cr-me" : ""}" data-act="create-combo" data-combo="${r.k}"><td>${r.star ? "★ " : ""}${esc(typeName(d.pos, r.k))}</td><td class="cr-dim">${comboPair(r.k).map(catLabel).join(" + ")}</td><td>${r.ovr.toFixed(0)}</td><td>${entryCount(r.ovr)}</td></tr>`).join("")}
      </tbody></table></div>
    </details>
    ${todo.length ? `<p class="cr-note">🏅 아직 못 깬 업적: ${todo.map((a) => `${a.icon} ${esc(a.name)}`).join(" · ")}</p>` : ""}
    <button class="btn primary block" data-act="create-start" ${pair ? "" : "disabled"}>이 선수로 시작 → 시작 구단 고르기</button>
    <button class="btn block" data-act="go" data-to="home">← 처음으로</button>
  </div>`;
}

/* ---------- 시작 구단 ---------- */
export function startClub(app) {
  const s = app.state;
  const ovr = Math.round(playerOvr(s));
  const lim = ovr + entryMargin(s.player.age);
  const opts = startClubOptions(s);
  const by = {};
  for (const c of opts) (by[c.country] = by[c.country] || []).push(c);
  const tab = app.view.country || (COUNTRIES.find(([c]) => by[c]) || COUNTRIES[0])[0];
  const list = (by[tab] || []).slice();
  const rank = { S: 0, R: 1, B: 2 };
  list.sort((a, b) => rank[a.role] - rank[b.role] || (b.short - a.short) || ((b.prefMatch ? 1 : 0) - (a.prefMatch ? 1 : 0)) || b.R - a.R);
  const leagues = LEAGUES.filter((l) => l.country === tab);
  let body = "";
  if (list.length) {
    // 리그별 접기: 주전·로테이션 가능한 구단이 있는 리그를 먼저, 그 리그는 펼친 채로
    const groups = leagues.map((lg) => ({ lg, xs: list.filter((c) => c.league === lg.id) })).filter((g) => g.xs.length);
    const best = (g) => Math.min(...g.xs.map((c) => rank[c.role]));
    groups.sort((a, b) => best(a) - best(b) || a.lg.tier - b.lg.tier);
    groups.forEach((g, i) => {
      const cnt = { S: 0, R: 0, B: 0 };
      for (const c of g.xs) cnt[c.role]++;
      body += `<details class="cr-group" ${i === 0 ? "open" : ""}><summary><b>${esc(g.lg.label)}</b> <span class="cr-dim">${g.xs.length}개 · 주전 ${cnt.S} · 로테이션 ${cnt.R} · 후보 ${cnt.B}</span></summary>` +
        g.xs.map((c) => clubCardHtml(app, c, { act: "start-pick", data: `data-club="${c.clubId}"`, btn: "이 구단에서 시작" })).join("") + `</details>`;
    });
  } else {
    const all = Object.keys(s.world.clubs).filter((id) => s.world.clubs[id].league.startsWith(tab + ".")).sort((a, b) => s.world.clubs[a].R - s.world.clubs[b].R).slice(0, 3);
    const need = s.world.clubs[all[0]].R - (lim - ovr);
    body = `<div class="cr-note warn">이 나라는 OVR ${need}부터 입단할 수 있어요 — 실력을 키워 해외 이적으로 도전하세요.</div>` +
      all.map((id) => `<div class="cr-clubcard dim">${clubLabel(app.base, id)} <span class="cr-dim">${leagueShort(s.world.clubs[id].league)} · 요구 OVR ${s.world.clubs[id].R}</span></div>`).join("");
  }
  return `${playerCard(app)}
    <p class="cr-note">💡 16세엔 <b>출전 기회</b>가 성장에 가장 중요해요. 18세 이하는 1군에 못 나가도 2군 경기로 절반은 인정돼요. 🔍부족 포지션이 내 포지션인 구단은 선발 기회가 늘어나요.</p>
    <p class="cr-dim">입단 가능: 요구 OVR ${lim} 이하 (OVR ${ovr} + 여유 ${lim - ovr}, 유망주 여유 포함)</p>
    <div class="chip-row">${COUNTRIES.map(([c, n]) => `<button class="chip ${tab === c ? "active" : ""}" data-act="start-tab" data-c="${c}">${n} ${(by[c] || []).length}</button>`).join("")}</div>
    ${body}`;
}
export { money };
