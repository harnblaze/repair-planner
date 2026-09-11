# Repair Planner

Веб-приложение для планирования и управления работами ремонтно-строительного цеха. Описание продукта, архитектуры и модели данных — в [docs/](docs/).

## Стек

Next.js (App Router) · TypeScript · Tailwind CSS · shadcn/ui · Supabase (PostgreSQL, Auth, Storage) · React Hook Form · Zod · Vitest.

## Разработка

```bash
npm install
cp .env.example .env.local   # заполнить значениями из Supabase проекта
npm run dev
```

Откройте [http://localhost:3000](http://localhost:3000).

## Проверки

```bash
npm run lint        # ESLint
npx tsc --noEmit    # типы
npm run test        # Vitest
npm run build       # production build
```

## Supabase

Локально используется [Supabase CLI](https://supabase.com/docs/guides/local-development). Миграции лежат в `supabase/migrations`.

```bash
supabase start        # локальный стек Supabase (Docker)
supabase db reset      # применить миграции с нуля
```
