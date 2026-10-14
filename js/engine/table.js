/* ============================================================
   table.js — 라운드별 순위표
   순위 기준: 승점 → 득실차 → 다득점 → 승수 → id (마지막은 결정성용)
   ============================================================ */

const emptyRow = (id) => ({ id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, form: [] });

export function sortRows(rows) {
  return rows.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || b.w - a.w || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/* 라운드 0(개막 전)~R까지 순위표를 모두 계산
   teamIds: 팀 id 배열, rounds: 대진, results: 라운드별 경기 결과 배열(results[r][m])
   반환: tables[k] = 라운드 k까지 반영된 정렬된 행 배열 (각 행에 rank) */
export function buildTables(teamIds, rounds, results) {
  const rows = new Map(teamIds.map((id) => [id, emptyRow(id)]));
  const snap = () => sortRows([...rows.values()].map((r) => ({ ...r, form: r.form.slice(-5) }))).map((r, i) => ({ ...r, rank: i + 1 }));
  const tables = [snap()];
  rounds.forEach((rd, r) => {
    rd.matches.forEach((m, i) => {
      const res = results[r][i];
      apply(rows.get(m.home), res.hg, res.ag);
      apply(rows.get(m.away), res.ag, res.hg);
    });
    tables.push(snap());
  });
  return tables;
}

function apply(row, gf, ga) {
  row.p++; row.gf += gf; row.ga += ga; row.gd = row.gf - row.ga;
  if (gf > ga) { row.w++; row.pts += 3; row.form.push("W"); }
  else if (gf === ga) { row.d++; row.pts += 1; row.form.push("D"); }
  else { row.l++; row.form.push("L"); }
}
