/* ============================================================
   notices.js — FC온라인 공지사항·개발자 노트 수집 (v2.10.0)
   - 하루 1회 notices.yml(GitHub Actions)에서 실행 → data/notices.json
   - 게시판 목록 1페이지만 읽고, 처음 보는 글만 상세를 열어 게시 시각 확정(이미 아는 글은 재사용)
   - 넥슨 API 키 불필요 (공식 홈페이지 HTML)
   저장 구조:
     updatedAt: 수집 시각 ISO
     boards[board] = { label, items: [{ sn, category, title, pinned, preview, date, url }] }  — 게시 시각 최신순
   실행: node scripts/notices.js
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NOTICE_BOARDS, listUrl, viewUrl, parseNoticeList, parsePublished } from "./lib/notice.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "notices.json");
const KEEP = 20;              // 게시판별 보관 개수
const INTERVAL_MS = 300;      // 홈페이지 요청 간격
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJSON = (f, fb) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } };

async function getHtml(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`응답 ${res.status} (${url})`);
  return res.text();
}

async function collectBoard(board, prevItems) {
  const known = new Map((prevItems || []).map((it) => [it.sn, it]));
  const list = parseNoticeList(await getHtml(listUrl(board)), board);
  if (!list.length) throw new Error("목록 파싱 결과 0건 — 홈페이지 구조 변경 가능성");

  const items = [];
  for (const it of list) {
    let date = known.get(it.sn) && known.get(it.sn).date;
    if (!date) {
      await sleep(INTERVAL_MS);
      try { date = parsePublished(await getHtml(viewUrl(board, it.sn))); }
      catch (e) { console.warn(`  [${board} ${it.sn}] 상세 실패: ${e.message}`); }
    }
    // 제목·미리보기는 수정될 수 있으니 항상 최신 목록 값 사용
    items.push({ ...it, date: date || null, url: viewUrl(board, it.sn) });
  }
  // 게시 시각 최신순 (시각 모르면 글 번호 순으로 뒤에)
  items.sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.sn - a.sn);
  return items.slice(0, KEEP);
}

async function main() {
  const prev = readJSON(OUT, { boards: {} });
  const out = { updatedAt: new Date().toISOString(), boards: {} };
  let fail = 0;
  for (const [board, info] of Object.entries(NOTICE_BOARDS)) {
    try {
      const items = await collectBoard(board, prev.boards && prev.boards[board] && prev.boards[board].items);
      out.boards[board] = { label: info.label, items };
      console.log(`  ${info.label}: ${items.length}건 (최신 ${items[0] && items[0].date})`);
    } catch (e) {
      fail++;
      console.error(`  ${info.label} 수집 실패: ${e.message}`);
      // 실패한 게시판은 이전 데이터 유지 → 화면이 비지 않게
      if (prev.boards && prev.boards[board]) out.boards[board] = prev.boards[board];
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`저장: ${path.relative(ROOT, OUT)}${fail ? ` (실패 ${fail}개 게시판 — 이전 값 유지)` : ""}`);
  if (fail === Object.keys(NOTICE_BOARDS).length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
