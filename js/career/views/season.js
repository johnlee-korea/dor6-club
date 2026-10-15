/* ============================================================
   career/views/season.js — 시즌 진행 연출 · 시즌 리포트 (CLAUDE.md 26-12 ⑤⑥)
   결과는 [시즌 시작] 순간 이미 확정 — 연출은 저장된 경기 기록을 라운드 순서로 보여줄 뿐
   ============================================================ */
import { CATS, SUBS, POSITIONS, SLOTS, ROLE_LABEL } from "../rules.js";
import { leagueOf } from "../world.js";
import { goalText, goalValue } from "../goals.js";
import { achievementById } from "../achievements.js";
import { seasonLabel } from "../config.js";
import { GOAL_KIND_LABEL } from "../types.js";
import { renderLine, attrBars } from "../charts.js";
import { esc, money, catLabel, posLabel, clubLabel, clubText, leagueShort, roleBadge, typeLabel, fmt1 } from "../ui.js";

const SUB_LABEL = Object.fromEntries(CATS.flatMap((c) => SUBS[c].map(([k, n]) => [`${c}.${k}`, n])));
const APP = { S: "선발", U: "교체", N: "벤치", Y: "2군" };

export const loading = (app) => `<section class="card cr-loading"><div class="cr-spin">⚽</div><b>시즌 ${app.state.world.season} 진행 중…</b><p class="cr-dim">12개 리그 약 2,900경기를 계산하고 있어요.</p></section>`;

const lastOf = (app) => ({ s: app.state.history[app.state.history.length - 1], d: app.state.recent[app.state.recent.length - 1] });

/* ---------- 진행 연출 ---------- */
export function progress(app) {
  const { s, d } = lastOf(app);
  const k = app.view.progressK || 0;
  const N = d.matches.length;
  const ms = d.matches.slice(0, k);
  const rank = k ? d.roundRanks[d.matches[k - 1].k - 1] : null;
  let pts = 0;
  for (const m of ms) pts += m.gf > m.ga ? 3 : m.gf === m.ga ? 1 : 0;
  const so = { goals: ms.reduce((a, m) => a + m.g, 0), assists: ms.reduce((a, m) => a + m.a, 0), starts: ms.filter((m) => m.app === "S").length, subs: ms.filter((m) => m.app === "U").length };
  const rated = ms.filter((m) => m.r !== null);
  so.avg = rated.length ? rated.reduce((a, m) => a + m.r, 0) / rated.length / 10 : 0;
  const gv = goalValue(s.goal.kind, so), gp = s.goal.kind === "rating" ? (rated.length ? Math.min(1, so.avg / s.goal.target) : 0) : Math.min(1, gv / s.goal.target);
  const feed = ms.slice(-8).reverse().map((m) => matchLine(app, m)).join("");
  return `<section class="card cr-prog">
    <div class="cr-prog-head"><b>시즌 ${s.n}</b> <span class="cr-dim">${seasonLabel(s.n)} · ${clubText(app.base, s.club)} · ${leagueShort(s.league)}</span></div>
    <div class="progress"><span class="bar" style="display:block;width:${(100 * k / N).toFixed(1)}%"></span></div>
    <div class="cr-prog-stats"><span>${k}/${N}경기</span><span>순위 <b>${rank ? rank + "위" : "-"}</b></span><span>승점 ${pts}</span><span>⚽ ${so.goals} · 🅰️ ${so.assists}</span><span>평점 ${so.avg ? so.avg.toFixed(2) : "-"}</span></div>
    <div class="cr-goalbar"><span class="cr-dim">📋 ${esc(goalText(s.goal))}</span><div class="progress"><span class="bar" style="display:block;width:${(gp * 100).toFixed(0)}%"></span></div></div>
    <div class="cr-feed">${feed || `<p class="cr-dim">킥오프!</p>`}</div>
    <button class="btn block" data-act="skip">결과 바로 보기 ⏭</button>
  </section>`;
}
export function afterProgress(app) {
  const { d } = lastOf(app);
  if (app.view.timer) return;
  const N = d.matches.length;
  const step = Math.max(250, Math.round(17000 / N));
  app.view.progressK = app.view.progressK || 0;
  app.view.timer = app.win.setInterval(() => {
    if (app.route !== "season") { stopProgress(app); return; }
    app.view.progressK++;
    if (app.view.progressK >= N) { stopProgress(app); app.view.playing = null; app.win.setTimeout(() => app.go("report"), 900); }
    app.render();
  }, step);
}
export function stopProgress(app) {
  if (app.view.timer) app.win.clearInterval(app.view.timer);
  app.view.timer = null; app.view.progressK = 0;
}

function matchLine(app, m) {
  const res = m.gf > m.ga ? "승" : m.gf < m.ga ? "패" : "무";
  const me = m.app === "S" || m.app === "U"
    ? `${APP[m.app]}${m.app === "U" ? ` ${m.min}분` : ""}${m.g ? ` · ⚽${m.g > 1 ? "×" + m.g : ""}` : ""}${m.a ? ` · 🅰️${m.a > 1 ? "×" + m.a : ""}` : ""}${m.r !== null ? ` · ${(m.r / 10).toFixed(1)}` : ""}`
    : `<span class="cr-dim">${APP[m.app]}</span>`;
  return `<div class="cr-ml"><span class="cr-ml-k">R${m.k}</span><span class="cr-ml-opp">${m.home ? "vs" : "@"} ${esc(clubText(app.base, m.opp))}</span>
    <span class="cr-ml-sc cr-${res === "승" ? "w" : res === "패" ? "l" : "d"}">${m.gf}:${m.ga}</span><span class="cr-ml-me">${me}</span></div>`;
}

/* ---------- 리포트 ---------- */
export function report(app) {
  const { s, d } = lastOf(app);
  const lg = leagueOf(s.league);
  const tab = app.view.reportTab || "matches";
  const hl = (s.highlights || []).map((h) => `<div class="cr-hl"><span class="cr-hl-i">${h.icon}</span><div><b>${esc(h.title)}</b>${h.text ? `<small>${esc(h.text)}</small>` : ""}</div></div>`).join("");
  const ach = (s.achievements || []).map((id) => achievementById(id)).filter(Boolean)
    .map((a) => `<div class="cr-hl cr-ach"><span class="cr-hl-i">${a.icon}</span><div><b>업적 달성: ${esc(a.name)}</b><small>${esc(a.desc)}${(s.deviceNew || []).includes(a.id) ? " · 🆕 이 기기 첫 달성" : ""}</small></div></div>`).join("");
  const appsTxt = s.youth ? `1군 선발 ${s.starts} · 교체 ${s.subs} · 2군 ${s.youth}${s.bench ? ` · 벤치 ${s.bench}` : ""}` : `선발 ${s.starts} · 교체 ${s.subs} · 미출전 ${s.bench + s.youth}`;
  const P = 0.25 + 0.75 * s.ratio;
  const role = s.role !== s.roleEnd ? `${roleBadge(s.role)} → 후반기 ${roleBadge(s.roleEnd)}` : roleBadge(s.role);
  const rows = CATS.map((c) => ({ label: catLabel(c), before: s.cats[c], after: s.catsAfter[c] }));
  const finishTxt = `${s.finish}위${s.champion ? " 🏆 우승" : ""}${s.promoted ? " · ⬆️ 승격" : ""}${s.relegated ? " · ⬇️ 강등" : ""}`;
  const tabs = [["matches", "경기별 기록"], ["rank", "순위 추이"], ["leaders", "개인 순위"], ["table", "최종 순위표"]];
  return `<div class="cr-report">
    <div class="cr-season-head"><b>시즌 ${s.n} 리포트</b> <span class="cr-dim">${seasonLabel(s.n)} · ${s.age}세</span></div>
    <p class="cr-rep-club">${clubLabel(app.base, s.club, { strong: true })} ${s.parent ? `<span class="cr-tag">임대</span>` : ""} <span class="cr-dim">${esc(lg.label)} · ${finishTxt}</span></p>
    ${s.legend ? `<div class="cr-legend-banner">🌟 레전드 시즌 🌟</div>` : ""}
    ${hl || ach ? `<div class="cr-hls">${hl}${ach}</div>` : ""}
    <section class="card">
      <div class="cr-sum">
        <div class="stat-tile"><span>OVR</span><b>${Math.round(s.ovr)} → ${Math.round(s.ovrEnd)}</b><small class="${s.ovrEnd >= s.ovr ? "cr-upt" : "cr-down"}">${s.ovrEnd >= s.ovr ? "+" : "−"}${fmt1(Math.abs(s.ovrEnd - s.ovr))}</small></div>
        <div class="stat-tile"><span>경기</span><b>${s.starts + s.subs}</b><small>${s.goals}골 ${s.assists}도움</small></div>
        <div class="stat-tile"><span>평균 평점</span><b>${s.apps ? s.avg.toFixed(2) : "-"}</b><small>${s.posRank ? `포지션 ${s.posRank}/${s.posCount}위` : ""}</small></div>
      </div>
      <p class="cr-eff-line">📈 ${appsTxt} → <b>성장 효율 ${s.efficiency}%</b> <span class="cr-dim">(출전 ${Math.round(P * 100)}% × 경기 수준 ${Math.round(s.stage * 100)}%)</span></p>
      ${s.stage < 1 ? `<p class="cr-warn">⚠️ 지금 무대가 너무 쉬워요 (성장 효율 −${Math.round((1 - s.stage) * 100)}%) — 더 높은 무대가 필요해요</p>` : ""}
      <p>역할 ${role} · 감독 신뢰도 ${s.trust > 0 ? "+" : ""}${s.trust}${s.awards.length ? ` · 🏅 ${s.awards.map(esc).join(" · ")}` : ""}</p>
      <p>${s.met ? "✅" : "❌"} 시즌 목표: ${esc(goalText(s.goal))} → <b>${goalValue(s.goal.kind, s).toString()}</b>${s.slump ? " · 💧 슬럼프 시즌" : ""}${s.revival ? " · 🔥 부활" : ""}</p>
      <p>💰 수입 ${money(s.income)} <span class="cr-dim">(연봉 ${money(s.salary)} + 보너스)</span> · 보유 ${money(s.money)}</p>
      ${s.typeAfter !== s.type ? `<p class="cr-hit">🧬 유형 진화: ${esc(typeLabel(s.pos, s.type))} → <b>${esc(typeLabel(s.pos, s.typeAfter))}</b></p>` : ""}
    </section>
    <section class="card"><h3 class="cr-h3">능력치 변화 <span class="cr-dim">집중: ${s.focus.map(catLabel).join(" · ")}</span></h3>
      ${attrBars(rows, esc)}
      <p class="cr-dim">크게 오른 세부: ${s.subTop.filter(([, v]) => v > 0).map(([k, v]) => `${esc(SUB_LABEL[k])} +${v.toFixed(1)}`).join(" · ") || "없음"}</p>
    </section>
    <div class="chip-row cr-tabs">${tabs.map(([k, l]) => `<button class="chip ${tab === k ? "active" : ""}" data-act="report-tab" data-tab="${k}">${l}</button>`).join("")}</div>
    <section class="card">${{ matches: matchesTab, rank: () => `<h3 class="cr-h3">${esc(clubText(app.base, s.club))} 라운드별 순위</h3><div id="cr-rank-chart"></div><p class="cr-dim">그래프를 누르거나 손가락으로 훑으면 라운드별 결과가 보여요. 표로 보려면 '경기별 기록'.</p>`, leaders: leadersTab, table: tableTab }[tab](app, s, d)}</section>
    ${s.forcedRetire ? `<div class="cr-note warn">${s.forcedRetire === "age" ? "40세 시즌을 마치고 은퇴합니다." : "더 이상 영입 제안이 없어 은퇴합니다."}</div>` : ""}
    <button class="btn primary block" data-act="to-offseason">${app.state.phase === "retired" ? "🏁 커리어 요약 보기" : `다음 시즌 준비 → (${app.state.player.age}세)`}</button>
  </div>`;
}

function matchesTab(app, s, d) {
  return `<div class="table-wrap"><table class="cr-table cr-matches"><thead><tr><th>R</th><th>상대</th><th>결과</th><th>출전</th><th>골</th><th>도움</th><th>평점</th></tr></thead><tbody>
    ${d.matches.map((m) => {
      const res = m.gf > m.ga ? "w" : m.gf < m.ga ? "l" : "d";
      const goals = m.g ? m.mins.map((mi, i) => `${mi}'${GOAL_KIND_LABEL[m.kinds[i]] ? `(${GOAL_KIND_LABEL[m.kinds[i]]})` : ""}`).join(" ") : "";
      return `<tr><td>${m.k}</td><td class="cr-opp">${m.home ? "" : "@"}${esc(clubText(app.base, m.opp))}</td><td class="cr-${res}">${m.gf}:${m.ga}</td>
        <td>${APP[m.app]}${m.app === "U" ? ` ${m.min}'` : ""}</td><td>${m.g || ""}${goals ? `<small class="cr-dim"> ${esc(goals)}</small>` : ""}${m.winner ? " 💥" : ""}</td><td>${m.a || ""}</td><td>${m.r !== null ? (m.r / 10).toFixed(1) : ""}</td></tr>`;
    }).join("")}
  </tbody></table></div>`;
}
function leadersTab(app, s, d) {
  const t = app.view.leadTab || "g";
  const list = t === "g" ? d.scorers : t === "a" ? d.assistLeaders : d.ratingLeaders;
  const best = POSITIONS.map((p) => `<div><span class="cr-dim">${posLabel(p)}</span> ${(d.best11[p] || []).map((x) => `${x.me ? "<b>⭐ " + esc(x.name) + "</b>" : esc(x.name)} <small class="cr-dim">${esc(clubText(app.base, x.club))}</small>`).join(", ")}</div>`).join("");
  return `<div class="chip-row">${[["g", "득점"], ["a", "도움"], ["r", "평균 평점"]].map(([k, l]) => `<button class="chip ${t === k ? "active" : ""}" data-act="lead-tab" data-tab="${k}">${l}</button>`).join("")}</div>
    <ol class="cr-lead-list">${list.map((x) => `<li class="${x.me ? "cr-me" : ""}">${x.me ? "⭐ " : ""}${esc(x.name)} <small class="cr-dim">${esc(clubText(app.base, x.club))}</small> <b>${t === "r" ? x.v.toFixed(2) : x.v}</b></li>`).join("")}</ol>
    <h3 class="cr-h3">베스트11</h3><div class="cr-best11">${best}</div>`;
}
function tableTab(app, s, d) {
  return `<div class="table-wrap"><table class="cr-table"><thead><tr><th>#</th><th>구단</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>득실</th><th>승점</th></tr></thead><tbody>
    ${d.table.map((r, i) => `<tr class="${r.id === s.club ? "cr-me" : ""}"><td>${i + 1}</td><td>${esc(clubText(app.base, r.id))}</td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf - r.ga}</td><td><b>${r.pts}</b></td></tr>`).join("")}
  </tbody></table></div>`;
}

export function afterReport(app) {
  const host = app.root.querySelector("#cr-rank-chart");
  if (!host) return;
  const { s, d } = lastOf(app);
  const n = d.table.length;
  const lg = leagueOf(s.league);
  const byRound = new Map(d.matches.map((m) => [m.k, m]));
  const bands = [];
  if (lg.tier > 1) bands.push({ from: 0.5, to: 3.5, cls: "cr-band-up", label: "승격권" });
  if (lg.down) bands.push({ from: n - lg.down + 0.5, to: n + 0.5, cls: "cr-band-down", label: "강등권" });
  renderLine(host, {
    points: d.roundRanks.map((rank, i) => {
      const m = byRound.get(i + 1);
      const tip = [`${i + 1}라운드 · ${rank}위`];
      if (m) tip.push(`${m.home ? "vs" : "@"} ${clubText(app.base, m.opp)} ${m.gf}:${m.ga}`, m.app === "S" || m.app === "U" ? `${APP[m.app]}${m.g ? ` · ${m.g}골` : ""}${m.a ? ` · ${m.a}도움` : ""}${m.r !== null ? ` · 평점 ${(m.r / 10).toFixed(1)}` : ""}` : APP[m.app]);
      return { x: i + 1, y: rank, tip };
    }),
    yInvert: true, yMin: 1, yMax: n, yTicks: [1, Math.round(n / 2), n], xTicks: [1, Math.round(d.roundRanks.length / 2), d.roundRanks.length],
    bands, ariaLabel: "라운드별 우리 팀 순위", yFmt: (v) => v + "위", xFmt: (v) => "R" + v
  });
}
export { ROLE_LABEL, SLOTS };
