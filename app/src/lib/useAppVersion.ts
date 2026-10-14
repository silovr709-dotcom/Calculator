// Проверка, что в браузере открыта свежая версия приложения.
// На хостинге рядом с index.html лежит build.json с коммитом сборки:
// если он отличается от зашитого в бандл — предлагаем перезагрузить страницу.

import { useCallback, useEffect, useState } from 'react';

declare const __APP_COMMIT__: string;

const CURRENT_COMMIT = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : '';
const CHECK_INTERVAL = 5 * 60 * 1000;

export interface AppVersion {
  current: string;
  latest: string;
  hasUpdate: boolean;
  reload: () => void;
}

export function useAppVersion(): AppVersion {
  const [latest, setLatest] = useState('');

  useEffect(() => {
    if (!CURRENT_COMMIT) return;  // локальная сборка — проверять нечего
    let alive = true;

    const check = async () => {
      try {
        const url = new URL('build.json', document.baseURI);
        url.searchParams.set('ts', String(Date.now()));
        const res = await fetch(url.toString(), { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { commit?: unknown };
        if (alive && typeof data.commit === 'string' && data.commit) setLatest(data.commit);
      } catch {
        /* нет связи — молчим, это не ошибка пользователя */
      }
    };

    void check();
    const timer = window.setInterval(() => { void check(); }, CHECK_INTERVAL);
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const reload = useCallback(() => {
    // Меняем адрес, чтобы браузер точно перечитал index.html, а не взял его из кэша.
    const url = new URL(window.location.href);
    url.searchParams.set('v', (latest || String(Date.now())).slice(0, 7));
    window.location.replace(url.toString());
  }, [latest]);

  return {
    current: CURRENT_COMMIT,
    latest,
    hasUpdate: Boolean(CURRENT_COMMIT && latest && latest !== CURRENT_COMMIT),
    reload,
  };
}
