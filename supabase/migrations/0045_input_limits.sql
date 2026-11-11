-- Ограничения длины текстовых полей (0045).
--
-- Лимиты до сих пор жили только в zod: клиент обрезал ввод, серверное действие
-- проверяло ещё раз. Но браузерный клиент Supabase ходит в PostgREST напрямую
-- с токеном пользователя, и любой участник проекта может вставить строку
-- длиной в мегабайт мимо всех проверок. Такие строки потом рендерятся в
-- списках и отчётах и раздувают базу, поэтому ограничение должно быть в схеме.
--
-- Числа совпадают с zod-схемами, чтобы поведение формы и API не расходилось:
--   full_name         120  — lib/validation/auth.ts
--   task description 5000  — lib/validation/task.ts (taskDescriptionSchema)
--   movement note     500  — lib/validation/reference-data.ts (movementNoteSchema)
--   board item note  1000  — lib/validation/board-item.ts
-- Для projects.description схемы нет, берём 2000 — с запасом к реальным
-- описаниям (в проде максимум 86 символов).
--
-- Данные проверены до добавления (прод: 17/0/22/37, локально: 22/86/57/20/39
-- символов), поэтому constraint'ы обычные валидирующие, без not valid.

-- ================= profiles =================

alter table public.profiles drop constraint if exists profiles_full_name_length_check;
alter table public.profiles
  add constraint profiles_full_name_length_check
  check (full_name is null or char_length(full_name) <= 120);

-- ================= projects =================

alter table public.projects drop constraint if exists projects_description_length_check;
alter table public.projects
  add constraint projects_description_length_check
  check (description is null or char_length(description) <= 2000);

-- ================= tasks =================

alter table public.tasks drop constraint if exists tasks_description_length_check;
alter table public.tasks
  add constraint tasks_description_length_check
  check (description is null or char_length(description) <= 5000);

-- ================= material_movements =================

alter table public.material_movements drop constraint if exists material_movements_note_length_check;
alter table public.material_movements
  add constraint material_movements_note_length_check
  check (note is null or char_length(note) <= 500);

-- ================= board_items =================

alter table public.board_items drop constraint if exists board_items_note_length_check;
alter table public.board_items
  add constraint board_items_note_length_check
  check (note is null or char_length(note) <= 1000);

-- Про политику вставки в project_members (аудит предлагал ограничить роль
-- значением member): правка не нужна — прямой INSERT закрыт ещё в 0012, там
-- политика project_members_insert удалена целиком, а участник появляется только
-- через accept_project_invitation. Возвращать политику с «role = member» было
-- бы регрессом: владелец снова смог бы добавлять произвольный user_id напрямую.
