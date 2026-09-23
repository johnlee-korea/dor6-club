/* ============================================================
   common.js — 모든 페이지 공통: 헤더/네비 주입, 유틸 함수
   각 페이지는 <body data-page="키">, <main class="page">만 두면 됨.
   ============================================================ */

/* 사이트 설정 (배포 후 값 채움) */
window.DOR6 = {
  clubName: "도륙",
  clubEn: "Dor6",
  /* Cloudflare Worker 배포 후 URL 입력 (관리자 기능용). 미설정 시 관리자 패널 비활성 안내 */
  workerUrl: "",
  /* GitHub Pages base path (레포명). 로컬 file:// 열람 시 자동 무시 */
  basePath: "/dor6-club"
};

/* 네비 메뉴 정의 (순서 = 표시 순서) */
const DOR6_NAV = [
  { key: "home",      label: "홈",         href: "index.html" },
  { key: "members",   label: "클럽원",     href: "members.html" },
  { key: "dashboard", label: "판수",       href: "dashboard.html" },
  { key: "record",    label: "전적",       href: "record.html" },
  { key: "style",     label: "플레이스타일", href: "style.html" },
  { key: "internal",  label: "내전",       href: "internal.html" },
  { key: "hall",      label: "명예의전당",  href: "hall.html" },
  { key: "rules",     label: "규칙·공지",   href: "rules.html" }
];

/* ---------- 헤더/네비 렌더 ---------- */
function renderChrome() {
  if (document.querySelector(".app-header")) return; // 중복 주입 방지
  const page = document.body.dataset.page || "home";

  const header = document.createElement("header");
  header.className = "app-header";
  header.innerHTML = `
    <a href="index.html" style="display:flex;align-items:center;gap:10px;">
      <img class="logo" src="dor6.png" alt="도륙 엠블럼">
      <span class="brand">
        <span class="name">도륙 · Dor6</span>
        <span class="sub">클럽원 전용 정보</span>
      </span>
    </a>
    <span class="spacer"></span>
    <a class="admin-link" href="admin.html">🔒 관리자</a>
  `;

  const nav = document.createElement("nav");
  nav.className = "app-nav";
  nav.innerHTML = DOR6_NAV.map(n =>
    `<a href="${n.href}" class="${n.key === page ? "active" : ""}">${n.label}</a>`
  ).join("");

  document.body.prepend(nav);
  document.body.prepend(header);

  // 활성 탭이 보이도록 스크롤 (구형/미구현 환경 방어)
  const active = nav.querySelector("a.active");
  if (active && typeof active.scrollIntoView === "function") {
    active.scrollIntoView({ inline: "center", block: "nearest" });
  }
}

function renderFooter() {
  const f = document.createElement("footer");
  f.className = "app-footer";
  f.innerHTML = `도륙(Dor6) 클럽원 전용 · 게임 닉네임·전적 외 개인정보 미수집 ·
    데이터: 넥슨 오픈 API`;
  document.body.appendChild(f);
}

/* ---------- 데이터 로딩 ---------- */
async function loadJSON(path) {
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${path} 로딩 실패 (${res.status})`);
  return res.json();
}

/* 여러 JSON 병렬 로딩. 실패한 건 null */
async function loadAll(paths) {
  const results = await Promise.all(paths.map(p =>
    loadJSON(p).catch(err => { console.error(err); return null; })
  ));
  return results;
}

/* ---------- 포맷 유틸 ---------- */
const fmt = {
  pct: (n) => (n == null ? "-" : Math.round(n) + "%"),
  date: (iso) => {
    if (!iso) return "-";
    const d = new Date(iso);
    return `${d.getMonth() + 1}.${d.getDate()}`;
  },
  dateTime: (iso) => {
    if (!iso) return "-";
    const d = new Date(iso);
    const p = (x) => String(x).padStart(2, "0");
    return `${d.getMonth() + 1}.${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
  wl: (r) => ({ win: "승", draw: "무", lose: "패" }[r] || "-")
};

/* 역할 배지 HTML */
function roleBadge(role) {
  return `<span class="badge role-${role}">${role}</span>`;
}

/* 상태(달성/미달/임박) 클래스 계산 */
function progressStatus(played, target) {
  if (target <= 0) return "ok";
  const ratio = played / target;
  if (ratio >= 1) return "ok";
  if (ratio >= 0.7) return "warn";
  return "danger";
}

/* HTML 이스케이프 */
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* 빈 상태 렌더 헬퍼 */
function emptyState(msg, emoji = "📭") {
  return `<div class="empty"><span class="emoji">${emoji}</span>${msg}</div>`;
}
function errorState(msg) {
  return `<div class="error-box">⚠️ ${msg}</div>`;
}

/* ---------- 부팅 ---------- */
document.addEventListener("DOMContentLoaded", () => {
  renderChrome();
  renderFooter();
});
