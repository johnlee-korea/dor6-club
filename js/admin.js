/* admin.js — 관리자 패널 (로그인 + 클럽원 등록/삭제) */

const $ = (id) => document.getElementById(id);

function initAdmin() {
  // Worker 미설정 안내
  if (!window.DOR6.workerUrl) {
    $("worker-warn").innerHTML = `
      <div class="error-box" style="margin-top:var(--sp-4);">
        ⚙️ 관리자 백엔드(Cloudflare Worker)가 아직 연결되지 않았습니다.<br>
        <span style="font-size:var(--fs-sm);color:var(--text-muted);">
        worker/README.md 가이드대로 배포 후 <code>js/common.js</code>의 <code>DOR6.workerUrl</code>을 설정하세요.
        그 전까지는 <code>data/members.json</code>을 직접 편집해 관리할 수 있습니다.</span>
      </div>`;
  }

  if (auth.loggedIn) showAdminView();

  $("login-btn").addEventListener("click", doLogin);
  $("pw").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  $("logout-btn").addEventListener("click", () => { auth.logout(); location.reload(); });
  $("add-btn").addEventListener("click", doAdd);
}

async function doLogin() {
  const msg = $("login-msg");
  const pw = $("pw").value.trim();
  if (!pw) { msg.innerHTML = `<span style="color:var(--danger);">비밀번호를 입력하세요.</span>`; return; }
  msg.textContent = "확인 중…";
  try {
    const { token } = await auth.call("/login", { password: pw });
    auth.token = token;
    showAdminView();
  } catch (e) {
    msg.innerHTML = `<span style="color:var(--danger);">${escapeHtml(e.message)}</span>`;
  }
}

async function showAdminView() {
  $("login-view").style.display = "none";
  $("admin-view").style.display = "block";
  await loadMemberList();
}

async function loadMemberList() {
  const box = $("admin-members");
  const file = await loadJSON("data/members.json").catch(() => null);
  const members = (file && file.members) || [];
  if (!members.length) { box.innerHTML = emptyState("등록된 클럽원이 없습니다."); return; }
  box.innerHTML = members.map((m) => `
    <div class="member-row">
      <div class="info">
        <div class="nick">${escapeHtml(m.ingameNick)} ${roleBadge(m.role)} ${m.ouid ? "" : "<span class='badge warn'>ouid 없음</span>"}</div>
      </div>
      ${m.ouid ? `<button class="btn danger" data-del="${m.ouid}" data-nick="${escapeHtml(m.ingameNick)}">삭제</button>` : ""}
    </div>`).join("");
  box.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => doDelete(b.dataset.del, b.dataset.nick)));
}

async function doAdd() {
  const msg = $("add-msg");
  const nickname = $("new-nick").value.trim();
  const role = $("new-role").value;
  if (!nickname) { msg.innerHTML = err("인게임 닉네임을 입력하세요."); return; }

  $("add-btn").disabled = true;
  try {
    msg.textContent = "넥슨에서 닉네임 확인 중…";
    const { ouid } = await auth.call("/resolve", { nickname });

    msg.textContent = "등록 중…";
    const r = await auth.call("/members", {
      action: "add",
      member: { ouid, ingameNick: nickname, role }
    });
    if (r.error) { msg.innerHTML = err(r.error); }
    else {
      msg.innerHTML = `<span style="color:var(--ok);">✅ '${escapeHtml(nickname)}' 등록 완료 (총 ${r.count}명). 사이트 반영까지 1~2분 걸릴 수 있습니다.</span>`;
      $("new-nick").value = ""; $("new-talk").value = "";
      await loadMemberList();
    }
  } catch (e) {
    msg.innerHTML = err(e.message);
  } finally {
    $("add-btn").disabled = false;
  }
}

async function doDelete(ouid, nick) {
  if (!confirm(`'${nick}' 클럽원을 삭제할까요?`)) return;
  try {
    const r = await auth.call("/members", { action: "delete", ouid });
    if (r.error) alert(r.error);
    else await loadMemberList();
  } catch (e) { alert(e.message); }
}

function err(m) { return `<span style="color:var(--danger);">${escapeHtml(m)}</span>`; }

document.addEventListener("DOMContentLoaded", initAdmin);
