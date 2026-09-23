/* auth.js — 관리자 로그인 토큰 관리 (세션 단위) */

const AUTH_KEY = "dor6_admin_token";

const auth = {
  get token() { return sessionStorage.getItem(AUTH_KEY) || ""; },
  set token(t) { t ? sessionStorage.setItem(AUTH_KEY, t) : sessionStorage.removeItem(AUTH_KEY); },
  get loggedIn() { return !!this.token; },
  logout() { this.token = ""; },

  /* Worker 호출 (인증 헤더 자동 첨부) */
  async call(path, body) {
    const base = window.DOR6.workerUrl;
    if (!base) throw new Error("관리자 백엔드(Worker)가 설정되지 않았습니다.");
    const res = await fetch(base.replace(/\/$/, "") + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { "Authorization": "Bearer " + this.token } : {})
      },
      body: JSON.stringify(body || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
    return data;
  }
};
