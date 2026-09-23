/* ============================================================
   squad.js — 스쿼드 모달 (포메이션 필드 + 교체 명단)
   데이터: data/squads.json (aggregate.js가 회원별 '최근 경기 라인업'으로 생성)
   사용: openSquadModal(nick, squad) — members.js의 [스쿼드] 버튼에서 호출
   ============================================================ */

/* 넥슨 선수 이미지 CDN: 시즌별 액션 이미지 → 없으면 기본 얼굴(pid) → 그래도 없으면 실루엣 */
const SQ_IMG = {
  action: (spId) => `https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/playersAction/p${spId}.png`,
  face:   (pid)  => `https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/players/p${pid}.png`
};

const SQ_MATCH_TYPE = { 50: "공식경기", 60: "공식친선", 30: "리그친선" };

/* spPosition → 필드 좌표(%) — x: 왼쪽→오른쪽, y: 위(공격)→아래(골키퍼)
   L/C/R 3자리가 함께 있는 라인은 renderPitch에서 좌우를 더 벌림 */
const SQ_COORD = {
  0: [50, 89],                                                   // GK
  1: [50, 82],                                                   // SW
  2: [90, 63], 3: [88, 73], 4: [66, 76], 5: [50, 77], 6: [34, 76], 7: [12, 73], 8: [10, 63],
  9: [66, 62], 10: [50, 62], 11: [34, 62],                       // 수미
  12: [88, 46], 13: [66, 49], 14: [50, 49], 15: [34, 49], 16: [12, 46],
  17: [68, 36], 18: [50, 36], 19: [32, 36],                      // 공미
  20: [66, 24], 21: [50, 24], 22: [34, 24],                      // 처진 공격
  23: [86, 17], 24: [64, 11], 25: [50, 11], 26: [36, 11], 27: [14, 17]
};
/* [오른쪽, 가운데, 왼쪽] 삼각 라인 — 가운데가 있으면 좌우를 27/73으로 벌림 */
const SQ_TRIOS = [[4, 5, 6], [9, 10, 11], [13, 14, 15], [17, 18, 19], [20, 21, 22], [24, 25, 26]];

/* 강화 단계 → 색 등급 (게임 내 표기 관례: 2~4 브론즈, 5~7 실버, 8~10 골드, 11+ 특급) */
function sqGradeClass(g) {
  if (g >= 11) return "g-top";
  if (g >= 8) return "g-gold";
  if (g >= 5) return "g-silver";
  if (g >= 2) return "g-bronze";
  return "g-none";
}

/* 필드 위 표시는 공간이 좁아 마지막 단어(성)만 — 전체 이름은 title로 */
function sqShortName(name) {
  const parts = String(name).trim().split(/\s+/);
  return parts[parts.length - 1];
}

/* 이미지 로딩 실패 시 단계적 대체 (onerror 인라인 핸들러에서 호출) */
function sqImgFallback(img) {
  if (img.dataset.step !== "face") {
    img.dataset.step = "face";
    img.src = SQ_IMG.face(img.dataset.pid);
  } else {
    img.onerror = null;
    img.removeAttribute("src");
    img.classList.add("sq-noimg");
  }
}

function sqFace(p) {
  return `
    <div class="sq-face">
      <img src="${SQ_IMG.action(p.spId)}" data-pid="${p.pid}" alt="" loading="lazy"
           onerror="sqImgFallback(this)">
    </div>`;
}

function sqMeta(p) {
  const season = p.seasonImg
    ? `<img class="sq-season" src="${escapeHtml(p.seasonImg)}" alt="${escapeHtml(p.seasonName)}" title="${escapeHtml(p.seasonName)}">`
    : `<span class="sq-season-txt">${escapeHtml(p.seasonName || "-")}</span>`;
  return `<div class="sq-meta">${season}<span class="sq-grade ${sqGradeClass(p.grade)}" title="강화 ${p.grade}단계">${p.grade}</span></div>`;
}

function renderPitch(starters) {
  const present = new Set(starters.map((p) => p.pos));
  const coord = {};
  for (const [pos, xy] of Object.entries(SQ_COORD)) coord[pos] = [...xy];
  for (const [r, c, l] of SQ_TRIOS) {
    if (present.has(c)) { coord[r][0] = 73; coord[l][0] = 27; }
  }

  const used = {}; // 같은 포지션 코드 중복(비정상 데이터) 시 옆으로 비껴 표시
  const nodes = starters.map((p) => {
    const [x0, y] = coord[p.pos] || [50, 50];
    const dup = used[p.pos] = (used[p.pos] || 0) + 1;
    const x = x0 + (dup - 1) * 12;
    return `
      <div class="sq-player" style="left:${x}%;top:${y}%;" title="${escapeHtml(`${p.name} · ${p.seasonName} · 강화 ${p.grade} · ${p.posName}`)}">
        ${sqFace(p)}
        ${sqMeta(p)}
        <div class="sq-name">${escapeHtml(sqShortName(p.name))}</div>
        <div class="sq-pos">${escapeHtml(p.posName)}</div>
      </div>`;
  }).join("");

  return `
    <div class="sq-pitch">
      <div class="sq-line half"></div><div class="sq-line circle"></div>
      <div class="sq-line box top"></div><div class="sq-line box bottom"></div>
      ${nodes}
    </div>`;
}

function renderSubs(subs) {
  if (!subs.length) return "";
  const cards = subs.map((p) => `
    <div class="sq-sub" title="${escapeHtml(`${p.name} · ${p.seasonName} · 강화 ${p.grade}`)}">
      ${sqFace(p)}
      ${sqMeta(p)}
      <div class="sq-name">${escapeHtml(p.name)}</div>
    </div>`).join("");
  return `<div class="section-title" style="margin-top:var(--sp-4);">교체 명단 <span class="sq-dim">· ${subs.length}명</span></div>
    <div class="sq-subs">${cards}</div>`;
}

function openSquadModal(nick, squad) {
  closeSquadModal();
  const type = SQ_MATCH_TYPE[squad.matchType] || "경기";
  const score = `${fmt.wl(squad.result)} ${squad.goalFor}:${squad.goalAgainst}`;
  const vs = squad.opponentNick ? ` vs ${escapeHtml(squad.opponentNick)}` : "";

  const overlay = document.createElement("div");
  overlay.className = "sq-overlay";
  overlay.innerHTML = `
    <div class="sq-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(nick)} 스쿼드">
      <div class="sq-head">
        <div>
          <div class="sq-title">${escapeHtml(nick)} <span class="badge">${escapeHtml(squad.formation || "-")}</span></div>
          <div class="sq-dim">기준: ${fmt.dateTime(squad.matchDate)} ${type}${vs}
            · <span class="wl ${squad.result}">${score}</span></div>
        </div>
        <button class="sq-close" type="button" aria-label="닫기">✕</button>
      </div>
      ${renderPitch(squad.starters || [])}
      ${renderSubs(squad.subs || [])}
      <p class="sq-note">※ 넥슨 API는 현재 스쿼드를 제공하지 않아, 가장 최근 수집된 경기의 출전 명단으로 표시합니다.</p>
    </div>`;

  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeSquadModal(); });
  overlay.querySelector(".sq-close").addEventListener("click", closeSquadModal);
  document.addEventListener("keydown", sqEscHandler);
  document.body.classList.add("sq-lock");
  document.body.appendChild(overlay);
}

function closeSquadModal() {
  const el = document.querySelector(".sq-overlay");
  if (el) el.remove();
  document.body.classList.remove("sq-lock");
  document.removeEventListener("keydown", sqEscHandler);
}

function sqEscHandler(e) { if (e.key === "Escape") closeSquadModal(); }
