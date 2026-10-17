// Уведомления в Telegram: работают, даже когда приложение закрыто.
// Сообщения шлёт сам хостинг по расписанию, поэтому вкладку держать не нужно.

import { useCallback, useEffect, useState } from 'react';
import {
  calendarSubscriptionUrl, cronNotifyUrl, fetchNotifyServerSettings, fetchTelegramContacts,
  saveNotifyServerSettings, sendNotifyTest,
  type NotifyServerSettings, type TelegramChat, type TelegramContact,
} from '../lib/serverApi';

export default function TelegramNotifyCard() {
  const [settings, setSettings] = useState<NotifyServerSettings | null>(null);
  const [token, setToken] = useState('');
  const [chats, setChats] = useState<TelegramChat[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [contacts, setContacts] = useState<TelegramContact[] | null>(null);
  const [botName, setBotName] = useState('');

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

  const save = async (patch: Partial<{
    enabled: boolean; leadMinutes: number; timezoneOffset: number; eveningHour: number; dailyHour: number;
    notifyNew: boolean; morningDigest: boolean; eveningDigest: boolean; icsAlarms: number[];
  }> = {}) => {
    setBusy(true);
    setMessage('');
    try {
      const result = await saveNotifyServerSettings({
        enabled: patch.enabled ?? settings.enabled,
        token: token.trim() || undefined,
        chats: chats.filter((chat) => chat.name.trim() && chat.chatId.trim()),
        leadMinutes: patch.leadMinutes ?? settings.leadMinutes,
        timezoneOffset: patch.timezoneOffset ?? settings.timezoneOffset,
        eveningHour: patch.eveningHour ?? settings.eveningHour,
        dailyHour: patch.dailyHour ?? settings.dailyHour,
        notifyNew: patch.notifyNew ?? settings.notifyNew,
        morningDigest: patch.morningDigest ?? settings.morningDigest,
        eveningDigest: patch.eveningDigest ?? settings.eveningDigest,
        icsAlarms: patch.icsAlarms ?? settings.icsAlarms,
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

  /** Главная кнопка помощи: сами находим, кто написал боту, и подставляем chat id. */
  const findContacts = async () => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await fetchTelegramContacts();
      setBotName(result.bot);
      setContacts(result.contacts);
      if (result.contacts.length === 0) {
        setMessage(`Бот ${result.bot} на связи, но ему ещё никто не писал. Откройте ${result.bot} в Telegram, нажмите «Начать» (Start) и отправьте любое сообщение — потом нажмите кнопку ещё раз.`);
      }
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
        <li>В Telegram напишите <b>@BotFather</b> команду <code>/newbot</code> — он выдаст токен.</li>
        <li>Вставьте токен ниже и сохраните. {settings.tokenSet && <b>Сейчас сохранён токен {settings.tokenHint}.</b>}</li>
        <li><b>Важно:</b> каждый сотрудник должен открыть вашего бота и нажать <b>«Начать» (Start)</b>, затем отправить любое сообщение. Без этого Telegram запрещает боту писать первым.</li>
        <li>Нажмите <b>«Найти, кто написал боту»</b> — приложение само определит chat id и добавит получателя.</li>
        <li>Добавьте ссылку планировщика в панели хостинга — раздел «Планировщик CRON», раз в 5 минут.</li>
      </ol>
      <p className="muted small">
        Сам бот на сообщения не отвечает — это нормально: он только рассылает напоминания, принимать команды ему не нужно.
      </p>

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
        <label className="notify-check">
          <input type="checkbox" checked={settings.morningDigest} disabled={busy}
            onChange={(event) => void save({ morningDigest: event.target.checked })} />
          Утром присылать список на сегодня
        </label>
        <label>Утренняя сводка в
          <select value={settings.dailyHour} disabled={busy || !settings.morningDigest}
            onChange={(event) => void save({ dailyHour: Number(event.target.value) })}>
            {Array.from({ length: 24 }, (_, hour) => hour).map((hour) => (
              <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>
            ))}
          </select>
        </label>
        <label className="notify-check">
          <input type="checkbox" checked={settings.eveningDigest} disabled={busy}
            onChange={(event) => void save({ eveningDigest: event.target.checked })} />
          Вечером присылать список на завтра
        </label>
        <label>Вечерняя сводка в
          <select value={settings.eveningHour} disabled={busy} onChange={(event) => void save({ eveningHour: Number(event.target.value) })}>
            {Array.from({ length: 24 }, (_, hour) => hour).map((hour) => (
              <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>
            ))}
          </select>
        </label>
        <label className="notify-check">
          <input type="checkbox" checked={settings.notifyNew} disabled={busy}
            onChange={(event) => void save({ notifyNew: event.target.checked })} />
          Сообщать сразу, когда дело добавили в график
        </label>
        <label>Часовой пояс (UTC+)
          <input type="number" min={-12} max={14} value={settings.timezoneOffset} disabled={busy}
            onChange={(event) => void save({ timezoneOffset: Number(event.target.value) })} />
        </label>
      </div>

      <div className="notify-find">
        <button type="button" className="btn ghost" disabled={busy || !settings.tokenSet} onClick={() => void findContacts()}>
          {busy ? 'Спрашиваем Telegram…' : 'Найти, кто написал боту'}
        </button>
        {botName && <span className="muted small">Бот на связи: <b>{botName}</b></span>}
      </div>

      {contacts && contacts.length > 0 && (
        <div className="notify-contacts">
          <b>Написали боту</b>
          {contacts.map((contact) => (
            <div className="notify-contact-row" key={contact.chatId}>
              <span><b>{contact.name}</b><small>{contact.text || 'без текста'} · id {contact.chatId}</small></span>
              <button type="button" className="btn tiny ghost" disabled={chats.some((chat) => chat.chatId === contact.chatId)}
                onClick={() => setChats([...chats.filter((chat) => chat.name.trim() || chat.chatId.trim()), { name: contact.name, chatId: contact.chatId }])}>
                {chats.some((chat) => chat.chatId === contact.chatId) ? 'уже в списке' : 'Добавить'}
              </button>
              <button type="button" className="btn tiny ghost" disabled={busy} onClick={() => void test(contact.chatId)}>Проверить</button>
            </div>
          ))}
          <small className="muted">Имя можно поменять ниже — оно должно совпадать с тем, как сотрудник записан в делах календаря.</small>
        </div>
      )}

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
        <b>Подписка календаря на телефон</b>
        <input readOnly value={calendarSubscriptionUrl(settings.cronKey)} onFocus={(event) => event.target.select()} />
        <div className="notify-alarms">
          <b>Будильники внутри календаря телефона</b>
          <div className="notify-chips">
            {[15, 30, 60, 120, 480, 960, 1440, 2880].map((minutes) => {
              const active = settings.icsAlarms.includes(minutes);
              return (
                <button key={minutes} type="button" className={active ? 'active' : ''} disabled={busy}
                  onClick={() => void save({
                    icsAlarms: active
                      ? settings.icsAlarms.filter((item) => item !== minutes)
                      : [...settings.icsAlarms, minutes].sort((a, b) => a - b),
                  })}>
                  {minutes < 60 ? `${minutes} мин` : minutes < 1440 ? `${minutes / 60} ч` : `${minutes / 1440} дн`}
                </button>
              );
            })}
          </div>
          <small className="muted">
            Эти напоминания срабатывают в самом календаре iPhone или Android. Важно: при добавлении
            подписки на iPhone не включайте «Удалить напоминания» (Remove Alarms) — иначе телефон их отбросит.
          </small>
        </div>
        <small className="muted">
          Добавьте ссылку в Google Календарь («Другие календари → Подписаться по URL») или на iPhone
          («Настройки → Календарь → Учётные записи → Другое → Подписной календарь») — все работы появятся
          в системном календаре телефона и будут обновляться сами.
          Для личного календаря сотрудника добавьте в конец <code>&amp;who=Имя</code>, например{' '}
          <code>{`&who=${chats[0]?.name?.trim() || 'Пётр'}`}</code>.
        </small>
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
