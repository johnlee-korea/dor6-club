/* ============================================================
   career/app.js — ⭐ 내 선수 키우기 페이지 컨트롤러 (CLAUDE.md 26-12)
   mountCareer(root, { win, fetch, storage, now, seedFn }) — 스모크 테스트가 직접 호출
   - 해시 라우팅: #home #create #start-club #offseason #season #report #career #retire #hall #achievements #settings
   - 화면 조각은 views/*.js (HTML 문자열), 버튼은 data-act 위임 처리
   ============================================================ */
import { indexBase } from "./world.js";
import { makeStorage, loadSave, writeSave, clearSave, loadMeta, writeMeta, mergeAchievements, exportText, parseImport } from "./save.js";
import { newCareer, chooseStartClub, playSeason, decide, setFocus, buyTraining, convertPosition, retire, careerSummary, defaultFocus } from "./career.js";
import * as setup from "./views/setup.js";
import * as off from "./views/offseason.js";
import * as season from "./views/season.js";
import * as rec from "./views/records.js";

const ROUTES = ["home", "create", "start-club", "offseason", "season", "report", "career", "retire", "hall", "achievements", "settings"];

export async function mountCareer(root, opts = {}) {
  const win = opts.win || window;
  const doc = root.ownerDocument;
  const storage = opts.storage || makeStorage(win);
  const fetchFn = opts.fetch || ((u) => win.fetch(u));
  const nowIso = () => (opts.now ? opts.now() : new Date().toISOString());
  const seedFn = opts.seedFn || (() => {
    const a = new Uint32Array(2);
    (win.crypto || globalThis.crypto).getRandomValues(a);
    return "C-" + a[0].toString(36) + a[1].toString(36);
  });

  let clubsJson;
  try {
    const res = await fetchFn("data/career/clubs.json");
    if (!res.ok) throw new Error("HTTP " + res.status);
    clubsJson = await res.json();
  } catch (e) {
    console.error("[career] 구단 데이터 로딩 실패", e);
    root.innerHTML = `<div class="error-box">구단 데이터를 불러오지 못했어요. 잠시 후 새로고침해 주세요.</div>`;
    return null;
  }

  const app = {
    root, doc, win, storage, clubsJson, base: indexBase(clubsJson),
    state: loadSave(storage), meta: loadMeta(storage),
    view: {},          // 화면별 임시 상태 (선수 생성 초안·탭 선택 등)
    lastReport: null,  // 방금 끝난 시즌 결과(성장 계수 등 저장하지 않는 세부)
    saveFailed: false,
    route: "home",
    go(r, extra) { if (extra) Object.assign(app.view, extra); setRoute(r); },
    persist() {
      const ok = app.state ? writeSave(storage, app.state) : true;
      const ok2 = writeMeta(storage, app.meta);
      app.saveFailed = !(ok && ok2);
      return !app.saveFailed;
    },
    render
  };

  /* ---------- 라우팅 ---------- */
  function routeFromHash() {
    const h = (win.location.hash || "").replace("#", "");
    return ROUTES.includes(h) ? h : null;
  }
  function guard(r) {
    const s = app.state;
    if (["offseason", "season", "report", "career"].includes(r) && (!s || s.phase === "start-club")) return s ? "start-club" : "home";
    if (r === "start-club" && (!s || s.phase !== "start-club")) return s ? "offseason" : "create";
    if (r === "retire" && !s) return "home";
    if (r === "offseason" && s && s.phase === "retired") return "retire";
    if (r === "report" && s && !s.history.length) return "offseason";
    if (r === "season" && !app.view.playing) return s && s.history.length ? "report" : "offseason";
    return r;
  }
  function setRoute(r) {
    app.route = guard(r);
    try { if (win.location.hash !== "#" + app.route) win.history.replaceState(null, "", "#" + app.route); } catch (e) { /* 파일 열기 등 */ }
    render();
    if (!/jsdom/i.test(win.navigator.userAgent || "")) try { win.scrollTo(0, 0); } catch (e) { /* 일부 인앱 브라우저 */ }
  }
  win.addEventListener("hashchange", () => { const r = routeFromHash(); if (r && r !== app.route) { app.route = guard(r); render(); } });

  function render() {
    const views = {
      home: setup.home, create: setup.create, "start-club": setup.startClub,
      offseason: off.offseason, season: season.progress, report: season.report,
      career: rec.career, retire: rec.retire, hall: rec.hall, achievements: rec.achievements, settings: rec.settings
    };
    try {
      root.innerHTML = views[app.route](app) + rec.footer(app);
      const after = { "season": season.afterProgress, "report": season.afterReport, "career": rec.afterCareer }[app.route];
      if (after) after(app);
    } catch (e) {
      console.error("[career] 화면 그리기 실패", app.route, e);
      root.innerHTML = `<div class="error-box">화면을 그리는 중 문제가 생겼어요. 새로고침해 주세요. (저장은 안전해요)</div>`;
    }
  }

  /* ---------- 행동 (data-act) ---------- */
  const acts = {
    go: (d) => app.go(d.to),
    // 선수 생성
    "create-pos": (d) => { app.view.draft.pos = d.pos; render(); },
    "create-cat": (d) => {
      const sel = app.view.draft.pair;
      const i = sel.indexOf(d.cat);
      if (i >= 0) sel.splice(i, 1); else { if (sel.length >= 2) sel.shift(); sel.push(d.cat); }
      render();
    },
    "create-combo": (d) => { app.view.draft.pair = d.combo.split("+"); render(); },
    "create-name": () => { app.view.draft.name = setup.randomName(); render(); },
    "create-start": () => {
      const dr = app.view.draft;
      const nameEl = root.querySelector("#cr-name");
      const name = ((nameEl && nameEl.value) || dr.name || "").trim().slice(0, 10) || setup.randomName();
      if (!dr.pos || dr.pair.length !== 2) return;
      if (app.state && app.state.phase !== "retired" && !win.confirm("진행 중인 커리어가 지워져요. 새로 시작할까요?")) return;
      app.state = newCareer({ name, pos: dr.pos, pair: dr.pair, seed: seedFn(), clubsJson, createdAt: nowIso() });
      app.view.country = null;
      app.persist();
      app.go("start-club");
    },
    "start-tab": (d) => { app.view.country = d.c; render(); },
    "start-pick": (d) => {
      chooseStartClub(app.state, d.club);
      app.persist();
      app.go("offseason", { offStep: "club" });
    },
    // 오프시즌
    "off-step": (d) => { app.view.offStep = d.step; app.view.shopMsg = null; render(); if (!/jsdom/i.test(win.navigator.userAgent || "")) try { win.scrollTo(0, 0); } catch (e) { /* 인앱 */ } },
    "off-decide": (d) => {
      decide(app.state, { type: d.type, clubId: d.club });
      // 구단을 바꾸면 그 구단 코치진 기준 추천 집중 육성으로 (직접 고른 적 없을 때만)
      if (!app.view.focusTouched) setFocus(app.state, defaultFocus(app.state, d.club));
      app.persist();
      // 고르면 바로 다음 단계(훈련)로
      if (d.next) acts["off-step"]({ step: "shop" }); else render();
    },
    "off-focus": (d) => {
      const f = app.state.off.focus.slice();
      const i = f.indexOf(d.cat);
      if (i >= 0) f.splice(i, 1); else { if (f.length >= 3) f.shift(); f.push(d.cat); }
      app.state.off.focus = f; app.view.focusTouched = true;
      app.persist(); render();
    },
    "off-focus-reco": () => { setFocus(app.state, defaultFocus(app.state, app.state.off.decision.clubId)); app.view.focusTouched = false; app.persist(); render(); },
    "shop-kind": (d) => { app.view.shopKind = d.kind; render(); },
    "shop-cat": (d) => { app.view.shopCat = d.cat; render(); },
    "shop-buy": () => {
      const r = buyTraining(app.state, app.view.shopKind || "normal", app.view.shopCat);
      app.persist();
      if (r.ok) { app.view.offStep = "focus"; render(); app.view.shopMsg = null; return; }
      app.view.shopMsg = r.reason; render();
    },
    "convert": (d) => {
      if (!win.confirm("포지션을 바꾸면 이번 시즌 OVR −3(적응 기간)이에요. 커리어 중 2번까지만 가능해요. 바꿀까요?")) return;
      convertPosition(app.state, d.pos);
      app.persist(); app.view.offStep = "club"; render();
    },
    "same-again": () => {
      const s = app.state;
      decide(s, { type: "stay", clubId: s.player.clubId });
      if (s.player.lastFocus) setFocus(s, s.player.lastFocus);
      acts["play"]();
    },
    "play": () => {
      if (app.view.playing) return;
      app.view.playing = { started: Date.now() };
      root.innerHTML = season.loading(app);
      // 계산 전에 '진행 중' 화면을 먼저 그리도록 한 박자 쉼
      win.setTimeout(() => {
        try {
          const out = playSeason(app.state, clubsJson);
          app.lastReport = out;
          const fresh = mergeAchievements(app.meta, out.summary.achievements, app.state.seed, nowIso());
          out.summary.deviceNew = fresh;
          app.view.focusTouched = false; app.view.shopMsg = null; app.view.shopCat = null;
          app.persist();
          app.view.playing = { n: out.summary.n };
          app.go(app.meta.settings.fast === false ? "report" : "season");
          if (app.meta.settings.fast === false) app.view.playing = null;
        } catch (e) {
          console.error("[career] 시즌 진행 실패", e);
          app.view.playing = null;
          root.innerHTML = `<div class="error-box">시즌을 진행하다 문제가 생겼어요. 새로고침 후 다시 시도해 주세요. (이전 저장은 안전해요)</div>`;
        }
      }, 30);
    },
    "skip": () => { season.stopProgress(app); app.view.playing = null; app.go("report"); },
    "to-offseason": () => app.go(app.state.phase === "retired" ? "retire" : "offseason", { offStep: "club" }),
    "retire-now": () => {
      // 나이 제한 없음 (v2.13.2 사용자 요청: 맘에 안 들면 접고 다시) — 35세 전은 '조기 은퇴'
      const early = app.state.player.age < 35;
      if (!win.confirm(early ? "이 선수를 접고 은퇴할까요? 업적은 유지되고, 명예의 전당 등록 여부는 다음 화면에서 고를 수 있어요." : "은퇴하면 이 선수로는 더 이상 뛸 수 없어요. 은퇴할까요?")) return;
      retire(app.state); app.persist(); app.go("retire");
    },
    "hall-register": () => {
      const sum = careerSummary(app.state);
      sum.retiredAt = nowIso();
      if (!app.meta.hall.some((h) => h.id === sum.id)) app.meta.hall.push(sum);
      app.state = null; clearSave(storage); app.persist();
      app.go("hall", { hallSort: "maxOvr" });
    },
    "discard": () => {
      // 기록 없이 새로 시작 (명예의 전당에 남기지 않음, 업적은 이미 기기에 저장됨)
      app.state = null; clearSave(storage); app.persist();
      app.view.draft = { name: setup.randomName(), pos: "ST", pair: ["spd", "sht"] };
      app.go("create");
    },
    "hall-sort": (d) => { app.view.hallSort = d.k; render(); },
    "report-tab": (d) => { app.view.reportTab = d.tab; render(); },
    "lead-tab": (d) => { app.view.leadTab = d.tab; render(); },
    // 설정
    "set-fast": () => { app.meta.settings.fast = app.meta.settings.fast === false; app.persist(); render(); },
    "export": () => { app.view.exportText = exportText(app.state, app.meta); render(); },
    "copy-export": async () => {
      const t = root.querySelector("#cr-export");
      try { await win.navigator.clipboard.writeText(t.value); app.view.setMsg = "복사했어요. 메모장·카톡 나에게 보내기에 붙여 넣어 보관하세요."; }
      catch (e) { t.select(); app.view.setMsg = "자동 복사가 안 돼요. 글 상자를 길게 눌러 전체 선택 후 복사해 주세요."; }
      render();
    },
    "import": () => {
      const t = root.querySelector("#cr-import");
      const r = parseImport(t ? t.value : "");
      if (r.error) { app.view.setMsg = r.error; render(); return; }
      if (!win.confirm("지금 기기의 커리어·업적·명예의 전당을 가져온 내용으로 바꿀까요?")) return;
      app.state = r.state; if (r.meta) app.meta = { ...loadMeta({ getItem: () => JSON.stringify(r.meta) }) };
      app.persist(); app.view.setMsg = "가져오기 완료!"; app.go("home");
    },
    "reset": () => {
      if (!win.confirm("이 기기의 커리어·업적·명예의 전당을 모두 지울까요? 되돌릴 수 없어요.")) return;
      app.state = null; app.meta = loadMeta({ getItem: () => null });
      clearSave(storage); app.persist(); app.go("home");
    }
  };
  // 이름 입력은 다시 그려도 유지되게 초안에 바로 반영
  root.addEventListener("input", (e) => { if (e.target.id === "cr-name") app.view.draft.name = e.target.value; });
  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (!t || !root.contains(t) || t.disabled) return;
    const fn = acts[t.dataset.act];
    if (fn) { e.preventDefault(); fn(t.dataset); }
  });

  app.view.draft = { name: setup.randomName(), pos: "ST", pair: ["spd", "sht"] };
  app.acts = acts;
  const start = routeFromHash();
  setRoute(start || (app.state ? (app.state.phase === "retired" ? "retire" : app.state.phase === "start-club" ? "start-club" : "offseason") : "home"));
  return app;
}

/* 페이지에서 직접 열렸을 때 자동 시작 (스모크 테스트는 mountCareer를 직접 호출) */
if (typeof window !== "undefined" && window.document && window.document.getElementById("career-root") && !window.__CAREER_NO_AUTO) {
  mountCareer(window.document.getElementById("career-root"));
}
