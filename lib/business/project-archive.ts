// Подтверждение удаления проекта навсегда
// (docs/superpowers/specs/2026-10-08-project-archive-delete-design.md §3):
// введённое название совпадает с названием проекта после trim, с учётом регистра.
// Используется и в форме (активность кнопки), и в server action.
export function confirmsProjectName(input: string, name: string): boolean {
  const typed = input.trim();
  return typed !== "" && typed === name.trim();
}
