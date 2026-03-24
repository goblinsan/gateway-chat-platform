# ---- Build stage ----
FROM node:20-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json ./packages/shared/package.json
COPY apps/chat-ui/package.json ./apps/chat-ui/package.json

RUN pnpm install --frozen-lockfile

COPY packages/shared ./packages/shared
COPY apps/chat-ui ./apps/chat-ui

RUN pnpm --filter @gateway/chat-ui build

# ---- Serve stage ----
FROM nginx:1.25-alpine
COPY --from=builder /app/apps/chat-ui/dist /usr/share/nginx/html
COPY apps/chat-ui/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
