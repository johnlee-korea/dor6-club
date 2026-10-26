/* ============================================================
   lib/guide.js — 🧭 내 플레이 가이드 (v2.18.0, 사용자 요청 "어떤 장점을 더 살리고 어떤 단점을 보완할지")
   - 규칙·문장 템플릿만으로 만든다 (모든 문장에 근거 숫자 — 지어낸 말 없음)
   - 두 가지 비교를 함께 본다
     ① 랭커 대비: 플레이스타일 지표 31개의 Z점수 (ranker-baseline stats)
     ② 이길 때·질 때 나만의 특징 (v2 사용자 지적: "이기면 점유율·패스 성공률이 높은 건 누구나 그렇다")
        → 내 (이긴 경기 − 진 경기) 차이를 **클럽원들이 보통 보이는 차이**(winLossBaseline)와 비교해, 벗어날 때만 표시
        z = (내 차이 − 클럽원 평균 차이) ÷ √(클럽원 '진짜' 편차² + 내 차이 표준오차²) — |z| ≥ WL_Z
        클럽원 진짜 편차² = 회원 간 차이의 분산 − 회원별 표본 오차²의 평균 (표본 흔들림을 두 번 세지 않도록)
        z > 0 → 이길 때 상대적으로 더 많음(🟢 이길 때 나만의 특징) · z < 0 → 질 때 더 많음(🔴 질 때 나만의 특징)
   - 지표마다 '좋은 방향'(DIR)이 정해진 것만 장점·약점으로 단정. 스타일 지표(방향 없음)는 승패 차이가 있을 때만 판단,
     없으면 '특징'으로만 표시
   - 클럽 집계(aggregate.js → insights.json players[].guide)와 전적 검색(Worker /search analysis.guide)이 공유
   ============================================================ */
import { computeMetrics, METRICS } from "./playstyle.js";
import { GOAL_BUCKETS, bucketOf, goalFlow } from "./insight.js";

export const GUIDE_VERSION = 2;
const WL_Z = 1.5;            // 이길 때·질 때 '나만의 특징' 판정
const MIN_GAMES = 15;        // 가이드 최소 경기
const Z_GOOD = 0.5;          // 랭커 대비 '좋다/나쁘다' 판정 Z
const Z_TRAIT = 1;           // 방향 없는 지표가 '특징'이 되는 Z

/* 좋은 방향: +1 높을수록 좋음 · −1 낮을수록 좋음 · 없으면 스타일(방향 없음)
   득점(gf)·평점(rating)은 결정력과 같은 말을 반복해 장단점에서 뺌(요약 줄에만 득점 표시) */
const DIR = {
  passRate: 1, effRate: 1, finish: 1, tackleRate: 1, setGoal: 1,
  ga: -1, foul: -1, cards: -1, offside: -1
};
const SKIP = new Set(["gf", "rating"]);
/* 파울·카드는 적다고 '무기'라 하긴 어색 → 보완점(많을 때)으로만 사용 */
const NO_STRENGTH = new Set(["foul", "cards"]);
/* 경기당 1회 미만으로 드문 지표(카드)는 승패 패턴 판정에서 제외 — 몇 경기로 수치가 크게 흔들림 */
const NO_SPECIAL = new Set(["cards"]);
/* 승패 비교에서 빼는 지표 — 골·실점·평점처럼 결과 그 자체이거나 골이 있어야 정의되는 비율 */
const NOT_KEY = new Set(["gf", "ga", "rating", "finish", "headGoal", "longGoal", "boxGoal", "lateGoal", "setGoal"]);
/* 경기별 값의 분모(styleRaw 키) — 분모 0인 경기는 그 지표 비교에서 제외 */
const DEN = {
  passRate: "pT", shortRatio: "pT", longRatio: "pT", throughRatio: "pT", lobRatio: "pT",
  effRate: "sT", finish: "sT", longShot: "sT", tackleRate: "tT",
  headGoal: "g", longGoal: "g", boxGoal: "g",
  finesse: "xN", volley: "xN", lowShot: "xN", headShot: "xN", wideShot: "xN", lateGoal: "xG"
};

/* 지표별 조언 — good: 랭커보다 좋을 때 · bad: 랭커보다 나쁠 때 (방향 있는 지표만) */
const TIPS = {
  finish:     { good: "찬스를 골로 바꾸는 힘이 좋아요. 지금처럼 확실한 자리까지 만들어 차세요.",
                bad: "슈팅 대비 골이 적어요. 먼 거리·각도 없는 슈팅을 줄이고 박스 안 좋은 자리까지 한 번 더 연결해 보세요." },
  effRate:    { good: "슈팅이 골문 안으로 잘 가요.",
                bad: "골문을 벗어나는 슈팅이 많아요. 수비가 붙은 상태·몸이 꺾인 상태의 슈팅을 줄여 보세요." },
  passRate:   { good: "패스 실수가 적어 공을 오래 지켜요.",
                bad: "패스 실수가 많은 편이에요. 무리한 전진 패스 대신 한 번 돌려서 각을 만들어 보세요." },
  ga:         { good: "실점이 적어요. 수비 운영이 안정적이에요.",
                bad: "실점이 많은 편이에요. 실점 시간대(아래 ⏱)와 공 뺏긴 직후 수비 전환을 점검해 보세요." },
  tackleRate: { good: "태클을 걸면 잘 따내요.", bad: "태클 실패가 많아요. 성급한 태클보다 길목 막기(자리 지키기)를 먼저 해 보세요." },
  setGoal:    { good: "세트피스로 골을 잘 만들어요. 프리킥·PK 키커를 유지하세요.", bad: "세트피스 골이 적어요." },
  foul:       { good: "깔끔하게 수비해요 (파울 적음).", bad: "파울이 많아요. 프리킥·카드로 이어지니 뒤에서 미는 수비를 줄여 보세요." },
  cards:      { good: "카드가 적어요.", bad: "카드가 많아요. 퇴장·누적은 경기 흐름을 크게 바꿔요." },
  offside:    { good: "오프사이드가 적어요 (침투 타이밍 좋음).", bad: "오프사이드가 많아요. 스루패스 타이밍을 반 박자 늦추거나 공격수 움직임을 확인해 보세요." }
};

/* 받침 있으면 "이에요", 없으면 "예요" (한글 끝 글자 기준, 숫자·영문은 "이에요") */
const ieyo = (w) => {
  const c = w.charCodeAt(w.length - 1);
  return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 === 0 ? w + "예요" : w + "이에요";
};

const fmtV = (k, v) => {
  if (v == null || !isFinite(v)) return "-";
  const u = METRICS[k].unit;
  if (u === "%") return (v < 0.1 ? (v * 100).toFixed(1) : Math.round(v * 100)) + "%";   // 10% 미만은 소수 1자리
  if (u === "avg%") return Math.round(v) + "%";
  return (Math.round(v * 10) / 10).toFixed(1);
};

/* 두 표본 평균 차이의 표준오차 (Welch) — 표본 2개 미만이면 null */
function diffSE(a, b) {
  if (a.length < 2 || b.length < 2) return null;
  const m = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  const v = (x, mu) => x.reduce((s, y) => s + (y - mu) ** 2, 0) / (x.length - 1);
  return Math.sqrt(v(a, m(a)) / a.length + v(b, m(b)) / b.length);
}
const meanSd = (a) => {
  const mu = a.reduce((s, v) => s + v, 0) / a.length;
  return { mean: mu, sd: a.length > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - mu) ** 2, 0) / (a.length - 1)) : 0 };
};
const r4 = (x) => Math.round(x * 10000) / 10000;

/* 클럽원 '보통의 승패 차이' 기준값 (aggregate.js → data/meta/guide-baseline.json, 전적 검색도 사용)
   members: 회원별 정상 종료 경기 배열 [[{ result, raw }…]…] — 승·패 각 minSide경기 이상인 회원만
   → metrics[k] = { w: 이긴 경기 값 {mean, sd}, l: 진 경기 값, d: 차이(이긴 − 진) } (회원 단위 분포) */
export function winLossBaseline(members, minSide = 15) {
  const per = [];
  for (const ms of members) {
    const w = ms.filter((m) => m.result === "win"), l = ms.filter((m) => m.result === "lose");
    if (w.length < minSide || l.length < minSide) continue;
    const pm = new Map(ms.map((m) => [m, computeMetrics([m.raw])]));
    const vals = (list, k) => list.filter((m) => !DEN[k] || (m.raw[DEN[k]] || 0) > 0).map((m) => pm.get(m)[k]).filter((v) => v != null && isFinite(v));
    const se2 = {};
    for (const k of Object.keys(METRICS)) { const e = diffSE(vals(w, k), vals(l, k)); if (e != null) se2[k] = e * e; }
    per.push({ w: computeMetrics(w.map((m) => m.raw)), l: computeMetrics(l.map((m) => m.raw)), se2 });
  }
  const metrics = {};
  if (per.length >= 5) {
    for (const k of Object.keys(METRICS)) {
      const ok = per.filter((p) => p.w[k] != null && p.l[k] != null && isFinite(p.w[k]) && isFinite(p.l[k]));
      if (ok.length < 5) continue;
      const pick = (fn) => { const x = meanSd(ok.map(fn)); return { mean: r4(x.mean), sd: r4(x.sd) }; };
      const d = pick((p) => p.w[k] - p.l[k]);
      const ns = ok.filter((p) => p.se2[k] != null);
      d.noise = ns.length ? r4(Math.sqrt(ns.reduce((sum, p) => sum + p.se2[k], 0) / ns.length)) : 0;   // 회원별 표본 오차(RMS)
      metrics[k] = { w: pick((p) => p.w[k]), l: pick((p) => p.l[k]), d };
    }
  }
  return { v: 1, members: per.length, minSide, metrics };
}

/* 차이 표기: 비율은 %p, 그 외 ± 수치 */
const fmtD = (k, x) => {
  const u = METRICS[k].unit;
  const v = u === "%" ? x * 100 : x, t = Math.abs(v).toFixed(1);
  if (t === "0.0") return "0" + (u ? "%p" : "");                 // 반올림해서 0이면 부호 없이
  return (v > 0 ? "+" : "−") + t + (u ? "%p" : "");
};

/* matches: [{ result, raw(withShots 적용된 styleRaw), shots, oppGoals, goalFor, goalAgainst }] — 정상 종료 경기만
   base: 랭커 기준값 stats { 지표: { mean, sd } }
   opt.minSide: 승·패 각각 최소 경기 (클럽 15 · 전적 검색 30경기라 8)
   opt.wl: winLossBaseline 결과 (없으면 '이길 때·질 때 나만의 특징' 생략) */
export function buildGuide(matches, base, opt = {}) {
  const minSide = opt.minSide ?? 15;
  const n = matches.length;
  if (n < MIN_GAMES) return { v: GUIDE_VERSION, games: n, minGames: MIN_GAMES };
  const wins = matches.filter((m) => m.result === "win"), loses = matches.filter((m) => m.result === "lose");
  const me = computeMetrics(matches.map((m) => m.raw));
  const mw = wins.length ? computeMetrics(wins.map((m) => m.raw)) : {};
  const ml = loses.length ? computeMetrics(loses.map((m) => m.raw)) : {};
  const split = wins.length >= minSide && loses.length >= minSide;
  const wl = opt.wl && opt.wl.metrics && opt.wl.members >= 5 ? opt.wl : null;

  // 지표별 행: 내 값·랭커 평균·Z·이긴/진 경기 값·t
  // 경기별 지표는 한 번만 계산 (Worker CPU 10ms 한도 — 지표×경기마다 다시 계산하면 수 ms 낭비)
  const pmOf = new Map(matches.map((m) => [m, computeMetrics([m.raw])]));
  const per = (list, k) => list.filter((m) => !DEN[k] || (m.raw[DEN[k]] || 0) > 0)
    .map((m) => pmOf.get(m)[k]).filter((v) => v != null && isFinite(v));
  const rows = [];
  for (const k of Object.keys(METRICS)) {
    if (me[k] == null || SKIP.has(k)) continue;
    const b = base && base[k];
    const z = b && b.sd > 0 ? (me[k] - b.mean) / b.sd : null;
    // 이길 때·질 때: 내 차이 vs 클럽원 보통 차이
    let wz = 0;
    const c = wl && wl.metrics[k];
    if (split && c && mw[k] != null && ml[k] != null) {
      const se = diffSE(per(wins, k), per(loses, k));
      const tau2 = Math.max(0, c.d.sd ** 2 - (c.d.noise || 0) ** 2);
      const den = Math.sqrt(tau2 + (se || 0) ** 2);
      if (se != null && den > 0) wz = (mw[k] - ml[k] - c.d.mean) / den;
    }
    rows.push({ k, label: METRICS[k].label, dir: DIR[k] || 0, v: me[k], avg: b ? b.mean : null, z, w: mw[k], l: ml[k], c,
      wz, sig: Math.abs(wz) >= WL_Z });
  }
  const item = (r, text) => ({
    k: r.k, label: r.label, v: fmtV(r.k, r.v), avg: r.avg == null ? null : fmtV(r.k, r.avg),
    z: r.z == null ? null : Math.round(r.z * 100) / 100,
    win: split ? fmtV(r.k, r.w) : null, lose: split ? fmtV(r.k, r.l) : null, sig: r.sig,
    cw: split && r.c ? fmtV(r.k, r.c.w.mean) : null, cl: split && r.c ? fmtV(r.k, r.c.l.mean) : null, text
  });
  const used = new Set();

  // 💪 장점: 랭커보다 좋은 방향 지표
  const strengths = [];
  for (const r of rows) {
    if (r.z == null) continue;
    if (r.dir && r.dir * r.z >= Z_GOOD && !NO_STRENGTH.has(r.k)) strengths.push({ s: r.dir * r.z, r, text: TIPS[r.k].good });
  }
  strengths.sort((a, b) => b.s - a.s);

  // 🔧 보완점: 랭커보다 나쁜 방향 지표 (목표 = 랭커 평균)
  const weaknesses = [];
  for (const r of rows) {
    if (r.z == null) continue;
    if (r.dir && r.dir * r.z <= -Z_GOOD) weaknesses.push({ s: -r.dir * r.z, r, text: TIPS[r.k].bad + ` 목표: 랭커 평균 ${fmtV(r.k, r.avg)}.` });
  }
  weaknesses.sort((a, b) => b.s - a.s);
  const top = (arr) => arr.slice(0, 3).map((x) => { used.add(x.r.k); return item(x.r, x.text); });
  const S = top(strengths), W = top(weaknesses);

  // 🟢 이길 때 · 🔴 질 때 나만의 특징: 결과 지표 제외, 클럽원 보통 차이에서 벗어난 것 (|z| 큰 순, 각 3개)
  //   장점·보완점에 나온 지표도 다시 보여 줌 (관점이 다름: 수준 vs 승패 패턴)
  const special = (sd) => rows.filter((r) => r.sig && (sd === "win" ? r.wz > 0 : r.wz < 0) && !NOT_KEY.has(r.k) && !NO_SPECIAL.has(r.k))
    .sort((a, b) => Math.abs(b.wz) - Math.abs(a.wz)).slice(0, 3)
    .map((r) => {
      // 제목은 숫자 그대로 읽히게: 내 차이(이긴 − 진)의 부호로 문장을 고름
      //   🟢 내 차이 > 0: "이길 때 유난히 더 높아요" / ≤ 0: (보통은 이길 때 줄어드는데) "이길 때도 덜 줄어요"
      //   🔴 내 차이 < 0: "질 때 유난히 더 높아요"   / ≥ 0: (보통은 질 때 줄어드는데) "질 때도 크게 줄지 않아요"
      const ratio = !!METRICS[r.k].unit, myD = r.w - r.l;
      const hi = ratio ? "높아요" : "많아요";
      const flat = Math.abs(myD) < 0.3 * Math.abs(r.c.d.mean);   // 보통은 차이가 나는데 나는 거의 같음
      const head = flat ? "이기든 지든 비슷해요" : sd === "win"
        ? (myD > 0 ? `이길 때 유난히 더 ${hi}` : `이길 때도 덜 ${ratio ? "낮아져요" : "줄어요"}`)
        : (myD < 0 ? `질 때 유난히 더 ${hi}` : `질 때도 크게 ${ratio ? "낮아지지" : "줄지"} 않아요`);
      const fact = `진 경기 대비 이긴 경기 차이 — 클럽원 보통 ${fmtD(r.k, r.c.d.mean)}, 나 ${fmtD(r.k, myD)}.`;
      // 권유 문장은 방향 없는 스타일 지표 + 뚜렷한 경우(내 차이 부호가 맞을 때)만. 파울 같은 방향 지표는 사실만
      const tip = flat ? ` 보통은 ${r.c.d.mean > 0 ? "이길" : "질"} 때 더 ${hi.replace("요", "")}지는데, 나는 승패와 상관없이 비슷해요.`
        : r.dir ? ""
        : sd === "win" && myD > 0 ? " 이게 나올 때 이기는 나만의 패턴이에요. 더 자주 만들어 보세요."
        : sd === "lose" && myD < 0 ? " 질 때 늘어나는 나만의 패턴이에요. 안 풀릴 때 이렇게 되는지 점검해 보세요."
        : "";
      return { ...item(r, fact + tip), head };
    });
  const winSpecial = special("win"), loseSpecial = special("lose");
  for (const x of [...winSpecial, ...loseSpecial]) used.add(x.k);

  // ℹ️ 특징: 방향 없는 지표 중 랭커와 크게 다르지만 승패 차이는 없는 것 (장단점으로 단정하지 않음)
  const traits = rows.filter((r) => !r.dir && !NOT_KEY.has(r.k) && !used.has(r.k) && r.z != null && Math.abs(r.z) >= Z_TRAIT && !r.sig)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 2)
    .map((r) => item(r, `랭커보다 ${r.z > 0 ? "많아요" : "적어요"}. 승패와는 뚜렷한 관계가 없어 장단점으로 보진 않아요.`));

  // ⏱ 시간대: 실점·득점 구간 분포(연장 제외 6구간) + 역전승·극장골
  const gfB = GOAL_BUCKETS.map(() => 0), gaB = GOAL_BUCKETS.map(() => 0);
  let comebacks = 0, lateWinners = 0;
  for (const m of matches) {
    for (const s of m.shots || []) if (s[3] === 3) gfB[bucketOf(s[0])]++;
    for (const t of m.oppGoals || []) gaB[bucketOf(t)]++;
    const f = goalFlow(m);
    if (f && f.comeback) comebacks++;
    if (f && f.lateWinner) lateWinners++;
  }
  const time = [];
  const peak = (arr, word) => {
    const main = arr.slice(0, 6), tot = main.reduce((s, v) => s + v, 0);
    if (tot < 10) return;
    const i = main.indexOf(Math.max(...main)), share = main[i] / tot;
    if (share >= 1.25 / 6) time.push(`${word}이 ${GOAL_BUCKETS[i]}분에 가장 많아요 (${word} ${tot}골 중 ${main[i]}골, ${Math.round(share * 100)}%).`);
  };
  peak(gaB, "실점");
  peak(gfB, "득점");
  if (comebacks || lateWinners) time.push(`역전승 ${comebacks}번 · 80분 이후 결승골(극장골) ${lateWinners}번.`);

  // 🧭 요약
  const w = wins.length, l = loses.length, d = n - w - l;
  const gf = matches.reduce((s, m) => s + (m.goalFor || 0), 0) / n, ga = matches.reduce((s, m) => s + (m.goalAgainst || 0), 0) / n;
  let summary = `${n}경기 ${w}승 ${d}무 ${l}패 (승률 ${Math.round((w / n) * 100)}%) · 경기당 득점 ${gf.toFixed(1)} · 실점 ${ga.toFixed(1)}.`;
  if (S[0]) summary += ` 가장 큰 무기는 ${S[0].label}, `;
  if (W[0]) summary += `${S[0] ? "" : " "}가장 먼저 손볼 곳은 ${ieyo(W[0].label)}.`;
  else if (S[0]) summary = summary.replace(/, $/, "") .replace(/무기는 (.+)$/, (_, x) => "무기는 " + ieyo(x) + ".");

  return { v: GUIDE_VERSION, games: n, split, minSide, wlMembers: wl ? wl.members : 0, summary, strengths: S, weaknesses: W,
    winSpecial, loseSpecial, traits, time };
}
