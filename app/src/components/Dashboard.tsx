import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pricebook, Project } from '../types';
import { calcTotals } from '../lib/engine';
import { moduleToLines } from '../lib/modules';
import { fmtMoney, fmtDate, todayISO } from '../lib/format';
import { downloadFile, makeBackup, restoreBackup } from '../lib/storage';
import { projectFinance } from '../lib/finance';
import { filterDashboardProjects, projectReadiness, sortDashboardProjects, type DashboardReadinessFilter, type DashboardSort, type DashboardStatusFilter } from '../lib/dashboard';
import { isClosedWorkflowStatus, nextContactTone, workflowForProject, workflowStatusMeta } from '../lib/crm';

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
  onOpenCrm?: () => void;
  onOpenSync?: () => void;
}) {
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', client: '', date: todayISO(), comment: '' });
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
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

  // Финсводка РЕцепт PRO: считается из тех же итогов проектов (calcTotals), видимых в списке.
  const portfolio = useMemo(() => {
    const finances = filteredProjects.map((p) => {
      const pb = props.pricebooks.find((x) => x.meta.id === p.pricebookId) ?? props.pricebooks[0];
      return pb ? projectFinance(p, pb) : null;
    }).filter((f): f is NonNullable<typeof f> => f !== null);
    return {
      projectsCount: finances.length,
      revenue: finances.reduce((s, f) => s + f.clientPrice, 0),
      cost: finances.reduce((s, f) => s + f.cost, 0),
      grossProfit: finances.reduce((s, f) => s + f.grossProfit, 0),
      marginPct: finances.reduce((s, f) => s + f.clientPrice, 0) > 0
        ? (finances.reduce((s, f) => s + f.grossProfit, 0) / finances.reduce((s, f) => s + f.clientPrice, 0)) * 100
        : null,
      unpricedProjects: finances.filter((f) => f.unpricedCount > 0).length,
    };
  }, [filteredProjects, props.pricebooks]);

  const crmSummary = useMemo(() => {
    const rows = props.projects.map((project) => {
      const workflow = workflowForProject(project);
      return { project, workflow, tone: nextContactTone(workflow.nextContactAt) };
    });
    const active = rows.filter((row) => !isClosedWorkflowStatus(row.workflow.status));
    const due = active.filter((row) => row.tone === 'overdue' || row.tone === 'today');
    const noNext = active.filter((row) => !row.workflow.nextAction?.trim() || row.tone === 'none');
    const stuck = active.filter((row) => row.workflow.status === 'offerSent' || row.workflow.status === 'clientThinking');
    return {
      active: active.length,
      due: due.length,
      noNext: noNext.length,
      stuck: stuck.length,
      focus: [...due, ...noNext.filter((row) => !due.some((item) => item.project.id === row.project.id))].slice(0, 4),
    };
  }, [props.projects]);

  // Горячие клавиши списка проектов: «/» — фокус на поиск, «N» — новый расчёт.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key.toLowerCase() === 'n' || e.key.toLowerCase() === 'т') {
        e.preventDefault();
        setShowNew(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
      </header>

      <section className="dashboard-command-center card no-print" aria-label="Единый центр действий">
        <div className="dashboard-command-copy">
          <span className="eyebrow">Действия</span>
          <h2>Проекты, CRM и обмен — рядом</h2>
          <p>Основные операции вынесены в одну панель: создать расчёт, открыть CRM, сделать быстрый расчёт, импортировать или сохранить данные.</p>
        </div>
        <div className="dashboard-command-actions">
          <button className="btn primary" onClick={() => setShowNew(true)}>+ Новый расчёт</button>
          {props.onOpenCrm && <button className="btn ghost" onClick={props.onOpenCrm}>CRM клиентов</button>}
          <button className="btn ghost" onClick={props.onQuick}>Быстрый расчёт</button>
          {props.onOpenSync && <button className="btn ghost" title="Синхронизация с телефоном и другими устройствами" onClick={props.onOpenSync}>Синхронизация</button>}
          <div className="dropdown">
            <button className="btn ghost">Данные ▾</button>
            <div className="dropdown-menu">
              <button onClick={doBackup}>⭳ Резервная копия всего (файл .json)</button>
              <button onClick={() => backupRef.current?.click()}>⭱ Восстановить из копии…</button>
              <button onClick={() => fileRef.current?.click()}>Импорт одного проекта…</button>
            </div>
          </div>
        </div>
        <input ref={backupRef} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) doRestore(f); e.target.value = ''; }} />
        <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) props.onImport(f); e.target.value = ''; }} />
      </section>

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
          <section className="dashboard-crm-card card">
            <div className="dashboard-crm-copy">
              <span className="eyebrow">CRM в работе</span>
              <h2>{crmSummary.due > 0 ? `Есть контакты на сегодня: ${crmSummary.due}` : 'Клиентская работа под контролем'}</h2>
              <p>Быстрый обзор клиентских задач прямо на главном экране. Полная воронка, база клиентов и редактирование следующих шагов — в отдельном разделе CRM.</p>
              <div className="dashboard-crm-metrics">
                <button type="button" onClick={props.onOpenCrm}><b>{crmSummary.active}</b><span>активных заказов</span></button>
                <button type="button" onClick={props.onOpenCrm}><b>{crmSummary.due}</b><span>контакт сегодня</span></button>
                <button type="button" onClick={props.onOpenCrm}><b>{crmSummary.noNext}</b><span>без шага/даты</span></button>
                <button type="button" onClick={props.onOpenCrm}><b>{crmSummary.stuck}</b><span>КП ждёт решения</span></button>
              </div>
            </div>
            <div className="dashboard-crm-focus">
              <b>Фокус менеджера</b>
              {crmSummary.focus.length === 0 ? <span className="muted small">Нет срочных CRM-задач. Добавляйте дату контакта в карточках заказов или в CRM.</span> : crmSummary.focus.map(({ project, workflow, tone }) => (
                <button type="button" key={project.id} onClick={() => props.onOpen(project.id)} className={`tone-${tone}`}>
                  <span>{project.client || 'Без клиента'}</span>
                  <small>{workflowStatusMeta(workflow.status).label} · {workflow.nextAction || 'нет следующего шага'}</small>
                </button>
              ))}
              {props.onOpenCrm && <button type="button" className="btn tiny primary" onClick={props.onOpenCrm}>Открыть CRM</button>}
            </div>
          </section>

          <div className="dashboard-filters card">
            <label className="dashboard-search">Поиск проекта или клиента
              <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название, клиент, комментарий…" />
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
            <span className="muted small dashboard-hotkeys" title="Горячие клавиши">⌨ / — поиск · N — новый расчёт</span>
            {(query || statusFilter !== 'all' || readinessFilter !== 'all' || sortOrder !== 'updated-desc') && <button className="btn tiny ghost" onClick={() => { setQuery(''); setStatusFilter('all'); setReadinessFilter('all'); setSortOrder('updated-desc'); }}>Сбросить</button>}
          </div>
          <div className="card finance-strip" title="Финансовая сводка по показанным проектам — считается из тех же итогов, что видны в карточках">
            <div className="fin-item"><span>Выручка (цена клиента)</span><b>{fmtMoney(portfolio.revenue)}</b></div>
            <div className="fin-item"><span>Расходы (себест.+доп.)</span><b>{fmtMoney(portfolio.cost)}</b></div>
            <div className="fin-item"><span>Валовая прибыль</span><b>{fmtMoney(portfolio.grossProfit)}</b></div>
            <div className="fin-item"><span>Маржинальность</span><b>{portfolio.marginPct === null ? '—' : `${portfolio.marginPct.toFixed(1)} %`}</b></div>
            {portfolio.unpricedProjects > 0 && <div className="fin-item warn" title="В этих проектах есть позиции без цены — проверьте расчёт">⚠ без цен: {portfolio.unpricedProjects}</div>}
          </div>
          {filteredProjects.length === 0 ? <div className="empty">По выбранным фильтрам проекты не найдены.</div> : <table className="table dashboard-table">
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
                    <td data-label="Проект"><b>{p.name}</b>{p.comment && <div className="muted small">{p.comment}</div>}</td>
                    <td data-label="Клиент">{p.client || '—'}</td>
                    <td data-label="Дата">{fmtDate(p.date)}</td>
                    <td data-label="Состав">{(p.modules?.length ?? 0) > 0 ? `${p.modules!.length} мод. + ${p.lines.length}` : p.lines.length}</td>
                    <td data-label="Себестоимость">{fmtMoney(totals.cost)}</td>
                    <td data-label="Цена клиента"><b>{fmtMoney(totals.client)}</b></td>
                    <td data-label="Готовность"><span className={`readiness-pill ${readiness.tone}`} title={readiness.detail}>{readiness.label}</span></td>
                    <td data-label="Статус" onClick={(event) => event.stopPropagation()}>
                      <select className={`status-inline s-${p.status}`} value={p.status} aria-label={`Статус проекта «${p.name}»`} onChange={(event) => props.onStatusChange(p.id, event.target.value as Project['status'])}>
                        <option value="draft">Черновик</option>
                        <option value="sent">Отправлен</option>
                        <option value="approved">Согласован</option>
                        <option value="archived">Архив</option>
                      </select>
                    </td>
                    <td data-label="Действия" onClick={(e) => e.stopPropagation()}>
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
