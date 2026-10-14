/* ============================================================
   league/views.js — 도륙리그 탭별 화면 조각 (HTML 문자열만 만듦, 이벤트 연결은 league.js)
   ctx(league.js buildCtx): { status, date, no, snap, day, R, k, myId, pending, config, history, now }
   ============================================================ */
import * as C from "./clock.js";
import { reasonLabel } from "./eligibility.js";
import { playerStats, leaders } from "../engine/index.js";
import { ATTR_LABEL } from "../engine/team.js";

export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const empty = (msg, emoji = "📭") => `<div class="empty"><span class="emoji">${emoji}</span>${msg}</div>`;
const teamName = (ctx, id) => esc(ctx.day.names.get(id));
const player = (ctx, team, idx) => ctx.day.squads.get(team).players[idx];
const mine = (ctx, id) => (id === ctx.myId ? " lg-mine" : "");

/* 선수 기록 캐시 (라운드 k까지) */
export function statsAt(ctx, k) {
  ctx._stats = ctx._stats || new Map();
  if (!ctx._stats.has(k)) ctx._stats.set(k, playerStats(ctx.day.rounds, ctx.day.results, k));
  return ctx._stats.get(k);
}
/* 팀당 치른 경기 수(라운드 k까지, 휴식 제외 평균) */
const gamesPerTeam = (ctx, k) => {
  let n = 0;
  for (let r = 0; r < k; r++) n += ctx.day.rounds[r].matches.length * 2;
  return n / ctx.day.ids.length;
};

/* 득점 이벤트 한 줄: 23' 김도윤 (도움 이서준) */
function goalLine(ctx, m, e) {
  const team = e.side === "h" ? m.home : m.away;
  const t = e.add ? `90+${e.add}'` : `${e.min}'`;
  const as = e.as !== null ? ` <span class="lg-dim">(도움 ${esc(player(ctx, team, e.as).name)})</span>` : "";
  return `<div class="lg-goal ${e.side}"><span class="lg-min">${t}</span> ⚽ ${esc(player(ctx, team, e.s).name)}${as}</div>`;
}

/* 경기 카드 (결과 공개 전이면 예정 시각) */
export function matchCard(ctx, r, i, open = false) {
  const m = ctx.day.rounds[r].matches[i];
  const done = r < ctx.k;
  const res = ctx.day.results[r][i];
  const win = done ? (res.hg > res.ag ? m.home : res.ag > res.hg ? m.away : null) : null;
  const cls = (id) => `lg-team${mine(ctx, id)}${id === win ? " lg-win" : ""}`;
  const score = done ? `<b class="lg-score">${res.hg} : ${res.ag}</b>` : `<span class="lg-time">${C.hm(C.roundMs(ctx.date, r + 1, ctx.R))}</span>`;
  const head = `<div class="lg-match-row"><span class="${cls(m.home)} h">${teamName(ctx, m.home)}</span>${score}<span class="${cls(m.away)} a">${teamName(ctx, m.away)}</span></div>`;
  if (!done || !res.ev.length) return `<div class="lg-match">${head}</div>`;
  return `<details class="lg-match"${open ? " open" : ""}><summary>${head}</summary><div class="lg-goals">${res.ev.map((e) => goalLine(ctx, m, e)).join("")}</div></details>`;
}

/* 순위표 (라운드 k 기준, 직전 라운드 대비 변동) */
export function tableHtml(ctx, k, limit) {
  const rows = ctx.day.tables[k];
  const prev = k > 0 ? new Map(ctx.day.tables[k - 1].map((r) => [r.id, r.rank])) : null;
  let list = limit ? rows.slice(0, limit) : rows;
  if (limit && ctx.myId) {
    const me = rows.find((r) => r.id === ctx.myId);
    if (me && me.rank > limit) list = me.rank === limit + 1 ? [...list, me] : [...list, null, me];   // null = 생략 줄
  }
  const form = (f) => f.map((x) => `<span class="lg-f ${x}">${{ W: "승", D: "무", L: "패" }[x]}</span>`).join("");
  const move = (r) => {
    if (!prev || k === 0) return "";
    const d = prev.get(r.id) - r.rank;
    return d > 0 ? `<span class="lg-up">▲${d}</span>` : d < 0 ? `<span class="lg-down">▼${-d}</span>` : `<span class="lg-same">-</span>`;
  };
  return `<div class="table-wrap"><table class="data lg-table"><thead><tr>
      <th class="num">#</th><th>팀</th><th class="num">경기</th><th class="num">승점</th><th class="num">득실</th>
      <th class="num">승</th><th class="num">무</th><th class="num">패</th><th class="num">득</th><th class="num">실</th><th>최근 5</th></tr></thead><tbody>
    ${list.map((r) => r === null ? `<tr class="lg-gap"><td colspan="11">⋯</td></tr>` : `<tr class="${mine(ctx, r.id).trim()}">
      <td class="num"><span class="rank ${r.rank <= 3 ? "r" + r.rank : ""}">${r.rank}</span> ${move(r)}</td>
      <td class="lg-tname">${teamName(ctx, r.id)}</td><td class="num">${r.p}</td><td class="num"><b>${r.pts}</b></td>
      <td class="num">${r.gd > 0 ? "+" : ""}${r.gd}</td><td class="num">${r.w}</td><td class="num">${r.d}</td><td class="num">${r.l}</td>
      <td class="num">${r.gf}</td><td class="num">${r.ga}</td><td>${form(r.form)}</td></tr>`).join("")}
    </tbody></table></div>`;
}

/* 상단 정보 카드 (모든 탭 공통) */
export function headCard(ctx) {
  const st = ctx.status;
  const badge = {
    before: `<span class="badge warn">개막 전</span>`, live: `<span class="badge ok">진행 중</span>`,
    done: `<span class="badge">오늘 종료</span>`, forming: `<span class="badge warn">편성 중</span>`,
    delayed: `<span class="badge danger">편성 지연</span>`, rest: `<span class="badge">휴무</span>`,
    none: `<span class="badge">예정된 리그 없음</span>`
  }[st];
  if (!ctx.day) {
    return `<div class="card lg-head"><div class="lg-title">⚽ 도륙리그 ${badge}</div>${statusMessage(ctx)}</div>`;
  }
  const isToday = ctx.viewToday;
  const pct = ctx.R ? Math.round((ctx.k / ctx.R) * 100) : 0;
  return `<div class="card lg-head">
    <div class="lg-title">제${ctx.no}회 도륙리그 ${isToday ? badge : `<span class="badge">지난 회차</span>`}</div>
    <div class="lg-sub">${C.dateLabel(ctx.date)} · 참가 ${ctx.day.ids.length}팀 · ${ctx.R}라운드 · ${C.hm(C.roundMs(ctx.date, 0, ctx.R))}~${C.endLabel(ctx.R)}</div>
    <div class="progress ${ctx.k >= ctx.R ? "ok" : ""}"><div class="bar" style="width:${pct}%"></div></div>
    <div class="lg-prog"><span><b>${ctx.k}</b> / ${ctx.R} 라운드</span><span id="lg-count" class="lg-count">${countdownText(ctx)}</span></div>
    ${isToday ? "" : statusMessage(ctx)}
  </div>`;
}

/* 다음 이벤트까지 남은 시간 문구 (1초마다 갱신) */
export function countdownText(ctx) {
  if (!ctx.day || !ctx.viewToday) return "";
  const now = ctx.now();
  let target, label;
  if (ctx.k >= ctx.R) return "🏁 모든 라운드 종료";
  if (now < C.roundMs(ctx.date, 0, ctx.R)) { target = C.roundMs(ctx.date, 0, ctx.R); label = "개막까지"; }
  else { target = C.roundMs(ctx.date, ctx.k + 1, ctx.R); label = `${ctx.k + 1}라운드 결과까지`; }
  const s = Math.max(0, Math.ceil((target - now) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const t = h ? `${h}시간 ${m}분` : `${m}:${String(sec).padStart(2, "0")}`;
  return `⏱ ${label} <b>${t}</b>`;
}

/* 리그가 없거나 지난 회차를 보여 줄 때 안내 문구 */
function statusMessage(ctx) {
  const st = ctx.status;
  const pend = ctx.pending ? `<div class="lg-note">📅 다음 리그: <b>제${ctx.pending.no}회 ${C.dateLabel(ctx.pending.date)} 07:00</b> 개막</div>` : "";
  if (st === "forming") return `<div class="lg-note">🛠 오늘 리그 편성 중이에요. 07:00 개막 — 잠시 후 다시 확인해 주세요.</div>`;
  if (st === "delayed") return `<div class="lg-note warn">⚠ 오늘 리그 편성이 늦어지고 있어요. 운영자 확인이 필요해요.</div>`;
  if (st === "rest") return `<div class="lg-note">😴 참가팀이 부족해 오늘은 쉬어요.</div>`;
  if (st === "none") return pend || `<div class="lg-note">다음 리그는 운영자가 예약하면 열려요.</div>`;
  return pend;
}

/* ---------- 탭 ① 라이브 ---------- */
export function tabLive(ctx) {
  if (!ctx.day) return ctx.history.days.length ? lastResultCard(ctx.history.days[ctx.history.days.length - 1]) : "";
  const k = ctx.k, R = ctx.R;
  let html = "";
  if (k >= R) html += finalCard(ctx);
  if (k === 0) {
    // 개막 전: 1라운드 대진
    html += `<div class="section-title">🗓 1라운드 대진 <span class="lg-dim">${C.hm(C.roundMs(ctx.date, 1, R))} 결과</span></div>
      <div class="card">${ctx.day.rounds[0].matches.map((_, i) => matchCard(ctx, 0, i)).join("")}${byeLine(ctx, 0)}</div>`;
  } else if (k < R || ctx.viewToday) {
    const r = k - 1;
    html += `<div class="section-title">📣 ${k}라운드 결과 <span class="lg-dim">${C.hm(C.roundMs(ctx.date, k, R))}</span></div>
      <div class="card">${ctx.day.rounds[r].matches.map((_, i) => matchCard(ctx, r, i)).join("")}${byeLine(ctx, r)}</div>`;
  }
  html += `<div class="section-title">📊 순위 <a class="lg-more" href="#table">전체 ›</a></div><div class="card">${tableHtml(ctx, k, 5)}</div>`;
  html += excludedBox(ctx);
  return html;
}

function byeLine(ctx, r) {
  const b = ctx.day.rounds[r].bye;
  return b ? `<div class="lg-bye">😴 휴식: ${teamName(ctx, b)}</div>` : "";
}

/* 오늘 불참 명단 (판수 미달·휴식·부계정) — 판수 채우면 다음 리그부터 참가 */
function excludedBox(ctx) {
  const ex = (ctx.snap && ctx.snap.excluded) || [];
  if (!ex.length) return "";
  return `<details class="card lg-excl"><summary>🚫 이번 회차 불참 ${ex.length}명</summary>
    <div class="lg-excl-list">${ex.map((x) => `<span class="lg-excl-item${mine(ctx, x.ouid)}">${esc(x.name)} <span class="lg-dim">${esc(reasonLabel(x))}</span></span>`).join("")}</div>
    <div class="lg-dim" style="margin-top:6px;">시즌 판수 진행률에 못 미치면 리그에 나갈 수 없어요. 판수를 채우면 다음 리그부터 자동 참가!</div></details>`;
}

/* 종료 카드: 우승·득점왕·도움왕·MVP */
function finalCard(ctx) {
  const st = statsAt(ctx, ctx.R);
  const champ = ctx.day.tables[ctx.R][0];
  const g = leaders(st, "g", 1)[0], a = leaders(st, "a", 1)[0];
  const mvp = leaders(st, "avg", 1, Math.ceil(gamesPerTeam(ctx, ctx.R) / 2))[0];
  const p = (s) => s ? `${esc(player(ctx, s.team, s.idx).name)} <span class="lg-dim">${teamName(ctx, s.team)}</span>` : "-";
  return `<div class="card lg-final">
    <div class="lg-champ">🏆 우승 <b>${teamName(ctx, champ.id)}</b></div>
    <div class="lg-dim">${champ.w}승 ${champ.d}무 ${champ.l}패 · 승점 ${champ.pts} · 득실 ${champ.gd > 0 ? "+" : ""}${champ.gd}</div>
    <div class="lg-awards">
      <div>⚽ 득점왕 ${p(g)} <b>${g ? g.g + "골" : ""}</b></div>
      <div>🅰️ 도움왕 ${p(a)} <b>${a ? a.a + "도움" : ""}</b></div>
      <div>⭐ MVP ${p(mvp)} <b>${mvp ? "평점 " + mvp.avg.toFixed(2) : ""}</b></div>
    </div></div>`;
}

/* 리그 없는 날: 직전 회차 결과 요약 (history) */
function lastResultCard(h) {
  const c = h.table && h.table[0];
  if (!c) return "";
  const s = h.scorers && h.scorers[0];
  return `<div class="section-title">🏆 지난 회차 결과</div><div class="card lg-final">
    <div class="lg-dim">제${h.no}회 · ${C.dateLabel(h.date)} · ${h.teams}팀</div>
    <div class="lg-champ">🏆 우승 <b>${esc(c.name)}</b></div>
    <div class="lg-dim">${c.w}승 ${c.d}무 ${c.l}패 · 승점 ${c.pts}</div>
    ${s ? `<div class="lg-awards"><div>⚽ 득점왕 ${esc(s.player)} <span class="lg-dim">${esc(s.team)}</span> <b>${s.goals}골</b></div></div>` : ""}
    <a class="lg-more" href="#records">기록실 ›</a></div>`;
}

/* ---------- 탭 ② 순위표 ---------- */
export function tabTable(ctx, sel) {
  if (!ctx.day) return empty("표시할 리그가 없어요.");
  const r = sel == null ? ctx.k : Math.min(sel, ctx.k);
  const opts = Array.from({ length: ctx.k + 1 }, (_, i) => `<option value="${i}"${i === r ? " selected" : ""}>${i === 0 ? "개막 전" : i + "라운드 후"}</option>`).reverse().join("");
  return `<div class="lg-tools"><label class="lg-dim">기준</label><select class="input lg-select" data-sel="table">${opts}</select></div>
    <div class="card">${tableHtml(ctx, r)}</div>
    <div class="lg-dim lg-foot">순위: 승점 → 득실차 → 다득점 → 승수. ▲▼ = 직전 라운드 대비.</div>`;
}

/* ---------- 탭 ③ 개인 순위 ---------- */
const P_KINDS = [["g", "득점"], ["a", "도움"], ["ap", "공격포인트"], ["avg", "평균 평점"]];
export function tabPlayers(ctx, kind = "g") {
  if (!ctx.day) return empty("표시할 리그가 없어요.");
  if (ctx.k === 0) return chips(kind) + empty("1라운드가 끝나면 개인 기록이 나와요.", "⏳");
  const minApps = Math.max(1, Math.ceil(gamesPerTeam(ctx, ctx.k) / 3));
  const list = leaders(statsAt(ctx, ctx.k), kind, 20, minApps);
  const val = (s) => kind === "avg" ? s.avg.toFixed(2) : s[kind];
  const sub = (s) => kind === "avg" ? `${s.apps}경기` : kind === "ap" ? `${s.g}골 ${s.a}도움` : `${s.apps}경기`;
  return chips(kind) + `<div class="card">${list.length ? list.map((s, i) => {
    const p = player(ctx, s.team, s.idx);
    return `<div class="lg-prow${mine(ctx, s.team)}"><span class="rank ${i < 3 ? "r" + (i + 1) : ""}">${i + 1}</span>
      <div class="lg-pinfo"><b>${esc(p.name)}</b> <span class="lg-pos">${p.pos}</span><div class="lg-dim">${teamName(ctx, s.team)}</div></div>
      <div class="lg-pval"><b>${val(s)}</b><div class="lg-dim">${sub(s)}</div></div></div>`;
  }).join("") : empty("기록이 없어요.")}</div>
  ${kind === "avg" ? `<div class="lg-dim lg-foot">평균 평점은 팀 경기 수의 1/3(${minApps}경기) 이상 출전 선수만.</div>` : ""}`;
  function chips(cur) {
    return `<div class="chip-row">${P_KINDS.map(([k, l]) => `<button type="button" class="chip${k === cur ? " active" : ""}" data-kind="${k}">${l}</button>`).join("")}</div>`;
  }
}

/* ---------- 탭 ④ 일정/결과 ---------- */
export function tabFixtures(ctx, sel) {
  if (!ctx.day) return empty("표시할 리그가 없어요.");
  const def = ctx.k >= ctx.R ? ctx.R : Math.max(1, ctx.k);
  const r = sel == null ? def : sel;
  const opts = ctx.day.rounds.map((_, i) => {
    const n = i + 1, t = C.hm(C.roundMs(ctx.date, n, ctx.R));
    return `<option value="${n}"${n === r ? " selected" : ""}>${n}라운드 · ${t}${n <= ctx.k ? " ✓" : ""}</option>`;
  }).join("");
  return `<div class="lg-tools"><select class="input lg-select" data-sel="fixtures">${opts}</select></div>
    <div class="card">${ctx.day.rounds[r - 1].matches.map((_, i) => matchCard(ctx, r - 1, i, false)).join("")}${byeLine(ctx, r - 1)}</div>
    <div class="lg-dim lg-foot">${r <= ctx.k ? "경기를 누르면 득점자가 보여요." : `${C.hm(C.roundMs(ctx.date, r, ctx.R))}에 결과가 공개돼요.`}</div>`;
}

/* ---------- 탭 ⑤ 내 팀 ---------- */
export function tabMyTeam(ctx, sel) {
  if (!ctx.day) return empty("표시할 리그가 없어요.");
  const ex = ((ctx.snap && ctx.snap.excluded) || []).find((x) => x.ouid === ctx.myId);
  const id = sel || (ctx.day.names.has(ctx.myId) ? ctx.myId : null);
  const sorted = [...ctx.day.ids].sort((a, b) => ctx.day.names.get(a).localeCompare(ctx.day.names.get(b), "ko"));
  const picker = `<div class="lg-tools"><select class="input lg-select" data-sel="myteam"><option value="">팀 선택…</option>
    ${sorted.map((t) => `<option value="${esc(t)}"${t === id ? " selected" : ""}>${teamName(ctx, t)}${t === ctx.myId ? " ⭐" : ""}</option>`).join("")}</select></div>`;
  let note = "";
  if (ex) note = `<div class="lg-note warn">🚫 ${esc(ex.name)}님은 이번 회차에 못 나갔어요 (${esc(reasonLabel(ex))}). 판수를 채우면 다음 리그부터 참가해요!</div>`;
  else if (!ctx.myId) note = `<div class="lg-note">⭐ 클럽원 프로필에서 '내 프로필'을 설정하면 내 팀이 자동으로 선택돼요.</div>`;
  if (!id) return picker + note;

  const sq = ctx.day.squads.get(id);
  const row = ctx.day.tables[ctx.k].find((r) => r.id === id);
  const st = statsAt(ctx, ctx.k);
  // 오늘 경기 목록 (공개된 것 + 다음 경기)
  const games = [];
  ctx.day.rounds.forEach((rd, r) => rd.matches.forEach((m, i) => { if (m.home === id || m.away === id) games.push([r, i]); }));
  const shown = games.filter(([r]) => r < ctx.k);
  const next = games.find(([r]) => r >= ctx.k);
  const recent = shown.slice().reverse();
  const game = ([r, i]) => {
    const m = ctx.day.rounds[r].matches[i], res = ctx.day.results[r][i];
    const [gf, ga] = m.home === id ? [res.hg, res.ag] : [res.ag, res.hg];
    const wl = gf > ga ? ["W", "승"] : gf < ga ? ["L", "패"] : ["D", "무"];
    return `<div class="lg-rlabel"><span class="lg-f ${wl[0]}">${wl[1]}</span> ${r + 1}R</div>${matchCard(ctx, r, i)}`;
  };
  const players = sq.players.map((p) => ({ p, s: st.get(id + "#" + p.idx) || { g: 0, a: 0, apps: 0, avg: 0 }, start: sq.starters.includes(p.idx) }));
  return picker + note + `<div class="card lg-myhead">
      <div class="lg-title">${teamName(ctx, id)}</div>
      <div class="lg-sub">${ctx.k ? `현재 <b>${row.rank}위</b> · ${row.w}승 ${row.d}무 ${row.l}패 · 승점 ${row.pts} · 득실 ${row.gd > 0 ? "+" : ""}${row.gd}` : "개막 전"} · 팀 오버롤 ${sq.ovr}</div>
      ${ctx.k > 1 ? rankChart(ctx, id) : ""}</div>
    ${next ? `<div class="section-title">⏭ 다음 경기</div><div class="card">${matchCard(ctx, next[0], next[1])}</div>` : ""}
    ${shown.length ? `<div class="section-title">📋 지난 경기 <span class="lg-dim">${shown.length}경기</span></div>
      <div class="card">${recent.slice(0, 10).map(game).join("")}${recent.length > 10 ? `<details class="lg-older"><summary>이전 ${recent.length - 10}경기 보기</summary>${recent.slice(10).map(game).join("")}</details>` : ""}</div>` : ""}
    <div class="section-title">👥 선수단 <span class="lg-dim">4-4-2 · 선발 ●</span></div>
    <div class="card"><div class="table-wrap"><table class="data lg-squad"><thead><tr><th>#</th><th>선수</th><th>포지션</th><th class="num">OVR</th>
      <th class="num">골</th><th class="num">도움</th><th class="num">평점</th></tr></thead><tbody>
      ${players.map(({ p, s, start }) => `<tr><td>${p.num}</td><td>${start ? "● " : "<span class='lg-dim'>○</span> "}${esc(p.name)}</td>
        <td><span class="lg-pos">${p.pos}</span></td><td class="num" title="${Object.entries(p.attrs).map(([k, v]) => ATTR_LABEL[k] + " " + v).join(" · ")}">${p.ovr}</td>
        <td class="num">${s.g || ""}</td><td class="num">${s.a || ""}</td><td class="num">${s.apps ? s.avg.toFixed(1) : ""}</td></tr>`).join("")}
    </tbody></table></div></div>`;
}

/* 순위 추이 꺾은선 (SVG, 1위가 위) */
function rankChart(ctx, id) {
  const n = ctx.day.ids.length, k = ctx.k;
  const pts = [];
  for (let r = 1; r <= k; r++) pts.push(ctx.day.tables[r].find((x) => x.id === id).rank);
  const W = 300, H = 90, pad = 6;
  const x = (i) => pad + (k <= 1 ? 0 : (i * (W - pad * 2)) / (k - 1));
  const y = (rank) => pad + ((rank - 1) * (H - pad * 2)) / Math.max(1, n - 1);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(" ");
  return `<svg class="lg-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="순위 추이">
    <line x1="0" x2="${W}" y1="${y(1)}" y2="${y(1)}" class="lg-chart-top"/>
    <path d="${d}" class="lg-chart-line"/><circle cx="${x(pts.length - 1)}" cy="${y(pts[pts.length - 1])}" r="3.5" class="lg-chart-dot"/></svg>
    <div class="lg-dim lg-chart-cap">순위 추이 (위 = 1위) · 최고 ${Math.min(...pts)}위 · 최저 ${Math.max(...pts)}위</div>`;
}

/* ---------- 탭 ⑥ 기록실 ---------- */
export function tabRecords(ctx) {
  const days = (ctx.history.days || []).slice().reverse();
  if (!days.length) return empty("아직 기록이 없어요. 리그가 끝나면 다음 날 새벽에 기록돼요.", "🏛");
  const wins = new Map();
  for (const d of days) {
    const c = d.table && d.table[0];
    if (!c) continue;
    const w = wins.get(c.ouid) || { name: c.name, n: 0 };
    w.n++; w.name = c.name;   // 최근 닉으로
    wins.set(c.ouid, w);
  }
  const top = [...wins.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "ko"));
  return `<div class="section-title">👑 누적 우승</div><div class="card">${top.map((w, i) => `<div class="lg-prow"><span class="rank ${i < 3 ? "r" + (i + 1) : ""}">${i + 1}</span>
      <div class="lg-pinfo"><b>${esc(w.name)}</b></div><div class="lg-pval"><b>${w.n}회</b></div></div>`).join("")}</div>
    <div class="section-title">📜 회차별 기록</div>
    ${days.map((d) => {
      const c = d.table && d.table[0], s = d.scorers && d.scorers[0], a = d.assists && d.assists[0];
      if (!c) return `<div class="card lg-rec"><b>제${d.no}회</b> <span class="lg-dim">${C.dateLabel(d.date)} · 미개최</span></div>`;
      return `<details class="card lg-rec"><summary><b>제${d.no}회</b> <span class="lg-dim">${C.dateLabel(d.date)} · ${d.teams}팀</span>
          <div>🏆 ${esc(c.name)} <span class="lg-dim">승점 ${c.pts}</span>${s ? ` · ⚽ ${esc(s.player)} ${s.goals}골` : ""}</div></summary>
        <div class="lg-awards">
          ${s ? `<div>⚽ 득점왕 ${esc(s.player)} <span class="lg-dim">${esc(s.team)}</span> <b>${s.goals}골</b></div>` : ""}
          ${a ? `<div>🅰️ 도움왕 ${esc(a.player)} <span class="lg-dim">${esc(a.team)}</span> <b>${a.assists}도움</b></div>` : ""}
          ${d.mvp ? `<div>⭐ MVP ${esc(d.mvp.player)} <span class="lg-dim">${esc(d.mvp.team)}</span> <b>평점 ${Number(d.mvp.avg).toFixed(2)}</b></div>` : ""}
        </div>
        <div class="table-wrap"><table class="data"><thead><tr><th class="num">#</th><th>팀</th><th class="num">승점</th><th class="num">승무패</th><th class="num">득실</th></tr></thead><tbody>
          ${d.table.map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(r.name)}</td><td class="num">${r.pts}</td><td class="num">${r.w}-${r.d}-${r.l}</td><td class="num">${r.gf - r.ga > 0 ? "+" : ""}${r.gf - r.ga}</td></tr>`).join("")}
        </tbody></table></div></details>`;
    }).join("")}`;
}
