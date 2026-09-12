-- Расширения, enum-типы и общий триггер обновления updated_at.

create extension if not exists pgcrypto with schema extensions;

do $$
begin
  create type public.project_role as enum ('owner', 'member');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.task_status as enum ('new', 'planned', 'in_progress', 'paused', 'completed', 'cancelled');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.movement_kind as enum ('receipt', 'consumption', 'adjustment');
exception
  when duplicate_object then null;
end
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
