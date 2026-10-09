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
