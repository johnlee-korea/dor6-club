/* ============================================================
   career/views/records.js — 커리어 기록 · 은퇴 · 내 선수 명예의 전당 · 업적 · 설정 · 권리 고지 (26-12 ⑦~⑨)
   ============================================================ */
import { ACHIEVEMENTS, ACH_CATS } from "../achievements.js";
import { careerSummary } from "../career.js";
import { NOTICE, seasonLabel } from "../config.js";
import { renderLine } from "../charts.js";
import { esc, money, clubLabel, clubText, leagueShort, roleBadge, typeIdLabel, posLabel } from "../ui.js";
import { parseType } from "../types.js";

/* ---------- 커리어 기록 ---------- */
export function career(app) {
  const s = app.state;
  const t = s.totals;
  const types = careerSummary(s).types;
  return `<div class="cr-season-head"><b>${esc(s.player.name)}의 커리어</b> <span class="cr-dim">${t.seasons}시즌</span>
      <button class="btn sm" data-act="go" data-to="${s.phase === "retired" ? "retire" : "offseason"}">← 돌아가기</button></div>
    <section class="card"><h3 class="cr-h3">OVR 추이 <span class="cr-dim">🌟 레전드 시즌</span></h3><div id="cr-ovr-chart"></div></section>
    <section class="card"><h3 class="cr-h3">🧬 유형 변천사</h3><p>${types.map((id) => esc(typeIdLabel(id))).join(" → ")}</p></section>
    ${seasonTable(app, s.history)}
    ${totalsCard(t)}`;
}
function seasonTable(app, hs) {
  return `<section class="card"><h3 class="cr-h3">시즌별 기록</h3><div class="table-wrap"><table class="cr-table"><thead><tr><th>나이</th><th>소속</th><th>역할</th><th>경기</th><th>골</th><th>도움</th><th>평점</th><th>OVR</th><th>순위</th></tr></thead><tbody>
    ${hs.map((h) => `<tr><td>${h.age}${h.legend ? " 🌟" : ""}${h.slump ? " 💧" : ""}</td><td class="cr-opp">${esc(clubText(app.base, h.club))}${h.parent ? " (임대)" : ""}<br><small class="cr-dim">${leagueShort(h.league)}</small></td><td>${roleBadge(h.role)}</td>
      <td>${h.starts + h.subs}</td><td>${h.goals}</td><td>${h.assists}</td><td>${h.apps ? h.avg.toFixed(2) : "-"}</td><td>${h.ovrShown}${h.pos !== (hs[0] || h).pos ? `<small class="cr-dim"> ${h.pos}</small>` : ""}</td><td>${h.finish}${h.champion ? " 🏆" : ""}</td></tr>`).join("")}
  </tbody></table></div></section>`;
}
function totalsCard(t) {
  const aw = Object.entries(t.awards).map(([k, v]) => `${esc(k)} ${v}회`).join(" · ") || "없음";
  return `<section class="card"><div class="cr-sum">
    <div class="stat-tile"><span>최고 OVR</span><b>${t.maxOvr}</b></div>
    <div class="stat-tile"><span>통산</span><b>${t.apps}경기</b><small>${t.goals}골 ${t.assists}도움</small></div>
    <div class="stat-tile"><span>우승</span><b>${t.titles}회</b><small>레전드 ${t.legends}회</small></div>
  </div><p>🏅 수상: ${aw}</p><p>💰 통산 수입 ${money(t.income)} · 거친 구단 ${Object.keys(t.clubs).length}개 · ${t.countries.length}개국</p></section>`;
}
export function afterCareer(app) {
  const host = app.root.querySelector("#cr-ovr-chart");
  if (!host) return;
  const hs = app.state.history;
  if (!hs.length) { host.innerHTML = `<p class="cr-dim">첫 시즌을 마치면 그래프가 생겨요.</p>`; return; }
  const pts = hs.map((h) => ({ x: h.age, y: Math.round(h.ovrEnd * 10) / 10, mark: h.legend ? "★" : null,
    tip: [`${h.age}세 시즌 후 OVR ${Math.round(h.ovrEnd)}`, `${clubText(app.base, h.club)} · ${h.starts + h.subs}경기 ${h.goals}골 ${h.assists}도움`] }));
  const ys = pts.map((p) => p.y);
  const lo = Math.max(30, Math.floor((Math.min(...ys) - 3) / 5) * 5), hi = Math.min(100, Math.ceil((Math.max(...ys) + 3) / 5) * 5);
  renderLine(host, { points: pts, yMin: lo, yMax: hi, yTicks: [lo, Math.round((lo + hi) / 2), hi], xTicks: [pts[0].x, pts[pts.length - 1].x], ariaLabel: "나이별 포지션 OVR", xFmt: (v) => v + "세" });
}

/* ---------- 은퇴 ---------- */
export function retire(app) {
  const s = app.state;
  if (!s) return hall(app);
  const sum = careerSummary(s);
  return `<div class="cr-retire-box">
    <h2 class="cr-h2">🏁 ${esc(s.player.name)} 은퇴</h2>
    <p class="cr-dim">${sum.retiredAge}세 · ${sum.seasons}시즌 · 시작 유형 ${esc(typeIdLabel(sum.startType))}${sum.star ? "" : " (도전 모드)"}</p>
    ${totalsCard(s.totals)}
    <section class="card"><h3 class="cr-h3">🧬 유형 변천사</h3><p>${sum.types.map((id) => esc(typeIdLabel(id))).join(" → ")}</p>
      <p>🏅 업적 ${(s.achieved || []).length}개 달성</p></section>
    ${seasonTable(app, s.history)}
    <button class="btn primary block" data-act="hall-register">🏛 명예의 전당에 등록하고 새 커리어로</button>
    <button class="btn block" data-act="go" data-to="career">OVR 추이 보기</button>
  </div>`;
}

/* ---------- 내 선수 명예의 전당 (기기 누적) ---------- */
export function hall(app) {
  const k = app.view.hallSort || "maxOvr";
  const list = app.meta.hall.slice().sort((a, b) => (b[k] || 0) - (a[k] || 0));
  const sorts = [["maxOvr", "최고 OVR"], ["goals", "통산 골"], ["titles", "우승"], ["income", "수입"]];
  return `<h2 class="cr-h2">🏛 내 선수 명예의 전당</h2>
    <p class="cr-dim">이 기기에서 은퇴한 선수들이에요. "이번엔 저 기록을 넘겨 보자!"</p>
    <div class="chip-row">${sorts.map(([key, l]) => `<button class="chip ${k === key ? "active" : ""}" data-act="hall-sort" data-k="${key}">${l}</button>`).join("")}</div>
    ${list.length ? list.map((h, i) => `<details class="card cr-hall"><summary><b>${i + 1}.</b> ${esc(h.name)} <span class="cr-dim">${esc(typeIdLabel(h.types[h.types.length - 1]))}</span>
      <span class="cr-hall-v">${k === "income" ? money(h.income) : k === "maxOvr" ? "OVR " + h.maxOvr : k === "goals" ? h.goals + "골" : h.titles + "회 우승"}</span></summary>
      <p>${h.seasons}시즌 · ${h.apps}경기 ${h.goals}골 ${h.assists}도움 · 우승 ${h.titles} · 레전드 ${h.legends} · ${money(h.income)}</p>
      <p class="cr-dim">유형: ${h.types.map((id) => esc(typeIdLabel(id))).join(" → ")}</p>
      <p class="cr-dim">최고 무대: ${h.bestClub ? esc(clubText(app.base, h.bestClub)) : "-"} · 은퇴 ${h.retiredAge}세</p></details>`).join("")
      : `<p class="empty">아직 은퇴한 선수가 없어요. 첫 커리어를 끝까지 키워 보세요!</p>`}
    <button class="btn block" data-act="go" data-to="home">← 처음으로</button>`;
}

/* ---------- 업적 ---------- */
export function achievements(app) {
  const got = app.meta.achievements;
  const n = ACHIEVEMENTS.filter((a) => got[a.id]).length;
  return `<h2 class="cr-h2">🏅 업적 <span class="cr-dim">${n}/${ACHIEVEMENTS.length} (${Math.round(100 * n / ACHIEVEMENTS.length)}%)</span></h2>
    <p class="cr-dim">커리어가 끝나도 이 기기에 계속 남아요. 판마다 다른 길을 시도해 보세요.</p>
    ${ACH_CATS.map((c) => `<h3 class="cr-h3">${esc(c)}</h3><div class="cr-ach-grid">${ACHIEVEMENTS.filter((a) => a.cat === c).map((a) => `<div class="cr-ach-b ${got[a.id] ? "on" : ""}"><span>${got[a.id] ? a.icon : "🔒"}</span><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></div>`).join("")}</div>`).join("")}
    <button class="btn block" data-act="go" data-to="home">← 처음으로</button>`;
}

/* ---------- 설정·저장 ---------- */
export function settings(app) {
  const fast = app.meta.settings.fast !== false;
  return `<h2 class="cr-h2">⚙ 설정·저장</h2>
    <section class="card"><b>시즌 진행 연출</b><p class="cr-dim">켜면 약 15~20초 동안 라운드가 흘러가요. 끄면 바로 리포트.</p>
      <button class="btn" data-act="set-fast">${fast ? "🎬 연출 켜짐 → 끄기" : "⏭ 연출 꺼짐 → 켜기"}</button></section>
    <section class="card"><b>내보내기 (다른 기기로 옮기기·백업)</b>
      <p class="cr-dim">커리어·업적·명예의 전당을 글 하나로 만들어요. 복사해서 카톡 '나에게 보내기' 등에 보관하세요.</p>
      <button class="btn" data-act="export">내보내기 글 만들기</button>
      ${app.view.exportText ? `<textarea id="cr-export" class="input cr-ta" readonly>${esc(app.view.exportText)}</textarea><button class="btn sm" data-act="copy-export">📋 복사</button>` : ""}</section>
    <section class="card"><b>가져오기</b><p class="cr-dim">내보내기로 만든 글을 붙여 넣으세요. 지금 기기의 기록을 덮어써요.</p>
      <textarea id="cr-import" class="input cr-ta" placeholder='{"kind":"dor6-career", …}'></textarea>
      <button class="btn" data-act="import">가져오기</button></section>
    ${app.view.setMsg ? `<p class="cr-note">${esc(app.view.setMsg)}</p>` : ""}
    <section class="card"><b>초기화</b><p class="cr-dim">이 기기의 커리어·업적·명예의 전당을 모두 지워요.</p><button class="btn danger" data-act="reset">모두 지우기</button></section>
    <button class="btn block" data-act="go" data-to="home">← 처음으로</button>`;
}

/* ---------- 권리 고지 (이 페이지 전용) ---------- */
export const footer = (app) => `<p class="cr-notice">${esc(NOTICE)} 권리 문의: <a href="${esc((app.win.DOR6 && app.win.DOR6.recruitUrl) || "#")}" target="_blank" rel="noopener">도륙 오픈채팅</a></p>`;
export { posLabel, parseType, seasonLabel, clubLabel };
