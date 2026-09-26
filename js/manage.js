/* ============================================================
   manage.js — 구단운영 부품 (v2.2.0 페이지 → v2.4.0 부품)
   붙이는 곳: 개인 프로필 #manage 탭(member.js, ouid로 조회) · 전적 검색 구단운영 탭(search.js, 닉네임으로 조회)
   사용: window.Dor6Manage.mount(container, { ouid?, nickname? })  — ES 모듈이라 준비되면 'dor6-manage-ready' 이벤트
   모드 칩(공식경기·친선·감독모드)별 선수 진단
   흐름
     1) Worker /manage/overview : ouid·등급·매치 ID 목록(유형별 최신 100) — ouid가 있으면 닉 조회 생략
     2) Worker /manage/details  : 30경기씩 압축 행 (브라우저가 나눠 호출 — Worker 무료 한도)
     3) Worker /manage/ranker   : 같은 카드·같은 포지션 랭커 평균 (24시간 캐시)
     4) scripts/lib/manage.js analyze() 로 계산 → 그리기만
   저장(이 브라우저만): 요약 dor6.manage.ov.id.<ouid> (닉 검색은 dor6.manage.ov.<닉>), 모드별 경기 dor6.manage.<ouid>.<mode>,
     랭커 dor6.manage.rk.<유형>, 마지막 모드 dor6.manage.last.<ouid>
   처음 열 때 저장된 결과가 없으면 조회, 이후엔 [최신 업데이트]를 눌렀을 때만 새 경기 추가(증분)
   의존: common.js(escapeHtml·fmt·loadJSON·emptyState·errorState), auth.js(auth.call), squad.js(선수 메타·얼굴), share.js(📸 캡처)
   ============================================================ */

import { MODES, analyze, rankerTargets, VERDICTS, CONF, LANES, P_METRICS, GROUP_LABEL, MIN_JUDGE_GAMES } from "../scripts/lib/manage.js";

const MAX_ROWS = 300;          // 모드별 저장 최대 경기
const PAGE = 100;              // 처음·더 불러오기 단위
const DETAIL_CHUNK = 30;       // Worker details 1회 경기 수 (worker MANAGE_DETAIL_MAX와 동일)
const RANKER_TTL = 24 * 3600 * 1000;
const STORE_VER = 1;
const MODE_KEYS = Object.keys(MODES);
const LANE_MIN_GAMES = 20;    // 실점 루트 결론(점검 안내)을 보여줄 최소 정상 종료 경기
const RANGES = [["all", "전체"], ["n30", "최근 30경기"], ["d7", "최근 7일"], ["d30", "최근 30일"]];
/* 분석 범위 직접 입력 (v2.5.3, 사용자 요청: 100판 기준이면 스쿼드 바꾸기 전 선수가 섞임)
   'n숫자' = 최근 N판. 고른 범위는 기기에 기억해 다음에도 그대로 */
const RANGE_KEY = "dor6.manage.range";
const CUSTOM_MIN = 5;
const rangeCount = (r) => { const m = /^n(\d+)$/.exec(r || ""); return m ? +m[1] : null; };
const rangeLabel = (r) => (RANGES.find(([k]) => k === r) || [])[1] || (rangeCount(r) ? `최근 ${rangeCount(r)}경기` : "전체");

/* ---------- 브라우저 저장소 (사생활 모드·용량 초과에도 화면은 동작) ---------- */
const LS = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { console.warn(`[구단운영] 저장 실패(${k}):`, e.name); return false; }
  }
};
const ovKey = (who) => who.ouid ? `dor6.manage.ov.id.${who.ouid}` : `dor6.manage.ov.${who.nickname.toLowerCase()}`;
const storeKey = (ouid, mode) => `dor6.manage.${ouid}.${mode}`;
const rkKey = (type) => `dor6.manage.rk.${type}`;

/* 모드 저장 — 용량 초과면 오래된 경기부터 줄여 재시도, 끝내 안 되면 메모리에서만 유지 */
function saveStore(ouid, store) {
  const copy = { ...store };
  for (let i = 0; i < 4; i++) {
    if (LS.set(storeKey(ouid, store.mode), copy)) return;
    copy.rows = copy.rows.slice(0, Math.floor(copy.rows.length * 0.6));
    copy.pending = {};
  }
  console.warn("[구단운영] 저장 공간 부족 — 이번 결과는 새로고침하면 사라집니다.");
}

/* ---------- 상태 (한 화면에 부품 하나) ----------
   token: mount마다 증가 — 조회 중 다른 탭·다른 사람으로 옮기면 이전 조회는 저장만 하고 화면은 건드리지 않음 */
const S = { root: null, who: null, token: 0, ov: null, mode: null, store: null, meta: null, base: null, xg: null,
  range: LS.get(RANGE_KEY) || "all", openKey: null, filter: "all", busy: false };
const $ = (sel) => (S.root ? S.root.querySelector(sel) : null);

/* ---------- 붙이기 ---------- */
async function mount(container, who, { force = false } = {}) {
  S.root = container;
  S.who = { ouid: who.ouid || null, nickname: String(who.nickname || "").trim() };
  S.token++; S.busy = false; S.openKey = null;
  const tok = S.token;
  if (!container.dataset.mgBound) {           // 같은 컨테이너에 이벤트 중복 방지
    container.addEventListener("click", onRootClick);
    container.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.closest("[data-range-input]")) applyCustomRange(); });
    container.dataset.mgBound = "1";
  }
  if (!window.DOR6.workerUrl) { container.innerHTML = errorState("구단운영은 Worker 연결 후 이용할 수 있어요."); return; }
  if (!S.who.ouid && !S.who.nickname) { container.innerHTML = emptyState("닉네임을 먼저 검색하세요.", "🔍"); return; }

  let ov = force ? null : LS.get(ovKey(S.who));
  let warn = "";
  if (!ov) {
    container.innerHTML = `<div class="loading">🔍 ${force ? "최신 정보 가져오는 중…" : "구단운영 정보 조회 중…"}</div>`;
    try {
      ov = await auth.call("/manage/overview", S.who.ouid ? { ouid: S.who.ouid } : { nickname: S.who.nickname });
      ov.fetchedAt = new Date().toISOString();
      LS.set(ovKey(S.who), ov);
    } catch (e) {
      console.error("[구단운영] 조회 실패:", e);
      const prev = LS.get(ovKey(S.who));
      if (force && prev) { ov = prev; warn = `⚠️ 최신 업데이트 실패: ${e.message} (이전 결과를 표시합니다)`; }
      else { if (tok === S.token) container.innerHTML = errorState(escapeHtml(e.message)); return; }
    }
  }
  if (tok !== S.token) return;
  S.ov = ov;
  await loadRefs();
  if (tok !== S.token) return;
  // 모드 우선순위: 이 유저를 마지막으로 본 모드 → 경기 수가 가장 많은 모드
  const last = LS.get(`dor6.manage.last.${ov.ouid}`);
  const mode = (MODE_KEYS.includes(last) ? last : null) || defaultMode(ov);
  renderShell(warn);
  await showMode(mode, { refresh: force });
}

/* 기본 모드: 경기 수가 가장 많은 모드 */
function defaultMode(ov) {
  const n = (m) => MODES[m].types.reduce((s, t) => s + ((ov.ids && ov.ids[t]) || []).length, 0);
  return MODE_KEYS.slice().sort((a, b) => n(b) - n(a))[0];
}

/* 랭커 기준값·xG 표·선수 메타 (페이지당 1회) */
async function loadRefs() {
  if (S.base) return;
  const [base, xg] = await Promise.all([
    loadJSON("data/meta/ranker-baseline.json").catch(() => null),
    loadJSON("data/meta/xg-model.json").catch(() => null)
  ]);
  S.base = base || {}; S.xg = xg || { modes: {} };
  S.meta = await sqLoadMeta();
}

/* ---------- 머리줄·모드 칩 ---------- */
function renderShell(warn = "") {
  const ov = S.ov;
  const count = (m) => {
    const n = MODES[m].types.reduce((s, t) => s + ((ov.ids && ov.ids[t]) || []).length, 0);
    return n >= 100 * MODES[m].types.length ? `${n}+` : n;
  };
  const div = (t) => (ov.maxDivision && ov.maxDivision[t]) || "-";
  S.root.innerHTML = `
    <div class="mg-head">
      <div class="in-dim">최고 등급 공식 <b style="color:var(--silver);">${escapeHtml(div(50))}</b> · 감독 <b style="color:var(--silver);">${escapeHtml(div(52))}</b>
        · 마지막 업데이트 ${fmt.dateTime(ov.fetchedAt)}</div>
      <button class="btn sm" type="button" data-refresh>🔄 최신 업데이트</button>
    </div>
    ${warn ? `<div class="in-dim" style="margin-bottom:var(--sp-2);">${escapeHtml(warn)}</div>` : ""}
    <div class="chip-row mg-modes" role="tablist">${MODE_KEYS.map((m) =>
      `<button class="chip" type="button" data-mode="${m}" role="tab">${MODES[m].label} <span class="mg-cnt">${count(m)}</span></button>`).join("")}</div>
    <div id="mg-body"></div>`;
}

/* ---------- 모드 표시 (필요하면 넥슨 조회) ---------- */
async function showMode(mode, { refresh = false, more = false, moreCount = PAGE } = {}) {
  const tok = S.token;
  S.mode = mode;
  LS.set(`dor6.manage.last.${S.ov.ouid}`, mode);
  S.root.querySelectorAll("[data-mode]").forEach((a) => a.classList.toggle("active", a.dataset.mode === mode));
  const body = $("#mg-body");
  const ouid = S.ov.ouid;
  let store = LS.get(storeKey(ouid, mode));
  if (!store || store.v !== STORE_VER) store = newStore(mode);
  S.store = store;
  S.openKey = null;

  const needNewer = !!store.tried && (refresh || String(store.syncedAt) < String(S.ov.fetchedAt));
  const needFirst = !store.rows.length && !store.tried;
  if (needNewer || needFirst || more) {
    S.busy = true;
    body.innerHTML = progressHtml(0, needFirst || more ? PAGE : 0, "경기 기록 가져오는 중…");
    try {
      if (needNewer) await loadNewer(store);
      if (needFirst || more) await loadOlder(store, Math.min(needFirst ? PAGE : moreCount, MAX_ROWS - store.rows.length));
      store.tried = true;
      await ensureRanker(store);
      saveStore(ouid, store);
    } catch (e) {
      console.error("[구단운영] 경기 조회 실패:", e);
      if (tok === S.token) { S.busy = false; body.innerHTML = errorState(`경기 기록을 가져오지 못했어요: ${escapeHtml(e.message)}`); }
      if (!store.rows.length) return;
    }
    if (tok === S.token) S.busy = false;
  } else {
    await ensureRanker(store).catch((e) => console.warn("[구단운영] 랭커 통계 조회 실패:", e));
  }
  if (tok !== S.token || S.mode !== mode) return;   // 조회 중 다른 탭·다른 모드로 이동
  renderMode();
}

function newStore(mode) {
  const ids = {}, cursor = {}, end = {}, pending = {};
  for (const t of MODES[mode].types) {
    ids[t] = ((S.ov.ids && S.ov.ids[t]) || []).slice();
    cursor[t] = 0; end[t] = ids[t].length < 100; pending[t] = [];
  }
  return { v: STORE_VER, mode, ids, cursor, end, pending, rows: [], syncedAt: S.ov.fetchedAt, ranker: {} };
}

function progressHtml(done, total, label) {
  const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 30;
  return `<div class="card mg-progress"><div>${escapeHtml(label)} ${total ? `<b>${done}</b>/${total}경기` : ""}</div>
    <div class="progress"><div class="bar" style="width:${pct}%"></div></div>
    <div class="in-dim">처음 분석은 100경기 기준 5~10초 걸려요. 다음부터는 새 경기만 가져옵니다.</div></div>`;
}
function setProgress(done, total) {
  const body = $("#mg-body");
  if (body && S.busy) body.innerHTML = progressHtml(done, total, "경기 기록 가져오는 중…");
}

async function fetchDetails(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += DETAIL_CHUNK) {
    const r = await auth.call("/manage/details", { ouid: S.ov.ouid, ids: ids.slice(i, i + DETAIL_CHUNK) });
    out.push(...(r.rows || []));
  }
  return out.sort((a, b) => String(b.d).localeCompare(String(a.d)));
}

/* 새 경기: overview 목록에서 이미 아는 첫 경기 이전까지 */
async function loadNewer(store) {
  const fresh = [];
  for (const t of MODES[store.mode].types) {
    const list = (S.ov.ids && S.ov.ids[t]) || [];
    const known = new Set(store.ids[t]);
    const newIds = [];
    for (const id of list) { if (known.has(id)) break; newIds.push(id); }
    if (!newIds.length) continue;
    store.ids[t] = [...newIds, ...store.ids[t]];
    store.cursor[t] += newIds.length;
    fresh.push(...newIds);
  }
  if (fresh.length) {
    setProgress(0, fresh.length);
    const rows = await fetchDetails(fresh);
    store.rows = [...rows, ...store.rows].sort((a, b) => String(b.d).localeCompare(String(a.d))).slice(0, MAX_ROWS);
  }
  store.syncedAt = S.ov.fetchedAt;
}

/* 과거 경기 target개 추가 — 유형이 여럿(친선 60·30)이면 날짜순으로 병합
   유형별 목록은 최신순이므로, 모든 유형의 '다음 후보'가 준비됐을 때 가장 최근 것을 받아들이는 방식 */
async function loadOlder(store, target) {
  const types = MODES[store.mode].types;
  const exhausted = (t) => !store.pending[t].length && store.cursor[t] >= store.ids[t].length && store.end[t];
  let added = 0;
  while (added < target) {
    for (const t of types) {
      if (store.pending[t].length || exhausted(t)) continue;
      await fetchChunk(store, t);
    }
    const ready = types.filter((t) => store.pending[t].length);
    if (!ready.length) { if (types.every(exhausted)) break; else continue; }
    // 아직 후보가 없는 유형(가져온 경기가 모두 실패)이 남아 있으면 다음 루프에서 더 가져옴
    if (types.some((t) => !store.pending[t].length && !exhausted(t))) continue;
    const t = ready.sort((a, b) => String(store.pending[b][0].d).localeCompare(String(store.pending[a][0].d)))[0];
    store.rows.push(store.pending[t].shift());
    added++;
    setProgress(added, target);
  }
}

async function fetchChunk(store, t) {
  if (store.cursor[t] >= store.ids[t].length && !store.end[t]) {
    const r = await auth.call("/manage/ids", { ouid: S.ov.ouid, type: t, offset: store.ids[t].length });
    const ids = (r.ids || []).filter((id) => !store.ids[t].includes(id));
    store.ids[t].push(...ids);
    if ((r.ids || []).length < 100) store.end[t] = true;
  }
  const ids = store.ids[t].slice(store.cursor[t], store.cursor[t] + DETAIL_CHUNK);
  store.cursor[t] += ids.length;
  if (!ids.length) { store.end[t] = true; return; }
  store.pending[t] = await fetchDetails(ids);
}

/* 같은 카드·같은 포지션 랭커 평균 — 유형별 24시간 캐시 (없는 카드도 null로 기억해 재조회 방지) */
async function ensureRanker(store) {
  const type = MODES[store.mode].rankerType;
  const targets = rankerTargets(store.rows);
  const cache = LS.get(rkKey(type)) || {};
  const now = Date.now();
  const missing = targets.filter((p) => { const c = cache[`${p.id}|${p.po}`]; return !c || now - c[0] > RANKER_TTL; });
  for (let i = 0; i < missing.length; i += 60) {
    const chunk = missing.slice(i, i + 60);
    const r = await auth.call("/manage/ranker", { matchtype: type, players: chunk });
    for (const p of chunk) { const k = `${p.id}|${p.po}`; cache[k] = [now, (r.ranker && r.ranker[k]) || null]; }
  }
  if (missing.length) {
    // 오래된 항목 정리 후 저장
    for (const [k, v] of Object.entries(cache)) if (now - v[0] > RANKER_TTL * 7) delete cache[k];
    LS.set(rkKey(type), cache);
  }
  store.ranker = Object.fromEntries(targets.map((p) => [`${p.id}|${p.po}`, cache[`${p.id}|${p.po}`] ? cache[`${p.id}|${p.po}`][1] : null]));
}

/* ---------- 분석 범위 필터 ---------- */
function rowsInRange(rows) {
  const sorted = [...rows].sort((a, b) => String(b.d).localeCompare(String(a.d)));
  if (rangeCount(S.range)) return sorted.slice(0, rangeCount(S.range));
  const days = { d7: 7, d30: 30 }[S.range];
  if (!days) return sorted;
  const from = Date.now() - days * 86400000;
  return sorted.filter((m) => parseTime(m.d).getTime() >= from);
}

/* ---------- 모드 화면 ---------- */
async function renderMode() {
  const body = $("#mg-body");
  const mode = S.mode, def = MODES[mode], store = S.store;
  if (!store.rows.length) {
    body.innerHTML = emptyState(`${def.label} 기록이 없어요.`, "📭");
    return;
  }
  const bl = S.base;
  const base = (bl.modes && bl.modes[def.baseMode] && bl.modes[def.baseMode].positions) || (def.baseMode === "official" ? bl.positions : null);
  const xgm = S.xg.modes ? S.xg.modes[def.baseMode] : null;
  // 입력한 판수가 저장된 경기보다 많고 더 가져올 수 있으면 모자란 만큼 자동으로 불러옴
  const want = rangeCount(S.range);
  const hasMore = def.types.some((t) => store.pending[t].length || store.cursor[t] < store.ids[t].length || !store.end[t]);
  if (want && want > store.rows.length && store.rows.length < MAX_ROWS && hasMore && !S.busy && !S.autoMore) {
    S.autoMore = true;   // 가져온 뒤에도 모자라면(기록이 원래 적음) 반복하지 않도록 한 번만
    showMode(S.mode, { more: true, moreCount: want - store.rows.length }).finally(() => { S.autoMore = false; });
    return;
  }
  const rows = rowsInRange(store.rows);
  const a = analyze(rows, { base, xg: xgm, lanesBase: xgm ? xgm.lanes : null, ranker: store.ranker });
  S.analysis = a;
  S.meta = await sqEnsureNames(S.meta, [a.players.map((p) => ({ spId: p.spId }))]);

  const canMore = store.rows.length < MAX_ROWS &&
    def.types.some((t) => store.pending[t].length || store.cursor[t] < store.ids[t].length || !store.end[t]);
  body.innerHTML = `
    ${rows.length ? shBarHtml() : ""}
    <div class="chip-row mg-range">${RANGES.map(([k, l]) =>
      `<button class="chip ${S.range === k ? "active" : ""}" type="button" data-range="${k}">${l}</button>`).join("")}
      <span class="mg-custom ${rangeCount(S.range) && S.range !== "n30" ? "active" : ""}">최근
        <input class="input" type="number" inputmode="numeric" min="${CUSTOM_MIN}" max="${MAX_ROWS}" data-range-input
          value="${rangeCount(S.range) && S.range !== "n30" ? rangeCount(S.range) : ""}" placeholder="판수" aria-label="분석할 최근 판수">판
        <button class="btn sm" type="button" data-range-apply>적용</button></span></div>
    ${rangeCount(S.range) && rows.length < rangeCount(S.range) ? `<div class="in-dim" style="margin:-4px 0 var(--sp-2);">기록이 ${rows.length}경기뿐이라 ${rows.length}경기로 분석했어요.</div>` : ""}
    ${!rows.length ? emptyState("이 기간에는 경기가 없어요.", "📭") : `
    ${summaryCard(a, def)}
    ${playersCard(a, def, base)}
    ${lanesCard(a)}`}
    <div class="mg-foot">
      ${canMore ? `<button class="btn sm" type="button" data-more>📥 과거 경기 ${Math.min(PAGE, MAX_ROWS - store.rows.length)}경기 더 불러오기</button>` : ""}
      <div class="in-dim">저장된 ${def.label} ${store.rows.length}경기 (최대 ${MAX_ROWS}) · ${footNote(def)}</div>
    </div>`;
  if (rows.length) shWarmImages(body);   // 📸 캡처 대비 선수 이미지 미리 받기 (share.js)
}

function footNote(def) {
  const bm = (S.base.modes && S.base.modes[def.baseMode]) || (def.baseMode === "official" ? S.base : null);
  const upd = S.base.updated ? fmt.date(S.base.updated) : "-";
  const src = bm && bm.source ? `${bm.source} (랭커 ${bm.sampleSize}명, ${upd} 갱신)` : "랭커 기준값 준비 중";
  const friendly = def.types.includes(60) ? " · 친선은 넥슨이 랭커 통계를 주지 않아 <b>공식경기 랭커 기준</b>으로 비교해요" : "";
  return `포지션 기준: ${escapeHtml(src)}${friendly}`;
}

/* ① 요약 */
function summaryCard(a, def) {
  const s = a.summary;
  const rate = s.games ? Math.round((s.win / s.games) * 100) : 0;
  const n2 = (v) => (v == null ? "-" : v.toFixed(2));
  // 선발 포지션 조합 → 포메이션 문자열로 합침
  const fm = new Map();
  for (const f of a.formations) {
    const name = sqFormation(f.positions.filter((p) => p !== 0).map((pos) => ({ pos })));
    const cur = fm.get(name) || { name, games: 0, win: 0 };
    cur.games += f.games; cur.win += f.win; fm.set(name, cur);
  }
  const forms = [...fm.values()].sort((x, y) => y.games - x.games).slice(0, 3);
  const luck = s.xgFor != null && s.gf != null ? s.gf - s.xgFor : null;
  return `
    <div class="card in-card">
      <div class="in-title">📋 요약 <span class="in-note">${fmt.date(s.from)} ~ ${fmt.date(s.to)} · ${s.games}경기</span></div>
      <div class="pf-rec"><span class="wl win">${s.win}승</span> <span class="wl draw">${s.draw}무</span> <span class="wl lose">${s.lose}패</span>
        · 승률 <b>${rate}%</b>${s.forfeit ? ` <span class="in-dim">(몰수·기권 ${s.forfeit}경기는 선수 지표에서 제외)</span>` : ""}</div>
      <div class="mg-stats">
        <div><span>경기당 득점</span><b>${n2(s.gf)}</b></div>
        <div><span>경기당 실점</span><b>${n2(s.ga)}</b></div>
        <div><span>기대 득점 xG</span><b>${n2(s.xgFor)}</b></div>
        <div><span>허용 xG</span><b>${n2(s.xgAg)}</b></div>
      </div>
      ${luck != null ? `<div class="in-dim">${luck >= 0.15 ? `만든 찬스보다 <b class="in-up">${luck.toFixed(2)}골 더</b> 넣는 중 (결정력 좋음 또는 운)` :
        luck <= -0.15 ? `만든 찬스보다 <b class="in-down">${(-luck).toFixed(2)}골 덜</b> 넣는 중 (결정력 부족 또는 불운)` : "만든 찬스만큼 넣고 있어요"}</div>` : ""}
      ${forms.length ? `<div class="mg-forms">${forms.map((f) =>
        `<span class="tag">${escapeHtml(f.name)} · ${f.games}경기 · 승률 ${Math.round((f.win / f.games) * 100)}%</span>`).join("")}</div>` : ""}
    </div>`;
}

/* ② 선수 진단 */
const mLabel = (k) => P_METRICS[k] || k;
const v2 = (v) => (v == null ? "-" : (Math.round(v * 100) / 100).toString());
function playerCardInfo(p) {
  return sqBuildTeam([{ spId: p.spId, spPosition: p.pos, spGrade: p.grade }], S.meta).starters[0];
}
function playersCard(a, def, base) {
  if (!base) return `<div class="card in-card"><div class="in-title">🩺 선수 진단</div>${emptyState("이 모드의 랭커 기준값을 준비 중이에요. 다음 주 갱신 후 표시됩니다.", "⏳")}</div>`;
  // 판정된 선수만 목록에, 선발 10경기 미만(참고)은 아래 접힌 칸으로 — 로테이션이 많은 친선에서 목록이 묻히지 않도록
  const judged = a.players.filter((p) => p.verdict !== "pending");
  const pending = a.players.filter((p) => p.verdict === "pending").sort((x, y) => y.games - x.games);
  const list = judged.filter((p) => S.filter === "all" || ["replace", "capped", "underused"].includes(p.verdict));
  const counts = {};
  for (const p of a.players) counts[p.verdict] = (counts[p.verdict] || 0) + 1;
  const tally = ["replace", "capped", "underused", "keep"].filter((k) => counts[k])
    .map((k) => `${VERDICTS[k].emoji} ${VERDICTS[k].label} ${counts[k]}`).join(" · ");
  return `
    <div class="card in-card">
      <div class="in-title">🩺 선수 진단
        <span class="chip-row in-filter">
          <button class="chip ${S.filter === "all" ? "active" : ""}" type="button" data-filter="all">전체</button>
          <button class="chip ${S.filter === "warn" ? "active" : ""}" type="button" data-filter="warn">점검 필요</button>
        </span></div>
      <div class="in-dim" style="margin-bottom:var(--sp-2);">${tally || ""}</div>
      ${list.length ? list.map(playerRow).join("") : `<div class="empty" style="padding:var(--sp-3);">${judged.length ? "점검이 필요한 선수가 없어요 👍" : `선발 ${MIN_JUDGE_GAMES}경기 이상 뛴 선수가 아직 없어요.`}</div>`}
      ${pending.length && S.filter === "all" ? `<details class="mg-pending" ${S.pendingOpen ? "open" : ""}><summary>⚪ 참고 — 선발 ${MIN_JUDGE_GAMES}경기 미만 ${pending.length}명 (판정 보류)</summary>
        ${pending.map(playerRow).join("")}</details>` : ""}
      <details class="ps-note" style="margin-top:var(--sp-3);"><summary>진단은 어떻게 하나요?</summary>
        <ul>
          <li><b>카드 대비</b>: 같은 선수 카드를 같은 포지션에 쓴 넥슨 랭커 평균과 비교 — 낮으면 <b>운용 문제</b>(포지션·전술)</li>
          <li><b>포지션 대비</b>: 같은 포지션 그룹 랭커 선수들 평균과 비교 — 낮으면 <b>카드 한계</b></li>
          <li>🟢 유지 · 🟡 카드는 좋은데 덜 쓰임 · 🟠 카드 한계치 · 🔴 둘 다 낮음</li>
          <li>포지션별 핵심 지표에 가중치를 둔 평균이며, 경기 수가 적을수록 판정을 보수적으로 줄여요. 선발 ${MIN_JUDGE_GAMES}경기 미만은 '참고'</li>
          <li>교체 출전은 뛴 시간을 알 수 없어 선발 경기만 봐요</li>
        </ul></details>
    </div>`;
}

function chipsOf(p) {
  const all = [...p.zB.map((z) => ({ ...z, src: "포지션" })), ...p.zA.map((z) => ({ ...z, src: "카드 랭커" }))].filter((z) => z.w > 0);
  if (!all.length) return "";
  const best = all.reduce((x, y) => (y.z > x.z ? y : x));
  const worst = all.reduce((x, y) => (y.z < x.z ? y : x));
  const chip = (z, dir) => `<span class="ps-chip ${dir}">${dir === "up" ? "▲" : "▼"} ${escapeHtml(mLabel(z.metric))} <b>${v2(z.value)}</b> <span class="mg-ref">/ ${z.src} ${v2(z.ref)}</span></span>`;
  return `<div class="ps-chips">${best.z > 0.2 ? chip(best, "up") : ""}${worst.z < -0.2 ? chip(worst, "down") : ""}</div>`;
}

function playerRow(p) {
  const c = playerCardInfo(p);
  const v = VERDICTS[p.verdict];
  const key = `${p.spId}`;
  const open = S.openKey === key;
  const posName = S.meta.posName[p.pos] || GROUP_LABEL[p.group];
  return `
    <div class="mg-row ${p.verdict === "pending" ? "dim" : ""}" data-player="${key}">
      <div class="mg-row-main">
        ${sqFace(c)}
        <div class="mg-row-info">
          <div class="mg-row-name">${escapeHtml(c.name)} <span class="sq-grade ${sqGradeClass(p.grade)}" title="강화 ${p.grade}단계">${p.grade}</span>
            <span class="badge">${escapeHtml(posName)}</span></div>
          <div class="in-dim">${escapeHtml(c.seasonName || "")} · 선발 ${p.games}경기 · 신뢰도 ${CONF(p.games)}${p.rankerGames == null && p.group !== "GK" ? " · 랭커 사용 기록 없음" : ""}</div>
          ${chipsOf(p)}
        </div>
        <span class="badge mg-verdict ${v.tone}">${v.emoji} ${v.label}</span>
      </div>
      ${open ? playerDetail(p) : ""}
    </div>`;
}

function playerDetail(p) {
  const v = VERDICTS[p.verdict];
  const aRef = Object.fromEntries(p.zA.map((z) => [z.metric, z.ref]));
  const bars = p.zB.filter((z) => z.w > 0).map((z) => {
    const vals = [z.value, aRef[z.metric], z.ref].filter((x) => x != null);
    const max = Math.max(...vals, 0.01) * 1.1;
    const bar = (val, cls, label) => val == null ? "" :
      `<div class="mg-bar"><span class="mg-bar-l">${label}</span><span class="mg-bar-t"><i class="${cls}" style="width:${(val / max) * 100}%"></i></span><b>${v2(val)}</b></div>`;
    return `<div class="mg-metric"><div class="mg-metric-h">${escapeHtml(mLabel(z.metric))} <span class="in-dim">/경기</span></div>
      ${bar(z.value, z.z >= 0 ? "me up" : "me down", "나")}${bar(aRef[z.metric], "card", "카드 랭커")}${bar(z.ref, "pos", "포지션 평균")}</div>`;
  }).join("");
  const fin = p.shots >= 10 ? `<div>⚽ 슈팅 ${p.shots} · 골 <b>${p.goals}</b> · 기대 득점 xG ${p.xg.toFixed(1)} →
      <b class="${p.finishing >= 0 ? "in-up" : "in-down"}">${p.finishing >= 0 ? "+" : ""}${p.finishing.toFixed(1)}</b> ${p.finishing >= 1 ? "(기대보다 많이 넣음)" : p.finishing <= -1 ? "(기대보다 적게 넣음)" : ""}</div>` : "";
  const xa = p.xa >= 0.3 ? `<div>🎯 찬스 메이킹 xA ${p.xa.toFixed(1)} (도움으로 이어진 슈팅들의 기대 득점 합)</div>` : "";
  const o = p.onOff;
  const pct = (x) => Math.round(x * 100) + "%";
  const sg = (x) => (x >= 0 ? "+" : "") + x.toFixed(2);
  const onoff = o.ok
    ? `<div>🔁 선발 ${o.on}경기 승률 <b>${pct(o.winOn)}</b> · 득실 ${sg(o.gdOn)} / 빠진 ${o.off}경기 승률 <b>${pct(o.winOff)}</b> · 득실 ${sg(o.gdOff)}</div>`
    : `<div class="in-dim">🔁 뛴 경기·빠진 경기 비교는 양쪽 모두 10경기 이상일 때 표시 (선발 ${o.on} / 빠짐 ${o.off})</div>`;
  return `
    <div class="mg-detail">
      ${v.line ? `<div class="mg-line ${v.tone}">${v.emoji} ${escapeHtml(v.line)}</div>` : ""}
      ${p.rankerGames != null ? `<div class="in-dim">카드 랭커 = 넥슨 랭커가 이 카드를 같은 포지션에 쓴 최근 ${p.rankerGames}경기 평균</div>` : ""}
      <div class="mg-metrics">${bars || `<div class="in-dim">비교 가능한 지표가 없어요.</div>`}</div>
      <div class="mg-extra">${fin}${xa}${onoff}</div>
      ${sparkline(p.ratings)}
    </div>`;
}

function sparkline(r) {
  if (!r || r.length < 3) return "";
  const W = 200, H = 36, lo = 5, hi = 9.5;
  const pts = r.map((v, i) => `${((i / (r.length - 1)) * W).toFixed(1)},${(H - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * H).toFixed(1)}`).join(" ");
  const avg = r.reduce((s, v) => s + v, 0) / r.length;
  return `<div class="mg-spark"><span class="in-dim">평점 추이 (최근 ${r.length}경기 · 평균 ${avg.toFixed(2)})</span>
    <svg viewBox="-2 -2 ${W + 4} ${H + 4}" preserveAspectRatio="none"><polyline points="${pts}"/></svg></div>`;
}

/* ③ 실점 루트 */
function lanesCard(a) {
  if (!a.lanes.length) return "";
  const enough = a.summary.normal >= LANE_MIN_GAMES;   // 경기가 적으면 한두 골로 비중이 크게 흔들림
  const order = ["L", "C", "R"];
  const byLane = Object.fromEntries(a.lanes.map((l) => [l.lane, l]));
  const cols = order.map((k) => {
    const l = byLane[k];
    const hot = enough && l.diff != null && l.diff >= 0.07;
    const alpha = Math.min(0.55, Math.max(0.08, l.share * 0.9));
    return `<div class="mg-lane ${hot ? "hot" : ""}" style="--a:${alpha}">
      <b>${Math.round(l.share * 100)}%</b>
      ${l.base != null ? `<span>랭커 ${Math.round(l.base * 100)}%</span>` : ""}
      <em>${LANES[k]}</em></div>`;
  }).join("");
  const notes = !enough ? "" : a.lanes.filter((l) => l.diff != null && l.diff >= 0.07).map((l) => {
    const who = l.watch.map((w) => {
      const c = sqBuildTeam([{ spId: w.spId, spPosition: w.pos, spGrade: 0 }], S.meta).starters[0];
      return `${escapeHtml(S.meta.posName[w.pos] || "")} ${escapeHtml(c.name)}`;
    }).join(", ");
    return `<li><b>${LANES[l.lane]}</b>에서 시작된 위기 비중 ${Math.round(l.share * 100)}% (랭커 평균보다 +${Math.round(l.diff * 100)}%p)${who ? ` → 점검: ${who}` : ""}</li>`;
  }).join("");
  return `
    <div class="card in-card">
      <div class="in-title">🛡 실점 루트 <span class="in-note">추정 · 우리 골문 기준</span></div>
      <div class="mg-lanes">${cols}</div>
      ${!enough ? `<div class="in-dim">경기가 ${LANE_MIN_GAMES}경기 이상 쌓이면 점검할 측면을 알려드려요. (현재 ${a.summary.normal}경기)</div>` : notes ? `<ul class="mg-notes">${notes}</ul>` : `<div class="in-dim">특정 측면으로 쏠린 실점 루트는 없어요.</div>`}
      <div class="in-dim" style="margin-top:var(--sp-2);">상대 슈팅의 출발점(도움 위치, 없으면 슈팅 위치)을 좌·중·우로 나눠 기대 득점(xG) 비중으로 표시. 같은 모드 랭커들이 허용한 분포와 비교하며, 담당 포지션은 추정이라 진단 배지에는 반영하지 않아요.</div>
    </div>`;
}

/* 📸 모드 탭 캡처 (v2.3.0, share.js) — 범위 칩·더 불러오기·'참고' 접힌 칸은 빼고 보이는 그대로 */
function captureMode(btn) {
  const def = MODES[S.mode], s = S.analysis.summary;
  const range = rangeLabel(S.range);
  const div = S.ov.maxDivision && S.ov.maxDivision[def.types.includes(52) ? 52 : 50];
  shareSection($("#mg-body"), {
    btn, nick: S.ov.nickname, tab: `구단운영 · ${def.label}`, fileTag: `구단운영_${def.label}`,
    sub: [div, `${range} ${s.games}경기 (${fmt.date(s.from)}~${fmt.date(s.to)})`].filter(Boolean).join(" · "),
    strip: [".mg-range", ".mg-foot", ".mg-pending"]
  });
}

/* 범위 바꾸기 — 기기에 기억 */
function setRange(r) {
  S.range = r;
  LS.set(RANGE_KEY, r);
  renderMode();
}
/* 직접 입력한 판수 적용 (5~300) */
function applyCustomRange() {
  const input = $("[data-range-input]");
  const n = Math.round(Number(input && input.value));
  if (!n || n < CUSTOM_MIN) { if (input) { input.value = ""; input.placeholder = `${CUSTOM_MIN}판 이상`; input.focus(); } return; }
  setRange(`n${Math.min(n, MAX_ROWS)}`);
}

/* ---------- 클릭 (부품 컨테이너에 위임) ---------- */
async function onRootClick(e) {
  if (e.currentTarget !== S.root) return;
  if (e.target.closest("[data-refresh]")) { if (!S.busy) mount(S.root, S.who, { force: true }); return; }
  const tab = e.target.closest("[data-mode]");
  if (tab) { if (!S.busy && tab.dataset.mode !== S.mode) showMode(tab.dataset.mode); return; }
  if (e.target.closest("[data-more]")) { if (!S.busy) showMode(S.mode, { more: true }); return; }
  const rg = e.target.closest("[data-range]");
  if (rg) { setRange(rg.dataset.range); return; }
  if (e.target.closest("[data-range-apply]")) { applyCustomRange(); return; }
  const fl = e.target.closest("[data-filter]");
  if (fl) { S.filter = fl.dataset.filter; renderMode(); return; }
  const sum = e.target.closest(".mg-pending > summary");
  if (sum) { S.pendingOpen = !sum.parentElement.open; return; }   // 다시 그려도 펼침 상태 유지
  const cap = e.target.closest("[data-capture]");
  if (cap) { captureMode(cap); return; }
  const row = e.target.closest("[data-player]");
  if (row && !e.target.closest(".mg-detail")) {
    S.openKey = S.openKey === row.dataset.player ? null : row.dataset.player;
    const p = S.analysis.players.find((x) => `${x.spId}` === row.dataset.player);
    if (p) row.outerHTML = playerRow(p);
  }
}

/* 일반 스크립트(member.js·search.js)에서 쓰도록 내보냄 */
window.Dor6Manage = { mount };
window.dispatchEvent(new Event("dor6-manage-ready"));
