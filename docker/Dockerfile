# syntax=docker/dockerfile:1

# --- builder: TypeScript 컴파일 -------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# --- prod-deps: 프로덕션 전용 node_modules + 네이티브 모듈 빌드 도구 -------
# better-sqlite3는 네이티브 애드온입니다. 특정 플랫폼/아키텍처/Node ABI 조합에서는
# 미리 빌드된 바이너리 다운로드가 실패할 수 있어서, C++ 툴체인을 여기서 설치해
# 어떤 경우든 빌드가 되도록 보장합니다 — 이 스테이지(그리고 툴체인)는 최종
# 이미지에는 절대 포함되지 않습니다.
FROM node:22-slim AS prod-deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- runtime -----------------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN groupadd --system apmail && useradd --system --gid apmail --uid 1001 apmail \
  && mkdir -p /data/keys /data/db /data/attachments \
  && chown -R apmail:apmail /data /app

COPY --from=prod-deps --chown=apmail:apmail /app/node_modules ./node_modules
COPY --from=builder --chown=apmail:apmail /app/dist ./dist
COPY --chown=apmail:apmail package.json ./

USER apmail

# 기본값은 docker/docker-compose.yml의 볼륨 마운트 경로와 맞춰져 있습니다. 이 외
# 나머지 설정(BRIDGE_DOMAIN, ALLOWED_ACTOR_URI, 메일 릴레이 설정 등)은 안전한
# 기본값이 없어서 env_file로 반드시 넘겨줘야 합니다 — .env.example 참고.
ENV HTTP_HOST=0.0.0.0 \
    HTTP_PORT=8080 \
    ACTOR_PRIVATE_KEY_PATH=/data/keys/actor-private.pem \
    ACTOR_PUBLIC_KEY_PATH=/data/keys/actor-public.pem \
    DB_PATH=/data/db/apmail.sqlite \
    ATTACHMENTS_DIR=/data/attachments

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HTTP_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# scripts/gen-actor-keys.ts, scripts/smoke-test-send-note.ts compile alongside src/
# (see tsconfig.json's rootDir/include) specifically so they're runnable in here with
# the container's real .env/keys/DB — e.g.
# `docker compose exec apmail node dist/scripts/smoke-test-send-note.js` — rather than
# only being runnable via `tsx` on a dev machine, which would spin up a *different*
# actor identity than whatever's actually deployed.
CMD ["node", "dist/src/index.js"]
