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
 * Место броска в панели очереди. В своей панели — индекс строки под курсором
 * (как arrayMove), над самой панелью — последнее место. В чужой — перед строкой
 * под курсором или после неё, если перетаскиваемая карточка ниже её середины;
 * над самой панелью — в конец.
 */
export function queueDropIndex(
  target: { id: string }[],
  taskId: string,
  overTaskId: string | null,
  below: boolean,
): number {
  const overIndex = overTaskId ? target.findIndex((t) => t.id === overTaskId) : -1;
  if (target.some((t) => t.id === taskId)) {
    return overIndex === -1 ? target.length - 1 : overIndex;
  }
  return overIndex === -1 ? target.length : overIndex + (below ? 1 : 0);
}
