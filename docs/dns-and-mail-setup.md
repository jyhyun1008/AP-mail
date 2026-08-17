# DNS, Postfix, 리버스 프록시 설정

서버/DNS 관리는 익숙하신 걸 전제로 쓰고, **Postfix(메일 서버)는 처음이라는 전제로**
개념부터 풀어서 설명합니다.

## 전체 그림

메일 서버(Postfix)가 하는 일은 딱 두 가지입니다:

1. **받기**: `<아무개>@mail.example.com`으로 온 메일을 받아서, 원래처럼 로컬
   메일함에 저장하는 대신 → 우리 브릿지 프로세스한테 SMTP로 그대로 넘겨줌.
2. **보내기**: 브릿지가 "이 답장 메일 좀 보내줘"라고 Postfix한테 넘기면 → Postfix가
   실제로 인터넷에 있는 상대 메일서버(Gmail 등)한테 SMTP로 배달해줌.

즉 Postfix는 "진짜 메일함 서버"가 아니라 **브릿지 앞뒤에 붙는 SMTP 배달부**
역할만 합니다. 실제 메일함이나 IMAP 같은 건 전혀 필요 없어요.

## 1. DNS

`BRIDGE_DOMAIN`(전용 서브도메인, 예: `mail.example.com`)에 등록:

| 레코드 | 값 | 왜 필요한가 |
|---|---|---|
| `A`/`AAAA` | `mail.example.com` → 브릿지 서버 IP | 브라우저/다른 서버가 `mail.example.com`을 IP로 찾을 수 있게 (HTTPS용) |
| `MX` | `mail.example.com` → `mail.example.com`, 우선순위 10 | "이 도메인으로 메일 보낼 땐 이 서버로 접속해라"라고 알려주는 레코드. 이게 없으면 아무도 우리한테 메일을 못 보냄 |
| `TXT` (SPF) | `v=spf1 mx ~all` | "이 도메인 이름으로 메일 보낼 수 있는 서버는 이거다"라는 허가 목록 |
| `TXT` (DKIM) | 2단계에서 키 만들고 나서 등록 | Postfix가 서명한 메일의 서명을 검증할 공개키 |
| `TXT` (DMARC) | `_dmarc.mail.example.com` → `v=DMARC1; p=none; rua=mailto:you@wherever` | SPF/DKIM 검증 실패하면 어떻게 하라는 정책 |

메일 서버 IP의 **역방향 DNS(PTR)**도 이 메일 호스트명으로 향하게 하세요(프로바이더가
지원하면) — SPF/DKIM보다도 전달률에 영향이 큽니다.

**새 도메인/IP로 처음 보내는 메일은 위 3개(SPF/DKIM/DMARC)를 다 맞게 설정해도 초반엔
Gmail/Outlook 스팸함으로 갈 확률이 높습니다.** 설정이 틀려서가 아니라 "신뢰도
(reputation)"가 아직 없어서 그런 거고, 정상적으로 소량씩 계속 보내다 보면 몇 주에
걸쳐 좋아집니다.

## 2. Postfix 설치 & 개념

### 설치

```bash
apt install postfix opendkim opendkim-tools    # Debian/Ubuntu 기준
```

설치 중에 "Internet Site" 같은 걸 물어보는 위저드가 뜨면 Internet Site 선택하고,
메일 이름은 `mail.example.com`으로 넣으세요. 나중에 아래에서 다시 손보니 대충
넘어가도 됩니다.

### 설정 파일이 두 개인 이유

- `/etc/postfix/main.cf` — 전역 설정 (도메인, 보안, 어떤 메일을 받을지 등)
- `/etc/postfix/master.cf` — 어떤 서비스가 어떤 포트에서 돌지 (기본값 거의 안 건드림)

우리가 만질 건 거의 다 `main.cf`고, 아래 별도 파일(`transport`)도 하나 만듭니다.

### "받기": transport_maps가 하는 일

Postfix는 원래 자기가 책임지는 도메인(`mydestination`이나 `virtual_mailbox_domains`에
등록된 도메인)으로 온 메일을 **로컬 유닉스 계정 메일함에 저장**하려고 합니다. 근데
우리는 그걸 원하는 게 아니라 "이 도메인으로 온 메일은 저장하지 말고 우리 브릿지
프로세스한테 SMTP로 던져줘"를 원하죠. 그래서 `transport_maps`로 이 도메인만
예외 처리를 합니다:

```
# /etc/postfix/main.cf
virtual_mailbox_domains = mail.example.com
transport_maps = hash:/etc/postfix/transport
```

```
# /etc/postfix/transport
mail.example.com   smtp:<브릿지-호스트>:<INBOUND_SMTP_PORT>
```

`transport` 파일의 문법은 "도메인 → 어떻게 배달할지"이고, `smtp:host:port`는
"그냥 평범한 SMTP로 저 주소한테 넘겨라"라는 뜻입니다 (로컬 배달이 아니라).

Postfix는 이 텍스트 파일을 그때그때 읽지 않고 성능을 위해 컴파일된 DB 형태로
읽습니다. 그래서 파일을 고칠 때마다 아래 명령으로 다시 컴파일해줘야 반영됩니다:

```bash
postmap /etc/postfix/transport   # transport.db 생성/갱신
systemctl reload postfix          # 연결 안 끊고 설정만 다시 읽음
```

- **Postfix가 브릿지랑 같은 서버**: `<브릿지-호스트>` = `127.0.0.1`,
  `<INBOUND_SMTP_PORT>` 기본값 `2525` — `.env` 기본값이랑 그대로 맞음.
- **Postfix가 다른 서버**: `<브릿지-호스트>` = 브릿지의 실제 호스트명/IP고,
  브릿지 쪽 Docker 설정에서 그 포트를 `127.0.0.1`에만 걸어두지 말고 실제로 열어줘야
  합니다(맨 아래 Docker 섹션 참고) — 아무한테나 열지 말고 이 Postfix 서버 IP로만
  방화벽 제한하세요.

`mail.example.com`이 다른 `virtual_alias_maps`/캐치올(catch-all) 설정에 이미
걸려서 이 transport 규칙보다 먼저 가로채이는 건 아닌지 한 번 확인하세요.

### DKIM: 밀터(milter)라는 플러그인 개념

DKIM은 나가는 메일 헤더에 **암호 서명**을 붙이는 겁니다 — 받는 쪽이 그 서명을
DNS에 공개된 공개키로 검증해서 "이 메일이 정말 이 도메인에서 보낸 게 맞고 중간에
변조 안 됐다"를 확인할 수 있게요. 이 서명 작업 자체는 Postfix가 직접 안 하고,
`opendkim`이라는 별도 프로그램이 **밀터(milter)**라는 플러그인 인터페이스로
Postfix에 꽂혀서, 메일이 Postfix를 지나갈 때 가로채서 서명을 붙여줍니다.

```bash
mkdir -p /etc/opendkim/keys
opendkim-genkey -b 2048 -d mail.example.com -s mail -D /etc/opendkim/keys
# /etc/opendkim/keys/mail.txt 안에 등록할 TXT 레코드 내용이 들어있음
# (mail._domainkey.mail.example.com)
```

그다음 `/etc/opendkim.conf`에서 도메인/키 경로 지정하고, `main.cf`에
milter 연결 두 줄 추가:

```
# /etc/postfix/main.cf
milter_default_action = accept
milter_protocol = 6
smtpd_milters = inet:localhost:8891
non_smtpd_milters = inet:localhost:8891
```

(포트 8891은 opendkim 기본값 — `/etc/opendkim.conf`의 `Socket` 값과 맞춰야 함)

```bash
systemctl restart opendkim postfix
```

### "보내기": 브릿지가 Postfix한테 메일을 넘길 때

```
# .env
MAIL_RELAY_HOST=...
MAIL_RELAY_PORT=587
```

- **같은 서버**: `main.cf`의 `mynetworks`에 `127.0.0.1/32`가 들어있는지 확인하세요
  (`postconf mynetworks`로 현재 값 확인 가능) — 있으면 Postfix가 로컬에서 오는
  건 인증 없이 릴레이해줍니다. Docker로 배포한다면 `127.0.0.1` 대신
  `MAIL_RELAY_HOST=host.docker.internal`을 쓰세요.
- **다른 서버**: "로컬이니까 믿어준다"는 네트워크 너머로는 안 통합니다.
  `.env`에 `MAIL_RELAY_USER`/`MAIL_RELAY_PASS`를 채우고, Postfix의 587
  (submission) 포트가 SMTP AUTH를 요구하도록 설정하세요 (`smtpd_sasl_auth_enable
  = yes` 등 — SASL 인증 계정 만드는 것까지 필요하면 알려주시면 그 부분도 같이
  정리해드릴게요).

## 3. 문제가 생기면 (Postfix 처음이라 막힐 만한 것들)

```bash
postconf -n              # 기본값 아닌 실제 적용된 설정만 보기
journalctl -u postfix -f # 실시간 로그 (또는 tail -f /var/log/mail.log)
mailq                    # 큐에 걸려서 안 나간 메일 확인
```

- 메일이 아예 안 옴: `journalctl -u postfix -f` 켜놓고 밖에서 테스트 메일 보내보기.
  연결 자체가 안 잡히면 25번 포트 방화벽/클라우드 보안그룹 문제일 확률이 높음.
- 손으로 SMTP 대화해보고 싶으면:
  ```bash
  nc mail.example.com 25
  # EHLO test
  # MAIL FROM:<you@somewhere.com>
  # RCPT TO:<jay@mail.example.com>
  # DATA
  # Subject: test
  #
  # hello
  # .
  ```
  `RCPT TO` 단계에서 거부되면 `transport`/`virtual_mailbox_domains` 설정을,
  `DATA` 이후 응답이 이상하면 브릿지 쪽(`INBOUND_SMTP_PORT`가 실제로 열려있는지)을
  의심하세요.
- 나가는 메일이 큐에 계속 쌓임(`mailq`에 남아있음): 십중팔구 상대 서버 연결
  실패(포트 25 아웃바운드 차단 등) — 로그에 이유가 찍힙니다.

## 4. 리버스 프록시

브릿지 HTTP 포트(`HTTP_PORT`, 기본 8080) 앞에 TLS 붙여서 `mail.example.com`
서버 블록 하나만 추가하면 됩니다. 경로 라우팅 필요 없이 전부 그대로 프록시.

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

`Host` 헤더 그대로 전달되는지만 확인하세요 — 브릿지 액터 ID가 `BRIDGE_DOMAIN`
기준으로 만들어지는데 실제 접속 호스트랑 일치해야 합니다.

## 5. Misskey 쪽 확인

[misskey-followup-caveat.md](./misskey-followup-caveat.md) 참고 — 위에 걸 다
해놓은 다음 실제로 눈으로 확인해야 하는 부분입니다.

## 6. Docker: 같은 서버 vs 원격 Postfix

`docker/docker-compose.yml`은 일반 Docker 브리지 네트워크로 뜹니다 (Postfix 위치를
미리 가정하지 않으려고 `network_mode: host`는 안 씀):

- **Postfix가 같은 서버, Docker 밖**: compose 파일 기본값(`127.0.0.1:...` 포트
  바인딩) 그대로 쓰면 됨 — Postfix는 `127.0.0.1:<INBOUND_SMTP_PORT>`로 접속,
  브릿지는 `MAIL_RELAY_HOST=host.docker.internal`로 Postfix에 접속 (compose의
  `extra_hosts` 항목이 Linux에서도 이게 되게 해줌).
- **Postfix가 완전히 다른 서버**: `docker/docker-compose.yml`의 `ports:`에서
  `127.0.0.1:` 접두어를 빼서 열어주고(그 Postfix 서버 IP로 방화벽 제한),
  `.env`의 `MAIL_RELAY_HOST`/`USER`/`PASS`를 그 서버 기준으로 채우세요.

어느 쪽이든 `.env`의 `INBOUND_SMTP_HOST`는 안 건드려도 됩니다 — compose 파일이
알아서 `0.0.0.0`으로 덮어씁니다.
