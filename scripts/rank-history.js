/* ============================================================
   rank-history.js — 클럽원 등급·순위·랭킹 점수 기록 (v2.8.0)
   - 매시 35분 rank.yml(Worker Cron이 workflow_dispatch로 호출)에서 실행 → data/rankhist.json
   - 출처: 데이터센터 랭킹 닉 검색(scripts/lib/rank.js). 넥슨 API 키 불필요
   - 감독모드는 자동 진행이라 최고 점수를 직접 보기 어려움 → 시점별 기록 + 역대 최고 보존
   - 랭킹(상위 1만) 밖이면 값 없는 점(null)으로 남겨 그래프에서 끊어 표시
   저장 구조:
     divisions: 등급 이름(division.json 순서 = 아이콘 번호)
     players[ouid][50|52] = {
       pts:  [[데이터 기준 시각 ISO, 등급 번호|null, 순위|null, 점수|null], …]  — 최근 PTS_KEEP_DAYS일
       best: { t, div, rank, score }                                         — 기록 시작 후 최고 점수
       days: { "YYYY-MM-DD"(KST): [최고 점수, 최고 순위, 최고 등급 번호] }      — 일별 최고 (계속 보존)
     }
   실행: node scripts/rank-history.js
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RANK_RT, rankSearchUrl, parseRankSearch, rankDataTime } from "./lib/rank.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "rankhist.json");
const PTS_KEEP_DAYS = 7;      // 그래프는 24시간이지만 누락·지연 대비 여유
const INTERVAL_MS = 300;      // 데이터센터 요청 간격
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJSON = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } };
const kstDate = (iso) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);

async function fetchRank(matchType, nickname) {
  const res = await fetch(rankSearchUrl(matchType, nickname), { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`응답 ${res.status}`);
  const html = await res.text();
  return { r: parseRankSearch(html, nickname), t: rankDataTime(html) };
}

async function main() {
  const members = readJSON(path.join(ROOT, "data", "members.json"), { members: [] }).members || [];
  const profiles = readJSON(path.join(ROOT, "data", "profiles.json"), { profiles: {} }).profiles || {};
  const hist = readJSON(OUT, { players: {} });
  hist.players = hist.players || {};

  // 등급 이름 (정적 메타, 키 불필요) — 실패하면 기존 값 유지
  try {
    const meta = await (await fetch("https://open.api.nexon.com/static/fconline/meta/division.json")).json();
    hist.divisions = meta.map((d) => d.divisionName);
  } catch (e) { console.warn(`  등급 메타 실패: ${e.message}`); }

  const cutoff = Date.now() - PTS_KEEP_DAYS * 86400e3;
  let ok = 0, ranked = 0, fail = 0;
  for (const m of members) {
    const nick = (profiles[m.ouid] && profiles[m.ouid].nickname) || m.ingameNick;   // 현재 닉(2시간마다 갱신)
    const p = hist.players[m.ouid] = hist.players[m.ouid] || {};
    for (const type of Object.keys(RANK_RT)) {
      await sleep(INTERVAL_MS);
      let got;
      try { got = await fetchRank(+type, nick); }
      catch (e) { fail++; console.warn(`  [${nick}] ${type} 실패: ${e.message}`); continue; }
      const t = got.t || new Date().toISOString();
      const r = got.r;
      const h = p[type] = p[type] || { pts: [], best: null, days: {} };
      const pt = [t, r ? r.div : null, r ? r.rank : null, r ? r.score : null];
      // 같은 기준 시각이면 덮어씀 (데이터센터가 아직 갱신 전이면 중복 기록 방지)
      if (h.pts.length && h.pts[h.pts.length - 1][0] === t) h.pts[h.pts.length - 1] = pt; else h.pts.push(pt);
      h.pts = h.pts.filter((x) => new Date(x[0]).getTime() >= cutoff);
      if (r && r.score != null) {
        ranked++;
        if (!h.best || r.score > h.best.score) h.best = { t, div: r.div, rank: r.rank, score: r.score };
        const d = kstDate(t), prev = h.days[d];
        h.days[d] = prev
          ? [Math.max(prev[0], r.score), Math.min(prev[1], r.rank), Math.min(prev[2], r.div)]
          : [r.score, r.rank, r.div];
      }
      ok++;
    }
  }
  // 명단에서 빠진 클럽원은 기록 정리
  const live = new Set(members.map((m) => m.ouid));
  for (const id of Object.keys(hist.players)) if (!live.has(id)) delete hist.players[id];

  hist._comment = "클럽원 등급·순위·랭킹 점수 기록 (scripts/rank-history.js, 매시). pts=[기준시각, 등급번호, 순위, 점수] 최근 7일 · best=역대 최고 · days=일별(KST) [최고점수, 최고순위, 최고등급번호]. 등급번호 = divisions 순서";
  hist.updated = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(hist));
  console.log(`✅ 등급 기록: 조회 ${ok}건 (랭킹 등재 ${ranked}) · 실패 ${fail}`);
  if (!ok && fail) process.exit(1);
}

main().catch((e) => { console.error("[치명] 등급 기록 실패:", e); process.exit(1); });
