// Небольшая плашка в углу: видно, что правки ушли на сервер и когда это было.
// Нужна, чтобы работа с телефона и с компьютера не вызывала вопросов «а сохранилось ли».

import { useEffect, useState } from 'react';
import type { ServerSync } from '../lib/useServerSync';

export default function ServerSaveChip(props: { sync: ServerSync; onOpenServer: () => void }) {
  const { sync } = props;
  const stateKey = `${sync.status}:${sync.rev}`;
  const [hiddenFor, setHiddenFor] = useState(stateKey);

  // «Сохранено» показываем пару секунд после сохранения, потом убираем, чтобы не мешало.
  useEffect(() => {
    if (sync.status !== 'synced') return;
    const timer = window.setTimeout(() => setHiddenFor(stateKey), 2500);
    return () => window.clearTimeout(timer);
  }, [stateKey, sync.status]);

  const hideSynced = hiddenFor === stateKey;

  if (sync.mode !== 'server' || !sync.user) return null;
  if (sync.status === 'synced' && hideSynced && !sync.pendingChanges) return null;

  let tone = 'ok';
  let text = 'Сохранено на сервере';
  if (sync.status === 'saving') {
    tone = 'busy';
    text = 'Сохраняем на сервере…';
  } else if (sync.status === 'loading') {
    tone = 'busy';
    text = 'Загружаем базу с сервера…';
  } else if (sync.status === 'offline') {
    tone = 'warn';
    text = 'Нет связи — правки ждут в телефоне';
  } else if (sync.status === 'error') {
    tone = 'bad';
    text = 'Ошибка сохранения — откройте «Сервер»';
  } else if (sync.pendingChanges) {
    tone = 'busy';
    text = 'Есть несохранённые правки…';
  }

  const savedAt = sync.savedAt ? new Date(sync.savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <button
      type="button"
      className={`server-save-chip ${tone}`}
      onClick={props.onOpenServer}
      title={savedAt ? `Последнее сохранение на сервере: ${savedAt}` : 'Состояние связи с сервером'}
    >
      <span className="dot" aria-hidden="true" />
      <span>{text}</span>
      {savedAt && tone === 'ok' && <small>{savedAt}</small>}
    </button>
  );
}
