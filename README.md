# apmail

개인용 메일 ↔ 연합우주(Misskey) DM 브릿지.

`<BRIDGE_USERNAME>@<BRIDGE_DOMAIN>`으로 메일을 보내면 내 Misskey 계정에 다이렉트 메시지로
도착합니다. 이건 별도로 만든 작은 봇 액터(`@<BRIDGE_USERNAME>@<BRIDGE_DOMAIN>`)가 보내는
거예요. 그 DM에 Misskey에서 답장하면 원래 보낸 사람의 이메일 주소로 회신이 가는데,
`In-Reply-To`/`References` 헤더로 제대로 스레딩까지 됩니다.

혼자 쓰는 걸 전제로 설계했습니다 — 어떻게/왜 이렇게 만들었는지는
[docs/architecture.md](./docs/architecture.md) 참고.

## 진행 상황

기능 마일스톤 3개 다 끝났고 테스트도 붙였습니다:

- **M1** — AP 액터 정체성, WebFinger, HTTP Signature 서명/검증
- **M2** — 메일 수신 → DM 발송, 첨부파일 릴레이
- **M3** — Misskey 답장 → 메일 발송, 중첩 답글까지 스레드 추적
- **M4** (이번) — 보안 강화, Docker 패키징, 문서화

## 로컬 개발 빠른 시작

```bash
npm install
cp .env.example .env   # 최소한 BRIDGE_DOMAIN, BRIDGE_USERNAME, ALLOWED_ACTOR_URI는 채워야 함
npm run dev             # tsx watch, 빌드 없이 바로 실행
```

```bash
npm test          # vitest — 유닛+통합 테스트 42개
npm run typecheck  # src/ + test/ + scripts/ 전체 타입 체크 (tsconfig.typecheck.json 참고)
npm run build      # tsc -> dist/, schema.sql도 같이 복사됨
```

`npm run gen-keys`는 서버 전체를 안 띄우고 액터 RSA 키만 미리 생성합니다.
`npm run smoke:send-note`는 실제로 설정된 `ALLOWED_ACTOR_URI`로 테스트 DM을 보내봅니다 —
배포 직후에 확인용으로 쓰면 좋아요
([docs/misskey-followup-caveat.md](./docs/misskey-followup-caveat.md) 참고).

**중요**: Docker로 배포했다면 이 스모크 테스트는 반드시 컨테이너 **안에서** 돌리세요:

```bash
docker compose -f docker/docker-compose.yml exec apmail node dist/scripts/smoke-test-send-note.js
```

호스트에서 그냥 `npm run smoke:send-note`(tsx)를 돌리면 컨테이너 안의 진짜 키/DB가 아니라
호스트에 **별도의 새 액터 정체성**을 만들어서 테스트하게 되어, 실제로 배포된 봇과
다른 봇으로 테스트하는 셈이 됩니다 — 결과가 의미 없거나 오히려 헷갈리는 원인이 될 수
있어요. 로컬 개발(Docker 없이 그냥 `npm run dev`로 작업 중)일 때만 호스트에서
`npm run smoke:send-note`를 쓰세요.

## 배포하기

내가 소유한 도메인(브릿지 전용 서브도메인용), 서버, 자체 운영하는 Postfix가 필요합니다 —
이건 브릿지가 대신 해주지 않아요. 중요한 건 **이 중 어느 것도 Misskey 인스턴스랑 같은 곳에
있을 필요가 없다**는 점이에요 — 브릿지는 Misskey랑 그냥 일반적인 HTTPS 페더레이션으로만
대화합니다, 다른 ActivityPub 서버끼리 그렇듯이요. 실제로 어딘가에 있어야만 하는 유일한
존재는 Postfix인데, 이것도 브릿지랑 같은 서버든 별도 서버든 둘 다 지원합니다
([docs/dns-and-mail-setup.md](./docs/dns-and-mail-setup.md) 참고).

1. [docs/dns-and-mail-setup.md](./docs/dns-and-mail-setup.md) — DNS 레코드, Postfix
   설정(같은 서버/원격 서버 둘 다), 리버스 프록시.
2. `docker/docker-compose.yml` — 독립 실행형, 다른 데 병합할 필요 없음.
3. [docs/misskey-followup-caveat.md](./docs/misskey-followup-caveat.md) — 코드로는
   보장 못 하고 배포 후 직접 눈으로 확인해야 하는 유일한 부분.
4. [docs/runbook.md](./docs/runbook.md) — 재배포, 로그 확인, 키 로테이션, DB 조회,
   첨부파일 보존 정책.

```bash
cp .env.example .env   # 실제 값으로 먼저 채우기
docker compose -f docker/docker-compose.yml --env-file .env up -d --build
```

## 설정

모든 설정은 환경변수입니다 — 전체 목록과 기본값/설명은
[.env.example](./.env.example) 참고. 필수 값(`BRIDGE_DOMAIN`, `BRIDGE_USERNAME`,
`ALLOWED_ACTOR_URI`)이 없으면 `src/config.ts`가 부팅 시점에 바로 에러를 냅니다.

## 일부러 안 만든 것들

- 다중 사용자/다중 수신자 지원 — `ALLOWED_ACTOR_URI`는 하드코딩된 단일 허용 액터입니다,
  의도적으로 그렇게 설계함 ([docs/architecture.md](./docs/architecture.md) 참고).
- `ATTACHMENTS_MAX_TOTAL_BYTES`(기본 메일당 8MB)보다 큰 첨부파일 릴레이 — 저장/링크
  대신 DM 텍스트에 파일명만 표시됨.
- 실패한 AP 전송 재시도 — 실패하면 로그만 남기고 재시도는 안 함.
- 앱 자체의 요청 제한(rate limiting) — 개인용/저트래픽 전제라 리버스 프록시 단에서
  하는 걸 권장 (dns-and-mail-setup.md 참고).
