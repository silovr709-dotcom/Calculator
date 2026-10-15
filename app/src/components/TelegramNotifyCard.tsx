// Уведомления в Telegram: работают, даже когда приложение закрыто.
// Сообщения шлёт сам хостинг по расписанию, поэтому вкладку держать не нужно.

import { useCallback, useEffect, useState } from 'react';
import {
  cronNotifyUrl, fetchNotifyServerSettings, saveNotifyServerSettings, sendNotifyTest,
  type NotifyServerSettings, type TelegramChat,
} from '../lib/serverApi';

export default function TelegramNotifyCard() {
  const [settings, setSettings] = useState<NotifyServerSettings | null>(null);
  const [token, setToken] = useState('');
  const [chats, setChats] = useState<TelegramChat[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const loaded = await fetchNotifyServerSettings();
      setSettings(loaded);
      setChats(loaded.chats.length > 0 ? loaded.chats : [{ name: '', chatId: '' }]);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  if (error && !settings) return <section className="card"><div className="server-alert error">{error}</div></section>;
  if (!settings) return null;

  const save = async (patch: Partial<{ enabled: boolean; leadMinutes: number; timezoneOffset: number }> = {}) => {
    setBusy(true);
    setMessage('');
    try {
      const result = await saveNotifyServerSettings({
        enabled: patch.enabled ?? settings.enabled,
        token: token.trim() || undefined,
        chats: chats.filter((chat) => chat.name.trim() && chat.chatId.trim()),
        leadMinutes: patch.leadMinutes ?? settings.leadMinutes,
        timezoneOffset: patch.timezoneOffset ?? settings.timezoneOffset,
      });
      setToken('');
      setMessage(result.tokenSet ? 'Сохранено. Не забудьте добавить ссылку в планировщик хостинга.' : 'Сохранено, но токен бота ещё не задан.');
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const test = async (chatId: string) => {
    setBusy(true);
    setMessage('');
    try {
      const result = await sendNotifyTest(chatId);
      setMessage(result.ok ? 'Сообщение отправлено — проверьте Telegram.' : (result.error ?? 'Телеграм не принял сообщение.'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card notify-card">
      <div className="section-head">
        <div>
          <h3>Уведомления в Telegram</h3>
          <p className="muted small">Приходят, даже когда приложение закрыто: сообщения отправляет сам хостинг по расписанию.</p>
        </div>
        <label className="notify-switch">
          <input type="checkbox" checked={settings.enabled} disabled={busy} onChange={(event) => void save({ enabled: event.target.checked })} />
          {settings.enabled ? 'включены' : 'выключены'}
        </label>
      </div>

      <ol className="notify-steps">
        <li>В Telegram напишите <b>@BotFather</b> команду <code>/newbot</code>, придумайте имя — он выдаст токен.</li>
        <li>Вставьте токен ниже и сохраните. {settings.tokenSet && <b>Сейчас сохранён токен {settings.tokenHint}.</b>}</li>
        <li>Каждый сотрудник пишет боту любое сообщение, затем узнаёт свой <b>chat id</b> у бота <b>@userinfobot</b> и сообщает вам.</li>
        <li>Впишите имя (как в делах календаря) и chat id, нажмите «Проверить».</li>
        <li>Добавьте ссылку планировщика в панели хостинга — раздел «Планировщик CRON», раз в 5 минут.</li>
      </ol>

      <div className="notify-grid">
        <label className="span-2">Токен бота
          <input value={token} placeholder={settings.tokenSet ? 'оставьте пустым, чтобы не менять' : '1234567890:AA...'}
            onChange={(event) => setToken(event.target.value)} />
        </label>
        <label>Предупреждать за
          <select value={settings.leadMinutes} disabled={busy} onChange={(event) => void save({ leadMinutes: Number(event.target.value) })}>
            {[15, 30, 60, 120, 240, 720, 1440].map((minutes) => (
              <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} мин` : minutes < 1440 ? `${minutes / 60} ч` : 'сутки'}</option>
            ))}
          </select>
        </label>
        <label>Часовой пояс (UTC+)
          <input type="number" min={-12} max={14} value={settings.timezoneOffset} disabled={busy}
            onChange={(event) => void save({ timezoneOffset: Number(event.target.value) })} />
        </label>
      </div>

      <div className="notify-chats">
        <b>Кому слать</b>
        {chats.map((chat, index) => (
          <div className="notify-chat-row" key={index}>
            <input value={chat.name} placeholder="Имя как в делах (Пётр, Бригада 1)"
              onChange={(event) => setChats(chats.map((item, position) => (position === index ? { ...item, name: event.target.value } : item)))} />
            <input value={chat.chatId} placeholder="chat id, например 123456789"
              onChange={(event) => setChats(chats.map((item, position) => (position === index ? { ...item, chatId: event.target.value } : item)))} />
            <button type="button" className="btn tiny ghost" disabled={busy || !chat.chatId.trim()} onClick={() => void test(chat.chatId.trim())}>Проверить</button>
            <button type="button" className="btn tiny ghost" onClick={() => setChats(chats.filter((_, position) => position !== index))}>✕</button>
          </div>
        ))}
        <button type="button" className="btn tiny ghost" onClick={() => setChats([...chats, { name: '', chatId: '' }])}>+ Добавить получателя</button>
      </div>

      <div className="notify-cron">
        <b>Ссылка для планировщика хостинга</b>
        <input readOnly value={cronNotifyUrl(settings.cronKey)} onFocus={(event) => event.target.select()} />
        <small className="muted">ispmanager → «Планировщик CRON» → новая задача: каждые 5 минут, команда <code>curl -s "ссылка"</code>. Ключ секретный — не публикуйте его.</small>
      </div>

      {message && <div className="server-alert">{message}</div>}
      {error && <div className="server-alert error">{error}</div>}

      <div className="notify-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void save()}>Сохранить настройки</button>
      </div>
    </section>
  );
}
