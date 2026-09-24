/* tournament.js — 클럽 토너먼트 기록기 (1회성, 저장 없음)
   흐름: 명단 등록(setup) → 추첨·대진표(play) → 승자 클릭으로 진출 → 우승
   설계: 모든 상태는 메모리의 TN 객체 하나. 화면은 상태가 바뀔 때마다 render()로 통째 다시 그림(인원 수십 명 규모라 충분)
         클릭은 루트 한 곳에서 data-act 속성으로 위임 처리 */

const TN = {
  phase: "setup",       // setup | play
  name: "도륙컵",
  pool: [],             // 선택 가능한 선수 [{ nick, guest }]
  selected: new Set(),  // 출전 선수 닉
  rounds: [],           // [라운드][경기] = { a, b, winner, bye }
  champion: null,
  revealed: false       // 대진표 발표 애니메이션 1회만
};

async function initTournament() {
  const [membersFile] = await loadAll(["data/members.json"]);
  const members = (membersFile && membersFile.members) || [];
  TN.pool = members.map((m) => ({ nick: m.ingameNick, guest: false }))
    .sort((a, b) => a.nick.localeCompare(b.nick, "ko"));
  render();
}

/* ---------- 로직 ---------- */

/* Fisher–Yates 셔플 (원본 보존) */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* 인원 → 대진 크기(2의 제곱수)·부전승 수 */
function bracketSize(n) {
  let size = 2;
  while (size < n) size *= 2;
  return { size, byes: size - n };
}

/* 라운드 이름: 경기 수 1 = 결승, 2 = 4강, 그 외 N강 */
function roundName(matchCount) {
  if (matchCount === 1) return "결승";
  return `${matchCount * 2}강`;
}

/* 추첨: 셔플 후 1라운드 편성. 부전승 경기는 전체에 고르게 분산(부전승끼리 붙지 않음) */
function draw() {
  const players = shuffle([...TN.selected]);
  const { size, byes } = bracketSize(players.length);
  const matchCount = size / 2;
  const byeIdx = new Set();
  for (let i = 0; i < byes; i++) byeIdx.add(Math.floor((i * matchCount) / byes));

  const first = [];
  for (let i = 0; i < matchCount; i++) {
    if (byeIdx.has(i)) first.push({ a: players.shift(), b: null, winner: null, bye: true });
    else first.push({ a: players.shift(), b: players.shift(), winner: null, bye: false });
  }
  // 이후 라운드는 빈 칸으로 생성
  TN.rounds = [first];
  for (let m = matchCount / 2; m >= 1; m /= 2) {
    TN.rounds.push(Array.from({ length: m }, () => ({ a: null, b: null, winner: null, bye: false })));
  }
  TN.champion = null;
  TN.revealed = false;
  // 부전승은 바로 다음 라운드로
  first.forEach((m, i) => { if (m.bye) setWinner(0, i, m.a); });
}

/* 경기 (r, i)의 승자 해제 — 다음 라운드로 올라간 기록까지 연쇄 초기화 */
function clearWinner(r, i) {
  const m = TN.rounds[r][i];
  if (!m.winner) return;
  m.winner = null;
  if (r === TN.rounds.length - 1) { TN.champion = null; return; }
  const next = TN.rounds[r + 1][i >> 1];
  next[i % 2 ? "b" : "a"] = null;
  clearWinner(r + 1, i >> 1);
}

/* 경기 (r, i)의 승자 지정 → 다음 라운드 칸(짝수 경기는 위 a, 홀수 경기는 아래 b)에 진출 */
function setWinner(r, i, nick) {
  const m = TN.rounds[r][i];
  if (m.winner === nick) return;
  clearWinner(r, i);
  m.winner = nick;
  if (r === TN.rounds.length - 1) { TN.champion = nick; return; }
  TN.rounds[r + 1][i >> 1][i % 2 ? "b" : "a"] = nick;
}

/* 부전승 외에 승자가 하나라도 입력됐는지 (다시 추첨 가능 여부) */
function started() {
  return TN.rounds.some((round) => round.some((m) => m.winner && !m.bye));
}

/* ---------- 렌더 ---------- */

function render() {
  const root = document.getElementById("tn-root");
  root.innerHTML = TN.phase === "setup" ? setupView() : playView();
}

function setupView() {
  const n = TN.selected.size;
  const info = n >= 2
    ? (() => { const { size, byes } = bracketSize(n); return `${n}명 → <b>${roundName(size / 2)}</b>${byes ? ` (부전승 ${byes}명)` : ""}`; })()
    : `${n}명 선택 — 2명 이상 골라주세요`;
  const chips = TN.pool.map((p) => `
    <button type="button" class="tn-pick ${TN.selected.has(p.nick) ? "on" : ""}" data-act="toggle" data-nick="${escapeHtml(p.nick)}">
      ${escapeHtml(p.nick)}${p.guest ? ` <span class="tn-guest">게스트</span>` : ""}
    </button>`).join("");
  return `
    <div class="card">
      <div class="field">
        <label for="tn-name">대회 이름</label>
        <input id="tn-name" class="input" maxlength="30" value="${escapeHtml(TN.name)}">
      </div>
      <div class="field" style="margin-bottom:var(--sp-3);">
        <label>출전 선수 <span style="color:var(--text-dim);">(눌러서 선택)</span></label>
        <div class="tn-tools">
          <button type="button" class="btn sm" data-act="all">전체 선택</button>
          <button type="button" class="btn sm" data-act="none">전체 해제</button>
        </div>
        <div class="tn-picks">${chips}</div>
      </div>
      <div class="field">
        <label for="tn-guest">클럽원이 아닌 참가자 추가</label>
        <div style="display:flex;gap:var(--sp-2);">
          <input id="tn-guest" class="input" maxlength="20" placeholder="닉네임 입력 후 추가">
          <button type="button" class="btn" data-act="guest">추가</button>
        </div>
      </div>
      <div class="tn-summary">${info}</div>
      <button type="button" class="btn primary block" data-act="draw" ${n < 2 ? "disabled" : ""}>🎲 추첨하기</button>
    </div>`;
}

function playView() {
  const reveal = !TN.revealed;
  TN.revealed = true;
  const final = TN.rounds[TN.rounds.length - 1][0];
  const runnerUp = TN.champion ? (final.a === TN.champion ? final.b : final.a) : null;

  const cols = TN.rounds.map((round, r) => `
    <div class="tn-col">
      <div class="tn-round">${roundName(round.length)}</div>
      <div class="tn-matches">
        ${round.map((m, i) => matchCard(m, r, i, reveal && r === 0 ? i : -1)).join("")}
      </div>
    </div>`).join("");

  const champ = TN.champion ? `
    <div class="card tn-champ">
      <div class="tn-trophy">🏆</div>
      <div class="tn-champ-name">${escapeHtml(TN.champion)}</div>
      <div style="color:var(--text-muted);">${escapeHtml(TN.name)} 우승!</div>
      ${runnerUp ? `<div class="tn-runner">🥈 준우승 ${escapeHtml(runnerUp)}</div>` : ""}
      <div class="tn-actions">
        <button type="button" class="btn primary" data-act="again">같은 명단으로 새 대회</button>
        <button type="button" class="btn" data-act="reset">처음으로</button>
      </div>
    </div>` : "";

  return `
    <div class="tn-head">
      <div>
        <div class="section-title" style="margin:0;">🏟️ ${escapeHtml(TN.name)}</div>
        <div style="font-size:var(--fs-xs);color:var(--text-dim);">${TN.selected.size}명 참가 · 이긴 선수를 누르세요 (다시 누르면 변경)</div>
      </div>
      <div class="tn-actions">
        ${started() ? "" : `<button type="button" class="btn sm" data-act="redraw">🎲 다시 추첨</button>`}
        <button type="button" class="btn sm" data-act="back">명단 수정</button>
      </div>
    </div>
    ${champ}
    <div class="tn-bracket">${cols}</div>`;
}

/* 경기 카드 — 두 선수 모두 정해진 경기만 클릭 가능. delay ≥ 0이면 발표 애니메이션 순서 */
function matchCard(m, r, i, delay) {
  const ready = m.a && m.b && !m.bye;
  const slot = (nick, isBye) => {
    if (isBye) return `<div class="tn-slot bye">부전승</div>`;
    if (!nick) return `<div class="tn-slot tbd">—</div>`;
    const cls = m.winner ? (m.winner === nick ? "win" : "lose") : "";
    return ready
      ? `<button type="button" class="tn-slot ${cls}" data-act="win" data-r="${r}" data-i="${i}" data-nick="${escapeHtml(nick)}">${escapeHtml(nick)}${m.winner === nick ? " ✔" : ""}</button>`
      : `<div class="tn-slot ${cls}">${escapeHtml(nick)}</div>`;
  };
  const style = delay >= 0 ? ` style="animation-delay:${delay * 120}ms"` : "";
  return `<div class="tn-match ${delay >= 0 ? "reveal" : ""}"${style}>${slot(m.a, false)}${slot(m.b, m.bye)}</div>`;
}

/* ---------- 이벤트 ---------- */

document.getElementById("tn-root").addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  const nameInput = document.getElementById("tn-name");
  if (nameInput) TN.name = nameInput.value.trim() || "도륙컵";

  if (act === "toggle") {
    const nick = el.dataset.nick;
    TN.selected.has(nick) ? TN.selected.delete(nick) : TN.selected.add(nick);
  } else if (act === "all") {
    TN.pool.forEach((p) => TN.selected.add(p.nick));
  } else if (act === "none") {
    TN.selected.clear();
  } else if (act === "guest") {
    addGuest();
    return;
  } else if (act === "draw" || act === "redraw" || act === "again") {
    draw();
    TN.phase = "play";
  } else if (act === "win") {
    setWinner(+el.dataset.r, +el.dataset.i, el.dataset.nick);
  } else if (act === "back") {
    if (started() && !confirm("진행 중인 대진이 사라집니다. 명단 수정으로 돌아갈까요?")) return;
    TN.phase = "setup";
  } else if (act === "reset") {
    TN.phase = "setup";
    TN.selected.clear();
  }
  render();
});

/* 게스트 추가 — 같은 닉이 이미 있으면 선택만 */
function addGuest() {
  const input = document.getElementById("tn-guest");
  const nick = input.value.trim();
  if (!nick) return;
  if (!TN.pool.some((p) => p.nick === nick)) TN.pool.push({ nick, guest: true });
  TN.selected.add(nick);
  render();
  document.getElementById("tn-guest").focus();
}

document.getElementById("tn-root").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "tn-guest") addGuest();
});

/* 진행 중(대진 생성 후 우승 전) 새로고침·닫기 경고 — 저장이 없으므로 */
window.addEventListener("beforeunload", (e) => {
  if (TN.phase === "play" && !TN.champion) { e.preventDefault(); e.returnValue = ""; }
});

initTournament();
