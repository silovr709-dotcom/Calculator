// Наряд на монтаж глазами мастера: открывается по ссылке на телефоне без пароля.
// Крупные кнопки: выехал, начал, закончил, нужна помощь — отметки сразу видит менеджер.

import { useEffect, useState } from 'react';
import { fetchWorkOrder, markWorkOrder, type WorkOrderLogEntry, type WorkOrderPayload, type WorkOrderStatus } from '../lib/serverApi';
import { fmtDateLong } from '../lib/format';

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  sent: 'Наряд выдан',
  onway: 'Мастер в пути',
  started: 'Монтаж идёт',
  done: 'Монтаж завершён',
  problem: 'Нужна помощь',
};

const ACTIONS: Array<{ status: WorkOrderStatus; label: string; tone: string; needComment?: boolean }> = [
  { status: 'onway', label: 'Выехал', tone: 'info' },
  { status: 'started', label: 'Начал работу', tone: 'info' },
  { status: 'done', label: 'Монтаж завершён', tone: 'ok' },
  { status: 'problem', label: 'Нужна помощь', tone: 'bad', needComment: true },
];

export default function WorkOrderPage(props: { id: string }) {
  const [payload, setPayload] = useState<WorkOrderPayload | null>(null);
  const [status, setStatus] = useState<WorkOrderStatus>('sent');
  const [log, setLog] = useState<WorkOrderLogEntry[]>([]);
  const [error, setError] = useState('');
  const [who, setWho] = useState(() => localStorage.getItem('recept.master.name') ?? '');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchWorkOrder(props.id)
      .then((data) => {
        if (!alive) return;
        setPayload(data.payload);
        setStatus(data.status);
        setLog(data.log ?? []);
      })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [props.id]);

  const mark = async (next: WorkOrderStatus, needComment?: boolean) => {
    if (needComment && !comment.trim()) {
      alert('Коротко опишите, что случилось, — менеджер сразу это увидит.');
      return;
    }
    setBusy(true);
    try {
      localStorage.setItem('recept.master.name', who.trim());
      const result = await markWorkOrder(props.id, { status: next, comment: comment.trim(), who: who.trim() || 'Мастер' });
      setStatus(result.status);
      setLog(result.log ?? []);
      setComment('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="public-offer-state"><h1>Наряд недоступен</h1><p>{error}</p></div>;
  if (!payload) return <div className="public-offer-state"><h1>Загружаем наряд…</h1></div>;

  return (
    <div className="work-order">
      <header className={`work-order-head status-${status}`}>
        <span className="eyebrow">Наряд на монтаж</span>
        <h1>{payload.client}</h1>
        <p>{fmtDateLong(payload.date)}{payload.time ? `, ${payload.time}` : ''}{payload.team ? ` · ${payload.team}` : ''}</p>
        <b className="work-order-status">{STATUS_LABELS[status]}</b>
      </header>

      <section className="work-order-card">
        <h2>Куда ехать</h2>
        <p className="work-order-address">{payload.address || 'Адрес не указан — уточните у менеджера'}</p>
        <div className="work-order-links">
          {payload.address && <a className="btn ghost" href={`https://yandex.ru/maps/?text=${encodeURIComponent(payload.address)}`} target="_blank" rel="noreferrer">Маршрут</a>}
          {payload.phone && <a className="btn ghost" href={`tel:${payload.phone.replace(/[^+\d]/g, '')}`}>Клиент: {payload.phone}</a>}
          {payload.managerPhone && <a className="btn ghost" href={`tel:${payload.managerPhone.replace(/[^+\d]/g, '')}`}>Менеджер: {payload.managerPhone}</a>}
        </div>
      </section>

      {payload.items.length > 0 && (
        <section className="work-order-card">
          <h2>Что везём и монтируем</h2>
          <ul className="work-order-items">{payload.items.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      )}

      {payload.note && (
        <section className="work-order-card">
          <h2>Важно</h2>
          <p>{payload.note}</p>
        </section>
      )}

      <section className="work-order-card">
        <h2>Отметки</h2>
        <label className="work-order-field">Ваше имя
          <input value={who} placeholder="кто на объекте" onChange={(event) => setWho(event.target.value)} />
        </label>
        <label className="work-order-field">Комментарий (для «нужна помощь» обязателен)
          <textarea rows={2} value={comment} placeholder="что сделано, что мешает" onChange={(event) => setComment(event.target.value)} />
        </label>
        <div className="work-order-actions">
          {ACTIONS.map((action) => (
            <button key={action.status} type="button" className={`work-order-btn ${action.tone}${status === action.status ? ' active' : ''}`}
              disabled={busy} onClick={() => void mark(action.status, action.needComment)}>
              {action.label}
            </button>
          ))}
        </div>
      </section>

      {log.length > 0 && (
        <section className="work-order-card">
          <h2>История</h2>
          <ul className="work-order-log">
            {[...log].reverse().map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                <b>{STATUS_LABELS[entry.status]}</b>
                <span>{new Date(entry.at).toLocaleString('ru-RU')}{entry.by ? ` · ${entry.by}` : ''}</span>
                {entry.comment && <small>{entry.comment}</small>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
