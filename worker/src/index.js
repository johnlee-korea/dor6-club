/* ============================================================
   Cloudflare Worker — 도륙 관리자 백엔드
   역할: 비밀번호 인증 → 넥슨 닉→ouid 변환 → GitHub에 members.json 커밋
   비밀값(시크릿)은 Worker에만 저장 (브라우저/저장소 노출 0):
     ADMIN_PASSWORD, NEXON_API_KEY, GH_TOKEN, JWT_SECRET
   일반 변수(vars): GH_REPO("owner/repo"), GH_BRANCH("main"), ALLOWED_ORIGIN
   ============================================================ */

const TOKEN_TTL = 60 * 60 * 6; // 6시간

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const url = new URL(request.url);
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

    try {
      if (url.pathname === "/login" && request.method === "POST") {
        const { password } = await request.json();
        if (!password || password !== env.ADMIN_PASSWORD)
          return json({ error: "비밀번호가 올바르지 않습니다." }, 401);
        const token = await sign({ exp: nowSec() + TOKEN_TTL }, env.JWT_SECRET);
        return json({ token, expiresIn: TOKEN_TTL });
      }

      // 공개: 아무 유저 전적 검색 (인증 불필요, 키는 Worker에만)
      if (url.pathname === "/search" && request.method === "POST") {
        const { nickname } = await request.json();
        if (!nickname) return json({ error: "닉네임을 입력하세요." }, 400);
        const ouid = await resolveOuid(nickname, env.NEXON_API_KEY);
        if (!ouid) return json({ error: "해당 닉네임을 찾을 수 없습니다. (닉 변경 직후면 하루 정도 뒤 조회됩니다)" }, 404);
        const data = await publicSearch(ouid, env.NEXON_API_KEY);
        return json(data);
      }

      // 이하 인증 필요
      const payload = await requireAuth(request, env);
      if (!payload) return json({ error: "인증이 필요합니다. 다시 로그인하세요." }, 401);

      if (url.pathname === "/resolve" && request.method === "POST") {
        const { nickname } = await request.json();
        if (!nickname) return json({ error: "닉네임을 입력하세요." }, 400);
        const ouid = await resolveOuid(nickname, env.NEXON_API_KEY);
        if (!ouid) return json({ error: "넥슨에서 해당 닉네임을 찾을 수 없습니다." }, 404);
        return json({ ouid });
      }

      if (url.pathname === "/members" && request.method === "POST") {
        const body = await request.json();
        const result = await mutateMembers(body, env);
        return json(result);
      }

      return json({ error: "알 수 없는 요청" }, 404);
    } catch (e) {
      return json({ error: "서버 오류: " + e.message }, 500);
    }
  }
};

/* ---------- 넥슨 API 공통 ---------- */
const NX = "https://open.api.nexon.com";
async function nexonGet(path, key) {
  const res = await fetch(NX + path, { headers: { "x-nxopen-api-key": key } });
  if (!res.ok) throw new Error(`nexon ${res.status} ${path}`);
  return res.json();
}

/* 닉→ouid */
async function resolveOuid(nickname, key) {
  try {
    const j = await nexonGet(`/fconline/v1/id?nickname=${encodeURIComponent(nickname)}`, key);
    return j.ouid || null;
  } catch { return null; }
}

/* 등급 메타 캐시 (isolate 수명 동안 유지) */
let _divMeta = null;
async function divisionName(id) {
  if (!_divMeta) {
    try { _divMeta = await (await fetch(`${NX}/static/fconline/meta/division.json`)).json(); }
    catch { _divMeta = []; }
  }
  const m = _divMeta.find((d) => d.divisionId === id);
  return m ? m.divisionName : (id != null ? String(id) : "-");
}

/* 아무 유저 전적 요약 (최근 공식경기 위주) */
const R_MAP = { "승": "win", "무": "draw", "패": "lose" };
async function publicSearch(ouid, key) {
  const out = { ouid, nickname: null, level: null, maxDivision: "-", matches: [] };
  try { const b = await nexonGet(`/fconline/v1/user/basic?ouid=${ouid}`, key); out.nickname = b.nickname; out.level = b.level; } catch {}
  try {
    const divs = await nexonGet(`/fconline/v1/user/maxdivision?ouid=${ouid}`, key);
    const off = divs.find((d) => d.matchType === 50) || divs[0];
    if (off) out.maxDivision = await divisionName(off.division);
  } catch {}

  let ids = [];
  try { ids = await nexonGet(`/fconline/v1/user/match?ouid=${ouid}&matchtype=50&offset=0&limit=8`, key); } catch {}
  for (const id of ids) {
    try {
      const d = await nexonGet(`/fconline/v1/match-detail?matchid=${id}`, key);
      const me = (d.matchInfo || []).find((i) => i.ouid === ouid);
      if (!me) continue;
      const opp = (d.matchInfo || []).find((i) => i.ouid !== ouid);
      const md = me.matchDetail || {}, sh = me.shoot || {};
      out.matches.push({
        matchDate: d.matchDate,
        result: R_MAP[md.matchResult] || "draw",
        goalFor: sh.goalTotal ?? 0,
        goalAgainst: (opp && opp.shoot && opp.shoot.goalTotal) ?? 0,
        opponentNick: opp ? opp.nickname : "?",
        possession: md.possession ?? null
      });
    } catch {}
  }
  const w = out.matches.filter((m) => m.result === "win").length;
  out.summary = { games: out.matches.length, wins: w,
    winRate: out.matches.length ? Math.round((w / out.matches.length) * 100) : null };
  return out;
}

/* ---------- GitHub members.json 등록/삭제 ---------- */
async function mutateMembers(body, env) {
  const { action, member, ouid } = body;
  const [owner, repo] = (env.GH_REPO || "").split("/");
  const branch = env.GH_BRANCH || "main";
  const path = "data/members.json";
  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const ghHeaders = {
    "Authorization": `Bearer ${env.GH_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "dor6-club-worker"
  };

  // 현재 파일 로드
  const getRes = await fetch(`${apiBase}?ref=${branch}`, { headers: ghHeaders });
  if (!getRes.ok) throw new Error(`members.json 로드 실패 (${getRes.status})`);
  const file = await getRes.json();
  const current = JSON.parse(decodeBase64(file.content));
  current.members = current.members || [];

  let message = "";
  if (action === "add") {
    if (!member || !member.ouid || !member.ingameNick) throw new Error("등록 정보가 부족합니다.");
    if (current.members.some((m) => m.ouid === member.ouid))
      return { error: "이미 등록된 클럽원입니다." };
    current.members.push({
      ouid: member.ouid,
      ingameNick: member.ingameNick,
      talkNick: member.talkNick || member.ingameNick,
      role: member.role || "클럽원",
      manager: member.manager || null,
      joinDate: member.joinDate || new Date().toISOString().slice(0, 10),
      isSub: !!member.isSub,
      parentOuid: member.parentOuid || null,
      restPeriods: []
    });
    message = `[기능] 클럽원 등록: ${member.ingameNick}`;
  } else if (action === "delete") {
    const before = current.members.length;
    current.members = current.members.filter((m) => m.ouid !== ouid);
    if (current.members.length === before) return { error: "해당 클럽원을 찾을 수 없습니다." };
    message = `[수정] 클럽원 삭제: ${ouid}`;
  } else {
    throw new Error("action은 add 또는 delete여야 합니다.");
  }

  current.meta = current.meta || {};
  current.meta.updated = new Date().toISOString().slice(0, 10);

  // 커밋
  const putRes = await fetch(apiBase, {
    method: "PUT",
    headers: { ...ghHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: encodeBase64(JSON.stringify(current, null, 2) + "\n"),
      sha: file.sha,
      branch
    })
  });
  if (!putRes.ok) throw new Error(`커밋 실패 (${putRes.status})`);
  return { ok: true, message, count: current.members.length };
}

/* ---------- 토큰 (HMAC 서명) ---------- */
function nowSec() { return Math.floor(Date.now() / 1000); }

async function hmac(data, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}
async function sign(payload, secret) {
  const p = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmac(p, secret);
  return `${p}.${sig}`;
}
async function verify(token, secret) {
  if (!token || !token.includes(".")) return null;
  const [p, sig] = token.split(".");
  if ((await hmac(p, secret)) !== sig) return null;
  const payload = JSON.parse(new TextDecoder().decode(fromB64url(p)));
  if (!payload.exp || payload.exp < nowSec()) return null;
  return payload;
}
async function requireAuth(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return verify(token, env.JWT_SECRET);
}

/* ---------- base64 유틸 ---------- */
function b64url(bytes) {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function decodeBase64(b64) {
  // GitHub content는 개행 포함 base64
  const bin = atob(b64.replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}
function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
