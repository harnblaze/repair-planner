// Поиск открытых заявок по тексту: подстрока без учёта регистра в названии или
// описании. Открытых заявок немного, страница и так загружает их все, поэтому
// фильтруем на сервере в памяти (при тысячах — SQL-функция, как у архива).

export function matchesTaskText(task: { title: string; description: string | null }, query: string): boolean {
  const q = query.trim().toLocaleLowerCase("ru");
  if (!q) return true;
  return (
    task.title.toLocaleLowerCase("ru").includes(q) || (task.description ?? "").toLocaleLowerCase("ru").includes(q)
  );
}
