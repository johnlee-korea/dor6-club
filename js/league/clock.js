/* ============================================================
   league/clock.js — 도륙리그 시각·예약 규칙 (순수 함수)
   화면(league.html·admin)·Worker(실제 판정)·Node 스크립트가 같은 규칙을 공유한다.
   모든 시각은 UTC 밀리초로 받고 KST(UTC+9)로 환산해 판단. (CLAUDE.md 25-4)
   ※ 이 파일은 "보는 시각"만 다룬다 — 경기 결과에는 관여하지 않음 (엔진은 js/engine)
   ============================================================ */

const KST = 9 * 3600 * 1000;
export const OPEN_H = 7;                  // 개막 07:00
export const CUTOFF_MIN = 6 * 60 + 30;    // 06:30 — 이후 [리그 시작]은 다음 날, [예약 취소] 불가
const DAY_SEC = 16 * 3600;                // 07:00~23:00
const MAX_I = 720, MIN_I = 360;           // 간격 12분 기본, 최소 6분

const pad = (n) => String(n).padStart(2, "0");

/* UTC ms → KST 날짜 "YYYY-MM-DD" */
export function kstDate(ms) {
  const d = new Date(ms + KST);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
/* UTC ms → KST 자정 이후 분 */
export function kstMinutes(ms) {
  const d = new Date(ms + KST);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
/* KST 날짜 + 시·분 → UTC ms */
export function kstMs(date, h = 0, m = 0, s = 0) {
  const [y, mo, d] = date.split("-").map(Number);
  return Date.UTC(y, mo - 1, d, h, m, s) - KST;
}
export function addDays(date, n) {
  return kstDate(kstMs(date, 12) + n * 86400000);
}
export function weekdayKo(date) {
  return "일월화수목금토"[new Date(kstMs(date, 12) + KST).getUTCDay()];
}
/* "2026-10-15" → "10/15(목)" */
export function dateLabel(date) {
  const [, m, d] = date.split("-").map(Number);
  return `${m}/${d}(${weekdayKo(date)})`;
}
/* 시간 이동 모드 ?now=2026-10-15T13:00 (KST로 해석) → UTC ms, 형식이 틀리면 null */
export function parseNowParam(s) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2})(?::(\d{2}))?(?::(\d{2}))?)?$/.exec(String(s || "").trim());
  if (!m) return null;
  return kstMs(m[1], Number(m[2] || 0), Number(m[3] || 0), Number(m[4] || 0));
}

/* ---------- 라운드 시각 ---------- */
/* 간격(초) = min(12분, 16시간 ÷ 라운드), 최소 6분 */
export function intervalSec(rounds) {
  if (!rounds) return MAX_I;
  return Math.max(MIN_I, Math.min(MAX_I, Math.floor(DAY_SEC / rounds)));
}
/* 라운드 k(1부터) 결과 공개 시각 = 07:00 + k × 간격 (k=0 → 개막) */
export function roundMs(date, k, rounds) {
  return kstMs(date, OPEN_H) + k * intervalSec(rounds) * 1000;
}
export function endMs(date, rounds) {
  return roundMs(date, rounds, rounds);
}
/* 지금까지 결과가 공개된 라운드 수 (0 ~ rounds) */
export function revealedRounds(date, rounds, now) {
  const start = kstMs(date, OPEN_H);
  if (now < start) return 0;
  return Math.min(rounds, Math.floor((now - start) / 1000 / intervalSec(rounds)));
}
/* ---------- 📻 문자중계 시간 흐름 (v2.19.0) ----------
   라운드 k(0부터)는 roundMs(k)에 킥오프 → 경기 1분 = 실제 6초(경기 10분 = 1분)로 흘러 90분이 9분 만에 끝남.
   간격이 12분보다 짧으면(41팀 이상·테스트 리그) 간격의 75% 안에 끝나도록 빨라짐.
   보는 속도만 정할 뿐 결과(엔진)와는 무관 */
export const LIVE_SEC_PER_MIN = 6;
/* 경기 1분이 실제 몇 ms인지 (간격 초 기준) */
export function liveMsPerMin(ivSec) {
  return Math.min(LIVE_SEC_PER_MIN * 1000, (ivSec * 1000 * 0.75) / 90);
}
/* 라운드의 마지막 경기 분 = 90 + 그 라운드 추가시간 골 중 최대(없으면 90) */
export function roundEndMin(results) {
  return 90 + results.reduce((m, res) => res.ev.reduce((x, e) => Math.max(x, e.add || 0), m), 0);
}
/* 이벤트의 경기 분 (90+2 → 92) */
export const eventMin = (e) => e.min + (e.add || 0);

/* 종료 시각 "HH:MM" (라운드 수만으로) */
export function endLabel(rounds) {
  const sec = OPEN_H * 3600 + rounds * intervalSec(rounds);
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}`;
}
/* UTC ms → KST "HH:MM" */
export function hm(ms) {
  const m = kstMinutes(ms);
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/* UTC ms → KST "HH:MM:SS" (테스트 리그처럼 간격이 짧을 때) */
export function hms(ms) {
  const d = new Date(ms + KST);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/* ---------- 개최일·예약 규칙 ---------- */
export const dayEntry = (config, date) => ((config && config.days) || []).find((d) => d.date === date) || null;
export const lastNo = (config) => ((config && config.days) || []).reduce((m, d) => Math.max(m, d.no), 0);

/* [리그 시작]을 지금 누르면 열리는 날짜: 06:30 전 → 오늘, 이후 → 내일 */
export function reserveTarget(now) {
  const today = kstDate(now);
  return kstMinutes(now) < CUTOFF_MIN ? today : addDays(today, 1);
}

/* 아직 개막하지 않은 예약 (오늘 07:00 전의 오늘 개최 포함) */
export function pendingReservation(config, now) {
  const today = kstDate(now);
  return ((config && config.days) || []).find((d) => d.date > today || (d.date === today && now < kstMs(today, OPEN_H))) || null;
}

/* 오늘 리그 진행 중? todayRounds: 오늘 스냅샷 기준 라운드 수(모르면 null → 23:00까지 진행 중으로 간주) */
export function todayRunning(config, now, todayRounds) {
  const today = kstDate(now);
  if (!dayEntry(config, today)) return false;
  const start = kstMs(today, OPEN_H);
  const end = todayRounds == null ? kstMs(today, 23) : endMs(today, todayRounds);
  return now >= start && now < end;
}

/* [리그 시작] 가능 여부 → { ok, reason, date, no } */
export function canReserve(config, now, todayRounds) {
  const pend = pendingReservation(config, now);
  if (pend) return { ok: false, reason: `이미 제${pend.no}회가 ${dateLabel(pend.date)} 07:00에 예약돼 있어요`, pending: pend };
  if (todayRunning(config, now, todayRounds)) return { ok: false, reason: "오늘 리그 종료 후 다음 리그를 예약할 수 있어요" };
  const date = reserveTarget(now);
  if (dayEntry(config, date)) return { ok: false, reason: `${dateLabel(date)}은 이미 개최일이에요` };
  return { ok: true, date, no: lastNo(config) + 1 };
}

/* [예약 취소] 가능 여부 — 예약일 06:30 전까지만 */
export function canCancel(config, now) {
  const pend = pendingReservation(config, now);
  if (!pend) return { ok: false, reason: "취소할 예약이 없어요" };
  if (now >= kstMs(pend.date, 0, CUTOFF_MIN)) return { ok: false, reason: "편성(06:40) 직전이라 취소할 수 없어요 (06:30 이후)", pending: pend };
  return { ok: true, pending: pend };
}

/* 오늘 스냅샷 생성 가능 여부 — 07:00 전: 생성·다시 만들기 / 07:00 후: 없을 때만 생성 */
export function canSnapshot(config, now, hasSnapshot) {
  const today = kstDate(now);
  if (!dayEntry(config, today)) return { ok: false, reason: "오늘은 개최일이 아니에요" };
  if (now < kstMs(today, OPEN_H)) return { ok: true, overwrite: !!hasSnapshot };
  if (hasSnapshot) return { ok: false, reason: "개막 후에는 스냅샷을 바꿀 수 없어요 (결과가 바뀌므로)" };
  return { ok: true, overwrite: false, late: true };
}
