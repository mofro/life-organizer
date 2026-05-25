// useDarkMode — three-way theme: 'light' | 'dark' | 'auto'
// - Persists to localStorage under key 'theme'
// - 'auto' follows prefers-color-scheme and re-applies when OS setting changes
// - Toggles the 'dark' class on <html> so Tailwind's darkMode:'class' picks it up

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'theme';

function applyTheme(mode) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = mode === 'dark' || (mode === 'auto' && prefersDark);
  document.documentElement.classList.toggle('dark', dark);
}

export function useDarkMode() {
  const [mode, setMode] = useState(
    () => localStorage.getItem(STORAGE_KEY) || 'auto'
  );

  useEffect(() => {
    applyTheme(mode);
    localStorage.setItem(STORAGE_KEY, mode);

    if (mode !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('auto');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode]);

  return [mode, setMode];
}
