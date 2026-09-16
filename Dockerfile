# Dockerfile для Timeweb Cloud App Platform (тип: backend).
#
# Next.js не входит в нативно поддерживаемые App Platform фреймворки для SSR
# (нативный пресет "Next.js" у Timeweb рассчитан только на статический
# экспорт и удаляет node_modules из образа), поэтому приложение
# разворачивается через Dockerfile — стандартный путь для fullstack
# Next.js на App Platform.
#
# Адаптация от общего шаблона templates/dockerfiles/node-backend.Dockerfile
# из скилла vibe-deploy: вместо копирования "dist" используется
# самодостаточная standalone-сборка Next.js (next.config.ts: output: "standalone"),
# т.к. у Next.js нет папки dist. Основано на официальном примере Next.js
# для standalone-сборки в Docker.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* переменные вшиваются в клиентский бандл на этапе сборки.
# Значения передаются из настроек приложения в App Platform Timeweb.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

RUN mkdir .next && chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
