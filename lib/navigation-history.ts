// Был ли во вкладке переход между страницами приложения. Нужен кнопке «Назад»:
// router.back() безопасен, только если предыдущая запись истории — наша
// страница; иначе (прямая ссылка, новая вкладка) он увёл бы из приложения.

export type NavigationState = { lastPathname: string | null; hasInAppHistory: boolean };

export const INITIAL_NAVIGATION: NavigationState = { lastPathname: null, hasInAppHistory: false };

export function recordNavigation(state: NavigationState, pathname: string): NavigationState {
  const moved = state.lastPathname !== null && state.lastPathname !== pathname;
  return { lastPathname: pathname, hasInAppHistory: state.hasInAppHistory || moved };
}
