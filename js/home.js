/* home.js — 홈: 이번 시즌 요약 + 바로가기 */

const QUICK = [
  { label: "클럽원 프로필", desc: "검색 → 플레이스타일·에이스·스쿼드·라이벌·경기", href: "members.html", emoji: "👥" },
  { label: "시즌 판수",     desc: "달성률·중간점검 미달자 · 한 장 이미지", href: "dashboard.html", emoji: "🎯" },
  { label: "클럽 내전",     desc: "클럽원 간 상대 전적",           href: "internal.html",  emoji: "⚔️" },
  { label: "토너먼트",     desc: "명단 등록 → 추첨 → 대진표 진행", href: "tournament.html", emoji: "🏟️" },
  { label: "명예의 전당",   desc: "시즌별 최다판수·최다승",         href: "hall.html",      emoji: "🏆" },
  { label: "규칙·공지",     desc: "운영 수칙·개편 공지",           href: "rules.html",     emoji: "📋" }
];

function renderQuickLinks() {
  document.getElementById("quicklinks").innerHTML = QUICK.map(q => `
    <a class="card" href="${q.href}" style="display:flex;gap:12px;align-items:center;">
      <span style="font-size:26px;">${q.emoji}</span>
      <span>
        <span style="font-weight:700;display:block;">${q.label}</span>
        <span style="font-size:var(--fs-xs);color:var(--text-muted);">${q.desc}</span>
      </span>
    </a>
  `).join("");
}

/* ---------- 📢 FC온라인 소식 (v2.10.0 · v2.10.1 전문) ----------
   data/notices.json (scripts/notices.js, 하루 1회) — 게시판 칩 [공지사항 | 개발자 노트]
   글 행을 누르면 본문 전문이 펼쳐짐 (사용자 결정: 출처를 위·아래에 명확히 표시).
   본문은 data/notices-body.json에 따로 있어 처음 펼칠 때 한 번만 로딩 → 홈 첫 화면은 가볍게.
   본문 HTML은 수집 단계(scripts/lib/notice.js sanitizeBody)에서 허용 태그만 남겨 정리된 것 */
const NEWS_SHOW = 5;          // 처음 보이는 글 수 (나머지는 [더 보기])
const NEWS_NEW_DAYS = 3;      // 이 기간 안의 글은 NEW 표시
const NEWS_TAB_KEY = "dor6.news.tab";
let newsBodies = null;        // notices-body.json 로딩 Promise (한 번만)

// "오늘 13:20" · "어제" · "3일 전" · 일주일 넘으면 "9.30" (1년 넘으면 연도 포함)
function newsWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  const day = (x) => Math.floor((x.getTime() - x.getTimezoneOffset() * 6e4) / 864e5);
  const diff = day(now) - day(d);
  const p = (x) => String(x).padStart(2, "0");
  if (diff <= 0) return `오늘 ${p(d.getHours())}:${p(d.getMinutes())}`;
  if (diff === 1) return "어제";
  if (diff < 7) return `${diff}일 전`;
  return d.getFullYear() === now.getFullYear()
    ? `${d.getMonth() + 1}.${d.getDate()}` : `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

// 작성 일시 전체 표기 "2026.10.12 12:10"
function newsFullDate(iso) {
  if (!iso) return "";
  const d = new Date(iso), p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function newsItemHtml(it, board, label) {
  const isNew = it.date && Date.now() - new Date(it.date).getTime() < NEWS_NEW_DAYS * 864e5;
  const cat = it.category || "공지";
  const src = `<a href="${escapeHtml(it.url)}" target="_blank" rel="noopener">FC온라인 공식 홈페이지 › ${escapeHtml(label)}</a>`;
  return `
    <details class="nw-item" data-nw-key="${board}-${it.sn}">
      <summary>
        <span class="nw-cat c-${escapeHtml(cat)}">${escapeHtml(cat)}</span>
        <span class="nw-title">${escapeHtml(it.title)}${isNew ? ' <span class="nw-new">N</span>' : ""}</span>
        <span class="nw-date">${newsWhen(it.date)}</span>
      </summary>
      <div class="nw-body">
        <div class="nw-src">출처: ${src}${it.date ? ` · 작성 ${newsFullDate(it.date)}` : ""}</div>
        <div class="nw-article" data-nw-article>
          ${it.preview ? `<p class="nw-preview">${escapeHtml(it.preview)}</p>` : ""}
          ${it.hasBody ? `<div class="nw-loading">본문 불러오는 중…</div>` : ""}
        </div>
        <div class="nw-foot">
          <p>이 글의 저작권은 NEXON Korea에 있으며, 원문을 출처와 함께 옮겨 보여드립니다.
             하루 1회 가져온 내용이라 이후 수정됐을 수 있어요 — 최신 내용은 원문에서 확인하세요.</p>
          <div class="nw-foot-btns">
            <a class="nw-link" href="${escapeHtml(it.url)}" target="_blank" rel="noopener">원문 보기 ↗</a>
            <button type="button" class="nw-close" data-nw-close>접기 ▴</button>
          </div>
        </div>
      </div>
    </details>`;
}

// 펼친 글에 전문 채우기 (실패하면 미리보기 + 원문 링크로 남음)
async function fillNewsBody(det) {
  if (det.dataset.filled) return;
  det.dataset.filled = "1";
  const box = det.querySelector("[data-nw-article]");
  const loading = box.querySelector(".nw-loading");
  if (!loading) return;   // 본문 없는 글 = 미리보기만
  try {
    newsBodies = newsBodies || loadJSON("data/notices-body.json");
    const html = ((await newsBodies).bodies || {})[det.dataset.nwKey];
    if (html) box.innerHTML = html;
    else loading.remove();
  } catch (e) {
    console.error("공지 본문 로딩 실패:", e);
    newsBodies = null;   // 다음에 다시 시도
    delete det.dataset.filled;
    loading.textContent = "본문을 불러오지 못했어요. 아래 '원문 보기'로 확인해 주세요.";
  }
}

function renderNews(news) {
  const root = document.getElementById("fc-news");
  const boards = Object.entries((news && news.boards) || {}).filter(([, b]) => b.items && b.items.length);
  if (!boards.length) return;   // 수집 전·실패면 섹션 자체를 숨김

  let tab = null;
  try { tab = localStorage.getItem(NEWS_TAB_KEY); } catch {}
  if (!boards.some(([k]) => k === tab)) tab = boards[0][0];
  let expanded = false;

  const draw = () => {
    const board = boards.find(([k]) => k === tab)[1];
    const items = board.items;
    const shown = expanded ? items : items.slice(0, NEWS_SHOW);
    root.innerHTML = `
      <div class="section-title">📢 FC온라인 소식 <span class="in-note">· 2시간마다 확인 (최근 변경 ${fmt.dateTime(news.updatedAt)})</span></div>
      <div class="chip-row nw-tabs">${boards.map(([k, b]) =>
        `<button type="button" class="chip${k === tab ? " active" : ""}" data-nw-tab="${k}">${escapeHtml(b.label)}</button>`).join("")}</div>
      <div class="card nw-list">
        ${shown.map((it) => newsItemHtml(it, tab, board.label)).join("")}
        ${items.length > NEWS_SHOW
          ? `<button type="button" class="nw-more" data-nw-more>${expanded ? "접기 ▴" : `더 보기 (${items.length - NEWS_SHOW}개) ▾`}</button>` : ""}
      </div>
      <p class="nw-credit">출처: EA SPORTS FC™ Online 공식 홈페이지(fconline.nexon.com) 공지사항·개발자 노트 · 저작권 NEXON Korea</p>`;
    // 펼칠 때 전문 로딩 (toggle은 버블링 안 됨 → 항목마다 연결)
    root.querySelectorAll("details.nw-item").forEach((det) =>
      det.addEventListener("toggle", () => { if (det.open) fillNewsBody(det); }));
  };

  root.addEventListener("click", (e) => {
    const t = e.target.closest("[data-nw-tab]");
    const close = e.target.closest("[data-nw-close]");
    if (t) {
      tab = t.dataset.nwTab; expanded = false;
      try { localStorage.setItem(NEWS_TAB_KEY, tab); } catch {}
      draw();
    } else if (close) {
      // 긴 글을 다 읽고 접으면 제목 위치로 돌아가게
      const det = close.closest("details");
      det.open = false;
      if (det.getBoundingClientRect().top < 0 && det.scrollIntoView) det.scrollIntoView({ block: "start" });
    } else if (e.target.closest("[data-nw-more]")) {
      expanded = !expanded; draw();
    }
  });
  draw();
}

async function initHome() {
  renderQuickLinks();
  // 공지는 다른 데이터와 독립 — 실패해도 홈 나머지에 영향 없게 따로 로딩
  loadJSON("data/notices.json").then(renderNews).catch((e) => console.error("FC온라인 소식 로딩 실패:", e));

  const [members, seasons, dashFile, activity] = await loadAll([
    "data/members.json", "data/seasons.json", "data/dashboard.json", "data/activity.json"
  ]);
  // dashboard.json은 { current: { rows }, seasons } 구조 — 현재 시즌만 사용
  // (v1.12.0 수정: 이전엔 dashboard.rows를 읽어 요약 타일이 항상 '-'로 표시됐음)
  const dashboard = dashFile && dashFile.current;

  // 🔥 연승 중 · 🧊 연패 중 · 📅 최근 7일 활동 (activity-ui.js)
  if (activity) {
    document.getElementById("activity").innerHTML =
      streakBoards(activity, (members && members.members) || []) + weekBoard(activity);
  }

  const summary = document.getElementById("summary");
  const seasonNameEl = document.getElementById("season-name");

  // 현재 시즌
  let season = null;
  if (seasons && seasons.seasons) {
    const curId = seasons.meta && seasons.meta.currentSeasonId;
    season = seasons.seasons.find(s => s.id === curId) || seasons.seasons[seasons.seasons.length - 1];
  }
  seasonNameEl.textContent = season ? `${season.name} · 기준 ${season.targetGames}판 (중간점검 ${season.midTargetGames}판)` : "시즌 정보 없음";

  const totalMembers = members && members.members ? members.members.length : 0;

  // 대시보드 집계가 있으면 사용, 없으면 인원만
  let avgRate = null, midMiss = null, achieved = null;
  if (dashboard && dashboard.rows && dashboard.rows.length) {
    const rows = dashboard.rows.filter(r => !r.resting);
    avgRate = Math.round(rows.reduce((a, r) => a + Math.min(100, (r.played / r.target) * 100 || 0), 0) / (rows.length || 1));
    achieved = rows.filter(r => r.played >= r.target).length;
    midMiss = rows.filter(r => r.midMiss).length;
  }

  summary.innerHTML = `
    <div class="stat-tile"><div class="value">${totalMembers}</div><div class="label">클럽원</div></div>
    <div class="stat-tile"><div class="value">${avgRate == null ? "-" : avgRate + "%"}</div><div class="label">평균 달성률</div></div>
    <div class="stat-tile"><div class="value">${achieved == null ? "-" : achieved}</div><div class="label">기준 달성</div></div>
    <div class="stat-tile"><div class="value" style="${midMiss ? "background:none;color:var(--danger);" : ""}">${midMiss == null ? "-" : midMiss}</div><div class="label">중간점검 미달</div></div>
  `;

  if (!dashboard) {
    summary.insertAdjacentHTML("afterend",
      `<p style="font-size:var(--fs-xs);color:var(--text-dim);margin-top:var(--sp-2);">
       ※ 판수 집계 데이터(dashboard.json)가 아직 없습니다. 수집·집계 실행 후 표시됩니다.</p>`);
  }
}

initHome();
