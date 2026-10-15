/* ============================================================
   career/achievements.js — 커리어 업적 38개 (CLAUDE.md 26-10)
   판정은 커리어 상태(totals·history)만으로 → 화면이 기기 누적 목록(meta)에 합침
   ============================================================ */
import { BIG_CLUB } from "./rules.js";
import { leagueOf } from "./world.js";

const T = (s) => s.totals;
export const ACHIEVEMENTS = [
  // 승격 서사
  { id: "rise", cat: "승격 서사", icon: "🪜", name: "바닥부터", desc: "잉글랜드 4부에서 시작해 1부 데뷔", test: (s) => T(s).startLeague === "en.4" && T(s).tier1Debut !== null },
  { id: "elevator", cat: "승격 서사", icon: "🛗", name: "엘리베이터", desc: "같은 구단 소속으로 승격 2회", test: (s) => Object.values(T(s).clubs).some((c) => c.promotions >= 2) },
  { id: "tier1", cat: "승격 서사", icon: "🏟", name: "꿈의 무대", desc: "1부 리그 데뷔", test: (s) => T(s).tier1Debut !== null },
  { id: "bigjoin", cat: "승격 서사", icon: "🏰", name: "빅클럽 입성", desc: `요구 OVR ${BIG_CLUB} 이상 구단에서 뛰기`, test: (s) => !!T(s).bigJoined },
  { id: "topstart", cat: "승격 서사", icon: "👑", name: "정상 등극", desc: "요구 OVR 83 이상 구단 주전", test: (s) => !!T(s).topStarter },
  // 정상
  { id: "title", cat: "정상", icon: "🏆", name: "첫 우승", desc: "리그 우승", test: (s) => T(s).titles >= 1 },
  { id: "dynasty", cat: "정상", icon: "🏆", name: "왕조", desc: "리그 우승 3회", test: (s) => T(s).titles >= 3 },
  { id: "scorer", cat: "정상", icon: "👟", name: "득점왕", desc: "리그 득점왕", test: (s) => (T(s).awards["득점왕"] || 0) >= 1 },
  { id: "assister", cat: "정상", icon: "🎯", name: "도움왕", desc: "리그 도움왕", test: (s) => (T(s).awards["도움왕"] || 0) >= 1 },
  { id: "mvp", cat: "정상", icon: "🥇", name: "시즌 MVP", desc: "리그 시즌 MVP", test: (s) => (T(s).awards["시즌 MVP"] || 0) >= 1 },
  { id: "best11x5", cat: "정상", icon: "⭐", name: "단골 베스트11", desc: "베스트11 5회", test: (s) => (T(s).awards["베스트11"] || 0) >= 5 },
  { id: "unbeaten", cat: "정상", icon: "🛡", name: "무패 우승", desc: "한 경기도 지지 않고 리그 우승", test: (s) => !!T(s).unbeaten },
  // 방랑자
  { id: "three", cat: "방랑자", icon: "🧳", name: "세 나라", desc: "3개국 리그에서 뛰기", test: (s) => T(s).countries.length >= 3 },
  { id: "five", cat: "방랑자", icon: "🌍", name: "유럽 일주", desc: "5개국 리그 모두에서 뛰기", test: (s) => T(s).countries.length >= 5 },
  { id: "journey", cat: "방랑자", icon: "🚌", name: "저니맨", desc: "5개 구단 거치기", test: (s) => Object.keys(T(s).clubs).length >= 5 },
  // 원클럽맨
  { id: "oneclub", cat: "원클럽맨", icon: "❤️", name: "원클럽맨", desc: "한 구단에서 10시즌", test: (s) => Object.values(T(s).clubs).some((c) => c.seasons >= 10) },
  { id: "franchise", cat: "원클럽맨", icon: "🗽", name: "프랜차이즈 스타", desc: "한 구단에서 통산 100골", test: (s) => Object.values(T(s).clubs).some((c) => c.goals >= 100) },
  // 기록
  { id: "g30", cat: "기록", icon: "🔥", name: "30골 시즌", desc: "한 시즌 리그 30골", test: (s) => s.history.some((h) => h.goals >= 30) },
  { id: "a20", cat: "기록", icon: "🎼", name: "20도움 시즌", desc: "한 시즌 리그 20도움", test: (s) => s.history.some((h) => h.assists >= 20) },
  { id: "apps300", cat: "기록", icon: "📅", name: "300경기", desc: "통산 리그 300경기 출전", test: (s) => T(s).apps >= 300 },
  { id: "goals200", cat: "기록", icon: "💯", name: "통산 200골", desc: "통산 리그 200골", test: (s) => T(s).goals >= 200 },
  { id: "hat10", cat: "기록", icon: "🎩", name: "해트트릭 장인", desc: "통산 해트트릭 10회", test: (s) => T(s).hatTricks >= 10 },
  { id: "rich", cat: "기록", icon: "💰", name: "1억 €", desc: "통산 수입 1억 €", test: (s) => T(s).income >= 10000 },
  // 전설
  { id: "ovr80", cat: "전설", icon: "📈", name: "1부 주전급", desc: "OVR 80 달성", test: (s) => T(s).maxOvr >= 80 },
  { id: "ovr90", cat: "전설", icon: "🌐", name: "월드클래스", desc: "OVR 90 달성", test: (s) => T(s).maxOvr >= 90 },
  { id: "ovr95", cat: "전설", icon: "🌟", name: "레전드", desc: "OVR 95 달성", test: (s) => T(s).maxOvr >= 95 },
  { id: "goat", cat: "전설", icon: "🐐", name: "GOAT", desc: "OVR 99 달성 (최상위 업적)", test: (s) => T(s).maxOvr >= 99 },
  { id: "legend3", cat: "전설", icon: "✨", name: "레전드 시즌 3회", desc: "레전드 시즌 3번", test: (s) => T(s).legends >= 3 },
  // 변신
  { id: "evolve3", cat: "변신", icon: "🧬", name: "진화의 끝", desc: "유형 3번 진화", test: (s) => T(s).typeChanges >= 3 },
  { id: "newrole", cat: "변신", icon: "🔄", name: "새 옷", desc: "포지션 전환 후 리그 우승", test: (s) => !!T(s).convertedTitle },
  { id: "pref", cat: "변신", icon: "🎯", name: "감독의 남자", desc: "선호 유형 완전 일치 구단에서 주전", test: (s) => !!T(s).prefStarter },
  // 부활
  { id: "revival", cat: "부활", icon: "🔥", name: "부활", desc: "슬럼프 직후 시즌 개인상", test: (s) => s.history.some((h, i) => i > 0 && s.history[i - 1].slump && h.awards.length > 0) },
  // 도전 모드
  { id: "reverse", cat: "도전 모드", icon: "🧗", name: "역주행", desc: "★추천이 아닌 조합으로 시작해 빅클럽 주전", test: (s) => !s.player.star && !!T(s).bigStarter },
  { id: "underdog", cat: "도전 모드", icon: "🐺", name: "언더독", desc: "★추천이 아닌 조합으로 시작해 1부 우승", test: (s) => !!T(s).underdogTitle },
  // 노장
  { id: "veteran", cat: "노장", icon: "🦾", name: "녹슬지 않는 발", desc: "36세 이후 1부 주전", test: (s) => !!T(s).veteranStarter },
  { id: "iron", cat: "노장", icon: "🗿", name: "철인", desc: "40세 시즌까지 현역", test: (s) => s.history.some((h) => h.age >= 40) },
  // 유망주
  { id: "prodigy", cat: "유망주", icon: "🍼", name: "신동", desc: "18세 이하에 1군 주전", test: (s) => !!T(s).youngStarter },
  { id: "wonderkid", cat: "유망주", icon: "💎", name: "원더키드", desc: "21세에 OVR 75 이상", test: (s) => s.history.some((h) => h.age === 21 && Math.round(h.ovrEnd) >= 75) }
];
export const ACH_CATS = [...new Set(ACHIEVEMENTS.map((a) => a.cat))];

/* 이 커리어에서 지금까지 달성한 업적 중 이번에 새로 달성한 것 (state.achieved에 누적) */
export function checkAchievements(state) {
  state.achieved = state.achieved || [];
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (state.achieved.includes(a.id)) continue;
    try { if (a.test(state)) { state.achieved.push(a.id); fresh.push(a.id); } }
    catch (e) { console.error("[career] 업적 판정 오류", a.id, e); }
  }
  return fresh;
}
export const achievementById = (id) => ACHIEVEMENTS.find((a) => a.id === id);
export { leagueOf };
