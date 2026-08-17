# 아키텍처

apmail은 이메일과 Misskey 계정을 이어주는 개인용 브릿지고, 직접 구현한 단일 ActivityPub
액터("봇") 하나를 중심으로 돌아갑니다. 이건 Misskey 계정이 **아니에요** — 딱 하나의
다른 액터(내 진짜 Misskey 계정, `ALLOWED_ACTOR_URI`)하고만 대화하는 작은 독립형 AP
서버입니다.

## 정체성(identity)

- 봇의 AP 핸들이랑 인바운드 이메일 주소는 **똑같은 문자열**이 되도록 설계했습니다:
  `<BRIDGE_USERNAME>@<BRIDGE_DOMAIN>`이 `mailto:` 주소이기도 하고, 앞에 `@`만 붙이면
  연합우주 핸들(`@jay@mail.example.com`)이기도 해요.
- 자기만의 서브도메인(`BRIDGE_DOMAIN`, 예: `mail.example.com`)에서 돌아가는데, 이건
  Misskey 인스턴스 자체 도메인의 WebFinger/액터 경로랑 절대 안 겹치게 하려는 목적이
  큽니다.
- RSA-2048 키쌍은 최초 부팅 시 한 번만 생성돼서 디스크에 저장됩니다 (Mastodon 기본
  액터 키 크기랑 동일; 4096은 엔트로피 부족한 환경(홈서버/최소 VM 등)에서 키 생성 자체가
  무한정 멈출 수 있어서 일부러 안 씀)
  (`ACTOR_PRIVATE_KEY_PATH`/`ACTOR_PUBLIC_KEY_PATH`) — `src/actor/keys.ts` 참고.

## 인바운드 흐름: 메일 → DM

```
발신자 ──SMTP──▶ Postfix ──SMTP (transport_maps)──▶ src/mail/smtp-listener.ts
                                                            │ 파싱 (src/mail/parse.ts)
                                                            ▼
                                          src/bridge/email-to-dm.ts
                                            ├─ 첨부파일 릴레이 여부 판단 (src/bridge/attachment-relay.ts)
                                            ├─ DM 본문 구성 + 정제(sanitize)
                                            ├─ Create{Note} 생성 (src/bridge/outbound-note.ts)
                                            └─ 서명 후 내 Misskey inbox로 POST (src/bridge/deliver-note.ts)
                                                            │
                                                            ▼
                                          notes 테이블: 이 Note의 id ↔ 발신자 이메일
```

이 Note는 `to: [ALLOWED_ACTOR_URI]`로만 주소가 지정되고 `cc: Public`은 없습니다 — 이게
Misskey가 이걸 공개 게시물이 아니라 DM으로 렌더링하게 만드는 핵심입니다.

## 아웃바운드 흐름: Misskey 답장 → 메일

```
Misskey에서 답장 ──Create{Note}──▶ POST /users/:username/inbox (src/routes/inbox.route.ts)
                                              │ HTTP Signature 검증 (src/signatures/verify.ts)
                                              │ — 네트워크 요청 나가기 *전에* keyId의 액터가
                                              │   ALLOWED_ACTOR_URI인지부터 확인 (SSRF 방어)
                                              ▼
                                     src/bridge/inbound-activity.ts
                                       ├─ actor/서명자 일치 확인, 허용 목록 확인
                                       └─ Create{Note} → src/bridge/dm-reply-to-email.ts
                                                            │ 스레드 해석 (src/bridge/thread-resolver.ts,
                                                            │   parent_note_id를 WITH RECURSIVE로 거슬러 올라감)
                                                            ▼
                                                     src/mail/send.ts → Postfix → 원래 발신자
```

## 저장되는 데이터

- `notes` 테이블 (SQLite, `src/store/schema.sql`): 양방향 Note 하나당 한 행. 루트 행
  (인바운드 메일에서 생긴 것)은 `sender_email`/`subject`/`email_message_id`/
  `email_references`를 갖고 있고, 답장 행은 `note_id`/`parent_note_id`만 가진 채로
  재귀적으로 루트를 찾아 올라갑니다. **메일/DM 본문 텍스트는 절대 저장 안 함** — 메타데이터뿐이라
  무기한 보관하기로 명시적으로 정함.
- `actor_key_cache` 테이블: 허용된 액터 딱 하나의 공개키+inbox URL을 TTL 캐시로 저장.
- 첨부파일(릴레이된 경우): `ATTACHMENTS_DIR` 아래에 파일당 UUID 디렉터리 하나씩,
  `ATTACHMENTS_RETENTION_DAYS`(기본 30일) 지나면 자동 삭제 — `notes` 테이블의 무기한
  보관과는 별개.

## 왜 봇 쪽을 Mastodon/Misskey API로 안 만들었나

봇 정체성을 진짜 Misskey 계정으로 안 만들고 순수 AP 액터로 직접 구현하기로 한 건
의도적인 선택이었습니다: 실제 계정을 하나 더 등록하면 결국 그것도 Misskey를 통해
관리(봇 플래그, API 토큰, 팔로우 상태)해야 하는데, 이 봇이 하는 일은 사실상 활동 타입
두 개(`Create{Note}` 발신, `Create{Note}`/`Follow` 수신)뿐이에요. 이 딱 하나의
목적을 위한 릴레이라면, 약 600줄짜리 직접 구현 액터가 Misskey 계정 하나의 전체
라이프사이클을 붙잡고 씨름하는 것보다 오히려 다뤄야 할 표면적이 더 작았습니다.
