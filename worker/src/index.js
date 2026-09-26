/* ============================================================
   Cloudflare Worker — 도륙 관리자 백엔드
   역할: 비밀번호 인증 → 넥슨 닉→ouid 변환 → GitHub에 members.json 커밋
   비밀값(시크릿)은 Worker에만 저장 (브라우저/저장소 노출 0):
     ADMIN_PASSWORD, NEXON_API_KEY, GH_TOKEN, JWT_SECRET
   일반 변수(vars): GH_REPO("owner/repo"), GH_BRANCH("main"), ALLOWED_ORIGIN
   예약 실행(Cron Trigger): 2시간마다 GitHub Actions 수집 워크플로를 호출
     → GitHub 자체 schedule은 혼잡 시 누락이 잦아 정시 실행을 Worker가 담당
   ============================================================ */

import { styleRaw, computeMetrics, judge } from "../../scripts/lib/playstyle.js";
import { insightRaw, rankPlayers, GROUP_LABEL, P_METRICS } from "../../scripts/lib/insight.js";
import { compactMatch } from "../../scripts/lib/manage.js";

const TOKEN_TTL = 60 * 60 * 6; // 6시간
const COLLECT_WORKFLOW = "collect.yml"; // .github/workflows/ 아래 수집 워크플로 파일명

export default {
  /* Cron Trigger 진입점 (wrangler.toml [triggers] crons) */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatchCollect(env).catch((e) => console.error("[cron] 수집 호출 실패:", e.message)));
  },

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

      // 공개: 넥슨 선수·시즌 이미지 프록시 (v2.0.0 공유 이미지용)
      // 넥슨 이미지 서버가 CORS를 허용하지 않아 캔버스 캡처 시 이미지가 막힘 → 허용 호스트만 중계 + CORS 헤더
      if (url.pathname === "/img" && request.method === "GET") {
        return proxyImage(url.searchParams.get("u"));
      }

      // 공개: 아무 유저 전적 검색 (인증 불필요, 키는 Worker에만)
      if (url.pathname === "/search" && request.method === "POST") {
        const { nickname } = await request.json();
        if (!nickname) return json({ error: "닉네임을 입력하세요." }, 400);
        const ouid = await resolveOuid(nickname, env.NEXON_API_KEY);
        if (!ouid) return json({ error: "해당 닉네임을 찾을 수 없습니다. (닉 변경 직후면 하루 정도 뒤 조회됩니다)" }, 404);
        const data = await publicSearch(ouid, env);
        return json(data);
      }

      // 공개: 구단운영(모드별 선수 진단, v2.2.0) — 조회만 중계하고 분석은 브라우저가 함
      if (url.pathname.startsWith("/manage/") && request.method === "POST") {
        const body = await request.json();
        const data = await manageRoute(url.pathname.slice(8), body, env);
        return json(data, data.error ? 404 : 200);
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
      if (e instanceof UserError) return json({ error: e.message }, 400);
      console.error("[worker] 처리 실패:", e);
      return json({ error: "서버 오류: " + e.message }, 500);
    }
  }
};

/* ---------- 이미지 프록시 ---------- */
const IMG_HOSTS = ["fco.dn.nexoncdn.co.kr", "ssl.nexon.com"];
async function proxyImage(u) {
  let target;
  try { target = new URL(u); } catch { return new Response("bad url", { status: 400 }); }
  if (target.protocol !== "https:" || !IMG_HOSTS.includes(target.hostname) || !/\.(png|jpe?g|gif|webp)$/i.test(target.pathname))
    return new Response("forbidden", { status: 403 });
  const res = await fetch(target.toString(), { cf: { cacheEverything: true, cacheTtl: 86400 } });
  const headers = {
    "Access-Control-Allow-Origin": "*",   // 공개 이미지 — 캔버스 캡처용
    "Cache-Control": "public, max-age=86400",
    "Content-Type": res.headers.get("Content-Type") || "image/png"
  };
  if (!res.ok || !(headers["Content-Type"] || "").startsWith("image/"))
    return new Response(null, { status: 404, headers: { "Access-Control-Allow-Origin": "*" } });
  return new Response(res.body, { status: 200, headers });
}

/* ---------- 넥슨 API 공통 ---------- */
const NX = "https://open.api.nexon.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function nexonGet(path, key, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(NX + path, { headers: { "x-nxopen-api-key": key } });
    if (res.ok) return res.json();
    // 429(수집 중 동시호출) / 5xx → 잠깐 대기 후 재시도
    if ((res.status === 429 || res.status >= 500) && i < retries) { await sleep(600 * (i + 1)); continue; }
    throw new Error(`nexon ${res.status} ${path}`);
  }
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
const toLineup = (side) => ((side && side.player) || []).map((pl) => ({
  spId: pl.spId, spPosition: pl.spPosition, spGrade: pl.spGrade
}));

/* 전적 검색 분석(플레이스타일·에이스) 기준 — 클럽 페이지와 같은 판정 로직(scripts/lib)을 번들에 포함 */
const SEARCH_MATCHES = 30;       // 공식경기 최근 N경기 (서브요청 한도 50 고려: 기본 3~4 + 상세 30 + 기준값 1)
const SEARCH_BATCH = 5;          // 상세 동시 조회 수 (넥슨 429 방지)
const STYLE_MIN_GAMES = 10;      // 플레이스타일 최소 경기 (클럽 config.playstyle.minGames와 동일)
const ANALYSIS_VERSION = 1;      // 화면에서 '최신 업데이트로 조회한 결과'인지 구분

/* 랭커 기준값 (Pages 정적 파일) — isolate 메모리에 6시간 캐시 */
let _baseline = null, _baselineAt = 0;
async function rankerBaseline(env) {
  if (_baseline && Date.now() - _baselineAt < 6 * 3600 * 1000) return _baseline;
  const res = await fetch(`${env.SITE_URL}/data/meta/ranker-baseline.json`, { cf: { cacheTtl: 3600 } });
  if (!res.ok) throw new Error(`기준값 ${res.status}`);
  _baseline = await res.json(); _baselineAt = Date.now();
  return _baseline;
}

async function publicSearch(ouid, env) {
  const key = env.NEXON_API_KEY;
  const out = { ouid, nickname: null, level: null, maxDivision: "-", matches: [] };
  try { const b = await nexonGet(`/fconline/v1/user/basic?ouid=${ouid}`, key); out.nickname = b.nickname; out.level = b.level; } catch {}
  try {
    const divs = await nexonGet(`/fconline/v1/user/maxdivision?ouid=${ouid}`, key);
    const off = divs.find((d) => d.matchType === 50) || divs[0];
    if (off) out.maxDivision = await divisionName(off.division);
  } catch {}

  let ids = [];
  try { ids = await nexonGet(`/fconline/v1/user/match?ouid=${ouid}&matchtype=50&offset=0&limit=${SEARCH_MATCHES}`, key); } catch {}
  // 상세는 SEARCH_BATCH개씩 병렬 조회 (순서 유지)
  const details = [];
  for (let i = 0; i < ids.length; i += SEARCH_BATCH) {
    const chunk = ids.slice(i, i + SEARCH_BATCH);
    details.push(...await Promise.all(chunk.map((id) =>
      nexonGet(`/fconline/v1/match-detail?matchid=${id}`, key, 1).catch(() => null))));
  }
  const raws = [], pRows = [];
  for (const d of details) {
    if (!d) continue;
    const me = (d.matchInfo || []).find((i) => i.ouid === ouid);
    if (!me) continue;
    const opp = (d.matchInfo || []).find((i) => i.ouid !== ouid);
    const md = me.matchDetail || {}, sh = me.shoot || {};
    out.matches.push({
      matchId: d.matchId,
      matchType: 50,
      matchDate: d.matchDate,
      result: R_MAP[md.matchResult] || "draw",
      goalFor: sh.goalTotal ?? 0,
      goalAgainst: (opp && opp.shoot && opp.shoot.goalTotal) ?? 0,
      opponentNick: opp ? opp.nickname : "?",
      possession: md.possession ?? null,
      lineup: toLineup(me),       // 양팀 스쿼드 모달용 (선수 id·포지션·강화만)
      oppLineup: toLineup(opp)
    });
    // 분석용 원본 — 정상 종료 경기만 (클럽 집계와 같은 기준)
    const raw = styleRaw(me, opp);
    if (raw && raw.end === 0 && d.matchInfo.length === 2) {
      raws.push(raw);
      pRows.push(...(insightRaw(me, opp).pStats || []));
    }
  }
  const w = out.matches.filter((m) => m.result === "win").length;
  out.summary = { games: out.matches.length, wins: w,
    winRate: out.matches.length ? Math.round((w / out.matches.length) * 100) : null };

  // 플레이스타일·에이스 판정 (기준값 조회 실패 시 분석만 생략, 전적은 그대로 응답)
  try {
    const base = await rankerBaseline(env);
    out.analysis = {
      version: ANALYSIS_VERSION, games: raws.length, minGames: STYLE_MIN_GAMES,
      playstyle: raws.length >= STYLE_MIN_GAMES ? judge(computeMetrics(raws), base.stats) : null,
      ace: base.positions ? rankPlayers(pRows, base.positions).slice(0, 3) : [],
      groupLabels: GROUP_LABEL, metricLabels: P_METRICS
    };
  } catch (e) {
    console.error("[search] 분석 실패:", e.message);
  }
  return out;
}

/* ---------- 구단운영 (v2.2.0) ----------
   무료 플랜 한도(요청당 외부 호출 50개·CPU 10ms) 때문에 100경기를 한 번에 조회할 수 없어
   브라우저가 overview → details(30경기씩) → ranker 순으로 나눠 호출하고, 계산은 브라우저에서 한다(scripts/lib/manage.js) */
const MANAGE_TYPES = [50, 60, 30, 52];     // 공식·공식친선·리그친선·감독모드
const MANAGE_DETAIL_MAX = 30;              // details 1회 최대 경기 수 (재시도 여유 포함 서브요청 50 이내)
const MANAGE_PARALLEL = 8;                 // 상세 동시 조회 수
const MANAGE_RANKER_CHUNK = 20;            // ranker-stats 1회 선수 수 (실측 22명까지 정상)
const OUID_RE = /^[0-9a-f]{32}$/i, MATCHID_RE = /^[0-9a-f]{24}$/i;
class UserError extends Error {}

async function manageRoute(action, body, env) {
  const key = env.NEXON_API_KEY;
  if (action === "overview") {
    // 클럽원 프로필은 ouid를 이미 알고 있어 닉 조회 생략 (닉 변경 직후에도 동작, v2.4.0)
    const nickname = String(body.nickname || "").trim();
    if (body.ouid != null && !OUID_RE.test(body.ouid)) throw new UserError("잘못된 요청");
    if (!body.ouid && !nickname) throw new UserError("닉네임을 입력하세요.");
    const ouid = body.ouid || await resolveOuid(nickname, key);
    if (!ouid) return { error: "해당 닉네임을 찾을 수 없습니다. (닉 변경 직후면 하루 정도 뒤 조회됩니다)" };
    const out = { ouid, nickname, level: null, maxDivision: {}, ids: {} };
    const [basic, divs, ...lists] = await Promise.all([
      nexonGet(`/fconline/v1/user/basic?ouid=${ouid}`, key).catch(() => null),
      nexonGet(`/fconline/v1/user/maxdivision?ouid=${ouid}`, key).catch(() => []),
      ...MANAGE_TYPES.map((t) => nexonGet(`/fconline/v1/user/match?ouid=${ouid}&matchtype=${t}&offset=0&limit=100`, key).catch(() => []))
    ]);
    if (basic) { out.nickname = basic.nickname; out.level = basic.level; }
    for (const d of divs || []) out.maxDivision[d.matchType] = await divisionName(d.division);
    MANAGE_TYPES.forEach((t, i) => { out.ids[t] = Array.isArray(lists[i]) ? lists[i] : []; });
    return out;
  }
  if (action === "ids") {   // [더 불러오기] — 한 매치유형의 다음 목록
    const { ouid, type, offset } = body;
    if (!OUID_RE.test(ouid || "") || !MANAGE_TYPES.includes(+type)) throw new UserError("잘못된 요청");
    const off = Math.max(0, Math.min(1000, +offset || 0));
    const ids = await nexonGet(`/fconline/v1/user/match?ouid=${ouid}&matchtype=${+type}&offset=${off}&limit=100`, key).catch(() => []);
    return { ids: Array.isArray(ids) ? ids : [] };
  }
  if (action === "details") {
    const { ouid } = body;
    const ids = (body.ids || []).filter((id) => MATCHID_RE.test(id)).slice(0, MANAGE_DETAIL_MAX);
    if (!OUID_RE.test(ouid || "")) throw new UserError("잘못된 요청");
    const rows = [];
    for (let i = 0; i < ids.length; i += MANAGE_PARALLEL) {
      const chunk = await Promise.all(ids.slice(i, i + MANAGE_PARALLEL).map((id) =>
        nexonGet(`/fconline/v1/match-detail?matchid=${id}`, key, 1).catch(() => null)));
      for (const d of chunk) { const r = d && compactMatch(d, ouid); if (r) rows.push(r); }
    }
    return { rows, missing: ids.length - rows.length };
  }
  if (action === "ranker") {
    const type = +body.matchtype;
    if (![50, 52].includes(type)) throw new UserError("랭커 통계는 공식경기·감독모드만 제공됩니다.");
    const players = (body.players || []).filter((p) => Number.isInteger(p.id) && Number.isInteger(p.po)).slice(0, 60);
    const out = {};
    const chunks = [];
    for (let i = 0; i < players.length; i += MANAGE_RANKER_CHUNK) chunks.push(players.slice(i, i + MANAGE_RANKER_CHUNK));
    const results = await Promise.all(chunks.map((c) =>
      nexonGet(`/fconline/v1/ranker-stats?matchtype=${type}&players=${encodeURIComponent(JSON.stringify(c))}`, key).catch(() => [])));
    for (const list of results) for (const r of list || []) out[`${r.spId ?? r.spid}|${r.spPosition}`] = r.status;
    return { ranker: out };
  }
  throw new UserError("알 수 없는 요청");
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

  // GitHub 토큰 미설정·만료는 관리자가 알아볼 수 있는 문구로 안내
  if (!env.GH_TOKEN) throw new Error("GitHub 토큰(GH_TOKEN)이 설정되지 않아 명단을 저장할 수 없습니다. 클럽장에게 문의하세요.");

  // 현재 파일 로드
  const getRes = await fetch(`${apiBase}?ref=${branch}`, { headers: ghHeaders });
  if (getRes.status === 401 || getRes.status === 403)
    throw new Error(`GitHub 토큰이 만료되었거나 권한이 없습니다 (${getRes.status}). 토큰을 새로 발급해 GH_TOKEN을 갱신하세요.`);
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

/* ---------- GitHub Actions 수집 워크플로 실행 (workflow_dispatch) ----------
   GH_TOKEN에 Actions: Read and write 권한 필요. 성공 시 GitHub가 204 응답 */
async function dispatchCollect(env) {
  if (!env.GH_TOKEN) throw new Error("GH_TOKEN 미설정");
  const url = `https://api.github.com/repos/${env.GH_REPO}/actions/workflows/${COLLECT_WORKFLOW}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.GH_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "dor6-club-worker",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ref: env.GH_BRANCH || "main" })
  });
  if (res.status !== 204) {
    const detail = await res.text();
    throw new Error(`GitHub ${res.status} ${detail.slice(0, 200)}`);
  }
  console.log(`[cron] 수집 워크플로 실행 요청 완료 (${new Date().toISOString()})`);
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
