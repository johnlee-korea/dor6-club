/* ============================================================
   lib/guide.js — 🧭 내 플레이 가이드 (v2.18.0, 사용자 요청 "어떤 장점을 더 살리고 어떤 단점을 보완할지")
   - 규칙·문장 템플릿만으로 만든다 (모든 문장에 근거 숫자 — 지어낸 말 없음)
   - 두 가지 비교를 함께 본다
     ① 랭커 대비: 플레이스타일 지표 31개의 Z점수 (ranker-baseline stats)
     ② 나 대 나: 내 경기 중 이긴 경기 vs 진 경기 — 경기별 값으로 Welch t (|t| ≥ SIG_T일 때만 '차이 있음')
   - 지표마다 '좋은 방향'(DIR)이 정해진 것만 장점·약점으로 단정. 스타일 지표(방향 없음)는 승패 차이가 있을 때만 판단,
     없으면 '특징'으로만 표시
   - 클럽 집계(aggregate.js → insights.json players[].guide)와 전적 검색(Worker /search analysis.guide)이 공유
   ============================================================ */
import { computeMetrics, METRICS } from "./playstyle.js";
import { GOAL_BUCKETS, bucketOf, goalFlow } from "./insight.js";

export const GUIDE_VERSION = 1;
const MIN_GAMES = 15;        // 가이드 최소 경기
const SIG_T = 2;             // 승패 차이 판정 (Welch t)
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

/* Welch t — 두 표본 평균 차이 (표본 2개 미만이면 0) */
function welch(a, b) {
  if (a.length < 2 || b.length < 2) return 0;
  const m = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  const v = (x, mu) => x.reduce((s, y) => s + (y - mu) ** 2, 0) / (x.length - 1);
  const ma = m(a), mb = m(b);
  const se = Math.sqrt(v(a, ma) / a.length + v(b, mb) / b.length);
  return se > 0 ? (ma - mb) / se : 0;
}

/* matches: [{ result, raw(withShots 적용된 styleRaw), shots, oppGoals, goalFor, goalAgainst }] — 정상 종료 경기만
   base: 랭커 기준값 stats { 지표: { mean, sd } }
   opt.minSide: 승·패 각각 최소 경기 (클럽 15 · 전적 검색 30경기라 8) */
export function buildGuide(matches, base, opt = {}) {
  const minSide = opt.minSide ?? 15;
  const n = matches.length;
  if (n < MIN_GAMES) return { v: GUIDE_VERSION, games: n, minGames: MIN_GAMES };
  const wins = matches.filter((m) => m.result === "win"), loses = matches.filter((m) => m.result === "lose");
  const me = computeMetrics(matches.map((m) => m.raw));
  const mw = wins.length ? computeMetrics(wins.map((m) => m.raw)) : {};
  const ml = loses.length ? computeMetrics(loses.map((m) => m.raw)) : {};
  const split = wins.length >= minSide && loses.length >= minSide;

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
    const t = split ? welch(per(wins, k), per(loses, k)) : 0;
    rows.push({ k, label: METRICS[k].label, dir: DIR[k] || 0, v: me[k], avg: b ? b.mean : null, z, w: mw[k], l: ml[k], t,
      sig: Math.abs(t) >= SIG_T });
  }
  const item = (r, text) => ({
    k: r.k, label: r.label, v: fmtV(r.k, r.v), avg: r.avg == null ? null : fmtV(r.k, r.avg),
    z: r.z == null ? null : Math.round(r.z * 100) / 100,
    win: split ? fmtV(r.k, r.w) : null, lose: split ? fmtV(r.k, r.l) : null, sig: r.sig, text
  });
  const winMore = (r) => r.sig && r.t > 0, loseMore = (r) => r.sig && r.t < 0;
  // 결과 지표(결정력·실점 등)는 이긴 경기에서 좋은 게 당연 → '이긴 경기에서도' 문장을 붙이지 않음
  const backedBy = (r) => !NOT_KEY.has(r.k) && (r.dir > 0 ? winMore(r) : loseMore(r));
  const used = new Set();

  // 💪 장점: 랭커보다 좋은 방향 지표 + (방향 없는 지표 중) 내가 많이 하고 이긴 경기에서 더 나오는 것
  const strengths = [];
  for (const r of rows) {
    if (r.z == null) continue;
    if (r.dir && r.dir * r.z >= Z_GOOD && !NO_STRENGTH.has(r.k)) {
      const backed = backedBy(r);
      strengths.push({ s: r.dir * r.z + (backed ? 0.5 : 0), r, text: TIPS[r.k].good + (backed ? " 이긴 경기에서 특히 두드러져요." : "") });
    } else if (!r.dir && !NOT_KEY.has(r.k) && r.z >= 0.3 && winMore(r)) {
      // 랭커보다 많이 하고 있고(0.3σ 이상), 이긴 경기에서 더 나오는 스타일 = 살릴 무기
      strengths.push({ s: r.z + Math.abs(r.t) / 4, r, text: `이긴 경기에서 더 많이 나와요 (${fmtV(r.k, r.w)} vs 진 경기 ${fmtV(r.k, r.l)}). 랭커 평균 이상으로 하고 있는 내 승리 패턴이에요.` });
    }
  }
  strengths.sort((a, b) => b.s - a.s);

  // 🔧 보완점: 랭커보다 나쁜 방향 지표 + (방향 없는 지표 중) 내가 많이 하는데 진 경기에서 더 늘어나는 것
  const weaknesses = [];
  for (const r of rows) {
    if (r.z == null) continue;
    if (r.dir && r.dir * r.z <= -Z_GOOD) {
      const backed = backedBy(r);   // 이 지표가 좋을 때 이겼다 = 고치면 승리에 직결
      weaknesses.push({ s: -r.dir * r.z + (backed ? 0.5 : 0), r,
        text: TIPS[r.k].bad + ` 목표: 랭커 평균 ${fmtV(r.k, r.avg)}.` + (backed ? " 이긴 경기에선 이 수치가 더 좋았어요." : "") });
    } else if (!r.dir && !NOT_KEY.has(r.k) && r.z >= 0.3 && loseMore(r)) {
      weaknesses.push({ s: r.z + Math.abs(r.t) / 4, r, text: `진 경기에서 더 늘어나요 (${fmtV(r.k, r.l)} vs 이긴 경기 ${fmtV(r.k, r.w)}). 안 풀릴 때 나오는 습관인지 점검해 보세요.` });
    }
  }
  weaknesses.sort((a, b) => b.s - a.s);
  const top = (arr) => arr.slice(0, 3).map((x) => { used.add(x.r.k); return item(x.r, x.text); });
  const S = top(strengths), W = top(weaknesses);

  // 🔑 이길 때 vs 질 때: 결과 지표 제외, 차이가 확실한 것 중 |t| 큰 순 3개 (위에서 이미 나온 지표 제외)
  const keys = split ? rows.filter((r) => r.sig && !NOT_KEY.has(r.k) && !used.has(r.k))
    .sort((a, b) => Math.abs(b.t) - Math.abs(a.t)).slice(0, 3)
    .map((r) => { used.add(r.k); const more = METRICS[r.k].unit ? "높아요" : "많아요";   // 비율 지표는 "높아요"
      return item(r, `${r.t > 0 ? "이긴" : "진"} 경기에서 더 ${more}.`); }) : [];
  // 🔑 항목 중 랭커 대비 거의 같은(±0.3σ 안) 지표도 그대로 둠 — 나 대 나 비교라 랭커 수준과 무관

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

  return { v: GUIDE_VERSION, games: n, split, minSide, summary, strengths: S, weaknesses: W, keys, traits, time };
}
