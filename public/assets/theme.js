(() => {
  const THEME_KEY = 'theme';
  const COOKIE_KEY = 'THEME';

  const readCookie = (name) => {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
  };

  const normalizeTheme = (value) => (value === 'dark' ? 'dark' : value === 'light' ? 'light' : '');

  const getPreferredTheme = () => {
    const cookieTheme = normalizeTheme(readCookie(COOKIE_KEY));
    if (cookieTheme) return cookieTheme;
    const stored = normalizeTheme(localStorage.getItem(THEME_KEY) || '');
    if (stored) return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  const applyTheme = (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(THEME_KEY, theme);
  };

  applyTheme(getPreferredTheme());

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.addEventListener('click', () => {
        const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark';
        applyTheme(next);
      });
    }
  });
})();
