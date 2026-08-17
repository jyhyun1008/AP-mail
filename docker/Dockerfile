# syntax=docker/dockerfile:1

# --- builder: compile TypeScript -------------------------------------------------
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- prod-deps: production-only node_modules, with native module toolchain -------
# better-sqlite3 is a native addon. Its prebuilt-binary download can fail for a given
# platform/arch/Node ABI combination, so we install a C++ toolchain here to guarantee a
# working build regardless — this stage (and the toolchain) never reaches the final image.
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

# Defaults match docker/docker-compose.snippet.yml's volume mounts. All other config
# (BRIDGE_DOMAIN, ALLOWED_ACTOR_URI, mail relay settings, ...) has no safe default and
# must come from the env_file — see .env.example.
ENV HTTP_HOST=0.0.0.0 \
    HTTP_PORT=8080 \
    ACTOR_PRIVATE_KEY_PATH=/data/keys/actor-private.pem \
    ACTOR_PUBLIC_KEY_PATH=/data/keys/actor-public.pem \
    DB_PATH=/data/db/apmail.sqlite \
    ATTACHMENTS_DIR=/data/attachments

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HTTP_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
