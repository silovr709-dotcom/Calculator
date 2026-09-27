import { useRef, useState } from 'react';
import type { Project } from '../types';
import { calcTotals } from '../lib/engine';
import { fmtMoney, fmtDate, todayISO } from '../lib/format';

const STATUS_LABEL: Record<Project['status'], string> = {
  draft: 'Черновик', sent: 'Отправлен', approved: 'Согласован', archived: 'Архив',
};

export default function Dashboard(props: {
  projects: Project[];
  pricebookLabel: string;
  onOpen: (id: string) => void;
  onCreate: (d: { name: string; client: string; date: string; comment: string }) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onImport: (f: File) => void;
  onQuick: () => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', client: '', date: todayISO(), comment: '' });
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Проекты</h1>
          <div className="muted">Активный прайс: {props.pricebookLabel}</div>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => fileRef.current?.click()}>Импорт проекта</button>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onImport(f); e.target.value = ''; }} />
          <button className="btn ghost" onClick={props.onQuick}>Быстрый расчёт</button>
          <button className="btn primary" onClick={() => setShowNew(true)}>+ Новый расчёт</button>
        </div>
      </header>

      {showNew && (
        <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowNew(false); }}>
          <div className="modal narrow">
            <h2>Новый проект</h2>
            <label>Название проекта
              <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') { props.onCreate(form); setShowNew(false); } }}
                placeholder="Кухня Ивановы, ул. Ленина" />
            </label>
            <label>Клиент
              <input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} placeholder="Имя клиента" />
            </label>
            <label>Дата
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </label>
            <label>Комментарий
              <textarea value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} rows={2} />
            </label>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setShowNew(false)}>Отмена (Esc)</button>
              <button className="btn primary" onClick={() => { props.onCreate(form); setShowNew(false); }}>Создать</button>
            </div>
          </div>
        </div>
      )}

      {props.projects.length === 0 ? (
        <div className="empty">
          Пока нет проектов. Нажмите <b>«Новый расчёт»</b>, чтобы собрать первую кухню, или <b>«Быстрый расчёт»</b> для предварительной оценки.
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Название</th><th>Клиент</th><th>Дата</th><th>Позиций</th><th>Себестоимость</th><th>Цена клиента</th><th>Статус</th><th /></tr>
          </thead>
          <tbody>
            {props.projects.map((p) => {
              const { totals } = calcTotals(p.lines, p.settings);
              return (
                <tr key={p.id} className="row-click" onClick={() => props.onOpen(p.id)}>
                  <td><b>{p.name}</b>{p.comment && <div className="muted small">{p.comment}</div>}</td>
                  <td>{p.client || '—'}</td>
                  <td>{fmtDate(p.date)}</td>
                  <td>{p.lines.length}</td>
                  <td>{fmtMoney(totals.cost)}</td>
                  <td><b>{fmtMoney(totals.client)}</b></td>
                  <td><span className={`status s-${p.status}`}>{STATUS_LABEL[p.status]}</span></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="btn tiny ghost" title="Дублировать" onClick={() => props.onDuplicate(p.id)}>⧉</button>
                    <button className="btn tiny danger" title="Удалить" onClick={() => props.onDelete(p.id)}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
