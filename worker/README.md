# 도륙 관리자 Worker 배포 가이드

관리자(회장·클럽장·부클럽장)가 웹에서 클럽원을 등록/삭제할 수 있게 하는 Cloudflare Worker입니다.
비밀번호 인증 후, 넥슨 닉→ouid 변환과 `data/members.json` 커밋을 대신 수행합니다.
**넥슨 API 키·GitHub 토큰은 Worker 시크릿에만 저장되어 브라우저·저장소에 노출되지 않습니다.**

## 1. 사전 준비
- Cloudflare 무료 계정
- GitHub Fine-grained PAT: 이 저장소의 **Contents: Read and write** 권한만 부여
- Node.js 설치 (wrangler 실행용)

## 2. 설치 & 로그인
```bash
cd worker
npm install -g wrangler   # 또는 npx 사용
wrangler login
```

## 3. 변수 확인 (wrangler.toml)
- `GH_REPO` = `johnlee-korea/dor6-club`
- `GH_BRANCH` = `main`
- `ALLOWED_ORIGIN` = `https://johnlee-korea.github.io` (Pages 도메인)

## 4. 시크릿 등록
```bash
wrangler secret put ADMIN_PASSWORD    # 관리자 비밀번호
wrangler secret put NEXON_API_KEY     # 넥슨 오픈 API 키
wrangler secret put GH_TOKEN          # 위에서 만든 Fine-grained PAT
wrangler secret put JWT_SECRET        # 긴 랜덤 문자열 (예: openssl rand -hex 32)
```

## 5. 배포
```bash
wrangler deploy
```
배포되면 `https://dor6-club-admin.<계정>.workers.dev` 같은 URL이 출력됩니다.

## 6. 프론트 연결
`js/common.js`의 `DOR6.workerUrl` 값에 위 Worker URL을 넣고 커밋하세요.
```js
workerUrl: "https://dor6-club-admin.<계정>.workers.dev",
```

## 엔드포인트
| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/login` | `{password}` → `{token}` |
| POST | `/resolve` | `{nickname}` → `{ouid}` (인증 필요) |
| POST | `/members` | `{action:"add"|"delete", ...}` → 커밋 (인증 필요) |
