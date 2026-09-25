/* ============================================================
   share.js — 이미지로 공유 (v2.0.0)
   - shareProfileImage(PF, btn): 프로필 공유 카드 (닉·등급·시즌 판수·폼·플레이스타일·에이스 3명)
   - shareDashboardImage(dash, btn): 전체 판수 한 장 (30명 초과 시 2단)
   방식: 화면 밖에 공유 전용 카드 DOM을 만들고 html-to-image(jsdelivr, 클릭 시에만 로딩)로 PNG 변환
   선수 얼굴·시즌 아이콘은 넥슨 서버가 CORS를 허용하지 않아 Worker /img 프록시로 받아 data URL로 넣는다
   공유: 미리보기 창의 [공유하기] 버튼(새 탭 동작 → 모바일 공유 시트·카톡) / [이미지 저장](다운로드)
     ※ 변환이 끝난 뒤 바로 navigator.share를 부르면 iOS에서 '사용자 동작 없음'으로 막히므로 한 번 더 누르게 함
   의존: common.js · squad.js(sqLoadMeta·sqBuildTeam·SQ_IMG) · activity-ui.js · insight-ui.js(psChip)
   ============================================================ */

const H2I_SRC = "https://cdn.jsdelivr.net/npm/html-to-image@1.11.13/dist/html-to-image.js";
let _h2iPromise = null;
function loadHtmlToImage() {
  if (window.htmlToImage) return Promise.resolve(window.htmlToImage);
  if (!_h2iPromise) {
    _h2iPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = H2I_SRC;
      s.onload = () => resolve(window.htmlToImage);
      s.onerror = () => { _h2iPromise = null; reject(new Error("이미지 도구 로딩 실패")); };
      document.head.appendChild(s);
    });
  }
  return _h2iPromise;
}

/* 넥슨 이미지 → data URL (Worker 프록시 경유). 실패하면 null */
async function proxiedDataUrl(url) {
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
}

/* 카드 안 넥슨 이미지 채우기: data-img(1순위) → data-img2(대체) → 없으면 요소 제거 */
async function inlineImages(node) {
  await Promise.all([...node.querySelectorAll("img[data-img]")].map(async (img) => {
    const data = await proxiedDataUrl(img.dataset.img) || (img.dataset.img2 && await proxiedDataUrl(img.dataset.img2));
    if (data) img.src = data; else img.remove();
  }));
}

/* 공통: 카드 DOM → PNG Blob */
async function renderCard(html, width) {
  const h2i = await loadHtmlToImage();
  const wrap = document.createElement("div");
  wrap.className = "sh-stage";
  wrap.innerHTML = html;
  const card = wrap.firstElementChild;
  card.style.width = width + "px";
  document.body.appendChild(wrap);
  try {
    await inlineImages(card);
    const bg = getComputedStyle(document.body).backgroundColor;
    return await h2i.toBlob(card, { pixelRatio: 2, backgroundColor: bg, skipFonts: true, cacheBust: false });
  } finally {
    wrap.remove();
  }
}

/* 공통: 버튼 상태 + 생성 + 미리보기 */
async function makeAndPreview(btn, build, fileName, title) {
  const label = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "⏳ 이미지 만드는 중…"; }
  try {
    const blob = await build();
    if (!blob) throw new Error("이미지 변환 결과 없음");
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

/* ---------- 📸 프로필 카드 ---------- */
async function shareProfileImage(PF, btn) {
  await makeAndPreview(btn, async () => {
    const meta = await sqLoadMeta();
    return renderCard(profileCardHtml(PF, meta), 540);
  }, `dor6_${PF.member.ingameNick}_${shFileDate()}.png`, `${PF.member.ingameNick} 프로필`);
}

function profileCardHtml(PF, meta) {
  const { member: m, prof, act, style, insMe, ins, season, counted } = PF;
  const w = counted.filter((x) => x.result === "win").length;
  const d = counted.filter((x) => x.result === "draw").length;
  const l = counted.filter((x) => x.result === "lose").length;
  const rate = counted.length ? Math.round((w / counted.length) * 100) : 0;
  const row = season && season.row;
  const ctrl = insMe && { keyboard: "⌨️ 키보드", gamepad: "🎮 패드" }[insMe.ctrl];

  const styleHtml = style && style.style ? `
    <div class="sh-sec">
      <div class="sh-sec-t">🎭 플레이스타일</div>
      <div class="sh-style">${escapeHtml(style.style.name)}</div>
      <div class="sh-line">“${escapeHtml(style.style.line)}”</div>
      <div class="ps-chips">${style.highs.map((x) => psChip(x, "up")).join("")}${style.lows.map((x) => psChip(x, "down")).join("")}</div>
    </div>` : "";

  const aces = (insMe && insMe.ace) || [];
  const aceHtml = aces.length ? `
    <div class="sh-sec">
      <div class="sh-sec-t">⚽ 에이스 선수 <span class="sh-dim">같은 포지션 랭커 대비</span></div>
      ${aces.map((a) => {
        const card = sqBuildTeam([{ spId: a.spId, spPosition: a.pos, spGrade: 0 }], meta).starters[0];
        const metric = (ins.metricLabels || {})[a.metric] || a.metric;
        const group = (ins.groupLabels || {})[a.group] || a.group;
        const ratio = a.base > 0 && a.metric !== "rt" ? ` · ${(a.value / a.base).toFixed(1)}배` : "";
        return `
        <div class="sh-ace">
          <div class="sh-face"><img data-img="${SQ_IMG.action(a.spId)}" data-img2="${SQ_IMG.face(card.pid)}" alt=""></div>
          <div class="sh-ace-b">
            <div class="sh-ace-title">${a.title ? `${a.title.emoji} ${escapeHtml(a.title.name)}` : "돋보인 지표"}</div>
            <div class="sh-ace-name">${card.seasonImg ? `<img class="sh-season" data-img="${escapeHtml(card.seasonImg)}" alt="">` : ""}${escapeHtml(card.name)}
              <span class="badge">${escapeHtml(meta.posName[a.pos] || group)}</span></div>
            <div class="sh-dim">${escapeHtml(metric)} ${a.value}/경기 · 랭커 ${escapeHtml(group)} ${a.base}${ratio}</div>
          </div>
        </div>`;
      }).join("")}
    </div>` : "";

  return `
    <div class="sh-card">
      <div class="sh-top"><img class="sh-logo" src="dor6.png" alt=""><span>도륙 · Dor6</span></div>
      <div class="sh-nick">${escapeHtml(m.ingameNick)} ${roleBadge(m.role)}</div>
      <div class="sh-sub">${escapeHtml(prof.maxDivisionName || "-")}${prof.level ? ` · Lv.${prof.level}` : ""}${ctrl ? ` · ${ctrl}` : ""}</div>
      <div class="sh-stats">
        ${row ? `<div><b>${row.played}</b><span>/${row.target} ${escapeHtml(season.name)} 판수</span></div>` : ""}
        <div><b>${w}-${d}-${l}</b><span>승률 ${rate}%</span></div>
      </div>
      <div class="sh-form">${act ? formDots(act.form) + " " + streakBadge(act.streak) : ""}</div>
      ${styleHtml}
      ${aceHtml}
      <div class="sh-foot">johnlee-korea.github.io/dor6-club · ${shDate()}</div>
    </div>`;
}

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
