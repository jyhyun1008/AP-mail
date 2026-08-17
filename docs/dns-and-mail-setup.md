# DNS, Postfix, 리버스 프록시 설정

여기 나오는 건 전부 어느 서버에서 하든 한 번만 손으로 해줘야 하는 작업입니다 — 브릿지가
대신해주는 부분은 없어요.

**토폴로지 관련 참고**: 이 브릿지는 Misskey 인스턴스 근처에 있을 필요가 전혀 없습니다 —
둘은 그냥 일반적인 HTTPS 페더레이션(WebFinger + 서명된 액티비티)으로만 대화하고, 이건
서로 아무 관련 없는 AP 서버 두 개가 통신하는 것과 똑같아요. 실제로 어딘가 닿아있어야만
하는 유일한 존재는 Postfix인데, 어디에 둘지는 아래에서 같은 서버/별도 서버 두 경우 다
다룹니다.

## 1. DNS

브릿지를 올릴 도메인(`BRIDGE_DOMAIN` — 전용 서브도메인, 예: `mail.example.com`;
Misskey 인스턴스 도메인이랑 아무 관계 없어도 됨)에 등록:

| 레코드 | 값 |
|---|---|
| `A`/`AAAA` | `mail.example.com` → 브릿지가 돌아가는 서버 IP (HTTPS: WebFinger/액터/inbox/media용) |
| `MX` | `mail.example.com` → `mail.example.com`, 우선순위 10 (또는 전용 메일 호스트명) |
| `TXT` (SPF) | `v=spf1 mx ~all` (Postfix가 다른 걸 통해서도 릴레이한다면 조정 필요) |
| `TXT` (DKIM) | 2단계에서 `opendkim-genkey` 실행하고 나서 등록 |
| `TXT` (DMARC) | `_dmarc.mail.example.com` → 예: `v=DMARC1; p=none; rua=mailto:you@wherever` |

메일 서버의 **역방향 DNS(PTR)**도 메일 호스트명으로 향하게 설정하세요, 프로바이더가
허용한다면요 — 이게 다른 무엇보다 전달률(deliverability)에 큰 영향을 줍니다.

**신규 도메인/IP에서 나가는 메일은 SPF/DKIM/DMARC를 다 맞게 설정해도 처음엔 Gmail/
Outlook 등에서 스팸함으로 갈 가능성이 높습니다.** 이건 설정 실수가 아니라 신뢰도
(reputation)가 아직 안 쌓여서 그런 정상적인 현상이고, 정상적으로 소량씩 계속 보내다 보면
몇 주에 걸쳐 나아집니다. 완전히 새 도메인으로 시작하는 거라 이미 감안된 부분이에요.

## 2. Postfix

Postfix를 어디에 두는지에 따라 값 몇 개만 달라지고 설정 형태 자체는 똑같습니다.

**인바운드** — 브릿지 메일 도메인을 로컬 메일함 전달이 아니라 브릿지의 인바운드
SMTP 리스너로 라우팅:

```
# /etc/postfix/main.cf
virtual_mailbox_domains = mail.example.com
transport_maps = hash:/etc/postfix/transport
```

```
# /etc/postfix/transport
mail.example.com   smtp:<bridge-host>:<INBOUND_SMTP_PORT>
```

```
postmap /etc/postfix/transport
systemctl reload postfix
```

- **Postfix가 브릿지랑 같은 서버에 있을 때**: `<bridge-host>` = `127.0.0.1`,
  `<INBOUND_SMTP_PORT>`는 기본값 `2525` — `.env` 기본값이랑 그대로 맞음.
- **Postfix가 다른 서버에 있을 때**: `<bridge-host>` = 브릿지의 실제 호스트명/IP고,
  이 경우 브릿지의 Docker 배포에서 그 포트를 `127.0.0.1`에만 바인딩하지 말고 실제로
  네트워크에 열어줘야 합니다(아래 Docker 섹션 참고) — 아무한테나 열지 말고 이 Postfix
  서버 IP로만 방화벽을 제한하세요.

`mail.example.com`이 기존 `virtual_alias_maps`/캐치올(catch-all) 항목에 이미 걸려서
transport 규칙보다 먼저 가로채이는 건 아닌지 확인하세요.

**DKIM** (권장, `opendkim` 사용):

```
opendkim-genkey -b 2048 -d mail.example.com -s mail -D /etc/opendkim/keys
# 생성된 mail._domainkey.mail.example.com TXT 레코드를 등록
# opendkim을 Postfix의 milter 체인에 연결 (opendkim 자체 문서에 나와있음 —
# 이건 시스템 전체 Postfix 설정이라 이 브릿지에 국한된 게 아님)
```

**아웃바운드 발신** (회신 메일을 위해 브릿지도 Postfix를 통해 메일을 *내보냅니다* —
`.env`의 `MAIL_RELAY_HOST`/`MAIL_RELAY_PORT`):

- **Postfix가 같은 서버에 있을 때**: `main.cf`의 `mynetworks`에 `127.0.0.1/32`가
  포함돼 있는지 확인 (bare metal), 그러면 Postfix가 인증 없이 로컬 릴레이를
  허용합니다. Docker 배포라면 `127.0.0.1` 대신 `MAIL_RELAY_HOST=host.docker.internal`을
  써야 함 — Docker 섹션 참고.
- **Postfix가 다른 서버에 있을 때**: "로컬호스트니까 신뢰"는 네트워크 너머로는 안
  통합니다 — `.env`에 `MAIL_RELAY_USER`/`MAIL_RELAY_PASS`를 설정하고 Postfix의
  submission 포트(587)가 SMTP AUTH를 요구하도록 설정하세요.

## 3. 리버스 프록시

브릿지 앞단에는 TLS를 위한 리버스 프록시가 필요합니다 — 이미 다른 용도(Misskey든
뭐든)로 쓰고 있는 프록시를 재사용해도 되고, 전용으로 하나 새로 둬도 됩니다, 상관없어요.
`mail.example.com`용 서버 블록을 새로 추가해서 브릿지의 HTTP 포트(`HTTP_PORT`, 기본
8080)로 포워딩하면 됩니다. 경로 기반 라우팅은 필요 없고, 모든 경로
(`/.well-known/webfinger`, `/users/...`, `/media/...`, `/healthz`)를 그냥 다
넘겨주면 됩니다. 예시 (nginx):

```nginx
server {
    listen 443 ssl http2;
    server_name mail.example.com;

    ssl_certificate     /etc/letsencrypt/live/mail.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mail.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

프록시가 브릿지랑 다른 서버에 있다면 `proxy_pass`를 `127.0.0.1` 대신 브릿지의 실제
주소로 바꾸고, 그 포트가 거기서 실제로 닿는지 확인하세요(Docker 섹션의 포트 공개
관련 내용 참고).

`Host` 헤더가 그대로 전달되는지 꼭 확인하세요 — 브릿지의 액터 ID는 `BRIDGE_DOMAIN`에서
만들어지는데, 이게 실제로 접속 가능한 호스트랑 일치해야 합니다.

필수는 아니지만 인터넷에 노출된 엔드포인트니까 하면 좋은 것: `/users/`/`/inbox`/
`/.well-known/` 앞에 nginx `limit_req` 존을 걸어서 요청 속도 제한을 하고 싶다면 그렇게
하세요 — 브릿지 자체는 요청 제한을 안 합니다(개인용/저트래픽 전제로 설계했기 때문),
필요하면 프록시 단에서 처리하는 게 낫습니다.

## 4. Misskey 쪽 팔로우/원격 DM 수락 확인

[misskey-followup-caveat.md](./misskey-followup-caveat.md) 참고 — 위에 나온 걸 다
해놓은 뒤에 실제로 눈으로 확인해야만 하는 유일한 단계입니다.

## Docker: 같은 서버 vs 원격 Postfix

`docker/docker-compose.yml`은 (`network_mode: host`가 아니라) 일반적인 Docker
브리지 네트워크로 브릿지를 띄우는데, Postfix가 어디에 있을지 미리 가정하지 않으려고
일부러 이렇게 했습니다:

- **Postfix가 같은 서버, Docker 밖에서 돌아갈 때** (가장 흔한 경우): compose 파일의
  기본 포트 바인딩(`127.0.0.1:...`)이 그대로 동작합니다 — Postfix는
  `127.0.0.1:<INBOUND_SMTP_PORT>`로 브릿지에 접속하면 되고(bare-metal 방식과 완전히
  동일), 브릿지는 `MAIL_RELAY_HOST=host.docker.internal`로 Postfix에 접속합니다
  (compose 파일의 `extra_hosts` 항목이 이걸 제대로 되게 해주는데, Docker Desktop은
  이걸 자동으로 해주지만 Linux에서는 이렇게 명시해줘야 함).
- **Postfix가 완전히 다른 서버에 있을 때**: `docker/docker-compose.yml`의 `ports:`
  항목에서 `127.0.0.1:` 접두어를 빼서(호스트 바깥에서도 접근되게 — 대신 그 Postfix
  서버 IP로만 방화벽 제한) 열어주고, `.env`의 `MAIL_RELAY_HOST`/`MAIL_RELAY_USER`/
  `MAIL_RELAY_PASS`를 그 서버의 실제 주소와 SMTP AUTH 인증정보로 설정하세요.

어느 쪽이든 `.env`의 `INBOUND_SMTP_HOST`는 건드릴 필요 없습니다 — compose 파일이
알아서 `0.0.0.0`으로 덮어씁니다(그 파일의 주석 참고), Docker의 포트 공개 기능이
프로세스에 닿으려면 이게 필요해서 그래요.
