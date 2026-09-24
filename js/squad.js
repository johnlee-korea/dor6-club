/* ============================================================
   squad.js — 스쿼드 모달 (포메이션 필드 + 교체 명단)
   사용처
   - members.js: openSquadModal(nick, squad) — data/squads.json(회원별 최근 경기 라인업)
   - record.js : openMatchModal(match, meta, myNick) — 한 경기의 양팀 스쿼드
   포메이션 계산은 화면 쪽(sqFormation) 한 곳에서만 한다.
   ============================================================ */

const SQ_SUB_POSITION = 28; // spposition 28 = SUB(교체)

/* 선수/시즌/포지션 메타 로딩 (페이지당 1회 캐시) */
let _sqMetaPromise = null;
function sqLoadMeta() {
  if (!_sqMetaPromise) {
    _sqMetaPromise = loadAll(["data/meta/players.json", "data/meta/seasonid.json", "data/meta/spposition.json"])
      .then(([players, seasons, pos]) => ({
        players: players || {},
        seasons: seasons || {},
        posName: Object.fromEntries((pos || []).map((x) => [x.spposition, x.desc]))
      }));
  }
  return _sqMetaPromise;
}

/* 클럽 밖 선수 이름 보충 — players.json은 클럽원 경기 선수만 담으므로
   전적 검색(아무 유저)처럼 없는 선수가 있을 때만 전체 이름표(pnames.json, pid→이름)를 1회 로딩 */
async function sqEnsureNames(meta, lineups) {
  if (meta.pnames) return meta;
  const missing = lineups.some((lu) => (lu || []).some((pl) => !meta.players[pl.spId]));
  if (missing) meta.pnames = (await loadJSON("data/meta/pnames.json").catch(() => null)) || {};
  return meta;
}

/* 저장된 라인업(spId·spPosition·spGrade) → 화면 카드 + 선발/교체 분리
   spId 앞 3자리 = 시즌 id, 뒤 6자리 = 선수 고유 pid */
function sqBuildTeam(lineup, meta) {
  const toCard = (pl) => {
    const pid = pl.spId % 1000000;
    const season = meta.seasons[Math.floor(pl.spId / 1000000)] || {};
    return {
      spId: pl.spId, pid,
      name: meta.players[pl.spId] || (meta.pnames && meta.pnames[pid]) || `선수 ${pid}`,   // 메타 누락 시 대체 표기
      pos: pl.spPosition, posName: meta.posName[pl.spPosition] || "",
      grade: pl.spGrade,
      seasonName: season.name || "", seasonImg: season.img || ""
    };
  };
  const list = lineup || [];
  return {
    starters: list.filter((p) => p.spPosition !== SQ_SUB_POSITION).map(toCard).sort((a, b) => a.pos - b.pos),
    subs: list.filter((p) => p.spPosition === SQ_SUB_POSITION).map(toCard)
  };
}

/* 포지션 코드 목록 → 포메이션 문자열 (예: 4-2-3-1)
   - 수비(1~8) / 수미(9~11) / 중앙미드(13~15) / 측면미드(12,16) / 공미(17~19) / 처진공격(20~22) / 최전방(23~27)
   - 측면미드는 중앙미드가 있으면 그 줄에, 없고 공미가 있으면 공미 줄에 합침
     (LM·CAM·RM → '3', LM·LCM·RCM·RM → '4' 처럼 게임 표기와 맞추기 위함)
   - 처진공격(CF 등)은 최전방(ST·윙)이 3명 이상일 때만 별도 줄(예: CF+RW·ST·LW → 4-2-1-3),
     아니면 최전방 줄에 합침(예: RF+LS 투톱 → 2) */
function sqFormation(starters) {
  const cnt = { def: 0, dm: 0, cm: 0, wide: 0, am: 0, cf: 0, fw: 0 };
  for (const { pos: s } of starters) {
    if (s >= 1 && s <= 8) cnt.def++;
    else if (s >= 9 && s <= 11) cnt.dm++;
    else if (s === 12 || s === 16) cnt.wide++;
    else if (s >= 13 && s <= 15) cnt.cm++;
    else if (s >= 17 && s <= 19) cnt.am++;
    else if (s >= 20 && s <= 22) cnt.cf++;
    else if (s >= 23 && s <= 27) cnt.fw++;
  }
  if (cnt.cm) cnt.cm += cnt.wide;
  else if (cnt.am) cnt.am += cnt.wide;
  else cnt.cm = cnt.wide;
  if (cnt.fw < 3) { cnt.fw += cnt.cf; cnt.cf = 0; }
  return [cnt.def, cnt.dm, cnt.cm, cnt.am, cnt.cf, cnt.fw].filter((n) => n > 0).join("-");
}

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

/* 강화 단계 → 색 등급 (게임 내 표기: 1~4 브론즈, 5~7 실버, 8~10 골드, 11~13 백금) */
function sqGradeClass(g) {
  if (g >= 11) return "g-plat";
  if (g >= 8) return "g-gold";
  if (g >= 5) return "g-silver";
  if (g >= 1) return "g-bronze";
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

/* 회원 스쿼드 (명단 페이지) — 최근 경기 라인업 1팀 */
function openSquadModal(nick, squad, meta) {
  const type = SQ_MATCH_TYPE[squad.matchType] || "경기";
  const score = `${fmt.wl(squad.result)} ${squad.goalFor}:${squad.goalAgainst}`;
  const vs = squad.opponentNick ? ` vs ${escapeHtml(squad.opponentNick)}` : "";
  const { starters, subs } = sqBuildTeam(squad.lineup, meta);

  sqShowModal(`${nick} 스쿼드`, `
      <div class="sq-head">
        <div>
          <div class="sq-title">${escapeHtml(nick)} <span class="badge">${escapeHtml(sqFormation(starters) || "-")}</span></div>
          <div class="sq-dim">기준: ${fmt.dateTime(squad.matchDate)} ${type}${vs}
            · <span class="wl ${squad.result}">${score}</span></div>
        </div>
        <button class="sq-close" type="button" aria-label="닫기">✕</button>
      </div>
      ${renderPitch(starters)}
      ${renderSubs(subs)}
      <p class="sq-note">※ 넥슨 API는 현재 스쿼드를 제공하지 않아, 가장 최근 수집된 경기의 출전 명단으로 표시합니다.</p>`);
}

/* 한 경기 양팀 스쿼드 (전적 페이지) — 넓은 화면은 좌우, 모바일은 위아래 */
function openMatchModal(match, meta, myNick) {
  const type = SQ_MATCH_TYPE[match.matchType] || "경기";
  const OPP_RESULT = { win: "lose", lose: "win", draw: "draw" };
  const team = (nick, lineup, result) => {
    const t = sqBuildTeam(lineup, meta);
    const body = t.starters.length
      ? renderPitch(t.starters) + renderSubs(t.subs)
      : `<div class="empty" style="padding:var(--sp-5);">라인업 정보 없음<br><span class="sq-dim">(넥슨 보관 기간이 지난 경기이거나 수집 전 경기)</span></div>`;
    return `
      <div class="sq-team">
        <div class="sq-team-head">
          <span class="wl-dot ${result}">${fmt.wl(result)}</span>
          <b class="sq-team-nick">${escapeHtml(nick)}</b>
          ${t.starters.length ? `<span class="badge">${escapeHtml(sqFormation(t.starters))}</span>` : ""}
        </div>
        ${body}
      </div>`;
  };

  sqShowModal(`${myNick} vs ${match.opponentNick || "상대"} 경기 스쿼드`, `
      <div class="sq-head">
        <div>
          <div class="sq-title">${escapeHtml(myNick)}
            <span class="sq-score">${match.goalFor} : ${match.goalAgainst}</span>
            ${escapeHtml(match.opponentNick || "?")}</div>
          <div class="sq-dim">${fmt.dateTime(match.matchDate)} · ${type}</div>
        </div>
        <button class="sq-close" type="button" aria-label="닫기">✕</button>
      </div>
      <div class="sq-teams">
        ${team(myNick, match.lineup, match.result)}
        ${team(match.opponentNick || "상대", match.oppLineup, OPP_RESULT[match.result] || "draw")}
      </div>`, true);
}

/* 모달 공통 뼈대 — 바깥 클릭·✕·ESC로 닫기, 열린 동안 배경 스크롤 잠금 */
function sqShowModal(label, innerHtml, wide = false) {
  closeSquadModal();
  const overlay = document.createElement("div");
  overlay.className = "sq-overlay";
  overlay.innerHTML = `
    <div class="sq-modal${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-label="${escapeHtml(label)}">
      ${innerHtml}
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
