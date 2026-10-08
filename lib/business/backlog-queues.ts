// Панели очередей текущих заявок на доске (docs/superpowers/specs/2026-10-08-task-queues-design.md).
// Основная очередь «Текущие заявки» — queue_id null; на клиенте у неё ключ MAIN_QUEUE_KEY.
// Окончательный порядок задаёт RPC move_backlog_task (supabase/migrations/0018),
// здесь — тот же расчёт для оптимистичного обновления.

export const MAIN_QUEUE_KEY = "main";

export function queueKey(queueId: string | null): string {
  return queueId ?? MAIN_QUEUE_KEY;
}

export function queueIdOf(key: string): string | null {
  return key === MAIN_QUEUE_KEY ? null : key;
}

/**
 * Переносит заявку внутри очереди или в другую. index — место в целевой очереди
 * без перемещаемой заявки (как p_position у RPC), зажимается в границы.
 */
export function moveTaskBetweenQueues<T extends { id: string; queueId: string | null }>(
  queues: Record<string, T[]>,
  taskId: string,
  fromKey: string,
  toKey: string,
  index: number,
): Record<string, T[]> {
  const task = queues[fromKey]?.find((t) => t.id === taskId);
  if (!task) return queues;

  const next = { ...queues, [fromKey]: queues[fromKey].filter((t) => t.id !== taskId) };
  const target = [...(next[toKey] ?? [])];
  const at = Math.min(Math.max(index, 0), target.length);
  target.splice(at, 0, { ...task, queueId: queueIdOf(toKey) });
  next[toKey] = target;
  return next;
}

/**
 * Место броска в панели очереди. below — карточка ниже середины того, над чем
 * её отпустили (строки или самой панели). Над строкой своей панели — индекс
 * этой строки (как arrayMove), чужой — перед строкой или после неё. Над самой
 * панелью: верхняя половина (заголовок, форма создания) — наверх, нижняя — в конец.
 */
export function queueDropIndex(
  target: { id: string }[],
  taskId: string,
  overTaskId: string | null,
  below: boolean,
): number {
  const own = target.some((t) => t.id === taskId);
  const overIndex = overTaskId ? target.findIndex((t) => t.id === overTaskId) : -1;
  if (overIndex === -1) {
    return below ? target.length - (own ? 1 : 0) : 0;
  }
  return own ? overIndex : overIndex + (below ? 1 : 0);
}

/**
 * Метка очереди на карточке в дне: название дополнительной очереди. У основной
 * «Текущие заявки» метки нет — это очередь по умолчанию; у удалённой — тоже.
 */
export function queueLabel(
  queueId: string | null,
  queues: { id: string | null; name: string }[],
): string | null {
  if (queueId === null) return null;
  return queues.find((q) => q.id === queueId)?.name ?? null;
}
