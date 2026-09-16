# Явный Dockerfile для Timeweb Cloud Apps (режим "Dockerfile").
#
# Автоматическая сборка Timeweb для Next.js рассчитана только на статический
# экспорт: она удаляет ВСЕ директории node_modules из финального образа,
# включая самодостаточный node_modules внутри .next/standalone, из-за чего
# SSR-приложению нечем запускаться. Явный Dockerfile — способ Timeweb
# развернуть полноценное (не статическое) Next.js-приложение.
#
# Основано на официальном примере Next.js для standalone-сборки в Docker.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* переменные вшиваются в клиентский бандл на этапе сборки,
# поэтому их нужно передать как build args, если Timeweb Apps это позволяет
# для режима Dockerfile. См. пояснение в ответе.
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
