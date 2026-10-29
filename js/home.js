/* home.js — 홈: 이번 시즌 요약 + 바로가기 */

// 바로가기 타일 (v2.21.0) — feature: 맨 위 가로로 넓게 강조 (도륙리그)
const QUICK = [
  { label: "도륙리그",       desc: "클럽원 1명 = 1팀 · 매일 아침 7시 문자중계", href: "league.html", emoji: "⚽", feature: true },
  { label: "클럽원 프로필", desc: "플레이스타일·에이스·스쿼드·라이벌", href: "members.html", emoji: "👥" },
  { label: "시즌 판수",     desc: "달성률·중간점검 미달자", href: "dashboard.html", emoji: "🎯" },
  { label: "내 선수 키우기", desc: "16세 유망주를 레전드로", href: "career.html", emoji: "⭐" },
  { label: "클럽 내전",     desc: "클럽원 간 상대 전적",           href: "internal.html",  emoji: "⚔️" },
  { label: "토너먼트",     desc: "추첨 → 대진표 진행", href: "tournament.html", emoji: "🏟️" },
  { label: "명예의 전당",   desc: "시즌별 최다판수·최다승",         href: "hall.html",      emoji: "🏆" },
  { label: "전적 검색",     desc: "아무 유저나 닉네임으로", href: "search.html",      emoji: "🔍" },
  { label: "규칙·공지",     desc: "운영 수칙·개편 공지",           href: "rules.html",     emoji: "📋" }
];

function renderQuickLinks() {
  document.getElementById("quicklinks").innerHTML = QUICK.map(q => `
    <a class="hm-link${q.feature ? " feature" : ""}" href="${q.href}">
      <span class="hm-link-ico">${q.emoji}</span>
      <span>
        <span class="hm-link-name">${q.label}</span>
        <span class="hm-link-desc" style="display:block;">${q.desc}</span>
      </span>
    </a>
  `).join("");
}

/* 🏟 배너 아래 시즌 진행 막대 — 오늘이 시즌의 며칠째인지, 중간점검 위치, 남은 날 (KST 날짜 기준) */
function renderSeasonBar(season) {
  const el = document.getElementById("season-bar");
  if (!el || !season || !season.start || !season.end) return;
  const day = (d) => Date.parse(d + "T00:00:00+09:00");
  const today = day(new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10));
  const start = day(season.start), end = day(season.end), DAY = 86400e3;
  const total = Math.round((end - start) / DAY) + 1;
  const nth = Math.round((today - start) / DAY) + 1;            // 오늘이 몇째 날
  const left = Math.round((end - today) / DAY);                 // 종료까지 남은 날
  const pct = Math.max(0, Math.min(100, (nth / total) * 100));
  const midPct = season.midCheck ? Math.max(0, Math.min(100, ((Math.round((day(season.midCheck) - start) / DAY) + 1) / total) * 100)) : null;
  const dday = left > 0 ? `D-${left}` : left === 0 ? "D-DAY" : "종료";
  const note = left > 0 ? `${nth}일째 / ${total}일` : left === 0 ? "오늘 시즌 마지막 날" : "다음 시즌 준비 중";
  const md = (d) => d.slice(5).replace("-", ".");
  el.innerHTML = `
    <div class="hm-season-row"><span>${escapeHtml(season.name)} 진행 · ${note}</span><span class="hm-dday">${dday}</span></div>
    <div class="hm-track"><div class="bar" style="width:${pct}%"></div>${midPct != null ? `<span class="mid" style="left:${midPct}%" title="중간점검 ${season.midCheck}"></span>` : ""}</div>
    <div class="hm-track-lab"><span>${md(season.start)} 개막</span>${season.midCheck ? `<span>중간점검 ${md(season.midCheck)}</span>` : ""}<span>${md(season.end)} 종료</span></div>`;
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
    // 중계 스타일: 연승 카드 레드 · 연패 카드 블루 띠 (css/home.css)
    document.querySelectorAll("#activity .section-title").forEach((t) => {
      const card = t.nextElementSibling;
      if (!card) return;
      if (t.textContent.includes("연승")) card.classList.add("hm-hot");
      else if (t.textContent.includes("연패")) card.classList.add("hm-cold");
    });
  }

  const summary = document.getElementById("summary");
  const seasonNameEl = document.getElementById("season-name");

  // 현재 시즌
  let season = null;
  if (seasons && seasons.seasons) {
    const curId = seasons.meta && seasons.meta.currentSeasonId;
    season = seasons.seasons.find(s => s.id === curId) || seasons.seasons[seasons.seasons.length - 1];
  }
  seasonNameEl.innerHTML = season ? `<b>${escapeHtml(season.name)}</b> · 기준 ${season.targetGames}판 · 중간점검 ${season.midTargetGames}판` : "시즌 정보 없음";
  renderSeasonBar(season);

  const totalMembers = members && members.members ? members.members.length : 0;

  // 대시보드 집계가 있으면 사용, 없으면 인원만
  let avgRate = null, midMiss = null, achieved = null;
  if (dashboard && dashboard.rows && dashboard.rows.length) {
    const rows = dashboard.rows.filter(r => !r.resting);
    avgRate = Math.round(rows.reduce((a, r) => a + Math.min(100, (r.played / r.target) * 100 || 0), 0) / (rows.length || 1));
    achieved = rows.filter(r => r.played >= r.target).length;
    midMiss = rows.filter(r => r.midMiss).length;
  }

  // 점수판 타일 (v2.21.0): 평균 달성률엔 미니 막대, 중간점검 미달 있으면 빨간 타일
  const mini = (p) => p == null ? "" : `<div class="hm-mini"><i style="width:${Math.min(100, p)}%"></i></div>`;
  const active = dashboard && dashboard.rows ? dashboard.rows.filter(r => !r.resting).length : 0;
  summary.innerHTML = `
    <div class="stat-tile"><div class="value">${totalMembers}<small>명</small></div><div class="label">클럽원</div></div>
    <div class="stat-tile"><div class="value">${avgRate == null ? "-" : avgRate + "<small>%</small>"}</div>${mini(avgRate)}<div class="label">평균 달성률</div></div>
    <div class="stat-tile"><div class="value">${achieved == null ? "-" : achieved}${achieved == null || !active ? "" : `<small>/${active}</small>`}</div><div class="label">기준 달성</div></div>
    <div class="stat-tile${midMiss ? " alert" : ""}"><div class="value">${midMiss == null ? "-" : midMiss}<small>명</small></div><div class="label">중간점검 미달</div></div>
`;


  if (!dashboard) {
    summary.insertAdjacentHTML("afterend",
      `<p style="font-size:var(--fs-xs);color:var(--text-dim);margin-top:var(--sp-2);">
       ※ 판수 집계 데이터(dashboard.json)가 아직 없습니다. 수집·집계 실행 후 표시됩니다.</p>`);
  }
}

initHome();
