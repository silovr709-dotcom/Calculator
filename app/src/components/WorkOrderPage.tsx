import { toast } from '../lib/toast';
// Наряд на монтаж глазами мастера: открывается по ссылке на телефоне без пароля.
// Крупные кнопки: выехал, начал, закончил, нужна помощь — отметки сразу видит менеджер.

import { useEffect, useState } from 'react';
import {
  addWorkOrderPhoto, fetchWorkOrder, markWorkOrder, serverFileUrl,
  type WorkOrderLogEntry, type WorkOrderPayload, type WorkOrderPhoto, type WorkOrderStatus,
} from '../lib/serverApi';
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
  const [photos, setPhotos] = useState<WorkOrderPhoto[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchWorkOrder(props.id)
      .then((data) => {
        if (!alive) return;
        setPayload(data.payload);
        setStatus(data.status);
        setLog(data.log ?? []);
        setPhotos(data.photos ?? []);
      })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [props.id]);

  const mark = async (next: WorkOrderStatus, needComment?: boolean) => {
    if (needComment && !comment.trim()) {
      toast.info('Коротко опишите, что случилось, — менеджер сразу это увидит.');
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

  const uploadPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      let next = photos;
      for (const file of Array.from(files)) {
        next = await addWorkOrderPhoto(props.id, { blob: file, who: who.trim() || 'Мастер', comment: comment.trim() });
      }
      setPhotos(next);
      setComment('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
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

      {(payload.images ?? []).length > 0 && (
        <section className="work-order-card">
          <h2>Эскиз и схемы</h2>
          <div className="work-order-images">
            {(payload.images ?? []).map((fileId) => (
              <a key={fileId} href={serverFileUrl(fileId)} target="_blank" rel="noreferrer">
                <img src={serverFileUrl(fileId)} alt="Эскиз к наряду" />
              </a>
            ))}
          </div>
        </section>
      )}

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
        <label className="work-order-photo-add">
          {uploading ? 'Загружаем фото…' : '📷 Добавить фото с объекта'}
          <input type="file" accept="image/*" capture="environment" multiple hidden disabled={uploading}
            onChange={(event) => { void uploadPhotos(event.target.files); event.target.value = ''; }} />
        </label>
        {photos.length > 0 && (
          <div className="work-order-images">
            {photos.map((photo) => (
              <a key={photo.fileId + photo.at} href={serverFileUrl(photo.fileId)} target="_blank" rel="noreferrer" title={`${photo.by}${photo.comment ? `: ${photo.comment}` : ''}`}>
                <img src={serverFileUrl(photo.fileId)} alt={photo.comment || 'Фото с объекта'} />
              </a>
            ))}
          </div>
        )}
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
