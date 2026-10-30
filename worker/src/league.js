/* ============================================================
   worker/src/league.js — ⚽ 도륙리그 관리 API · 예약 실행 (CLAUDE.md 25-7·25-8)
   - 관리자 API(로그인 필요): status · reserve · cancel · snapshot
   - Cron: 06:40/06:50 KST 당일 참가팀 스냅샷 생성, 00:30 KST 전날 기록 보관 워크플로 호출
   - 🔁 자동 개최(v2.23.0): config.auto가 켜져 있으면 06:40/06:50 크론이 오늘을 개최일로 먼저 추가(참가 자격자 2명 이상일 때)
   - 서버는 경기 결과를 계산하지 않는다. 설정(config)과 스냅샷 파일만 커밋 → 결과는 브라우저가 결정론으로 계산
   - 쓰는 파일: data/league/config.json · data/league/days/*.json 만 (members.json은 읽기만)
   - 시각 판정은 항상 Worker 서버 시각 기준 (관리자 기기 시계가 틀려도 안전)
   ============================================================ */
import {
  kstDate, kstMs, addDays, dateLabel, OPEN_H, dayEntry, lastNo, nextAutoDate,
  canReserve, canCancel, canSnapshot, pendingReservation, todayRunning
} from "../../js/league/clock.js";
import { judgeEligibility } from "../../js/league/eligibility.js";
import { attachBoost } from "../../js/league/boost.js";
import { squadFromLineup } from "../../js/league/roster.js";
import { ENGINE_VERSION, roundCount } from "../../js/engine/index.js";

export const LEAGUE_SNAPSHOT_CRON = "40,50 21 * * *";   // 06:40·06:50 KST — wrangler.toml crons와 같은 문자열
export const LEAGUE_ARCHIVE_CRON = "30 15 * * *";       // 00:30 KST
export const LEAGUE_WORKFLOW = "league.yml";

const CONFIG = "data/league/config.json";
const dayPath = (date) => `data/league/days/${date}.json`;

class LeagueError extends Error {}

/* ---------- GitHub Contents API ---------- */
function ghBase(env, path) {
  return `https://api.github.com/repos/${env.GH_REPO}/contents/${path}`;
}
function ghHeaders(env) {
  if (!env.GH_TOKEN) throw new LeagueError("GitHub 토큰(GH_TOKEN)이 설정되지 않아 리그 설정을 저장할 수 없습니다.");
  return { "Authorization": `Bearer ${env.GH_TOKEN}`, "Accept": "application/vnd.github+json", "User-Agent": "dor6-club-worker" };
}
/* 파일 읽기 → { json, sha } · 없으면 null */
async function ghRead(env, path) {
  const res = await fetch(`${ghBase(env, path)}?ref=${env.GH_BRANCH || "main"}`, { headers: ghHeaders(env) });
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw new LeagueError(`GitHub 토큰이 만료되었거나 권한이 없습니다 (${res.status}).`);
  if (!res.ok) throw new Error(`${path} 읽기 실패 (${res.status})`);
  const file = await res.json();
  const bin = atob(String(file.content || "").replace(/\n/g, ""));
  const text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  return { json: JSON.parse(text), sha: file.sha };
}
/* 파일 쓰기 (sha 없으면 새 파일). 409/422 = 그 사이 다른 커밋 → false 반환(호출 측이 다시 읽고 재시도) */
async function ghWrite(env, path, obj, sha, message) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj, null, 2) + "\n");
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  const res = await fetch(ghBase(env, path), {
    method: "PUT",
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: btoa(bin), ...(sha ? { sha } : {}), branch: env.GH_BRANCH || "main" })
  });
  if (res.status === 409 || res.status === 422) return false;
  if (!res.ok) throw new Error(`${path} 커밋 실패 (${res.status} ${(await res.text()).slice(0, 150)})`);
  return true;
}

async function readConfig(env) {
  const f = await ghRead(env, CONFIG);
  if (!f) throw new LeagueError("리그 설정 파일(data/league/config.json)이 없습니다.");
  f.json.days = f.json.days || [];
  return f;
}
/* 참가 자격 판정용 명단·판수 (dashboard 읽기 실패해도 진행 — 판정 불가면 참가) */
async function readRoster(env) {
  const [m, d] = await Promise.all([
    ghRead(env, "data/members.json"),
    ghRead(env, "data/dashboard.json").catch((e) => { console.error("[league] dashboard.json 읽기 실패:", e.message); return null; })
  ]);
  return { members: m ? m.json : { members: [] }, dashboard: d ? d.json : null };
}

/* ---------- 스냅샷 ---------- */
/* opts.source: "cron" | "admin", opts.force: 07:00 전 덮어쓰기 허용 여부 */
async function makeSnapshot(env, now, opts) {
  const { json: config } = await readConfig(env);
  const today = kstDate(now);
  const entry = dayEntry(config, today);
  const existing = await ghRead(env, dayPath(today));
  const can = canSnapshot(config, now, !!existing);
  if (!can.ok) return { skipped: true, reason: can.reason };
  if (existing && !opts.force) return { skipped: true, reason: "이미 스냅샷이 있어요" };

  const { members, dashboard } = await readRoster(env);
  const judged = judgeEligibility(members, dashboard, today);
  // v2.12.0 실제 스쿼드: squads.json 최근 경기 라인업 18명을 [spId, spPosition]으로 얼려 둠 (없으면 가상 선수)
  const sqFile = await ghRead(env, "data/squads.json").catch((e) => { console.error("[league] squads.json 읽기 실패:", e.message); return null; });
  const sq = (sqFile && sqFile.json && sqFile.json.squads) || {};
  // v2.14.0 🔥 전날 판수 보너스: daily-games.json의 개최 전날 판수를 팀마다 얼려 둠 (없으면 보너스 없이 진행)
  const dgFile = await ghRead(env, "data/daily-games.json").catch((e) => { console.error("[league] daily-games.json 읽기 실패:", e.message); return null; });
  const boosted = attachBoost(judged.teams.map((t) => {
    const squad = squadFromLineup(sq[t.ouid]);
    return squad ? { ouid: t.ouid, name: t.name, squad } : { ouid: t.ouid, name: t.name };
  }), dgFile && dgFile.json, today);
  const snap = {
    date: today, no: entry.no,
    seed: `${config.seed}-${today}`, teamSeed: config.seed,
    engine: ENGINE_VERSION,
    createdAt: new Date(now).toISOString(), source: opts.source,
    teams: boosted.teams,
    eligibility: judged.eligibility,
    activity: boosted.activity, activityDay: boosted.activityDay,
    excluded: judged.excluded
  };
  const tag = opts.source === "cron" ? "[자동]" : "[기능]";
  const msg = `${tag} 도륙리그 제${entry.no}회 편성 (${snap.teams.length}팀${existing ? ", 다시 만들기" : ""})`;
  const ok = await ghWrite(env, dayPath(today), snap, existing && existing.sha, msg);
  if (!ok) throw new LeagueError("다른 저장과 겹쳤어요. 잠시 후 다시 시도해 주세요.");
  console.log(`[league] 스냅샷 생성 ${today} ${snap.teams.length}팀 (${opts.source})`);
  return { ok: true, date: today, no: entry.no, teams: snap.teams.length, excluded: snap.excluded.length, message: msg };
}

/* ---------- 상태 ---------- */
async function leagueStatus(env, now) {
  const { json: config } = await readConfig(env);
  const today = kstDate(now);
  const todayEntry = dayEntry(config, today);
  const snapFile = todayEntry ? await ghRead(env, dayPath(today)) : null;
  const snap = snapFile && snapFile.json;
  const todayRounds = snap ? roundCount(snap.teams.length) : null;
  const pend = pendingReservation(config, now);
  // 예상 참가: 예약이 있으면 그 날짜, 없으면 지금 [리그 시작]하면 열릴 날짜 기준 (최종 판정은 개최일 06:40)
  const reserve = canReserve(config, now, todayRounds);
  const expectDate = pend ? pend.date : config.auto ? nextAutoDate(config, now) : (reserve.date || kstDate(now));
  const { members, dashboard } = await readRoster(env);
  const judged = judgeEligibility(members, dashboard, expectDate);
  return {
    now: new Date(now).toISOString(),
    today, engine: ENGINE_VERSION,
    auto: !!config.auto, autoNext: config.auto ? nextAutoDate(config, now) : null,
    totalHeld: config.days.filter((d) => d.date < today || (d.date === today && now >= kstMs(today, OPEN_H))).length,
    lastNo: config.days.reduce((m, d) => Math.max(m, d.no), 0),
    pending: pend,
    todayEntry,
    todayRunning: todayRunning(config, now, todayRounds),
    snapshot: snap ? { teams: snap.teams.length, createdAt: snap.createdAt, source: snap.source, engine: snap.engine, eligibility: snap.eligibility, excluded: snap.excluded || [] } : null,
    can: {
      reserve,
      cancel: canCancel(config, now),
      snapshot: canSnapshot(config, now, !!snap)
    },
    roster: { members: ((members.members) || []).length, expectDate, teams: judged.teams.length, excluded: judged.excluded, eligibility: judged.eligibility }
  };
}

/* ---------- 예약·취소 (동시 수정 시 다시 읽고 1회 재시도) ---------- */
async function reserve(env, now, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { json: config, sha } = await readConfig(env);
    const todaySnap = dayEntry(config, kstDate(now)) ? await ghRead(env, dayPath(kstDate(now))) : null;
    const can = canReserve(config, now, todaySnap ? roundCount(todaySnap.json.teams.length) : null);
    if (!can.ok) throw new LeagueError(can.reason);
    // 확인창에 보여준 날짜와 서버 판정이 다르면(06:30 경계) 다시 확인시킴
    if (body.expectDate && body.expectDate !== can.date)
      throw new LeagueError(`개최일이 ${dateLabel(can.date)}로 바뀌었어요 (06:30 경계). 다시 확인해 주세요.`);
    const { members, dashboard } = await readRoster(env);
    const judged = judgeEligibility(members, dashboard, can.date);
    if (judged.teams.length < 2) throw new LeagueError(`참가 자격이 있는 클럽원이 ${judged.teams.length}명이라 리그를 열 수 없어요 (2명 이상 필요).`);
    config.days.push({ no: can.no, date: can.date, reservedAt: new Date(now).toISOString() });
    const msg = `[기능] 도륙리그 제${can.no}회 예약 (${can.date})`;
    if (await ghWrite(env, CONFIG, config, sha, msg)) return { ok: true, no: can.no, date: can.date, message: msg };
  }
  throw new LeagueError("다른 저장과 겹쳤어요. 잠시 후 다시 시도해 주세요.");
}

async function cancel(env, now) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { json: config, sha } = await readConfig(env);
    const can = canCancel(config, now);
    if (!can.ok) throw new LeagueError(can.reason);
    // 지우는 건 아직 개막 전인 예약 1건뿐 — 지난 개최일은 절대 건드리지 않음
    config.days = config.days.filter((d) => d.date !== can.pending.date);
    const msg = `[수정] 도륙리그 제${can.pending.no}회 예약 취소 (${can.pending.date})`;
    if (await ghWrite(env, CONFIG, config, sha, msg)) return { ok: true, no: can.pending.no, date: can.pending.date, message: msg };
  }
  throw new LeagueError("다른 저장과 겹쳤어요. 잠시 후 다시 시도해 주세요.");
}

/* ---------- 🔁 자동 개최 ---------- */
/* 크론(06:40/06:50): 자동 개최가 켜져 있고 오늘이 아직 개최일이 아니면 오늘을 추가.
   07:00 이후엔 추가하지 않음(개막 시각이 지난 리그를 새로 열지 않음) · 참가 자격자 2명 미만이면 그날은 쉼 */
async function autoOpen(env, now) {
  const today = kstDate(now);
  if (now >= kstMs(today, OPEN_H)) return { skipped: true, reason: "07:00 이후" };
  for (let attempt = 0; attempt < 2; attempt++) {
    const { json: config, sha } = await readConfig(env);
    if (!config.auto) return { skipped: true, reason: "자동 개최 꺼짐" };
    if (dayEntry(config, today)) return { skipped: true, reason: "이미 개최일" };
    const { members, dashboard } = await readRoster(env);
    const judged = judgeEligibility(members, dashboard, today);
    if (judged.teams.length < 2) return { skipped: true, reason: `참가 자격자 ${judged.teams.length}명 (2명 미만)` };
    const no = lastNo(config) + 1;
    config.days.push({ no, date: today, reservedAt: new Date(now).toISOString(), auto: true });
    const msg = `[자동] 도륙리그 제${no}회 자동 개최 (${today})`;
    if (await ghWrite(env, CONFIG, config, sha, msg)) return { ok: true, no, date: today };
  }
  throw new LeagueError("자동 개최 저장이 다른 저장과 겹쳤어요.");
}

/* 관리자: 자동 개최 켜기/끄기 */
async function setAuto(env, now, body) {
  const on = !!(body && body.on);
  for (let attempt = 0; attempt < 2; attempt++) {
    const { json: config, sha } = await readConfig(env);
    if (!!config.auto === on) return { ok: true, auto: on, message: `이미 자동 개최가 ${on ? "켜져" : "꺼져"} 있어요` };
    config.auto = on;
    const msg = `[기능] 도륙리그 자동 개최 ${on ? "켜기" : "끄기"}`;
    if (await ghWrite(env, CONFIG, config, sha, msg)) {
      return { ok: true, auto: on, message: on ? `자동 개최를 켰어요 — ${dateLabel(nextAutoDate(config, now))} 07:00부터 매일 열려요` : "자동 개최를 껐어요 — 이제 [리그 시작]으로 직접 열어야 해요" };
    }
  }
  throw new LeagueError("다른 저장과 겹쳤어요. 잠시 후 다시 시도해 주세요.");
}

/* ---------- 라우터 (index.js에서 인증 후 호출) ---------- */
export async function leagueRoute(action, body, env) {
  const now = Date.now();
  try {
    if (action === "status") return await leagueStatus(env, now);
    if (action === "reserve") return await reserve(env, now, body || {});
    if (action === "cancel") return await cancel(env, now);
    if (action === "auto") return await setAuto(env, now, body || {});
    if (action === "snapshot") {
      const r = await makeSnapshot(env, now, { source: "admin", force: true });
      if (r.skipped) throw new LeagueError(r.reason);
      return r;
    }
    return { error: "알 수 없는 리그 요청" };
  } catch (e) {
    if (e instanceof LeagueError) return { error: e.message };
    throw e;
  }
}

/* ---------- Cron (index.js scheduled에서 호출) ---------- */
export async function leagueScheduled(cron, env, dispatch) {
  const now = Date.now();
  if (cron === LEAGUE_SNAPSHOT_CRON) {
    // 자동 개최가 켜져 있으면 오늘을 개최일로 먼저 추가 (실패해도 06:50에 다시 시도)
    const a = await autoOpen(env, now).catch((e) => ({ skipped: true, reason: "오류 — " + e.message }));
    console.log(`[league cron] 자동 개최: ${a.ok ? `제${a.no}회 ${a.date} 추가` : "건너뜀 — " + a.reason}`);
    // 개최일이고 스냅샷이 없을 때만 생성 (06:50은 06:40 실패 대비 — 이미 있으면 아무것도 안 함)
    const r = await makeSnapshot(env, now, { source: "cron", force: false });
    console.log(`[league cron] 스냅샷: ${r.ok ? `${r.date} ${r.teams}팀 생성` : "건너뜀 — " + r.reason}`);
    return;
  }
  if (cron === LEAGUE_ARCHIVE_CRON) {
    // 어제(KST)가 개최일일 때만 기록 보관 워크플로 실행
    const { json: config } = await readConfig(env);
    const yesterday = addDays(kstDate(now), -1);
    if (!dayEntry(config, yesterday)) { console.log(`[league cron] ${yesterday} 개최일 아님 — 기록 보관 생략`); return; }
    await dispatch(env, LEAGUE_WORKFLOW);
  }
}
