/* ============================================================
   theme.js — ☀️ 밝은 모드 / 🌙 다크 모드 (v2.20.0)
   <head>에서 CSS 바로 뒤에 동기 로딩 → 화면을 그리기 전에 <html data-theme>를 정해
   깜빡임(다크로 그렸다가 밝게 바뀜) 없이 시작한다.
   - 사용자가 고른 값: localStorage "dor6.theme" = "light" | "dark"
   - 고른 적 없으면 기기 설정(prefers-color-scheme)을 따르고, 기기 설정이 바뀌면 따라감
   - 버튼은 common.js가 헤더에 붙임 (DOR6Theme.toggle)
   ============================================================ */
(function () {
  var KEY = "dor6.theme";
  var root = document.documentElement;
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

  // 카톡 인앱·사생활 보호 모드에선 저장소 접근이 막힐 수 있어 try로 감쌈
  function saved() {
    try { var v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : null; }
    catch (e) { return null; }
  }
  function system() { return mq && mq.matches ? "light" : "dark"; }
  function current() { return root.getAttribute("data-theme") === "light" ? "light" : "dark"; }

  function apply(t) {
    root.setAttribute("data-theme", t);
    // 모바일 주소창 색도 맞춤
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
    meta.content = t === "light" ? "#ffffff" : "#0b0c0e";
    // 헤더 버튼 아이콘·설명 갱신 (버튼이 아직 없으면 건너뜀)
    var btn = document.querySelector(".theme-btn");
    if (btn) {
      btn.textContent = t === "light" ? "🌙" : "☀️";
      btn.title = btn.ariaLabel = t === "light" ? "다크 모드로 바꾸기" : "밝은 모드로 바꾸기";
    }
  }

  function set(t) {
    try { localStorage.setItem(KEY, t); } catch (e) { console.warn("[테마] 저장 실패 — 이번 화면에만 적용:", e); }
    apply(t);
  }

  apply(saved() || system());
  if (mq) {
    var onSys = function () { if (!saved()) apply(system()); };
    if (mq.addEventListener) mq.addEventListener("change", onSys); else if (mq.addListener) mq.addListener(onSys);
  }

  window.DOR6Theme = {
    get: current,
    set: set,
    toggle: function () { set(current() === "light" ? "dark" : "light"); },
    refreshButton: function () { apply(current()); }
  };
})();
