/* ============================================================
   worker/src/career.js — ⭐ 내 선수 키우기 → 도륙리그 연동 (v2.24.0, CLAUDE.md 25-21)
   - 공개 POST /career/sync: ⭐ 내 프로필이 설정된 기기가 시즌 종료·은퇴 때 자동 전송
       { ouid, device, seasons(이 기기 총 플레이 시즌), star: { name, pos, ovr, seasons, retired } }
   - 저장: KV(CAREER) 키 c:<ouid> = { devices: { <device>: { seasons, star, at } }, blocked: [device…] }
     (시즌마다 GitHub 커밋을 만들지 않으려고 KV 사용 — 편성 때만 스냅샷 파일로 얼려 커밋)
   - 여러 기기 → 총 시즌 수가 가장 많은 기기 기준 (pickDevice) · 관리자가 기기 제외 가능
   - 로그인이 없으므로 클럽원 명단에 있는 ouid만 받고 값 정합성(validStar)만 검사 (사용자 결정 2026-10-31)
   ============================================================ */
import { validStar, pickDevice, starBoost } from "../../js/league/career-link.js";

const key = (ouid) => `c:${ouid}`;
const MAX_DEVICES = 10;

/* 클럽원 명단 — Pages의 data/members.json을 isolate 메모리에 10분 캐시 */
let memberCache = { at: 0, set: null };
async function memberSet(env) {
  if (memberCache.set && Date.now() - memberCache.at < 10 * 60 * 1000) return memberCache.set;
  const res = await fetch(`${env.SITE_URL}/data/members.json`, { cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error(`members.json 로딩 실패 (${res.status})`);
  const j = await res.json();
  memberCache = { at: Date.now(), set: new Map((j.members || []).map((m) => [m.ouid, m.ingameNick])) };
  return memberCache.set;
}

export async function readCareer(env, ouid) {
  if (!env.CAREER) return null;
  return (await env.CAREER.get(key(ouid), "json")) || null;
}

/* 편성용: 클럽원 ouid → 반영할 커리어 선수 (없으면 null) */
export async function careerStar(env, ouid) {
  const pick = pickDevice(await readCareer(env, ouid).catch((e) => { console.error("[career] KV 읽기 실패:", e.message); return null; }));
  return pick ? pick.star : null;
}

const clean = (s) => ({
  name: String(s.name).trim().slice(0, 12), pos: s.pos, ovr: s.ovr, seasons: s.seasons, retired: !!s.retired,
  ...(typeof s.type === "string" ? { type: s.type.slice(0, 20) } : {})
});

/* 공개: 기기 → 서버 동기화 */
export async function careerSync(body, env) {
  if (!env.CAREER) return { error: "연동 저장소가 설정되지 않았어요" };
  const { ouid, device, seasons, star } = body || {};
  if (typeof device !== "string" || !/^[a-z0-9]{8,32}$/.test(device)) return { error: "기기 정보가 올바르지 않아요" };
  const members = await memberSet(env);
  if (!members.has(ouid)) return { error: "도륙 클럽원 프로필이 아니에요" };
  const bad = validStar(star, seasons);
  if (bad) return { error: bad };
  const rec = (await readCareer(env, ouid)) || { devices: {}, blocked: [] };
  const prev = rec.devices[device];
  const next = { seasons, star: clean(star), at: Date.now() };
  // 같은 내용을 30초 안에 다시 보내면 쓰지 않음 (KV 무료 쓰기 하루 1,000회 보호)
  const same = prev && prev.seasons === next.seasons && JSON.stringify(prev.star) === JSON.stringify(next.star);
  if (!(same && Date.now() - prev.at < 30 * 1000)) {
    rec.devices[device] = next;
    const ids = Object.keys(rec.devices).sort((a, b) => rec.devices[b].at - rec.devices[a].at);
    for (const id of ids.slice(MAX_DEVICES)) delete rec.devices[id];
    await env.CAREER.put(key(ouid), JSON.stringify(rec));
  }
  const pick = pickDevice(rec);
  return {
    ok: true, team: members.get(ouid),
    used: !!pick && pick.id === device,
    blocked: (rec.blocked || []).includes(device),
    star: pick ? pick.star : null, boost: pick ? starBoost(pick.star) : null,
    deviceSeasons: seasons, topSeasons: pick ? pick.seasons : 0
  };
}

/* 관리자: 전체 목록 */
export async function careerList(env) {
  if (!env.CAREER) return { items: [] };
  const members = await memberSet(env).catch(() => new Map());
  const items = [];
  let cursor;
  do {
    const page = await env.CAREER.list({ prefix: "c:", cursor });
    for (const k of page.keys) {
      const ouid = k.name.slice(2), rec = await env.CAREER.get(k.name, "json");
      if (!rec) continue;
      const pick = pickDevice(rec);
      items.push({
        ouid, name: members.get(ouid) || ouid, pick: pick ? pick.id : null, blocked: rec.blocked || [],
        devices: Object.entries(rec.devices || {}).map(([id, d]) => ({ id, seasons: d.seasons, at: d.at, star: d.star }))
          .sort((a, b) => b.seasons - a.seasons)
      });
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  items.sort((a, b) => (a.name < b.name ? -1 : 1));
  return { items };
}

/* 관리자: 기기 제외/해제 */
export async function careerBlock(env, body) {
  const { ouid, device, block } = body || {};
  const rec = await readCareer(env, ouid);
  if (!rec || !rec.devices[device]) return { error: "기기를 찾을 수 없어요" };
  const set = new Set(rec.blocked || []);
  block ? set.add(device) : set.delete(device);
  rec.blocked = [...set];
  await env.CAREER.put(key(ouid), JSON.stringify(rec));
  return { ok: true, message: block ? "이 기기 기록을 리그 반영에서 뺐어요" : "다시 반영해요" };
}
