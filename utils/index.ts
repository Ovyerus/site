import { storage } from './storage';

export * from './storage';

export const isDarkTheme = () => {
  if (typeof window === 'undefined') return true;

  const theme = storage.get('theme');
  return theme
    ? theme === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
};

export interface Theme {
  background: string;
  foreground: string;
  filter: string;
  filterInvert: string;
  stroke: string;
  __type: 'dark' | 'light';
}
