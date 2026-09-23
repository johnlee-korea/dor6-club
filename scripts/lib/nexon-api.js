/* ============================================================
   nexon-api.js — 넥슨 오픈 API (EA SPORTS FC 온라인) 래퍼
   - API 키는 process.env.NEXON_API_KEY (로컬: node --env-file=.env / CI: Secrets)
   - 호출 간격 조절 + 재시도(429/5xx) 내장
   ============================================================ */

const BASE = "https://open.api.nexon.com";
const KEY = process.env.NEXON_API_KEY;

if (!KEY) {
  console.error("[치명] NEXON_API_KEY 환경변수가 없습니다. 로컬은 `node --env-file=.env`, CI는 Secrets 설정 필요.");
  process.exit(1);
}

/* 호출 간격(ms) — config.json에서 덮어씀 가능 */
let CALL_INTERVAL = 250;
export function setCallInterval(ms) { CALL_INTERVAL = ms; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 공통 GET (재시도 포함) */
async function apiGet(path, params = {}, { retries = 3 } = {}) {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    await sleep(CALL_INTERVAL);
    let res;
    try {
      res = await fetch(url, { headers: { "x-nxopen-api-key": KEY } });
    } catch (e) {
      // 네트워크 오류 → 백오프 후 재시도
      if (attempt < retries) { await sleep(500 * (attempt + 1)); continue; }
      throw new Error(`네트워크 오류: ${path} — ${e.message}`);
    }

    if (res.ok) return res.json();

    // 429(rate) / 5xx → 백오프 후 재시도
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const wait = 800 * (attempt + 1);
      console.warn(`  ↻ ${res.status} 재시도(${attempt + 1}/${retries}) — ${wait}ms 대기 [${path}]`);
      await sleep(wait);
      continue;
    }

    // 그 외(400 등)는 본문 파싱해 에러로
    let body = "";
    try { body = JSON.stringify(await res.json()); } catch { /* noop */ }
    throw new Error(`API ${res.status} [${path}] ${body}`);
  }
}

/* 닉네임 → ouid (없으면 null 반환) */
export async function getOuidByNickname(nickname) {
  try {
    const j = await apiGet("/fconline/v1/id", { nickname });
    return j.ouid || null;
  } catch (e) {
    // 존재하지 않는 닉네임은 400(OPENAPI00004) → null 처리
    if (String(e.message).includes("OPENAPI00004") || String(e.message).includes("400")) return null;
    throw e;
  }
}

/* 기본 정보(닉·레벨) */
export async function getUserBasic(ouid) {
  return apiGet("/fconline/v1/user/basic", { ouid });
}

/* 최고 등급 (matchtype별 최고 division) */
export async function getMaxDivision(ouid) {
  try { return await apiGet("/fconline/v1/user/maxdivision", { ouid }); }
  catch (e) { console.warn(`  maxdivision 조회 실패(${ouid}): ${e.message}`); return []; }
}

/* 매치 id 목록 (최신순). matchtype·offset·limit */
export async function getMatchIds(ouid, matchtype, offset = 0, limit = 100) {
  return apiGet("/fconline/v1/user/match", { ouid, matchtype, offset, limit });
}

/* 매치 상세 */
export async function getMatchDetail(matchid) {
  return apiGet("/fconline/v1/match-detail", { matchid });
}

/* 정적 메타데이터 (matchtype/division/spid/spposition 등) — 키 불필요 */
export async function getMeta(name) {
  const res = await fetch(`${BASE}/static/fconline/meta/${name}.json`);
  if (!res.ok) throw new Error(`메타데이터 로딩 실패: ${name} (${res.status})`);
  return res.json();
}
