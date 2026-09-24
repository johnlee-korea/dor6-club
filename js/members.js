/* members.js — 클럽원 명단 (운영진 + 클럽원 평면 표시, 행별 [스쿼드] 보기, 플레이스타일 한 줄) */

const ROLE_ORDER = { "회장": 0, "클럽장": 1, "부클럽장": 2, "클럽원": 3 };
let SQUADS = {}; // ouid → 최근 경기 라인업 (data/squads.json)
let STYLES = null; // data/playstyles.json (랭커 대비 지표·스타일, aggregate.js 산출)

async function initMembers() {
  const root = document.getElementById("members-root");
  const [membersFile, profilesFile, squadsFile, stylesFile] =
    await loadAll(["data/members.json", "data/profiles.json", "data/squads.json", "data/playstyles.json"]);
  SQUADS = (squadsFile && squadsFile.squads) || {};
  STYLES = stylesFile;

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

  let html = styleNote();
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
        ${styleBlock(m.ouid)}
      </div>
      <div class="meta">
        <div style="color:var(--silver);font-weight:700;">${grade}</div>
        <div style="font-size:var(--fs-xs);">${level}</div>
      </div>
      ${squadBtn}
    </div>
  `;
}

/* ---------- 플레이스타일 ---------- */
function styleNote() {
  if (!STYLES) return "";
  const d = STYLES.baselineUpdated ? STYLES.baselineUpdated.slice(0, 10) : "-";
  return `<p class="ps-note">🎭 플레이스타일: 최근 ${STYLES.recentGames}경기를 랭커 평균(${escapeHtml(STYLES.baselineSource || "")}, ${STYLES.baselineSampleSize}명·${d} 기준)과 비교해 ▲높은 지표 3개 ▼낮은 지표 3개를 뽑았어요. 재미로 봐주세요 😎</p>`;
}

/* 지표 값 표시 — '%'는 0~1 비율, 'avg%'는 이미 % 값, 그 외는 경기당 수치 */
function psVal(v, unit) {
  if (unit === "%") return `${(v * 100).toFixed(1)}%`;
  if (unit === "avg%") return `${v.toFixed(1)}%`;
  return v.toFixed(2);
}

function psChip(x, dir) {
  const tip = `나 ${psVal(x.v, x.unit)} · 랭커 평균 ${psVal(x.avg, x.unit)}`;
  return `<span class="ps-chip ${dir}" title="${escapeHtml(tip)}">${dir === "up" ? "▲" : "▼"} ${escapeHtml(x.label)} <b>${psVal(x.v, x.unit)}</b></span>`;
}

function styleBlock(ouid) {
  const ps = STYLES && ouid ? STYLES.players[ouid] : null;
  if (!ps) return "";
  if (!ps.style) return `<div class="ps"><span class="ps-wait">🎭 스타일 분석 대기 (${ps.games}/${STYLES.minGames}경기)</span></div>`;
  return `
    <div class="ps">
      <div><span class="ps-name">🎭 ${escapeHtml(ps.style.name)}</span> <span class="ps-line">“${escapeHtml(ps.style.line)}”</span></div>
      <div class="ps-chips">${ps.highs.map((x) => psChip(x, "up")).join("")}${ps.lows.map((x) => psChip(x, "down")).join("")}</div>
    </div>`;
}

/* [스쿼드] 버튼 — 행마다 리스너를 달지 않고 루트에서 이벤트 위임 */
document.getElementById("members-root").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-squad]");
  if (!btn) return;
  const squad = SQUADS[btn.dataset.squad];
  if (!squad) return;
  sqLoadMeta().then((meta) => openSquadModal(btn.dataset.nick, squad, meta));
});

initMembers();
