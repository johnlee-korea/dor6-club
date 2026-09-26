/* ============================================================
   members.js — 클럽원 탭 (v2.0.0 검색 우선)
   클럽원은 대부분 '나'를 보러 옴 → 맨 위 검색 + ⭐ 내 프로필 + 최근 본 프로필
   전체 명단은 운영진용으로 접어 두고(펼침 상태 기억), 행을 누르면 개인 프로필(member.html)
   상세(플레이스타일 칩·스쿼드·인사이트·라이벌·경기)는 모두 프로필로 이동
   ============================================================ */

const ROLE_ORDER = { "회장": 0, "클럽장": 1, "부클럽장": 2, "클럽원": 3 };
const CTRL_ICON = { keyboard: ["⌨️", "키보드"], gamepad: ["🎮", "패드"] };
const ROSTER_OPEN_KEY = "dor6.rosterOpen";

let MS = { members: [], profiles: {}, styles: {}, insights: {}, activity: {} };

async function initMembers() {
  const root = document.getElementById("members-root");
  const [membersFile, profilesFile, stylesFile, insightsFile, activityFile] = await loadAll([
    "data/members.json", "data/profiles.json", "data/playstyles.json", "data/insights.json", "data/activity.json"
  ]);
  if (!membersFile || !membersFile.members || !membersFile.members.length) {
    root.innerHTML = emptyState("등록된 클럽원이 없습니다.", "👥");
    return;
  }
  MS = {
    members: membersFile.members,
    profiles: (profilesFile && profilesFile.profiles) || {},
    styles: (stylesFile && stylesFile.players) || {},
    insights: (insightsFile && insightsFile.players) || {},
    activity: (activityFile && activityFile.players) || {}
  };

  const staff = MS.members.filter((m) => m.role !== "클럽원").sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role]);
  const club = MS.members.filter((m) => m.role === "클럽원").sort((a, b) => a.ingameNick.localeCompare(b.ingameNick, "ko"));
  let open = false;
  try { open = localStorage.getItem(ROSTER_OPEN_KEY) === "1"; } catch {}

  root.innerHTML = `
    <input id="member-q" class="input ms-search" type="search" autocomplete="off"
      placeholder="🔍 클럽원 닉네임 검색 (일부만 입력해도 돼요)">
    <div id="ms-results"></div>
    <div id="ms-quick"></div>
    <details id="ms-roster" class="ms-roster" ${open ? "open" : ""}>
      <summary>📋 전체 명단 보기 <span class="in-note">· ${MS.members.length}명</span></summary>
      ${group("👑 운영진", staff)}
      ${group("👥 클럽원", club)}
    </details>`;

  renderQuick();
  const input = document.getElementById("member-q");
  input.addEventListener("input", renderResults);
  input.addEventListener("keydown", (e) => {          // Enter = 첫 번째 결과로 이동
    if (e.key !== "Enter") return;
    const first = document.querySelector("#ms-results a.ms-row");
    if (first) location.href = first.href;
  });
  document.getElementById("ms-roster").addEventListener("toggle", (e) => {
    try { localStorage.setItem(ROSTER_OPEN_KEY, e.target.open ? "1" : "0"); } catch {}
  });
}

/* 검색 결과 — 부분 일치·대소문자 무시, 입력 중에는 바로가기 영역을 숨김 */
function renderResults() {
  const raw = document.getElementById("member-q").value.trim();
  const q = raw.toLowerCase();
  const box = document.getElementById("ms-results");
  document.getElementById("ms-quick").style.display = q ? "none" : "";
  if (!q) { box.innerHTML = ""; return; }
  const hits = MS.members.filter((m) => m.ingameNick.toLowerCase().includes(q));
  box.innerHTML = hits.length
    ? `<div class="card" style="margin-bottom:var(--sp-4);">${hits.map(row).join("")}</div>`
    : `<div class="empty" style="padding:var(--sp-4);">'${escapeHtml(raw)}'와(과) 일치하는 클럽원이 없어요.</div>`;
}

/* ⭐ 내 프로필 + 🕘 최근 본 프로필 */
function renderQuick() {
  const byOuid = Object.fromEntries(MS.members.filter((m) => m.ouid).map((m) => [m.ouid, m]));
  const me = byOuid[myProfile.get()];
  const recent = myProfile.recent().map((o) => byOuid[o]).filter((m) => m && (!me || m.ouid !== me.ouid));
  document.getElementById("ms-quick").innerHTML = `
    <div class="section-title">⭐ 내 프로필</div>
    ${me ? `<div class="card" style="margin-bottom:var(--sp-4);">${row(me)}</div>`
         : `<div class="ps-note" style="margin-bottom:var(--sp-4);">내 닉네임을 검색해 프로필을 연 뒤 <b>☆ 내 프로필로 설정</b>을 누르면, 다음부터 여기서 바로 열 수 있어요.</div>`}
    ${recent.length ? `<div class="section-title">🕘 최근 본 프로필</div>
      <div class="chip-row">${recent.map((m) => `<a class="chip" href="${profileUrl(m.ouid)}">${escapeHtml(m.ingameNick)}</a>`).join("")}</div>` : ""}`;
}

function group(title, list) {
  return `
    <div class="section-title">${title} <span class="in-note">· ${list.length}명</span></div>
    <div class="card">${list.length ? list.map(row).join("") : `<div class="empty" style="padding:var(--sp-4);">해당 인원 없음</div>`}</div>`;
}

/* 한 줄 요약 행 — 닉·컨트롤러·역할 / 폼·연승·스타일 이름 / 등급 → 누르면 프로필 */
function row(m) {
  const prof = (m.ouid && MS.profiles[m.ouid]) || {};
  const ci = m.ouid && MS.insights[m.ouid] && CTRL_ICON[MS.insights[m.ouid].ctrl];
  const act = m.ouid && MS.activity[m.ouid];
  const ps = m.ouid && MS.styles[m.ouid];
  const badges = `${m.isSub ? `<span class="badge">부계정</span>` : ""}${!m.ouid ? `<span class="badge warn" title="넥슨 조회 대기">닉 확인중</span>` : ""}`;
  const inner = `
      <div class="info">
        <div class="nick">${escapeHtml(m.ingameNick)} ${ci ? `<span class="ctrl-ico" title="주 컨트롤러: ${ci[1]}">${ci[0]}</span>` : ""} ${roleBadge(m.role)} ${badges}</div>
        <div class="form-line">${act ? formDots(act.form) + " " + streakBadge(act.streak) : ""}
          ${ps && ps.style ? `<span class="ms-style">🎭 ${escapeHtml(ps.style.name)}${ps.style.rare ? " ✨" : ""}</span>` : ""}</div>
      </div>
      <div class="meta">
        <div style="color:var(--silver);font-weight:700;">${escapeHtml(prof.maxDivisionName || "-")}</div>
        <div style="font-size:var(--fs-xs);">${prof.level ? `Lv.${prof.level}` : ""}</div>
      </div>
      <span class="ms-go">›</span>`;
  return m.ouid
    ? `<a class="member-row ms-row" href="${profileUrl(m.ouid)}">${inner}</a>`
    : `<div class="member-row">${inner}</div>`;   // ouid 없는 회원(닉 확인중)은 프로필 없음
}

initMembers();
