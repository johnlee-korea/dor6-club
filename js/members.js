/* members.js — 클럽원 명단 (담당 부클럽장별 그룹) */

const ROLE_ORDER = { "회장": 0, "클럽장": 1, "부클럽장": 2, "클럽원": 3 };

async function initMembers() {
  const root = document.getElementById("members-root");
  const [membersFile, profilesFile] = await loadAll(["data/members.json", "data/profiles.json"]);

  if (!membersFile || !membersFile.members || !membersFile.members.length) {
    root.innerHTML = emptyState("등록된 클럽원이 없습니다.", "👥");
    return;
  }
  const members = membersFile.members;
  const profiles = (profilesFile && profilesFile.profiles) || {};
  const byOuid = Object.fromEntries(members.filter((m) => m.ouid).map((m) => [m.ouid, m]));

  // 그룹 구성
  const staff = members.filter((m) => m.role !== "클럽원")
    .sort((a, b) => (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]));
  const managers = members.filter((m) => m.role === "부클럽장");

  let html = "";

  // 운영진
  html += groupCard("👑 운영진", staff, profiles);

  // 부클럽장별 담당 그룹
  for (const mgr of managers) {
    const mine = members.filter((m) => m.role === "클럽원" && m.manager === mgr.ouid);
    html += groupCard(`🛡 ${mgr.ingameNick} 담당`, mine, profiles, `담당 클럽원 ${mine.length}명`);
  }

  // 미배정 클럽원
  const unassigned = members.filter((m) =>
    m.role === "클럽원" && !(m.manager && byOuid[m.manager] && byOuid[m.manager].role === "부클럽장"));
  if (unassigned.length) {
    html += groupCard("❔ 부클럽장 미배정", unassigned, profiles, `${unassigned.length}명`);
  }

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
  return `
    <div class="member-row">
      <div class="info">
        <div class="nick">${escapeHtml(m.ingameNick)} ${roleBadge(m.role)} ${sub} ${pending}</div>
        <div class="talk">톡방: ${escapeHtml(m.talkNick || "-")}</div>
      </div>
      <div class="meta">
        <div style="color:var(--silver);font-weight:700;">${grade}</div>
        <div style="font-size:var(--fs-xs);">${level}</div>
      </div>
    </div>
  `;
}

initMembers();
