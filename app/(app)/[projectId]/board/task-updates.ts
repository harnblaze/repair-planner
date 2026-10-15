// Чистые функции оптимистичного обновления доски (week-board.tsx::applyMove):
// смена статуса и исполнителей с карточки дня.

export type TaskExecutor = { id: string; name: string };

/** Список исполнителей задачи после галочки; порядок — по имени, как с сервера (page.tsx). */
export function toggleExecutor(
  executors: TaskExecutor[],
  executor: TaskExecutor,
  assign: boolean,
): TaskExecutor[] {
  const others = executors.filter((e) => e.id !== executor.id);
  if (!assign) return others.length === executors.length ? executors : others;
  if (others.length !== executors.length) return executors;
  return [...executors, executor].sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

type Board<D, Q> = { days: Record<string, D[]>; queues: Record<string, Q[]> };

function patchLists<T extends { id: string }>(
  lists: Record<string, T[]>,
  taskId: string,
  update: (task: T) => T,
): Record<string, T[]> {
  let changed = false;
  const next: Record<string, T[]> = {};
  for (const [key, tasks] of Object.entries(lists)) {
    if (tasks.some((t) => t.id === taskId)) {
      changed = true;
      next[key] = tasks.map((t) => (t.id === taskId ? update(t) : t));
    } else {
      next[key] = tasks;
    }
  }
  return changed ? next : lists;
}

/**
 * Применяет update ко всем карточкам задачи: в днях недели (включая дни-историю —
 * это та же заявка) и в панелях очередей.
 */
export function patchTask<D extends { id: string }, Q extends { id: string }, S extends Board<D, Q>>(
  state: S,
  taskId: string,
  update: <T extends D | Q>(task: T) => T,
): S {
  const days = patchLists(state.days, taskId, update);
  const queues = patchLists(state.queues, taskId, update);
  if (days === state.days && queues === state.queues) return state;
  return { ...state, days, queues };
}
