/* ============================================================
   share.js — 이미지로 공유 (v2.0.0 → v2.3.0 탭별 캡처)
   - shareSection(node, opts): 보이는 탭 본문을 그대로 복제해 이미지로 (프로필 5탭 · 구단운영 모드 탭)
   - shareDashboardImage(dash, btn): 전체 판수 한 장 (30명 초과 시 2단)
   방식: 화면 밖에 카드 DOM을 만들고 html-to-image로 캔버스 → UPNG.js로 256색 PNG(파일 크기 절반 이하)
     · 라이브러리는 페이지가 한가할 때 미리 받아 둠(첫 클릭 대기 제거)
     · 넥슨 이미지는 CORS 미허용 → Worker /img 프록시로 받아 data URL로 넣고, 페이지 메모리에 캐시(다른 탭 재사용)
     · 양자화 도구를 못 받으면 일반 PNG로 대체 — 공유는 항상 가능
   공유: 미리보기 창의 [공유하기](모바일 공유 시트·카톡) / [이미지 저장](다운로드)
     ※ 변환이 끝난 뒤 바로 navigator.share를 부르면 iOS에서 '사용자 동작 없음'으로 막히므로 한 번 더 누르게 함
   의존: common.js(escapeHtml·fmt·progressStatus) · squad.js(SQ_IMG·sqShowModal)
   ============================================================ */

const SH_LIBS = {
  h2i:  "https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.js",
  pako: "https://cdn.jsdelivr.net/npm/pako@1.0.11/dist/pako.min.js",     // UPNG가 전역 pako를 씀 → 먼저 로딩
  upng: "https://cdn.jsdelivr.net/npm/upng-js@2.1.0/UPNG.js"
};
const SH_COLORS = 256;           // 팔레트 색 수 (어두운 단색 배경·글자 위주라 256색으로 충분)
const SH_PIXEL_RATIO = 2;        // 폭 480px → 이미지 960px
const SH_TAB_WIDTH = 480;
const SH_IMG_PARALLEL = 8;       // 프록시 동시 요청 수

/* ---------- 외부 스크립트 로딩 (한 번만) ---------- */
const _shScripts = {};
function shLoadScript(src) {
  if (!_shScripts[src]) {
    _shScripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { delete _shScripts[src]; reject(new Error(`스크립트 로딩 실패: ${src}`)); };
      document.head.appendChild(s);
    });
  }
  return _shScripts[src];
}
const loadHtmlToImage = () => shLoadScript(SH_LIBS.h2i).then(() => window.htmlToImage);
/* 양자화 도구 — 실패해도 null (일반 PNG로 대체) */
const loadUpng = () => shLoadScript(SH_LIBS.pako).then(() => shLoadScript(SH_LIBS.upng))
  .then(() => window.UPNG || null)
  .catch((e) => { console.warn("[공유] 256색 변환 도구 로딩 실패 — 일반 PNG로 만듭니다:", e.message); return null; });

/* 페이지가 뜬 뒤 한가할 때 미리 받아 둠 */
function shPreload() {
  loadHtmlToImage().catch((e) => console.warn("[공유] 미리 로딩 실패:", e.message));
  loadUpng();
}
if (typeof window !== "undefined") {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 2500));
  window.addEventListener("load", () => idle(shPreload, { timeout: 4000 }));
}

/* ---------- 넥슨 이미지 → data URL (Worker 프록시, 페이지 메모리 캐시) ---------- */
const _shImgCache = new Map();   // url → Promise<dataURL|null>
function proxiedDataUrl(url) {
  if (!_shImgCache.has(url)) {
    _shImgCache.set(url, (async () => {
      try {
        const res = await fetch(`${window.DOR6.workerUrl}/img?u=${encodeURIComponent(url)}`);
        if (!res.ok) return null;
        const blob = await res.blob();
        return await new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => resolve(null);
          r.readAsDataURL(blob);
        });
      } catch { return null; }
    })());
  }
  return _shImgCache.get(url);
}

/* 카드 안 넥슨 이미지 채우기: data-img(1순위) → data-img2(대체) → 없으면 요소 제거. 동시 요청 제한 */
async function inlineImages(node) {
  const imgs = [...node.querySelectorAll("img[data-img]")];
  let i = 0;
  const worker = async () => {
    while (i < imgs.length) {
      const img = imgs[i++];
      const data = await proxiedDataUrl(img.dataset.img) || (img.dataset.img2 && await proxiedDataUrl(img.dataset.img2));
      if (data) img.src = data; else img.remove();
    }
  };
  await Promise.all(Array.from({ length: Math.min(SH_IMG_PARALLEL, imgs.length) }, worker));
}

/* ---------- 캔버스 → PNG Blob (256색 우선) ---------- */
async function encodePng(canvas) {
  const UPNG = await loadUpng();
  if (UPNG) {
    try {
      const { width: w, height: h } = canvas;
      const rgba = canvas.getContext("2d").getImageData(0, 0, w, h).data.buffer;
      return new Blob([UPNG.encode([rgba], w, h, SH_COLORS)], { type: "image/png" });
    } catch (e) { console.warn("[공유] 256색 변환 실패 — 일반 PNG로 만듭니다:", e); }
  }
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/* 공통: 카드 HTML(또는 노드) → PNG Blob */
async function renderCard(content, width) {
  const h2i = await loadHtmlToImage();
  const wrap = document.createElement("div");
  wrap.className = "sh-stage";
  if (typeof content === "string") wrap.innerHTML = content; else wrap.appendChild(content);
  const card = wrap.firstElementChild;
  card.style.width = width + "px";
  document.body.appendChild(wrap);
  try {
    await inlineImages(card);
    const bg = getComputedStyle(document.body).backgroundColor;
    const canvas = await h2i.toCanvas(card, { pixelRatio: SH_PIXEL_RATIO, backgroundColor: bg, skipFonts: true, cacheBust: false });
    return await encodePng(canvas);
  } finally {
    wrap.remove();
  }
}

/* 공통: 버튼 상태 + 생성 + 미리보기 */
async function makeAndPreview(btn, build, fileName, title) {
  const label = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "⏳ 이미지 만드는 중…"; }
  try {
    const t0 = performance.now();
    const blob = await build();
    if (!blob) throw new Error("이미지 변환 결과 없음");
    console.info(`[공유] ${fileName} ${Math.round(blob.size / 1024)}KB · ${Math.round(performance.now() - t0)}ms`);
    showSharePreview(blob, fileName, title);
  } catch (e) {
    console.error("공유 이미지 생성 실패:", e);
    alert("이미지를 만들지 못했어요. 잠시 후 다시 시도해 주세요.");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

/* 미리보기 창 — [공유하기](지원 시) · [이미지 저장] · 닫기 */
function showSharePreview(blob, fileName, title) {
  const url = URL.createObjectURL(blob);
  const file = new File([blob], fileName, { type: "image/png" });
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  sqShowModal("공유 이미지", `
    <div class="sq-head">
      <div><div class="sq-title">📸 공유 이미지</div>
        <div class="sq-dim">${canShare ? "공유하기를 누르면 카톡 등으로 바로 보낼 수 있어요." : "이미지 저장 후 카톡방에 올려 주세요. (길게 눌러 저장해도 돼요)"}</div></div>
      <button class="sq-close" type="button" aria-label="닫기">✕</button>
    </div>
    <img class="sh-preview" src="${url}" alt="${escapeHtml(title)}">
    <div class="sh-actions">
      ${canShare ? `<button class="btn primary" type="button" data-sh-share>📤 공유하기</button>` : ""}
      <a class="btn" href="${url}" download="${escapeHtml(fileName)}">💾 이미지 저장</a>
    </div>`);
  const shareBtn = document.querySelector("[data-sh-share]");
  if (shareBtn) shareBtn.addEventListener("click", async () => {
    try { await navigator.share({ files: [file], title }); }
    catch (e) { if (e.name !== "AbortError") console.warn("공유 취소/실패:", e); }
  });
}

const shDate = () => { const d = new Date(), p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const shFileDate = () => new Date().toISOString().slice(0, 10);
const shSafe = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, "_");

/* ---------- 📸 탭 캡처 (v2.3.0) ----------
   source: 화면의 탭 본문 노드 — 복제해서 쓰므로 화면은 그대로
   opts: { btn, nick, sub, tab, fileTag, strip } — strip: 복제본에서 추가로 뺄 선택자
   복제본 정리: 조작 요소(버튼·필터 칩·접힌 설명) 제거, 넥슨 이미지는 프록시 data URL로 교체 */
const SH_STRIP = ["button", ".btn", ".in-filter", "details:not([open])", ".sh-bar", "[data-no-capture]"];
function shareSection(source, { btn, nick, sub = "", tab, fileTag, strip = [] }) {
  return makeAndPreview(btn, () => {
    const body = source.cloneNode(true);
    body.removeAttribute("id");
    inlineSvgStyles(source, body);
    body.querySelectorAll([...SH_STRIP, ...strip].join(",")).forEach((el) => el.remove());
    body.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") || "";
      img.removeAttribute("onerror");
      img.removeAttribute("loading");
      if (img.classList.contains("sq-noimg") || !src) { img.remove(); return; }
      if (/^https:\/\/(fco\.dn\.nexoncdn\.co\.kr|ssl\.nexon\.com)\//.test(src)) {
        img.dataset.img = src;
        if (img.dataset.pid) img.dataset.img2 = SQ_IMG.face(img.dataset.pid);   // 시즌 액션 이미지가 없으면 기본 얼굴
        img.removeAttribute("src");
      }
    });
    const card = document.createElement("div");
    card.className = "sh-card sh-tab";
    card.innerHTML = `
      <div class="sh-tabhead">
        <img class="sh-logo" src="dor6.png" alt="">
        <div class="sh-tabhead-b"><div class="sh-tabnick">${escapeHtml(nick)}</div>
          <div class="sh-dim">${escapeHtml(sub)}</div></div>
        <span class="sh-tabname">${escapeHtml(tab)}</span>
      </div>
      <div class="sh-tabbody"></div>
      <div class="sh-foot">도륙 · Dor6 · johnlee-korea.github.io/dor6-club · ${shDate()}</div>`;
    card.querySelector(".sh-tabbody").appendChild(body);
    return renderCard(card, SH_TAB_WIDTH);
  }, `dor6_${shSafe(nick)}_${shSafe(fileTag || tab)}_${shFileDate()}.png`, `${nick} ${tab}`);
}

/* SVG(슈팅맵·평점 추이) 안 요소는 CSS 클래스로 색을 입히는데, html-to-image가 이를 옮기지 못해 검게 나옴(실측)
   → 화면에 그려진 원본의 계산된 스타일을 복제본에 인라인으로 복사 (복제 직후라 요소 순서가 같음) */
const SH_SVG_PROPS = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "opacity", "vector-effect"];
function inlineSvgStyles(source, clone) {
  const src = source.querySelectorAll("svg, svg *"), dst = clone.querySelectorAll("svg, svg *");
  src.forEach((el, i) => {
    const d = dst[i];
    if (!d) return;
    const cs = getComputedStyle(el);
    for (const p of SH_SVG_PROPS) d.style.setProperty(p, cs.getPropertyValue(p));
  });
}

/* 탭을 보고 있는 동안 한가할 때 그 탭의 넥슨 이미지를 미리 받아 둠 → 📸 누를 때 대기 없음
   (프록시 첫 조회는 Cloudflare 캐시가 비어 있으면 느림 — 실측 스쿼드 탭 6초 → 미리 받으면 1초 안팎) */
const SH_WARM_MAX = 40;
function shWarmImages(node) {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
  idle(() => {
    const urls = [...new Set([...node.querySelectorAll("img")].map((i) => i.getAttribute("src") || "")
      .filter((u) => /^https:\/\/(fco\.dn\.nexoncdn\.co\.kr|ssl\.nexon\.com)\//.test(u)))].slice(0, SH_WARM_MAX);
    let i = 0;
    const next = () => { if (i < urls.length) proxiedDataUrl(urls[i++]).then(next); };
    for (let k = 0; k < 4; k++) next();   // 동시 4개로 천천히
  }, { timeout: 3000 });
}

/* 탭 본문 맨 위에 붙일 📸 버튼 줄 */
const shBarHtml = (label = "📸 이 탭 이미지로") =>
  `<div class="sh-bar"><button class="btn sm" type="button" data-capture>${label}</button></div>`;

/* ---------- 📸 전체 판수 한 장 ---------- */
async function shareDashboardImage(dash, btn) {
  const cur = dash.current;
  const twoCol = cur.rows.length > 30;
  await makeAndPreview(btn, () => renderCard(dashCardHtml(dash, twoCol), twoCol ? 900 : 540),
    `dor6_판수_${cur.seasonName}_${shFileDate()}.png`, `${cur.seasonName} 판수 현황`);
}

function dashCardHtml(dash, twoCol) {
  const cur = dash.current;
  const rows = [...cur.rows].sort((a, b) => b.played - a.played);
  const active = rows.filter((r) => !r.resting);
  const achieved = active.filter((r) => r.played >= r.target).length;
  const midMiss = active.filter((r) => r.midMiss).length;
  const line = (r, i) => {
    const pct = r.target ? Math.min(100, Math.round((r.played / r.target) * 100)) : 100;
    const status = r.resting ? "rest" : progressStatus(r.played, r.target);
    const tag = r.resting ? `<span class="badge rest">휴식</span>`
      : r.played >= r.target ? `<span class="badge ok">달성</span>`
      : r.midMiss ? `<span class="badge danger">중간 미달</span>` : "";
    return `
      <div class="sh-drow ${r.resting ? "rest" : ""}">
        <span class="sh-drank">${i + 1}</span>
        <span class="sh-dnick">${escapeHtml(r.ingameNick)}</span>
        <span class="sh-dbar progress ${status}"><span class="bar" style="width:${pct}%;"></span></span>
        <span class="sh-dnum"><b>${r.played}</b>/${r.target}</span>
        <span class="sh-dtag">${tag}</span>
      </div>`;
  };
  const half = Math.ceil(rows.length / 2);
  const body = twoCol
    ? `<div class="sh-dcols"><div>${rows.slice(0, half).map((r, i) => line(r, i)).join("")}</div>
       <div>${rows.slice(half).map((r, i) => line(r, i + half)).join("")}</div></div>`
    : rows.map(line).join("");
  return `
    <div class="sh-card">
      <div class="sh-top"><img class="sh-logo" src="dor6.png" alt=""><span>도륙 · Dor6</span></div>
      <div class="sh-nick">${escapeHtml(cur.seasonName)} 판수 현황</div>
      <div class="sh-sub">기준 ${cur.targetGames}판 · 중간점검 ${cur.midTargetGames}판(${escapeHtml(cur.midCheck || "-")}) · 종료 ${escapeHtml(cur.end || "-")}</div>
      <div class="sh-stats">
        <div><b>${rows.length}</b><span>명</span></div>
        <div><b>${achieved}</b><span>기준 달성</span></div>
        <div><b>${midMiss}</b><span>중간점검 미달</span></div>
      </div>
      ${body}
      <div class="sh-foot">집계 ${fmt.dateTime(dash.updated)} · 인정 매치: 공식·공식친선·리그친선 · johnlee-korea.github.io/dor6-club</div>
    </div>`;
}
