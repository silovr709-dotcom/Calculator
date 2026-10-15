// Предложение установить приложение: своя иконка, запуск без адресной строки и офлайн.
// На Android и в десктопных браузерах ставится одной кнопкой, на iPhone — через «Поделиться».

import { useEffect, useState } from 'react';
import { isIos, isStandalone, type InstallPromptEvent } from '../lib/pwa';

const HIDE_KEY = 'recept.install.hidden';

export default function InstallAppCard() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(() => localStorage.getItem(HIDE_KEY) === '1');
  const [installed, setInstalled] = useState(() => isStandalone());

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setPromptEvent(null); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || hidden) return null;
  const ios = isIos();
  if (!promptEvent && !ios) return null;

  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setPromptEvent(null);
  };

  const hide = () => {
    localStorage.setItem(HIDE_KEY, '1');
    setHidden(true);
  };

  return (
    <section className="install-card no-print">
      <div>
        <b>Установить РЕцепт как приложение</b>
        <p>
          {ios && !promptEvent
            ? 'На iPhone: нажмите «Поделиться» внизу браузера и выберите «На экран “Домой”». Появится иконка, приложение будет открываться без адресной строки.'
            : 'Появится иконка на рабочем столе, приложение откроется в своём окне и продолжит работать даже без интернета.'}
        </p>
      </div>
      <div className="install-card-actions">
        {promptEvent && <button type="button" className="btn primary" onClick={() => void install()}>Установить</button>}
        <button type="button" className="btn ghost" onClick={hide}>Не сейчас</button>
      </div>
    </section>
  );
}
