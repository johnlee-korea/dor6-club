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

async function initHome() {
  renderQuickLinks();

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
