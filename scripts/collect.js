/* ============================================================
   collect.js — 넥슨 API에서 클럽원 매치를 수집해 누적 저장
   실행: node --env-file=.env scripts/collect.js   (로컬)
         node scripts/collect.js                    (CI, 환경변수 주입됨)
   원칙: matchid 중복 제거 → 신규 매치만 상세 조회 → 요약 값만 저장
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  setCallInterval, getMatchIds, getMatchDetail,
  getUserBasic, getMaxDivision, getMeta, getOuidByNickname
} from "./lib/nexon-api.js";
import { seasonIdOf, shortSeasonName } from "./lib/squad.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const p = (...s) => path.join(ROOT, ...s);
const readJSON = (f, def) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : def);
const writeJSON = (f, o) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(o, null, 2) + "\n");
};

const RESULT_MAP = { "승": "win", "무": "draw", "패": "lose" };

/* 매치 상세 → 회원 관점 요약 */
function summarize(detail, ouid, matchType) {
  const info = detail.matchInfo || [];
  const me = info.find((i) => i.ouid === ouid);
  if (!me) return null;                    // 해당 회원이 없는(비정상) 매치는 스킵
  const opp = info.find((i) => i.ouid !== ouid);
  const md = me.matchDetail || {};
  const shoot = me.shoot || {};
  const pass = me.pass || {};
  const def = me.defence || {};

  return {
    matchId: detail.matchId,
    matchType,
    matchDate: detail.matchDate,
    result: RESULT_MAP[md.matchResult] || "draw",
    goalFor: shoot.goalTotal ?? 0,
    goalAgainst: (opp && opp.shoot && opp.shoot.goalTotal) ?? 0,
    opponentOuid: opp ? opp.ouid : null,
    opponentNick: opp ? opp.nickname : null,
    stats: {
      possession: md.possession ?? null,
      shootTotal: shoot.shootTotal ?? null,
      effectiveShoot: shoot.effectiveShootTotal ?? null,
      passTry: pass.passTry ?? null,
      passSuccess: pass.passSuccess ?? null,
      tackle: def.tackleSuccess ?? null,
      foul: md.foul ?? null,
      corner: md.cornerKick ?? null
    },
    lineup: toLineup(me),
    oppLineup: toLineup(opp)   // 상대 스쿼드 — 전적 화면 '양팀 포메이션' 표시용
  };
}

/* matchInfo 한쪽 → 저장용 라인업(선수 id·포지션·강화만) */
function toLineup(side) {
  return ((side && side.player) || []).map((pl) => ({
    spId: pl.spId, spPosition: pl.spPosition, spGrade: pl.spGrade
  }));
}

/* 상대 라인업 저장 이전에 수집된 매치 보충(백필)
   - 회당 상한(limit)까지만 조회해 CI 실행 시간을 제한, 남은 건 다음 실행에서 이어서 처리
   - 같은 매치를 두 회원이 공유(내전)하면 matchId 캐시로 1회만 조회
   - 4xx(보관 기간 만료 등 복구 불가)는 빈 배열로 표시해 재시도하지 않음, 429/5xx·네트워크는 다음 실행에 재시도 */
async function backfillOppLineups(active, limit) {
  const cache = new Map();
  let fetched = 0, remaining = 0;
  for (const m of active) {
    const file = p("data", "matches", `${m.ouid}.json`);
    const store = readJSON(file, null);
    if (!store) continue;
    let dirty = false;
    for (const match of store.matches) {
      if (match.oppLineup !== undefined) continue;
      if (!cache.has(match.matchId)) {
        if (fetched >= limit) { remaining++; continue; }
        fetched++;
        try { cache.set(match.matchId, await getMatchDetail(match.matchId)); }
        catch (e) {
          console.warn(`  [백필] ${match.matchId} 실패: ${e.message}`);
          cache.set(match.matchId, /^API 4\d\d/.test(e.message) ? { matchInfo: [] } : null);
        }
      }
      const detail = cache.get(match.matchId);
      if (!detail) continue;
      match.oppLineup = toLineup((detail.matchInfo || []).find((i) => i.ouid !== m.ouid));
      dirty = true;
    }
    if (dirty) writeJSON(file, store);
  }
  if (fetched || remaining) console.log(`🔁 상대 라인업 백필 — 조회 ${fetched}건, 남은 ${remaining}건`);
}

async function collectMember(member, config) {
  const { ouid, ingameNick } = member;
  const file = p("data", "matches", `${ouid}.json`);
  const store = readJSON(file, { ouid, updated: null, knownMatchIds: [], matches: [] });
  const known = new Set(store.knownMatchIds);

  let newCount = 0;
  for (const mt of config.collectMatchTypes) {
    let ids = [];
    try {
      ids = await getMatchIds(ouid, mt, 0, config.matchListLimit);
    } catch (e) {
      console.warn(`  [${ingameNick}] 매치목록(유형 ${mt}) 조회 실패: ${e.message}`);
      continue;
    }
    const fresh = ids.filter((id) => !known.has(id));
    for (const id of fresh) {
      try {
        const detail = await getMatchDetail(id);
        const summary = summarize(detail, ouid, mt);
        known.add(id);
        store.knownMatchIds.push(id);
        if (summary) { store.matches.push(summary); newCount++; }
      } catch (e) {
        console.warn(`  [${ingameNick}] 매치상세(${id}) 실패: ${e.message}`);
      }
    }
  }

  // 최신순 정렬
  store.matches.sort((a, b) => new Date(b.matchDate) - new Date(a.matchDate));
  store.updated = new Date().toISOString();
  writeJSON(file, store);
  console.log(`  [${ingameNick}] 신규 ${newCount}건 (누적 ${store.matches.length}건)`);
  return newCount;
}

/* 회원 프로필(닉·레벨·최고등급) 수집 → profiles.json */
async function collectProfile(member, divisionMeta) {
  const { ouid } = member;
  const profile = { ouid, updated: new Date().toISOString() };
  try {
    const basic = await getUserBasic(ouid);
    profile.nickname = basic.nickname;
    profile.level = basic.level;
  } catch (e) { console.warn(`  [${member.ingameNick}] basic 실패: ${e.message}`); }

  try {
    const divs = await getMaxDivision(ouid);
    // 공식경기(50) 기준 최고 등급 우선, 없으면 전체 중 첫 항목
    const off = divs.find((d) => d.matchType === 50) || divs[0];
    if (off) {
      const meta = divisionMeta.find((m) => m.divisionId === off.division);
      profile.maxDivisionId = off.division;
      profile.maxDivisionName = meta ? meta.divisionName : String(off.division);
    }
  } catch (e) { console.warn(`  [${member.ingameNick}] maxdivision 실패: ${e.message}`); }

  return profile;
}

/* 스쿼드 표시용 메타 저장 — spid.json(6MB+)은 통째로 커밋하지 않고
   수집된 모든 경기(양팀 라인업)에 등장한 선수만 추려 data/meta/players.json 으로 저장 */
async function saveSquadMeta(active) {
  const used = new Set();
  for (const m of active) {
    const store = readJSON(p("data", "matches", `${m.ouid}.json`), { matches: [] });
    for (const match of store.matches) {
      for (const pl of [...(match.lineup || []), ...(match.oppLineup || [])]) used.add(pl.spId);
    }
  }
  try {
    const [spids, seasons] = await Promise.all([getMeta("spid"), getMeta("seasonid")]);
    const players = {};
    for (const s of spids) if (used.has(s.id)) players[s.id] = s.name;
    const seasonMeta = {};
    for (const s of seasons) {
      seasonMeta[s.seasonId] = { name: shortSeasonName(s.className), img: s.seasonImg };
    }
    writeJSON(p("data", "meta", "players.json"), players);
    writeJSON(p("data", "meta", "seasonid.json"), seasonMeta);
    const unknownSeasons = [...used].map(seasonIdOf).filter((id) => !seasonMeta[id]);
    if (unknownSeasons.length) console.warn(`  시즌 메타 없음: ${[...new Set(unknownSeasons)]}`);
    console.log(`🧩 스쿼드 메타 저장 — 선수 ${Object.keys(players).length}/${used.size}명`);
  } catch (e) { console.warn(`스쿼드 메타 저장 실패(기존 파일 유지): ${e.message}`); }
}

async function main() {
  const config = readJSON(p("config.json"), {});
  const membersFile = readJSON(p("data", "members.json"), { members: [] });
  const members = membersFile.members || [];
  setCallInterval(config.apiCallIntervalMs || 250);

  // ouid 없는 회원(닉 변경 직후 등) → 닉네임 재조회해서 성공 시 members.json에 자동 반영
  let membersDirty = false;
  for (const m of members.filter((x) => !x.ouid && x.ingameNick)) {
    const ouid = await getOuidByNickname(m.ingameNick).catch(() => null);
    if (ouid) {
      m.ouid = ouid;
      delete m._pending;
      membersDirty = true;
      console.log(`🔎 ouid 확보: ${m.ingameNick} → ${ouid}`);
    } else {
      console.log(`⏳ 아직 조회 안됨(닉 변경 반영 대기): ${m.ingameNick}`);
    }
  }
  if (membersDirty) {
    membersFile.meta = membersFile.meta || {};
    membersFile.meta.updated = new Date().toISOString().slice(0, 10);
    writeJSON(p("data", "members.json"), membersFile);
  }

  const active = members.filter((m) => m.ouid);
  const skipped = members.filter((m) => !m.ouid);
  if (skipped.length) {
    console.log(`⚠ ouid 없는 회원 ${skipped.length}명 스킵: ${skipped.map((m) => m.ingameNick).join(", ")}`);
  }

  // 등급 메타데이터 (divisionId → 이름)
  let divisionMeta = [];
  try { divisionMeta = await getMeta("division"); }
  catch (e) { console.warn(`등급 메타 로딩 실패: ${e.message}`); }

  // 포지션 메타데이터 (spposition → 이름) 로컬 저장 — 전적 라인업 표시용
  try {
    const sppos = await getMeta("spposition");
    writeJSON(p("data", "meta", "spposition.json"), sppos);
  } catch (e) { console.warn(`포지션 메타 저장 실패: ${e.message}`); }

  console.log(`▶ 수집 시작 — 대상 ${active.length}명, 유형 [${config.collectMatchTypes}]`);
  let total = 0;
  const profiles = {};
  for (const m of active) {
    total += await collectMember(m, config);
    profiles[m.ouid] = await collectProfile(m, divisionMeta);
  }
  writeJSON(p("data", "profiles.json"), { updated: new Date().toISOString(), profiles });
  await backfillOppLineups(active, config.oppLineupBackfillPerRun ?? 300);
  await saveSquadMeta(active);
  console.log(`✅ 수집 완료 — 신규 매치 총 ${total}건, 프로필 ${Object.keys(profiles).length}명`);
}

main().catch((e) => { console.error("수집 실패:", e); process.exit(1); });
