// Подпись списка исполнителей задачи в узком поле карточки: одного показываем
// полностью, нескольких — «Фамилия И. О.», чтобы в строку поместились все.

function shortName(name: string): string {
  const [surname, ...rest] = name.trim().split(/\s+/);
  return [surname, ...rest.map((part) => `${part[0]}.`)].join(" ");
}

export function executorsSummary(names: string[]): string {
  if (names.length === 0) return "Не назначены";
  if (names.length === 1) return names[0].trim();
  return names.map(shortName).join(", ");
}

/**
 * Подпись исполнителей на карточке доски: «Фамилия И.» даже для одного,
 * не больше двух фамилий — остальные числом («+2»), чтобы карточка не росла.
 */
export function executorsInitials(names: string[], visible = 2): string {
  const label = names
    .slice(0, visible)
    .map((name) => {
      const [surname, first] = name.trim().split(/\s+/);
      return first ? `${surname} ${first[0]}.` : surname;
    })
    .join(", ");
  const rest = names.length - visible;
  return rest > 0 ? `${label} +${rest}` : label;
}

/**
 * Что изменилось в выборе исполнителей: страница заявки назначает и снимает
 * их поштучно (как доска), а не заменяет весь список двумя запросами.
 */
export function executorChanges(previous: string[], next: string[]): { added: string[]; removed: string[] } {
  return {
    added: next.filter((id) => !previous.includes(id)),
    removed: previous.filter((id) => !next.includes(id)),
  };
}
