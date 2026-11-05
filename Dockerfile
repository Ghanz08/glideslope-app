# Glideslope: Next.js app (standalone) and the LLM worker, from one build.
# Server-only env (Supabase URL/keys, LLM, OCR, Google) is read at runtime; nothing secret is baked in.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm run build:functions

# ---- web: the standalone server only
FROM node:22-alpine AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/masuk >/dev/null || exit 1
CMD ["node", "server.js"]

# ---- worker: LLM queue (needs 9router on the host) and one-off scripts (migrations, owner)
FROM node:22-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app package.json tsconfig.json ./
COPY --chown=app:app src ./src
COPY --chown=app:app scripts ./scripts
COPY --chown=app:app tests/e2e/helpers.ts ./tests/e2e/helpers.ts
COPY --chown=app:app supabase ./supabase
COPY --from=build --chown=app:app /app/supabase/functions/_shared/core.js ./supabase/functions/_shared/core.js
USER app
CMD ["npx", "tsx", "scripts/llm-worker.mts"]
