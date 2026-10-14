/* ============================================================
   admin-league.js — 관리자 패널 '⚽ 도륙리그' 섹션 (v2.11.0, CLAUDE.md 25-9)
   - 상태 확인 · [리그 시작] · [예약 취소] · [오늘 스냅샷 (다시) 만들기]
   - 가능 여부 판정은 Worker가 서버 시각으로 함(/league/status의 can.*) → 화면은 그대로 보여 주기만
   - admin.js가 로그인 후 window.loadLeagueAdmin()을 호출
   ============================================================ */

(function () {
  const box = () => document.getElementById("league-admin");
  const WD = "일월화수목금토";
  const dayLabel = (date) => {
    const [y, m, d] = date.split("-").map(Number);
    return `${date}(${WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
  };
  const kstTime = (iso) => {
    if (!iso) return "-";
    const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  };
  const REASON = { short: (x) => `판수 미달 ${x.played}/${x.need}판`, rest: () => "휴식 중", sub: () => "부계정" };

  async function load() {
    const el = box();
    if (!el) return;
    el.innerHTML = `<div class="loading">리그 상태 확인 중…</div>`;
    let s;
    try { s = await auth.call("/league/status", {}); }
    catch (e) {
      console.error("[도륙리그 관리] 상태 조회 실패:", e);
      el.innerHTML = `<div class="error-box">리그 상태를 불러오지 못했어요: ${escapeHtml(e.message)}</div>`;
      return;
    }
    render(el, s);
  }

  function render(el, s) {
    const can = s.can;
    const today = s.todayEntry
      ? (s.todayRunning ? `제${s.todayEntry.no}회 진행 중` : `제${s.todayEntry.no}회 개최일`)
      : "개최일 아님";
    const snap = s.todayEntry
      ? (s.snapshot ? `✅ ${s.snapshot.teams}팀 · ${kstTime(s.snapshot.createdAt)} 생성 (${s.snapshot.source === "cron" ? "자동" : "관리자"})`
          + (s.snapshot.engine !== s.engine ? ` <span class="badge danger">⚠ 엔진 버전 불일치 v${s.snapshot.engine}→v${s.engine}</span>` : "")
          + (s.snapshot.eligibility === "skipped" ? ` <span class="badge warn">⚠ 판수 판정 생략(대시보드 로드 실패)</span>` : "")
        : `<span style="color:var(--warn);">❌ 아직 없음</span> <span class="lg-dim">(06:40 자동 생성)</span>`)
      : "-";
    const ex = s.roster.excluded || [];
    const snapBtnLabel = can.snapshot.overwrite ? "🔄 오늘 스냅샷 다시 만들기" : "🧊 오늘 스냅샷 만들기";
    el.innerHTML = `
      <dl class="lg-admin-grid">
        <dt>다음 개최</dt><dd>${s.pending ? `<b>제${s.pending.no}회 ${dayLabel(s.pending.date)} 07:00</b>` : "예약 없음"}</dd>
        <dt>오늘</dt><dd>${today}</dd>
        <dt>오늘 스냅샷</dt><dd>${snap}</dd>
        <dt>누적 개최</dt><dd>${s.totalHeld}회</dd>
        <dt>예상 참가</dt><dd><b>${s.roster.teams}팀</b> / 명단 ${s.roster.members}명 <span class="lg-dim">(${dayLabel(s.roster.expectDate)} 기준, 최종 판정은 개최일 06:40)</span>
          ${ex.length ? `<details style="margin-top:4px;"><summary class="lg-dim" style="cursor:pointer;">제외 ${ex.length}명 보기</summary>
            <div class="lg-excl-list">${ex.map((x) => `<span class="lg-excl-item">${escapeHtml(x.name)} <span class="lg-dim">${(REASON[x.reason] || (() => x.reason))(x)}</span></span>`).join("")}</div></details>` : ""}</dd>
        <dt>엔진</dt><dd>v${s.engine} <span class="lg-dim">· 서버 시각 ${kstTime(s.now)} KST</span></dd>
      </dl>
      <div class="lg-admin-actions">
        <button class="btn primary block" data-act="reserve" ${can.reserve.ok ? "" : "disabled"}>⚽ 리그 시작${can.reserve.ok ? ` — 제${can.reserve.no}회 ${dayLabel(can.reserve.date)} 07:00` : ""}</button>
        ${can.reserve.ok ? "" : `<div class="lg-admin-why">${escapeHtml(can.reserve.reason)}</div>`}
        ${s.pending ? `<button class="btn danger block" data-act="cancel" ${can.cancel.ok ? "" : "disabled"}>예약 취소</button>
          ${can.cancel.ok ? `<div class="lg-admin-why">해당일 06:30 전까지만 취소할 수 있어요.</div>` : `<div class="lg-admin-why">${escapeHtml(can.cancel.reason)}</div>`}` : ""}
        ${s.todayEntry ? `<button class="btn block" data-act="snapshot" ${can.snapshot.ok ? "" : "disabled"}>${snapBtnLabel}</button>
          <div class="lg-admin-why">${can.snapshot.ok ? (can.snapshot.late ? "자동 생성이 안 됐을 때만 사용 — 지금 명단·판수로 오늘 팀을 확정해요." : "07:00 전까지만 다시 만들 수 있어요 (지금 명단·판수 기준).") : escapeHtml(can.snapshot.reason)}</div>` : ""}
        <a class="btn block" href="league.html?test&iv=20" target="_blank" rel="noopener">🧪 테스트 리그 바로 돌려 보기 <span class="lg-dim">(20초 간격 · 기록에 안 남음)</span></a>
        <button class="btn sm" data-act="refresh" style="justify-self:start;">↻ 상태 새로고침</button>
      </div>
      <div id="league-admin-msg" style="margin-top:var(--sp-3);font-size:var(--fs-sm);"></div>`;
    el.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => act(b.dataset.act, s, b)));
  }

  async function act(kind, s, btn) {
    const msg = document.getElementById("league-admin-msg");
    if (kind === "refresh") return load();
    let path, body = {}, question;
    if (kind === "reserve") {
      const r = s.can.reserve;
      question = `제${r.no}회 도륙리그를 ${dayLabel(r.date)} 07:00에 개최합니다. 진행할까요?\n\n(그날 06:40 기준 참가 자격자로 자동 편성 · 하루만 열려요)`;
      path = "/league/reserve"; body = { expectDate: r.date };
    } else if (kind === "cancel") {
      question = `제${s.pending.no}회(${dayLabel(s.pending.date)}) 예약을 취소할까요?`;
      path = "/league/cancel";
    } else if (kind === "snapshot") {
      question = s.can.snapshot.overwrite
        ? "오늘 스냅샷을 지금 명단·판수로 다시 만들까요? (07:00 개막 전이라 결과에 문제 없어요)"
        : "오늘 스냅샷을 지금 명단·판수로 만들까요?";
      path = "/league/snapshot";
    } else return;
    if (!confirm(question)) return;
    btn.disabled = true;
    msg.textContent = "처리 중…";
    let result;
    try {
      const r = await auth.call(path, body);
      if (r.error) throw new Error(r.error);
      result = `<span style="color:var(--ok);">✅ ${escapeHtml(r.message || "완료")} — 사이트 반영까지 1~2분 걸릴 수 있어요.</span>`;
    } catch (e) {
      console.error(`[도륙리그 관리] ${kind} 실패:`, e);
      result = `<span style="color:var(--danger);">${escapeHtml(e.message)}</span>`;
    }
    // 성공·실패 모두 최신 상태로 다시 그림 (06:30 경계 등으로 버튼 상태가 바뀌었을 수 있음)
    await load();
    const m2 = document.getElementById("league-admin-msg");
    if (m2) m2.innerHTML = result;
  }

  window.loadLeagueAdmin = load;
})();
