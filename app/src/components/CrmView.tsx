import { useMemo, useRef, useState } from 'react';
import type { OrderWorkflow, OrderWorkflowStatus, Pricebook, Project } from '../types';
import { calcTotals } from '../lib/engine';
import { fmtDate, fmtMoney, fmtNum } from '../lib/format';
import { moduleToLines } from '../lib/modules';
import { projectReadiness } from '../lib/dashboard';
import {
  ORDER_WORKFLOW_STATUSES,
  dateInputToIso,
  dateInputValue,
  defaultNextAction,
  isClosedWorkflowStatus,
  nextContactTone,
  normalizeClientName,
  scheduleDate,
  workflowForProject,
  workflowStatusMeta,
  type NextContactTone,
} from '../lib/crm';

interface CrmRow {
  project: Project;
  pricebook: Pricebook | null;
  workflow: OrderWorkflow;
  status: ReturnType<typeof workflowStatusMeta>;
  nextTone: NextContactTone;
  total: number;
  marginPct: number | null;
  readiness: ReturnType<typeof projectReadiness>;
  phone: string;
  email: string;
  contact: string;
}

const CRM_COLUMNS: Array<{ id: string; title: string; subtitle: string; statuses: OrderWorkflowStatus[] }> = [
  { id: 'lead', title: 'Лиды и расчёт', subtitle: 'замер, данные, просчёт', statuses: ['draft', 'calculating'] },
  { id: 'offer', title: 'КП и контакт', subtitle: 'отправлено / клиент думает', statuses: ['offerSent', 'clientThinking'] },
  { id: 'approved', title: 'Согласовано', subtitle: 'договор, проверка', statuses: ['approved', 'techCheck'] },
  { id: 'production', title: 'Производство', subtitle: 'фабрика, готовность', statuses: ['factorySent', 'production', 'ready'] },
  { id: 'closed', title: 'Закрыто', subtitle: 'выдано или отказ', statuses: ['delivered', 'rejected'] },
];

const statusFilterOptions = [
  { value: 'active', label: 'Активные' },
  { value: 'due', label: 'Контакт сегодня' },
  { value: 'no-next', label: 'Без следующего шага' },
  { value: 'closed', label: 'Закрытые' },
  { value: 'all', label: 'Все' },
] as const;

type CrmFilter = (typeof statusFilterOptions)[number]['value'];

function calcProjectTotals(project: Project, pricebook: Pricebook | null) {
  if (!pricebook) return { client: 0, marginPct: null };
  const moduleLines = (project.modules ?? []).flatMap((module) => moduleToLines(module, project.moduleDefaults ?? {}, pricebook));
  const result = calcTotals([...moduleLines, ...project.lines], project.settings);
  return { client: result.totals.client, marginPct: result.totals.marginPct };
}

function projectContact(project: Project) {
  const offer = project.clientOffer;
  return {
    phone: offer?.clientPhone?.trim() ?? '',
    email: offer?.clientEmail?.trim() ?? '',
    contact: offer?.clientContacts?.trim() ?? '',
  };
}

function toneLabel(tone: NextContactTone, value?: string) {
  if (tone === 'none') return 'нет даты';
  if (tone === 'overdue') return `просрочено · ${value ? fmtDate(value) : ''}`;
  if (tone === 'today') return 'сегодня';
  if (tone === 'soon') return `скоро · ${value ? fmtDate(value) : ''}`;
  return value ? fmtDate(value) : 'запланировано';
}

function rowSort(left: CrmRow, right: CrmRow) {
  const toneRank: Record<NextContactTone, number> = { overdue: 0, today: 1, none: 2, soon: 3, planned: 4 };
  const byTone = toneRank[left.nextTone] - toneRank[right.nextTone];
  if (byTone) return byTone;
  return right.project.updatedAt.localeCompare(left.project.updatedAt);
}

export default function CrmView(props: {
  projects: Project[];
  pricebooks: Pricebook[];
  onOpen: (id: string) => void;
  onWorkflowChange: (id: string, patch: Partial<OrderWorkflow>) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<CrmFilter>('active');

  const rows = useMemo<CrmRow[]>(() => props.projects.map((project) => {
    const pricebook = props.pricebooks.find((item) => item.meta.id === project.pricebookId) ?? props.pricebooks[0] ?? null;
    const workflow = workflowForProject(project);
    const totals = calcProjectTotals(project, pricebook);
    const contacts = projectContact(project);
    return {
      project,
      pricebook,
      workflow,
      status: workflowStatusMeta(workflow.status),
      nextTone: nextContactTone(workflow.nextContactAt),
      total: totals.client,
      marginPct: totals.marginPct,
      readiness: projectReadiness(project, pricebook),
      ...contacts,
    };
  }).sort(rowSort), [props.projects, props.pricebooks]);

  const activeRows = rows.filter((row) => !isClosedWorkflowStatus(row.workflow.status));
  const dueRows = activeRows.filter((row) => row.nextTone === 'overdue' || row.nextTone === 'today');
  const noNextRows = activeRows.filter((row) => !row.workflow.nextAction?.trim() || row.nextTone === 'none');
  const clientGroups = useMemo(() => {
    const map = new Map<string, { name: string; rows: CrmRow[]; total: number; phone: string; email: string; lastUpdated: string }>();
    for (const row of rows) {
      const key = normalizeClientName(row.project.client);
      const existing = map.get(key) ?? { name: row.project.client?.trim() || 'Без клиента', rows: [], total: 0, phone: '', email: '', lastUpdated: '' };
      existing.rows.push(row);
      existing.total += row.total;
      if (!existing.phone && row.phone) existing.phone = row.phone;
      if (!existing.email && row.email) existing.email = row.email;
      if (!existing.lastUpdated || row.project.updatedAt > existing.lastUpdated) existing.lastUpdated = row.project.updatedAt;
      map.set(key, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
  }, [rows]);

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru-RU');
    return rows.filter((row) => {
      if (filter === 'active' && isClosedWorkflowStatus(row.workflow.status)) return false;
      if (filter === 'closed' && !isClosedWorkflowStatus(row.workflow.status)) return false;
      if (filter === 'due' && !(row.nextTone === 'overdue' || row.nextTone === 'today')) return false;
      if (filter === 'no-next' && row.workflow.nextAction?.trim() && row.nextTone !== 'none') return false;
      if (!needle) return true;
      return [row.project.name, row.project.client, row.project.comment, row.workflow.nextAction, row.workflow.managerComment, row.phone, row.email, row.contact]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('ru-RU')
        .includes(needle);
    }).sort(rowSort);
  }, [filter, query, rows]);

  const pipelineRevenue = activeRows.reduce((sum, row) => sum + row.total, 0);
  const quickSchedule = (row: CrmRow, days: number, action?: string) => props.onWorkflowChange(row.project.id, {
    nextContactAt: scheduleDate(days),
    nextAction: action ?? row.workflow.nextAction ?? defaultNextAction(row.workflow.status),
  });
  const changeStatus = (row: CrmRow, status: OrderWorkflowStatus) => props.onWorkflowChange(row.project.id, {
    status,
    nextAction: row.workflow.nextAction?.trim() || defaultNextAction(status),
    nextContactAt: row.workflow.nextContactAt ?? scheduleDate(status === 'clientThinking' ? 2 : 1),
  });

  return (
    <div className="page crm-view">
      <header className="page-head crm-page-head">
        <div>
          <span className="eyebrow">CRM</span>
          <h1>Клиенты и заказы</h1>
          <div className="muted">Теперь CRM не спрятана внутри заказа: все контакты, этапы, задачи и суммы видны в одном рабочем центре.</div>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => searchRef.current?.focus()}>Найти клиента</button>
          <button className="btn primary" onClick={() => setFilter('due')}>Что сделать сегодня</button>
        </div>
      </header>

      <section className="crm-command card">
        <div className="crm-command-main">
          <h2>{dueRows.length > 0 ? `Сегодня нужно связаться: ${dueRows.length}` : 'На сегодня критичных контактов нет'}</h2>
          <p>Держите следующий шаг и дату контакта у каждого клиента. Просрочки и проекты без следующего действия подсвечиваются автоматически.</p>
        </div>
        <div className="crm-metrics">
          <button type="button" onClick={() => setFilter('active')}><b>{activeRows.length}</b><span>активных заказов</span></button>
          <button type="button" onClick={() => setFilter('due')}><b>{dueRows.length}</b><span>контактов сегодня</span></button>
          <button type="button" onClick={() => setFilter('no-next')}><b>{noNextRows.length}</b><span>без следующего шага</span></button>
          <button type="button" onClick={() => setFilter('active')}><b>{fmtMoney(pipelineRevenue)}</b><span>активный портфель</span></button>
        </div>
      </section>

      <section className="crm-board card">
        <div className="section-head"><div><h3>Воронка заказов</h3><p className="muted small">Первая строка CRM: где застрял клиент и что надо двигать дальше.</p></div></div>
        <div className="crm-columns">
          {CRM_COLUMNS.map((column) => {
            const columnRows = rows.filter((row) => column.statuses.includes(row.workflow.status));
            return <div className="crm-column" key={column.id}>
              <div className="crm-column-head"><b>{column.title}</b><span>{columnRows.length} · {fmtMoney(columnRows.reduce((sum, row) => sum + row.total, 0))}</span><small>{column.subtitle}</small></div>
              <div className="crm-column-cards">
                {columnRows.slice(0, 8).map((row) => <button type="button" className={`crm-mini-card tone-${row.nextTone}`} key={row.project.id} onClick={() => props.onOpen(row.project.id)}>
                  <b>{row.project.client || 'Без клиента'}</b>
                  <span>{row.project.name}</span>
                  <small>{toneLabel(row.nextTone, row.workflow.nextContactAt)} · {fmtMoney(row.total)}</small>
                </button>)}
                {columnRows.length === 0 && <div className="crm-column-empty">Нет проектов на этапе</div>}
              </div>
            </div>;
          })}
        </div>
      </section>

      <div className="crm-workbench">
        <section className="card crm-action-panel">
          <div className="section-head"><div><h3>Рабочий список CRM</h3><p className="muted small">Меняйте этап, следующий шаг и дату контакта прямо здесь — не нужно заходить в каждый заказ.</p></div><b>{filteredRows.length}</b></div>
          <div className="crm-filters">
            <label className="crm-search">Поиск<input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Клиент, проект, телефон, комментарий…" /></label>
            <label>Фокус<select value={filter} onChange={(event) => setFilter(event.target.value as CrmFilter)}>{statusFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          </div>
          <div className="crm-action-list">
            {filteredRows.length === 0 ? <div className="empty small">По выбранным фильтрам задач нет.</div> : filteredRows.map((row) => (
              <article className={`crm-row tone-${row.nextTone}`} key={row.project.id}>
                <div className="crm-row-main">
                  <button type="button" className="linkish" onClick={() => props.onOpen(row.project.id)}><b>{row.project.client || 'Без клиента'}</b><span>{row.project.name}</span></button>
                  <div className="crm-row-meta"><span>{fmtMoney(row.total)}</span><span>маржа {row.marginPct == null ? '—' : `${fmtNum(row.marginPct, 1)}%`}</span><span className={`readiness-pill ${row.readiness.tone}`}>{row.readiness.label}</span></div>
                  {(row.phone || row.email || row.contact) && <div className="crm-contact-line">{[row.phone, row.email, row.contact].filter(Boolean).join(' · ')}</div>}
                </div>
                <div className="crm-row-controls">
                  <label>Этап<select value={row.workflow.status} onChange={(event) => changeStatus(row, event.target.value as OrderWorkflowStatus)}>{ORDER_WORKFLOW_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label>
                  <label>Следующий шаг<input key={`action-${row.project.id}-${row.workflow.nextAction ?? ''}`} defaultValue={row.workflow.nextAction ?? ''} onBlur={(event) => { if (event.target.value !== (row.workflow.nextAction ?? '')) props.onWorkflowChange(row.project.id, { nextAction: event.target.value }); }} placeholder={defaultNextAction(row.workflow.status)} /></label>
                  <label>Дата контакта<input type="date" value={dateInputValue(row.workflow.nextContactAt)} onChange={(event) => props.onWorkflowChange(row.project.id, { nextContactAt: dateInputToIso(event.target.value) })} /></label>
                </div>
                <div className="crm-row-footer">
                  <span className={`crm-date-pill ${row.nextTone}`}>{toneLabel(row.nextTone, row.workflow.nextContactAt)}</span>
                  <button className="btn tiny ghost" onClick={() => quickSchedule(row, 0, row.workflow.nextAction || defaultNextAction(row.workflow.status))}>Сегодня</button>
                  <button className="btn tiny ghost" onClick={() => quickSchedule(row, 2, 'Повторный контакт с клиентом')}>+2 дня</button>
                  <button className="btn tiny ghost" onClick={() => props.onWorkflowChange(row.project.id, { nextContactAt: undefined })}>Без даты</button>
                  <button className="btn tiny ghost" onClick={() => props.onOpen(row.project.id)}>Открыть</button>
                </div>
                <textarea key={`comment-${row.project.id}-${row.workflow.managerComment ?? ''}`} className="crm-manager-note" defaultValue={row.workflow.managerComment ?? ''} onBlur={(event) => { if (event.target.value !== (row.workflow.managerComment ?? '')) props.onWorkflowChange(row.project.id, { managerComment: event.target.value }); }} placeholder="Заметка менеджера: что согласовано, почему ждём, что по возражениям" rows={2} />
              </article>
            ))}
          </div>
        </section>

        <aside className="card crm-client-base">
          <div className="section-head"><div><h3>Клиентская база</h3><p className="muted small">Группировка по клиенту: сколько проектов, контакты и сумма.</p></div><b>{clientGroups.length}</b></div>
          <div className="crm-client-list">
            {clientGroups.slice(0, 18).map((client) => {
              const activeCount = client.rows.filter((row) => !isClosedWorkflowStatus(row.workflow.status)).length;
              return <button type="button" key={client.name} onClick={() => { setQuery(client.name === 'Без клиента' ? '' : client.name); setFilter('all'); }}>
                <b>{client.name}</b>
                <span>{client.rows.length} проект(а), активных: {activeCount}</span>
                <small>{[client.phone, client.email].filter(Boolean).join(' · ') || 'контакты не заполнены'}</small>
                <strong>{fmtMoney(client.total)}</strong>
              </button>;
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}
