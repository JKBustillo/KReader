export type Theme = 'dark' | 'light';

export function getTheme(): Theme {
  return (localStorage.getItem('kreader-theme') as Theme) ?? 'dark';
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('kreader-theme', theme);
}
