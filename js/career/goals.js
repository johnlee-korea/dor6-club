/* ============================================================
   career/goals.js — 시즌 목표(감독 미션) · 감독 신뢰도 (CLAUDE.md 26-9)
   목표: { kind: "goals"|"points"|"apps"|"rating", target }
   ============================================================ */
import { GOALS, MATCH, TRUST_MIN, TRUST_MAX, clamp } from "./rules.js";

export const GOAL_LABEL = { goals: "리그 골", points: "공격포인트", apps: "출전", rating: "평균 평점" };

/* role: 시즌 시작 역할, games: 리그 경기 수, last: 직전 시즌 요약(같은 지표가 목표를 30% 넘게 웃돌면 ×1.15)
   fit: { ovr, R, typeRb } — 평점 목표 보정. 팀보다 훨씬 강하면 평점이 높게 나오므로 목표도 높게, 빠듯하면 낮게 */
export function makeGoal(role, pos, games, last, fit) {
  const [kind, v] = GOALS[role][pos];
  let target = kind === "rating" ? ratingTarget(v, fit) : Math.max(1, Math.round(v * games));
  if (last && kind !== "rating") {
    const prev = goalValue(kind, last);
    if (prev > target * GOALS.raiseOver) target = Math.round(target * GOALS.raise);
  }
  return { kind, target };
}

/* 예상 평점 보정(×10 정수, 엔진 rb와 같은 식) → 0.1 단위 목표 */
export function ratingTarget(base, fit) {
  if (!fit) return base;
  const rb = clamp(Math.round(MATCH.rbK * (fit.ovr - fit.R - GOALS.starterGap)), -MATCH.rbCap, MATCH.rbCap) + (fit.typeRb | 0);
  return Math.round(base * 10 + rb) / 10;
}

export function goalValue(kind, s) {
  if (kind === "goals") return s.goals;
  if (kind === "points") return s.goals + s.assists;
  if (kind === "apps") return s.starts + s.subs;
  return Math.round((s.avg || 0) * 100) / 100;
}
export const goalMet = (goal, s) => goalValue(goal.kind, s) >= goal.target;
export const goalText = (goal) => goal.kind === "rating" ? `평균 평점 ${goal.target.toFixed(1)} 이상` : `${GOAL_LABEL[goal.kind]} ${goal.target}${goal.kind === "apps" ? "경기" : goal.kind === "goals" ? "골" : "개"}`;

export const addTrust = (t, d) => clamp(t + d, TRUST_MIN, TRUST_MAX);
