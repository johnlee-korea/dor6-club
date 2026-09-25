/* members.js — 클럽원 명단 (운영진 + 클럽원 평면 표시, 행별 [스쿼드] 보기, 플레이스타일 한 줄) */

const ROLE_ORDER = { "회장": 0, "클럽장": 1, "부클럽장": 2, "클럽원": 3 };
let SQUADS = {}; // ouid → 최근 경기 라인업 (data/squads.json)
let STYLES = null; // data/playstyles.json (랭커 대비 지표·스타일, aggregate.js 산출)
let INSIGHTS = {}; // ouid → 인사이트(컨트롤러 등, data/insights.json)
const CTRL_ICON = { keyboard: ["⌨️", "키보드"], gamepad: ["🎮", "패드"] };
let ACTIVITY = {}; // ouid → { form, streak } (data/activity.json, v1.12.0)

async function initMembers() {
  const root = document.getElementById("members-root");
  const [membersFile, profilesFile, squadsFile, stylesFile, insightsFile, activityFile] =
    await loadAll(["data/members.json", "data/profiles.json", "data/squads.json", "data/playstyles.json",
      "data/insights.json", "data/activity.json"]);
  INSIGHTS = (insightsFile && insightsFile.players) || {};
  ACTIVITY = (activityFile && activityFile.players) || {};
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
  // 최근 20경기 주 사용 컨트롤러
  const ci = m.ouid && INSIGHTS[m.ouid] && CTRL_ICON[INSIGHTS[m.ouid].ctrl];
  const ctrl = ci ? `<span class="ctrl-ico" title="주 컨트롤러: ${ci[1]}">${ci[0]}</span>` : "";
  // 최근 경기 기록이 있는 회원만 스쿼드 보기 가능
  const squadBtn = m.ouid && SQUADS[m.ouid]
    ? `<button class="btn sm" type="button" data-squad="${escapeHtml(m.ouid)}" data-nick="${escapeHtml(m.ingameNick)}">스쿼드</button>`
    : `<button class="btn sm" type="button" disabled title="수집된 경기 없음">스쿼드</button>`;
  return `
    <div class="member-row">
      <div class="info">
        <div class="nick">${escapeHtml(m.ingameNick)} ${ctrl} ${roleBadge(m.role)} ${sub} ${pending}</div>
        ${formLine(m.ouid)}
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
  const defs = Object.values(STYLES.metrics || {})
    .map((m) => `<li><b>${escapeHtml(m.label)}</b> — ${escapeHtml(m.desc)}</li>`).join("");
  return `
    <div class="ps-note">
      🎭 <b>플레이스타일</b>: 최근 ${STYLES.recentGames}경기의 지표 25개를 랭커 평균(${escapeHtml(STYLES.baselineSource || "")}, ${STYLES.baselineSampleSize}명·${d} 기준)과 비교해
      랭커 대비 가장 높은 지표 ▲3개, 가장 낮은 지표 ▼3개를 표시해요. 스타일은 이 6개 중 <b>★표시된 지표</b>로 정해집니다. 재미로 봐주세요 😎
      <details><summary>지표 기준 보기</summary>
        <ul>${defs}</ul>
        <p>▲▼ 순서는 랭커 평균에서 벗어난 정도(표준편차 배수) 기준. ★ 두 지표가 함께 있으면 조합 스타일, 아니면 가장 두드러진 지표 하나의 스타일이 붙어요.</p>
      </details>
    </div>`;
}

/* 최근 10경기 폼 점 + 🔥연승/🧊연패 배지 (activity-ui.js) */
function formLine(ouid) {
  const a = ouid && ACTIVITY[ouid];
  if (!a || !a.form || !a.form.length) return "";
  return `<div class="form-line">${formDots(a.form)} ${streakBadge(a.streak)}</div>`;
}

/* 플레이스타일 블록 그리기는 js/insight-ui.js psBlock (전적 검색과 공용) */
function styleBlock(ouid) {
  const ps = STYLES && ouid ? STYLES.players[ouid] : null;
  return psBlock(ps, STYLES && STYLES.minGames);
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
