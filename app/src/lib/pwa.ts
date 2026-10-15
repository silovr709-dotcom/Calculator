// Установка приложения и работа без сети.
//
// Service worker включаем только в собранной версии и только на https (или localhost),
// иначе браузер его просто не примет. Адрес с ?nosw=1 снимает регистрацию —
// это аварийный выключатель, если кэш когда-нибудь начнёт мешать.

export function setupServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const params = new URLSearchParams(window.location.search);
  if (params.get('nosw') === '1') {
    void navigator.serviceWorker.getRegistrations().then((list) => list.forEach((item) => void item.unregister()));
    return;
  }

  if (!import.meta.env.PROD) return;
  const secure = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
  if (!secure) return;

  const base = import.meta.env.BASE_URL || '/';
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {
      /* не получилось — приложение просто работает как обычный сайт */
    });
  });
}

/** Событие браузера «можно предложить установку». Типов для него в TS нет. */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Приложение уже открыто как установленное (своё окно, без адресной строки). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** Похоже ли устройство на iPhone/iPad: там установка делается вручную через «Поделиться». */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
