/* members.js — 클럽원 명단 (운영진 + 클럽원 평면 표시, 행별 [스쿼드] 보기) */

const ROLE_ORDER = { "회장": 0, "클럽장": 1, "부클럽장": 2, "클럽원": 3 };
let SQUADS = {}; // ouid → 최근 경기 라인업 (data/squads.json)

async function initMembers() {
  const root = document.getElementById("members-root");
  const [membersFile, profilesFile, squadsFile] =
    await loadAll(["data/members.json", "data/profiles.json", "data/squads.json"]);
  SQUADS = (squadsFile && squadsFile.squads) || {};

  if (!membersFile || !membersFile.members || !membersFile.members.length) {
    root.innerHTML = emptyState("등록된 클럽원이 없습니다.", "👥");
    return;
  }
  const members = membersFile.members;
  const profiles = (profilesFile && profilesFile.profiles) || {};

  // 운영진(회장/클럽장/부클럽장) + 클럽원 평면 구성 (담당 그룹 없음)
  const staff = members.filter((m) => m.role !== "클럽원")
    .sort((a, b) => (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]));
  const clubMembers = members.filter((m) => m.role === "클럽원")
    .sort((a, b) => a.ingameNick.localeCompare(b.ingameNick, "ko"));

  let html = "";
  if (staff.length) html += groupCard("👑 운영진", staff, profiles);
  html += groupCard("👥 클럽원", clubMembers, profiles, `${clubMembers.length}명`);
  root.innerHTML = html;
}

function groupCard(title, list, profiles, subtitle = "") {
  const rows = list.length
    ? list.map((m) => memberRow(m, profiles)).join("")
    : `<div class="empty" style="padding:var(--sp-4);">해당 인원 없음</div>`;
  return `
    <div class="section-title">${title}
      ${subtitle ? `<span style="font-size:var(--fs-xs);color:var(--text-dim);font-weight:400;">· ${subtitle}</span>` : ""}
    </div>
    <div class="card">${rows}</div>
  `;
}

function memberRow(m, profiles) {
  const prof = m.ouid ? profiles[m.ouid] : null;
  const grade = prof && prof.maxDivisionName ? prof.maxDivisionName : "-";
  const level = prof && prof.level ? `Lv.${prof.level}` : "";
  const pending = !m.ouid ? `<span class="badge warn" title="넥슨 조회 대기">닉 확인중</span>` : "";
  const sub = m.isSub ? `<span class="badge">부계정</span>` : "";
  // 최근 경기 기록이 있는 회원만 스쿼드 보기 가능
  const squadBtn = m.ouid && SQUADS[m.ouid]
    ? `<button class="btn sm" type="button" data-squad="${escapeHtml(m.ouid)}" data-nick="${escapeHtml(m.ingameNick)}">스쿼드</button>`
    : `<button class="btn sm" type="button" disabled title="수집된 경기 없음">스쿼드</button>`;
  return `
    <div class="member-row">
      <div class="info">
        <div class="nick">${escapeHtml(m.ingameNick)} ${roleBadge(m.role)} ${sub} ${pending}</div>
      </div>
      <div class="meta">
        <div style="color:var(--silver);font-weight:700;">${grade}</div>
        <div style="font-size:var(--fs-xs);">${level}</div>
      </div>
      ${squadBtn}
    </div>
  `;
}

/* [스쿼드] 버튼 — 행마다 리스너를 달지 않고 루트에서 이벤트 위임 */
document.getElementById("members-root").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-squad]");
  if (!btn) return;
  const squad = SQUADS[btn.dataset.squad];
  if (!squad) return;
  openSquadModal(btn.dataset.nick, squad);
});

initMembers();
