import { useMemo, useRef, useState } from 'react';
import type { Pricebook, Project } from '../types';
import { calcTotals } from '../lib/engine';
import { moduleToLines } from '../lib/modules';
import { fmtMoney, fmtDate, todayISO } from '../lib/format';
import { downloadFile, makeBackup, restoreBackup } from '../lib/storage';
import { filterDashboardProjects, projectReadiness, sortDashboardProjects, type DashboardReadinessFilter, type DashboardSort, type DashboardStatusFilter } from '../lib/dashboard';

export default function Dashboard(props: {
  projects: Project[];
  pricebooks: Pricebook[];
  pricebookLabel: string;
  onOpen: (id: string) => void;
  onCreate: (d: { name: string; client: string; date: string; comment: string }) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: Project['status']) => void;
  onImport: (f: File) => void;
  onQuick: () => void;
  onOpenSync?: () => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', client: '', date: todayISO(), comment: '' });
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<DashboardStatusFilter>('all');
  const [readinessFilter, setReadinessFilter] = useState<DashboardReadinessFilter>('all');
  const [sortOrder, setSortOrder] = useState<DashboardSort>('updated-desc');
  const readinessById = useMemo(() => new Map(props.projects.map((project) => {
    const pricebook = props.pricebooks.find((item) => item.meta.id === project.pricebookId) ?? props.pricebooks[0] ?? null;
    return [project.id, projectReadiness(project, pricebook)] as const;
  })), [props.projects, props.pricebooks]);
  const filteredProjects = useMemo(() => {
    const filtered = filterDashboardProjects(props.projects, query, statusFilter)
      .filter((project) => readinessFilter === 'all' || (readinessFilter === 'ready'
        ? readinessById.get(project.id)?.tone === 'ready'
        : readinessById.get(project.id)?.tone !== 'ready'));
    return sortDashboardProjects(filtered, sortOrder);
  }, [props.projects, query, statusFilter, readinessFilter, readinessById, sortOrder]);

  const doBackup = () => {
    const b = makeBackup();
    downloadFile(`recept-backup-${b.exportedAt.slice(0, 10)}.json`, JSON.stringify(b), 'application/json');
  };
  const doRestore = async (f: File) => {
    if (!confirm('Восстановление ЗАМЕНИТ все текущие проекты, шаблоны, настройки и загруженные версии прайса данными из копии. Продолжить?')) return;
    try {
      const msg = restoreBackup(await f.text());
      alert(msg);
      location.reload();
    } catch (e) {
      alert(`Ошибка восстановления: ${(e as Error).message}`);
    }
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Проекты</h1>
          <div className="muted">Активный прайс: {props.pricebookLabel}</div>
        </div>
        <div className="actions">
          <div className="dropdown">
            <button className="btn ghost">Данные ▾</button>
            <div className="dropdown-menu">
              <button onClick={doBackup}>⭳ Резервная копия всего (файл .json)</button>
              <button onClick={() => backupRef.current?.click()}>⭱ Восстановить из копии…</button>
              <button onClick={() => fileRef.current?.click()}>Импорт одного проекта…</button>
            </div>
          </div>
          <input ref={backupRef} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) doRestore(f); e.target.value = ''; }} />
          <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onImport(f); e.target.value = ''; }} />
          {props.onOpenSync && <button className="btn ghost" title="Синхронизация с телефоном и другими устройствами" onClick={props.onOpenSync}>📱 Синхронизация</button>}
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
        <>
          <div className="dashboard-filters card">
            <label className="dashboard-search">Поиск проекта или клиента
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, клиент, комментарий…" />
            </label>
            <label>Статус
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as DashboardStatusFilter)}>
                <option value="all">Все статусы</option>
                <option value="draft">Черновики</option>
                <option value="sent">Отправлены</option>
                <option value="approved">Согласованы</option>
                <option value="archived">Архив</option>
              </select>
            </label>
            <label>Готовность
              <select value={readinessFilter} onChange={(event) => setReadinessFilter(event.target.value as DashboardReadinessFilter)}>
                <option value="all">Все проекты</option>
                <option value="problem">Есть проблемы</option>
                <option value="ready">Готовы к КП</option>
              </select>
            </label>
            <label>Сортировка
              <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as DashboardSort)}>
                <option value="updated-desc">Сначала изменённые</option>
                <option value="updated-asc">Сначала старые</option>
                <option value="name">По названию</option>
                <option value="client">По клиенту</option>
              </select>
            </label>
            <span className="muted small dashboard-filter-count">Показано: {filteredProjects.length} из {props.projects.length}</span>
            {(query || statusFilter !== 'all' || readinessFilter !== 'all' || sortOrder !== 'updated-desc') && <button className="btn tiny ghost" onClick={() => { setQuery(''); setStatusFilter('all'); setReadinessFilter('all'); setSortOrder('updated-desc'); }}>Сбросить</button>}
          </div>
          {filteredProjects.length === 0 ? <div className="empty">По выбранным фильтрам проекты не найдены.</div> : <table className="table">
            <thead>
              <tr><th>Название</th><th>Клиент</th><th>Дата</th><th>Позиций</th><th>Себестоимость</th><th>Цена клиента</th><th>Готовность</th><th>Статус</th><th /></tr>
            </thead>
            <tbody>
              {filteredProjects.map((p) => {
                // строки из модулей («Позиции кухни») входят в итог наравне с ручными строками
                const pb = props.pricebooks.find((x) => x.meta.id === p.pricebookId) ?? props.pricebooks[0];
                const modLines = pb ? (p.modules ?? []).flatMap((m) => moduleToLines(m, p.moduleDefaults ?? {}, pb)) : [];
                const { totals } = calcTotals([...modLines, ...p.lines], p.settings);
                const readiness = projectReadiness(p, pb ?? null);
                return (
                  <tr key={p.id} className="row-click" onClick={() => props.onOpen(p.id)}>
                    <td><b>{p.name}</b>{p.comment && <div className="muted small">{p.comment}</div>}</td>
                    <td>{p.client || '—'}</td>
                    <td>{fmtDate(p.date)}</td>
                    <td>{(p.modules?.length ?? 0) > 0 ? `${p.modules!.length} мод. + ${p.lines.length}` : p.lines.length}</td>
                    <td>{fmtMoney(totals.cost)}</td>
                    <td><b>{fmtMoney(totals.client)}</b></td>
                    <td><span className={`readiness-pill ${readiness.tone}`} title={readiness.detail}>{readiness.label}</span></td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <select className={`status-inline s-${p.status}`} value={p.status} aria-label={`Статус проекта «${p.name}»`} onChange={(event) => props.onStatusChange(p.id, event.target.value as Project['status'])}>
                        <option value="draft">Черновик</option>
                        <option value="sent">Отправлен</option>
                        <option value="approved">Согласован</option>
                        <option value="archived">Архив</option>
                      </select>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn tiny ghost" title="Дублировать" onClick={() => props.onDuplicate(p.id)}>⧉</button>
                      <button className="btn tiny danger" title="Удалить" onClick={() => props.onDelete(p.id)}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>}
        </>
      )}
    </div>
  );
}
