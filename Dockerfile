# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# --- All dependencies (the Prisma schema is needed by the postinstall `prisma generate`).
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# --- Production build (standalone output).
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm exec prisma generate && pnpm build

# --- Prisma CLI on its own, used only to apply migrations when the container starts.
FROM base AS migrator
WORKDIR /migrate
COPY package.json /tmp/package.json
RUN npm init -y >/dev/null \
    && npm install --no-audit --no-fund \
       "prisma@$(node -p "require('/tmp/package.json').devDependencies.prisma")"
COPY prisma.config.ts ./
COPY prisma ./prisma

# --- Runtime image.
FROM node:22-alpine AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    CHECKPOINT_DISABLE=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apk add --no-cache openssl
WORKDIR /app

COPY --from=migrator --chown=node:node /migrate /migrate
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --chown=node:node docker-entrypoint.sh ./

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --start-interval=2s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]
