/* ============================================================
   ranker-baseline.js — 플레이스타일 비교 기준(랭커 평균) 생성
   실행: node --env-file=.env scripts/ranker-baseline.js [--force]   (로컬)
         node scripts/ranker-baseline.js                             (CI)
   동작: 공식 랭킹 1~1000위(50페이지)에서 페이지마다 일정 간격으로 샘플링 →
         각 랭커의 최근 공식경기 상세로 지표 계산 → 지표별 평균·표준편차 저장
   산출: data/meta/ranker-baseline.json
   주기: 기존 파일이 config.rankerBaseline.refreshDays 이내면 건너뜀(API 호출 절약)
   참고: 넥슨 오픈 API에는 랭킹 목록이 없어 FC온라인 데이터센터 랭킹 페이지(HTML)에서 닉네임을 읽는다
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setCallInterval, getOuidByNickname, getMatchIds, getMatchDetail } from "./lib/nexon-api.js";
import { styleRaw, computeMetrics, baselineStats } from "./lib/playstyle.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "meta", "ranker-baseline.json");
const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
const opt = {
  pages: 50,          // 1페이지 = 20명 → 50페이지 = 상위 1000명
  perPage: 3,         // 페이지당 샘플 인원
  matchesPerUser: 15, // 랭커별 최근 공식경기 수
  minMatches: 5,      // 정상 종료 경기가 이보다 적은 랭커는 제외
  refreshDays: 7,
  ...(config.rankerBaseline || {})
};

/* 랭킹 페이지 한 장 → 닉네임 20개 */
async function rankPage(pg) {
  const res = await fetch(`https://fconline.nexon.com/datacenter/rank_inner?rt=manager&n4pageno=${pg}`,
    { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`랭킹 페이지 ${pg} 응답 ${res.status}`);
  const html = await res.text();
  return [...html.matchAll(/class="name profile_pointer"[^>]*>([^<]+)/g)].map((m) => m[1].trim());
}

async function main() {
  if (!process.argv.includes("--force") && fs.existsSync(OUT)) {
    const prev = JSON.parse(fs.readFileSync(OUT, "utf8"));
    const ageDays = (Date.now() - new Date(prev.updated).getTime()) / 86400000;
    if (ageDays < opt.refreshDays) {
      console.log(`⏭ 랭커 기준값 최신(${ageDays.toFixed(1)}일 전) — 건너뜀`);
      return;
    }
  }
  setCallInterval(config.apiCallIntervalMs || 250);

  // 1) 랭커 닉네임 샘플 (페이지 내 균등 간격)
  const step = Math.floor(20 / opt.perPage);
  const nicks = [];
  for (let pg = 1; pg <= opt.pages; pg++) {
    try {
      const names = await rankPage(pg);
      for (let i = 0; i < opt.perPage; i++) if (names[i * step]) nicks.push(names[i * step]);
    } catch (e) { console.warn(`  ${e.message}`); }
  }
  console.log(`▶ 랭커 샘플 ${nicks.length}명 — 공식경기 최근 ${opt.matchesPerUser}경기씩 조회`);

  // 2) 랭커별 지표
  const list = [];
  for (const nick of nicks) {
    try {
      const ouid = await getOuidByNickname(nick);
      if (!ouid) continue;
      const ids = await getMatchIds(ouid, 50, 0, opt.matchesPerUser);
      const raws = [];
      for (const id of ids) {
        const d = await getMatchDetail(id).catch(() => null);
        const info = (d && d.matchInfo) || [];
        const raw = styleRaw(info.find((i) => i.ouid === ouid), info.find((i) => i.ouid !== ouid));
        if (raw && raw.end === 0 && info.length === 2) raws.push(raw);
      }
      if (raws.length >= opt.minMatches) list.push(computeMetrics(raws));
    } catch (e) { console.warn(`  [${nick}] 실패: ${e.message}`); }
  }

  // 표본이 너무 적으면 기존 기준값 유지 (랭킹 페이지 구조 변경 등 대비)
  if (list.length < 20) {
    console.warn(`⚠ 유효 랭커 ${list.length}명 — 표본 부족, 기존 기준값 유지`);
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    updated: new Date().toISOString(),
    source: `공식 랭킹 1~${opt.pages * 20}위 샘플, 공식경기 최근 ${opt.matchesPerUser}경기`,
    sampleSize: list.length,
    stats: baselineStats(list)
  }, null, 2) + "\n");
  console.log(`✅ 랭커 기준값 저장 — 유효 랭커 ${list.length}명`);
}

main().catch((e) => { console.error("랭커 기준값 생성 실패:", e); process.exit(1); });
