# 운영 가이드 (Runbook)

apmail을 일상적으로 운영할 때 참고할 내용들입니다. Docker 배포
(`docker/docker-compose.yml`) 기준으로 썼고, bare-metal(직접 설치) 방식은 다른
부분만 따로 적었습니다.

## 코드 변경 후 재배포

```bash
git pull
docker compose -f docker/docker-compose.yml build apmail
docker compose -f docker/docker-compose.yml up -d apmail
```

액터 키쌍이랑 SQLite DB는 네임드 볼륨(`apmail-keys`, `apmail-db`,
`apmail-attachments`)에 있어서 컨테이너를 다시 만들어도 그대로 남습니다. 재배포
과정에서 이것들을 건드리는 부분은 없어요.

**Bare metal (Docker 없이)**: `npm run dev`나 터미널에서 그냥 `node`로 띄우면
SSH 세션 끊기거나 터미널 닫을 때 같이 죽습니다 — `systemd/apmail.service`
템플릿으로 상시 서비스 등록하세요 (그 파일 안 주석에 설치 방법 있음). 등록해두면
재배포는:

```bash
git pull && npm ci && npm run build
sudo systemctl restart apmail
```

## 로그 보기

```bash
docker compose -f docker/docker-compose.yml logs -f apmail
```

`pino`로 구조화된 JSON 로그가 나옵니다 — 읽기 편하게 보려면
`| npx pino-pretty`로 파이프하시고, 잠깐 더 자세히 보고 싶으면 `.env`에
`LOG_LEVEL=debug`로 설정하고 재시작하세요.

## 액터 키쌍 로테이션

가볍게 할 일은 아닙니다 — 지금까지 액터 문서를 가져간 모든 원격 서버가 **예전** 공개키를
캐시로 갖고 있고, Misskey/Mastodon 쪽에서 액터 정보 재조회를 언제 하는지는
구현마다 달라요. 그래도 꼭 로테이션해야 한다면 (키 유출이 의심되는 경우 등):

```bash
docker compose -f docker/docker-compose.yml exec apmail sh -c "rm /data/keys/actor-*.pem"
docker compose -f docker/docker-compose.yml restart apmail   # 다음 부팅 시 새 키쌍 생성
```

로테이션 후에는 Misskey 계정에서 봇을 다시 팔로우해야 할 가능성이 높습니다
([misskey-followup-caveat.md](./misskey-followup-caveat.md) 참고) — 예전 Follow
관계가 Misskey 쪽에 캐시된 예전 키의 액터 문서에 묶여있었기 때문이에요.

## SQLite DB 들여다보기

```bash
docker compose -f docker/docker-compose.yml cp apmail:/data/db/apmail.sqlite ./apmail.sqlite
sqlite3 apmail.sqlite "SELECT note_id, sender_email, subject, direction, created_at FROM notes ORDER BY created_at DESC LIMIT 20;"
```

또는 실행 중인 컨테이너에 바로 셸을 붙여도 됩니다: `docker compose -f
docker/docker-compose.yml exec apmail sh` (단, 런타임 이미지에는 `sqlite3` CLI가
안 들어있어요 — 위처럼 파일을 꺼내서 보거나, 컨테이너 안에서 직접 쓰고 싶으면
Dockerfile의 런타임 스테이지에 `sqlite3`를 추가하면 됩니다).

## 스레드 매핑이 "막혔을" 때 복구하기

Misskey에서 답장을 했는데 메일이 안 나가면, 브릿지 로그에
`"could not resolve reply to a known email thread; dropping"`이 찍힙니다 — 답장한
노트(또는 그 노트가 답장한 원본 노트를 재귀적으로 계속 거슬러 올라가도)가
`notes` 테이블에 없다는 뜻이에요. 이런 경우는:

- 이 브릿지에서 시작되지 않은 Misskey 노트에 답장한 경우.
- 원래 DM의 행이 어떤 이유로든 삭제된 경우 (코드상으로는 이걸 지우는 동작이 없음 —
  `notes` 테이블은 의도적으로 무기한 보관하게 설계했음 — 그러니 이런 경우면 DB를
  직접 손댄 게 아닌 이상 발생하기 어려움).

복구 수단은 딱히 없고, `notes` 테이블에 관련된 Misskey 노트 ID들을 직접 대조해서
`note_id`/`parent_note_id`/`sender_email`/`email_message_id`를 맞춰 직접
`INSERT`하는 것뿐입니다. 정상적으로 쓰다 보면 이런 일은 거의 안 생길 거예요.

## 첨부파일 보존 정책

첨부파일 바이너리는 하루에 한 번 자동으로 정리됩니다 (`ATTACHMENTS_RETENTION_DAYS`,
기본 30일) — `src/media/attachment-store.ts`의 `purgeExpiredAttachments`가
`src/index.ts`의 `setInterval`로 연결돼있어요. `notes` 테이블의 메타데이터
(발신자/제목/Message-ID)는 이 대상이 **아니고** 명시적으로 무기한 보관합니다 —
오래된 스레드의 첨부파일 링크는 정리되고 나면 404가 뜨지만, 스레드가 이후 답장을
계속 라우팅하는 능력에는 영향 없습니다(첨부파일은 스레드 해석 로직에 관여 안 함).

## 헬스체크

`GET /healthz` → HTTP 서버가 떠있으면 `{"status":"ok"}`. 지금은 DB나 SMTP 리스너
상태까지 확인하진 않아요 — 200이 온다고 해서 모든 하위 시스템이 다 정상이라는
보장은 아니고, 프로세스가 살아있고 응답 가능하다는 것만 확인해줍니다.
`docker compose ps`로 Docker 레벨의 헬스체크 상태도 볼 수 있습니다 (같은 엔드포인트를
`docker/Dockerfile`의 `HEALTHCHECK`가 사용).
