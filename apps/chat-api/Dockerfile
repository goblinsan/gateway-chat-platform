FROM node:20-bookworm-slim AS builder
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@9 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/chat-api/package.json ./apps/chat-api/package.json

RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/chat-api ./apps/chat-api

RUN pnpm --filter @gateway/chat-api prisma:generate
RUN pnpm --filter @gateway/chat-api build

FROM node:20-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@9 --activate
WORKDIR /app

COPY --from=builder /app /app

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/chat-api/dist/server.js"]
