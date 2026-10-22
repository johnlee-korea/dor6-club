/* ============================================================
   career/events.js — 🎲 시즌 이벤트 (v2.15.0 사용자 요청)
   매 시즌 오프시즌 첫 단계에 3지선다 질문 1개. 고른 답마다 결과는 랜덤:
     유지 · 소폭 상승(OVR +1~2) · 대폭 상승(+3~4)
   5시즌마다(시즌 5·10·15·20 = 20·25·30·35세) '⭐ 인생의 갈림길' — 초대폭(+5~6) 기회가 추가된다.
   - 결과는 커리어 시드로 정해짐(같은 저장·같은 선택 → 같은 결과, 저장 후 다시 골라도 그대로)
   - 밸런스(사용자 결정 "확률로 조절"): 유지가 가장 자주 나오고, OVR 85부터 효과가 줄어 99는 여전히 드묾 → rules.js EVENT
   - 질문 순서는 커리어마다 섞이고, 한 바퀴 다 나오기 전엔 같은 질문이 다시 나오지 않음
   ============================================================ */
import { makeRng } from "../engine/rng.js";
import { CATS, W, EVENT, lerp, round1 } from "./rules.js";
import { applyGrowth, posOvr } from "./attrs.js";

/* 일반 이벤트 — choices 3개 (문구만 다르고 결과 확률은 같음: "선택이 운을 부른다") */
export const EVENTS = [
  { id: "confess", icon: "💌", q: "평소 관심 있던 사람에게서 고백을 받았습니다.",
    choices: ["받아준다", "조금만 기다려 달라고 한다", "난 축구가 전부야… 미안해"] },
  { id: "tv", icon: "📺", q: "인기 예능 프로그램에서 출연 섭외가 들어왔습니다.",
    choices: ["출연한다", "시즌 끝나고 하자고 한다", "정중히 거절한다"] },
  { id: "party", icon: "🎂", q: "팀 동료 생일 파티가 새벽까지 이어질 분위기입니다.",
    choices: ["끝까지 달린다", "1차만 하고 빠진다", "선물만 주고 숙소로 간다"] },
  { id: "mentor", icon: "🧓", q: "은퇴한 레전드 선배가 개인 레슨을 해 주겠다고 합니다.",
    choices: ["감사히 배운다", "영상만 받아서 혼자 연습한다", "내 스타일대로 간다"] },
  { id: "sns", icon: "📱", q: "SNS에 내 실수 장면을 조롱하는 영상이 퍼졌습니다.",
    choices: ["실력으로 보여준다", "재치 있게 답글을 단다", "앱을 지운다"] },
  { id: "family", icon: "🏠", q: "고향 부모님이 보고 싶다고 연락하셨습니다.",
    choices: ["휴가를 내고 다녀온다", "영상 통화로 대신한다", "경기장으로 초대한다"] },
  { id: "diet", icon: "🥗", q: "구단 영양사가 철저한 식단 관리를 제안했습니다.",
    choices: ["철저히 따른다", "치팅데이는 지킨다", "먹는 게 낙인데…"] },
  { id: "fconline", icon: "🎮", q: "숙소에 FC온라인 내전 붐이 일었습니다.",
    choices: ["밤새 랭크를 달린다", "주말에만 한다", "전술 공부용으로만 한다"] },
  { id: "dog", icon: "🐶", q: "유기견 보호소에서 강아지 입양을 권했습니다.",
    choices: ["입양한다", "임시 보호만 한다", "봉사 활동만 간다"] },
  { id: "rival", icon: "🤝", q: "라이벌 팀 에이스가 비시즌 개인 훈련을 같이 하자고 합니다.",
    choices: ["함께 훈련한다", "기술만 슬쩍 배워 온다", "라이벌과는 안 섞인다"] },
  { id: "coin", icon: "💸", q: "친구가 '무조건 오른다'며 투자를 권합니다.",
    choices: ["연봉 일부를 넣는다", "소액만 넣어 본다", "축구에만 집중한다"] },
  { id: "rain", icon: "🌧", q: "폭우 속 훈련, 감독이 오늘은 자율 참여라고 합니다.",
    choices: ["끝까지 남는다", "실내 웨이트로 바꾼다", "쉬면서 컨디션을 관리한다"] }
];

/* ⭐ 인생의 갈림길 — 5시즌마다 (나이 순서대로 하나씩) */
export const MAJOR_EVENTS = [
  { id: "national", icon: "🎽", q: "국가대표 첫 소집 통보! 그런데 소속팀의 중요한 일정과 겹칩니다.",
    choices: ["태극마크를 택한다", "감독과 상의해 일정을 조율한다", "소속팀에 남는다"] },
  { id: "marriage", icon: "💍", q: "오래 만난 연인이 결혼 이야기를 꺼냈습니다.",
    choices: ["그 자리에서 프러포즈한다", "시즌 끝나고 이야기하자고 한다", "아직은 커리어가 먼저야"] },
  { id: "knee", icon: "🩺", q: "무릎 통증이 심해졌습니다. 의료진이 선택하라고 합니다.",
    choices: ["수술하고 완벽하게 돌아온다", "재활 훈련으로 버틴다", "진통제 맞고 그냥 뛴다"] },
  { id: "lastdance", icon: "🎤", q: "\"이제 은퇴할 때가 됐다\"는 기사가 쏟아집니다.",
    choices: ["\"아직 끝나지 않았다\" 지옥 훈련", "후배들의 멘토가 된다", "마지막 시즌을 즐긴다"] }
];

/* 결과 단계 */
export const TIERS = {
  keep:  { label: "유지", icon: "😐", texts: ["특별한 변화는 없었어요.", "그냥 평범하게 지나갔어요.", "마음은 편해졌지만 능력치는 그대로예요."] },
  small: { label: "소폭 상승", icon: "📈", texts: ["컨디션이 한결 좋아졌어요!", "자신감이 붙었어요!", "몸이 가벼워졌어요!"] },
  big:   { label: "대폭 상승", icon: "🚀", texts: ["완전히 각성했어요!", "한 단계 다른 선수가 됐어요!", "모든 게 맞아떨어졌어요!"] },
  huge:  { label: "초대폭 상승", icon: "🌟", texts: ["인생이 바뀌는 순간이었어요!", "전설의 서막이 열렸어요!", "누구도 막을 수 없는 선수가 됐어요!"] }
};

export const isMajorSeason = (n) => n % EVENT.majorEvery === 0;

/* 시즌 n의 질문 (커리어 시드로 섞은 순서, 한 바퀴 돌면 다시 섞음) */
export function eventFor(seed, n) {
  if (isMajorSeason(n)) {
    const m = n / EVENT.majorEvery - 1;
    return { ...MAJOR_EVENTS[m % MAJOR_EVENTS.length], major: true };
  }
  const k = n - Math.floor(n / EVENT.majorEvery) - 1;     // 일반 이벤트 순번 (0부터)
  const lap = Math.floor(k / EVENTS.length);
  const order = makeRng(`${seed}|events|${lap}`).shuffle(EVENTS.map((_, i) => i));
  return { ...EVENTS[order[k % EVENTS.length]], major: false };
}

/* 오프시즌 시작 시 이번 시즌 이벤트 준비 (예전 저장분은 화면이 처음 열릴 때 만듦) */
export function prepareEvent(state) {
  const n = state.world.season;
  const ev = eventFor(state.seed, n);
  state.off.event = { n, id: ev.id, major: ev.major, choice: null };
  return state.off.event;
}
export const pendingEvent = (state) => !!(state.off && state.off.event && state.off.event.choice === null);
export const eventDef = (e) => (e.major ? MAJOR_EVENTS : EVENTS).find((x) => x.id === e.id);

/* OVR 85부터 효과 감소 (rules.js EVENT.damp) */
export const eventDamp = (ovr) => lerp(EVENT.damp, ovr)[0];

/* 선택 → 결과 판정 + 능력치 적용 (player.subs를 직접 바꿈) */
export function resolveEvent(state, choice) {
  const e = state.off.event, p = state.player;
  if (!e || e.choice !== null) return e;
  const rng = makeRng(`${state.seed}|S${e.n}|event|${choice}`);
  const tiers = e.major ? EVENT.major : EVENT.normal;
  const tier = tiers[rng.weighted(tiers.map((t) => t[1]))][0];
  const target = tier === "keep" ? 0 : rng.range(EVENT.amount[tier][0], EVENT.amount[tier][1]);
  const before = posOvr(p.subs, p.pos);
  const damp = eventDamp(before);
  if (target > 0) applyOvrGain(p, target * damp);
  const after = posOvr(p.subs, p.pos);
  Object.assign(e, { choice, tier, target, damp: round1(damp), text: rng.int(TIERS[tier].texts.length),
                     ovrBefore: round1(before), ovrAfter: round1(after), gain: round1(after - before) });
  return e;
}

/* 포지션 OVR이 gain만큼 오르도록 포지션 관련 대분류(가중치 > 0)를 고르게 올림
   핵심 세부 강조 때문에 대분류 +x가 OVR +x와 조금 다름 → 복사본으로 한 번 재 보고 비율 보정 (99 근처는 덜 오를 수 있음) */
function applyOvrGain(p, gain) {
  const cats = CATS.filter((c) => W[p.pos][c] > 0);
  const deltas = (x) => Object.fromEntries(cats.map((c) => [c, x]));
  const base = posOvr(p.subs, p.pos);
  const trial = { ...p.subs };
  applyGrowth(trial, deltas(gain), p.pos, {}, true);
  const got = posOvr(trial, p.pos) - base;
  const scale = got > 0.01 ? gain / got : 1;
  applyGrowth(p.subs, deltas(gain * Math.min(scale, 1.5)), p.pos, {}, true);
}
