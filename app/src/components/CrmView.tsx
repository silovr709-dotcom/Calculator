import { toast } from '../lib/toast';
// CRM: один список сделок, воронка строкой и карточка клиента во всплывающем окне.
// Принцип: на экране — только то, что помогает выбрать, с кем работать сейчас;
// всё подробное (деньги, документы, история, контакты) открывается по клику.

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ClientHistoryEntry, ClientProfile, ClientProjectDocuments, CrmTask, CrmTaskKind,
  OrderWorkflow, OrderWorkflowStatus, PaymentKind, Pricebook, Project,
} from '../types';
import { calcTotals } from '../lib/engine';
import { fmtMoney, fmtNum } from '../lib/format';
import { moduleToLines } from '../lib/modules';
import { applyClientOfferEdits, buildClientOfferDetails, buildClientProjectSummary, clientBodyTotal, clientOfferEditsDelta } from '../lib/clientOffer';
import { makeClientNameResolver } from '../lib/clientNaming';
import { downloadClientContractDocx, downloadClientDocumentZip, downloadClientOfferDocx, downloadClientReceiptDocx, type ClientDocumentArgs } from '../lib/clientPackage';
import {
  applyClientProfileToProject, findDuplicateClientGroups, mergeClientPatch,
  updateClientProjectDocuments, updateClientProjectPayment,
} from '../lib/clientProfiles';
import {
  defaultNextAction, isClosedWorkflowStatus, nextContactTone,
  scheduleDate, workflowForProject, workflowStatusMeta,
} from '../lib/crm';
import {
  CRM_FOCUS_LABELS, compareCrmRows, focusCounts, matchesFocus, matchesQuery, summarizeStages,
  toneLabel, type CrmFocus, type CrmRowLike,
} from '../lib/crmBoard';
import { clientOfferUrl, listPublishedOffers, type PublishedOffer } from '../lib/serverApi';
import { loadViewPrefs, saveViewPrefs } from '../lib/viewPrefs';
import CrmDealDialog, { type DealCard } from './CrmDealDialog';
import {
  addPayment, addTask, nextTask, openTasks, paymentState, removePayment, removeTask,
  taskKindMeta, taskStats, taskTone, toggleTask,
} from '../lib/crmTasks';

interface CrmRow extends CrmRowLike {
  project: Project;
  client: ClientProfile | null;
  pricebook: Pricebook | null;
  workflow: OrderWorkflow;
  statusLabel: string;
  marginPct: number | null;
  phone: string;
  email: string;
  task: CrmTask | null;
  openTasks: number;
  paidLabel: string;
  paidTone: string;
  remainder: number;
}

function projectMoney(project: Project, pricebook: Pricebook | null) {
  if (!pricebook) return { total: 0, marginPct: null as number | null, lines: project.lines, lineCalcs: new Map(), modules: [] as Array<{ title: string; sub?: string; qty: number; total: number | null; bodyTotal?: number }> };
  const groups = (project.modules ?? []).map((module) => ({ module, lines: moduleToLines(module, project.moduleDefaults ?? {}, pricebook) }));
  const lines = [...groups.flatMap((group) => group.lines), ...project.lines];
  const result = calcTotals(lines, project.settings);
  return {
    total: result.totals.client,
    marginPct: result.totals.marginPct,
    lines,
    lineCalcs: result.lineCalcs,
    modules: groups.map(({ module, lines: groupLines }) => ({
      title: module.name,
      sub: module.widthMm && module.heightMm ? `${module.widthMm}×${module.heightMm}${module.depthMm ? `×${module.depthMm}` : ''} мм` : undefined,
      qty: module.qty,
      total: groupLines.reduce((sum, line) => sum + (result.lineCalcs.get(line.id)?.clientSum ?? 0), 0),
      bodyTotal: clientBodyTotal(buildClientOfferDetails(groupLines, result.lineCalcs)),
    })),
  };
}

function buildClientArgs(project: Project, pricebook: Pricebook | null): ClientDocumentArgs | null {
  if (!pricebook) return null;
  const money = projectMoney(project, pricebook);
  const resolveName = makeClientNameResolver(new Map(pricebook.items.map((item) => [item.id, item])), project.clientOffer?.lineNames);
  const details = applyClientOfferEdits(
    buildClientOfferDetails(money.lines, money.lineCalcs, resolveName),
    { qty: project.clientOffer?.lineQty, sums: project.clientOffer?.lineSums },
  );
  return {
    project: { ...project, lines: money.lines },
    offer: project.clientOffer ?? {},
    details,
    modules: money.modules,
    total: money.total + clientOfferEditsDelta(details),
    summary: buildClientProjectSummary(details, project.modules?.length ?? 0),
  };
}

/** Готовый текст сообщения клиенту под текущий этап сделки. */
function dealMessage(row: CrmRow, remainder: number): string {
  const name = row.client?.name || row.project.client || 'Добрый день';
  const total = fmtMoney(row.total);
  const terms = row.project.clientOffer?.productionTerms || 'согласованный срок';
  switch (row.workflow.status) {
    case 'draft':
    case 'calculating':
      return `${name}, добрый день! Готовим расчёт по проекту «${row.project.name}». Уточню пару деталей и пришлю коммерческое предложение.`;
    case 'offerSent':
      return `${name}, отправили КП по проекту «${row.project.name}» на сумму ${total}. Посмотрите, пожалуйста, и напишите, что скорректировать.`;
    case 'clientThinking':
      return `${name}, добрый день! Напоминаю про проект «${row.project.name}» на ${total}. Подскажите, двигаемся дальше или нужны правки?`;
    case 'approved':
    case 'techCheck':
      return `${name}, проект «${row.project.name}» согласован. Готовим договор и товарный чек, срок изготовления — ${terms}.`;
    case 'factorySent':
    case 'production':
      return `${name}, ваш заказ «${row.project.name}» в производстве. Срок — ${terms}. Остаток к оплате: ${fmtMoney(remainder)}.`;
    case 'ready':
      return `${name}, заказ «${row.project.name}» готов. Остаток к оплате ${fmtMoney(remainder)} — давайте согласуем доставку и монтаж.`;
    case 'delivered':
      return `${name}, спасибо за заказ «${row.project.name}»! Будем рады рекомендациям и всегда поможем с сервисом.`;
    default:
      return `${name}, добрый день! По проекту «${row.project.name}»: ${row.workflow.nextAction || defaultNextAction(row.workflow.status)}.`;
  }
}

export default function CrmView(props: {
  projects: Project[];
  clients: ClientProfile[];
  pricebooks: Pricebook[];
  onOpen: (id: string) => void;
  onProjectChange: (project: Project) => void;
  onWorkflowChange: (id: string, patch: Partial<OrderWorkflow>) => void;
  onClientChange: (client: ClientProfile) => void;
  onClientHistory: (clientId: string, entry: Omit<ClientHistoryEntry, 'id' | 'createdAt'>) => void;
  onMergeClients: (targetId: string, sourceId: string) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  // Фильтры запоминаются: экран открывается там же, где его оставили.
  const savedView = useMemo(() => loadViewPrefs('crm', { focus: 'active' as CrmFocus, stage: '', assignee: '', sort: 'urgency' as 'urgency' | 'money' | 'updated' }), []);
  const [focus, setFocus] = useState<CrmFocus>(savedView.focus);
  const [stage, setStage] = useState<string>(savedView.stage);
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
  const [assignee, setAssignee] = useState(savedView.assignee);
  const [sort, setSort] = useState<'urgency' | 'money' | 'updated'>(savedView.sort);
  const [docBusy, setDocBusy] = useState<string | null>(null);
  const [offers, setOffers] = useState<PublishedOffer[]>([]);

  // Состояние клиентских ссылок на КП: открывал ли, согласовал ли.
  useEffect(() => {
    let alive = true;
    listPublishedOffers().then((list) => { if (alive) setOffers(list); }).catch(() => { /* без сервера блок просто не показываем */ });
    return () => { alive = false; };
  }, []);

  const rows = useMemo<CrmRow[]>(() => props.projects.map((rawProject) => {
    const client = props.clients.find((item) => item.id === rawProject.clientId) ?? null;
    const project = applyClientProfileToProject(rawProject, client ?? undefined);
    const pricebook = props.pricebooks.find((item) => item.meta.id === project.pricebookId) ?? props.pricebooks[0] ?? null;
    const workflow = workflowForProject(project);
    const money = projectMoney(project, pricebook);
    const phone = client?.phones?.[0] || project.clientOffer?.clientPhone?.trim() || '';
    const email = client?.emails?.[0] || project.clientOffer?.clientEmail?.trim() || '';
    const payment = client?.paymentsByProject?.[project.id];
    const pay = paymentState(payment, money.total);
    const task = nextTask(project);
    return {
      project,
      client,
      pricebook,
      workflow,
      statusLabel: workflowStatusMeta(workflow.status).label,
      marginPct: money.marginPct,
      phone,
      email,
      task,
      openTasks: openTasks(project).length,
      paidLabel: pay.label,
      paidTone: pay.tone,
      remainder: pay.remainder,
      status: workflow.status,
      tone: nextContactTone(workflow.nextContactAt),
      hasNextAction: Boolean(workflow.nextAction?.trim()) || Boolean(task),
      closed: isClosedWorkflowStatus(workflow.status),
      total: money.total,
      updatedAt: project.updatedAt,
      search: [project.name, project.client, client?.name, workflow.nextAction, workflow.managerComment, workflow.assignee, task?.title, phone, email, client?.source, client?.tags?.join(' ')].filter(Boolean).join(' '),
    };
  }), [props.projects, props.clients, props.pricebooks]);

  useEffect(() => { saveViewPrefs('crm', { focus, stage, assignee, sort }); }, [focus, stage, assignee, sort]);

  const counts = useMemo(() => focusCounts(rows), [rows]);
  const stages = useMemo(() => summarizeStages(rows), [rows]);
  const duplicates = useMemo(() => findDuplicateClientGroups(props.clients), [props.clients]);

  const assignees = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) if (row.workflow.assignee?.trim()) set.add(row.workflow.assignee.trim());
    return Array.from(set).sort((left, right) => left.localeCompare(right, 'ru'));
  }, [rows]);

  const tasksSummary = useMemo(() => taskStats(props.projects), [props.projects]);

  const visible = useMemo(() => {
    const stageDef = stages.find((item) => item.id === stage);
    const list = rows
      .filter((row) => matchesFocus(row, focus) && matchesQuery(row, query))
      .filter((row) => !stageDef || stageDef.statuses.includes(row.status))
      .filter((row) => !assignee || (row.workflow.assignee ?? '') === assignee);
    if (sort === 'money') return [...list].sort((left, right) => right.total - left.total);
    if (sort === 'updated') return [...list].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return [...list].sort(compareCrmRows);
  }, [rows, focus, query, stage, stages, assignee, sort]);

  const openRow = openProjectId ? rows.find((row) => row.project.id === openProjectId) ?? null : null;

  const updateClient = (client: ClientProfile, patch: Partial<ClientProfile>) => props.onClientChange(mergeClientPatch(client, patch));

  const addDealTask = (row: CrmRow, task: { title: string; kind: CrmTaskKind; dueAt?: string; assignee?: string }) => {
    props.onProjectChange(addTask(row.project, { ...task, done: false }));
    // Ближайшая задача заодно становится следующим шагом сделки — список и карточка не расходятся.
    if (task.dueAt && (!row.workflow.nextContactAt || task.dueAt < row.workflow.nextContactAt.slice(0, 10))) {
      props.onWorkflowChange(row.project.id, { nextContactAt: task.dueAt, nextAction: task.title });
    }
    if (row.client) props.onClientHistory(row.client.id, { kind: 'contact', title: `Задача: ${task.title}`, projectId: row.project.id });
  };

  const addDealPayment = (row: CrmRow, entry: { amount: number; at: string; kind: PaymentKind; comment?: string }) => {
    if (!row.client) { toast.info('Чтобы вести оплаты, привяжите проект к карточке клиента.'); return; }
    const payment = addPayment(row.client.paymentsByProject?.[row.project.id], entry);
    props.onClientChange(updateClientProjectPayment(row.client, row.project.id, payment));
    props.onClientHistory(row.client.id, { kind: 'payment', title: `Платёж ${fmtMoney(entry.amount)}`, text: entry.comment, projectId: row.project.id });
  };

  const schedule = (row: CrmRow, days: number) => {
    props.onWorkflowChange(row.project.id, {
      nextContactAt: scheduleDate(days),
      nextAction: row.workflow.nextAction?.trim() || defaultNextAction(row.workflow.status),
    });
    if (row.client) props.onClientHistory(row.client.id, { kind: 'contact', title: days === 0 ? 'Контакт назначен на сегодня' : `Контакт назначен через ${days} дн.`, projectId: row.project.id });
  };

  const changeStatus = (row: CrmRow, status: OrderWorkflowStatus) => {
    props.onWorkflowChange(row.project.id, {
      status,
      nextAction: row.workflow.nextAction?.trim() || defaultNextAction(status),
      nextContactAt: row.workflow.nextContactAt ?? scheduleDate(status === 'clientThinking' ? 2 : 1),
    });
    if (row.client) props.onClientHistory(row.client.id, { kind: 'status', title: `Этап: ${workflowStatusMeta(status).label}`, projectId: row.project.id });
  };

  const exportDocument = async (row: CrmRow, kind: 'offer' | 'contract' | 'receipt' | 'package') => {
    const args = buildClientArgs(row.project, row.pricebook);
    if (!args) { toast.error('Нет прайса для выгрузки документов.'); return; }
    setDocBusy(`${row.project.id}-${kind}`);
    try {
      if (kind === 'offer') await downloadClientOfferDocx(args);
      if (kind === 'contract') await downloadClientContractDocx(args);
      if (kind === 'receipt') await downloadClientReceiptDocx(args);
      if (kind === 'package') await downloadClientDocumentZip(args, []);
      if (row.client) {
        const patch: Partial<ClientProjectDocuments> = kind === 'package' ? { package: 'created' } : { [kind]: 'created' };
        props.onClientChange(updateClientProjectDocuments(row.client, row.project.id, patch));
        props.onClientHistory(row.client.id, { kind: 'document', title: `Документ сформирован: ${kind === 'offer' ? 'КП' : kind === 'contract' ? 'договор' : kind === 'receipt' ? 'товарный чек' : 'пакет клиента'}`, projectId: row.project.id });
      }
    } catch (error) {
      toast.error(`Не получилось сформировать документ: ${(error as Error).message}`);
    } finally {
      setDocBusy(null);
    }
  };

  const dealCard = (row: CrmRow): DealCard => {
    const offer = offers.find((item) => item.projectId === row.project.id) ?? null;
    return {
      project: row.project,
      clientName: row.client?.name || row.project.client || 'Без клиента',
      client: row.client,
      workflow: row.workflow,
      tone: row.tone,
      total: row.total,
      marginPct: row.marginPct,
      phone: row.phone,
      email: row.email,
      payment: row.client?.paymentsByProject?.[row.project.id],
      documents: row.client?.documentsByProject?.[row.project.id] ?? {},
      offerLink: offer
        ? { url: clientOfferUrl(offer.id), views: offer.views, lastViewAt: offer.lastViewAt, createdAt: offer.createdAt, approvedAt: offer.approvedAt, approvedBy: offer.approvedBy }
        : null,
    };
  };

  return (
    <div className="page crm-view">
      <header className="page-head">
        <div>
          <h1>CRM</h1>
          <div className="muted">Клиенты, сделки, деньги и документы. Кликните строку — откроется карточка со всем остальным.</div>
        </div>
        <div className="actions">
          <input ref={searchRef} className="crm-search-input" value={query} placeholder="Клиент, проект, телефон…" onChange={(event) => setQuery(event.target.value)} />
          <button type="button" className={`btn ${counts.today > 0 ? 'primary' : 'ghost'}`} onClick={() => { setFocus('today'); setStage(''); }}>
            Сегодня{counts.today > 0 ? ` · ${counts.today}` : ''}
          </button>
        </div>
      </header>

      <section className="crm-focus-bar" aria-label="Фокус списка">
        {(['today', 'week', 'no-next', 'active', 'closed', 'all'] as CrmFocus[]).map((value) => {
          const count = value === 'today' ? counts.today
            : value === 'week' ? counts.week
            : value === 'no-next' ? counts.noNext
            : value === 'active' ? counts.active
            : value === 'closed' ? counts.closed
            : rows.length;
          return (
            <button key={value} type="button" className={focus === value ? 'active' : ''} onClick={() => setFocus(value)}>
              {CRM_FOCUS_LABELS[value]}<b>{count}</b>
            </button>
          );
        })}
        <span className="crm-focus-money">Активный портфель: <b>{fmtMoney(counts.pipeline)}</b></span>
      </section>

      <section className="crm-toolbar">
        <span className={`crm-task-summary${tasksSummary.overdue > 0 ? ' alert' : ''}`}>
          Задачи: <b>{tasksSummary.open}</b> открыто
          {tasksSummary.overdue > 0 && <> · <b>{tasksSummary.overdue}</b> просрочено</>}
          {tasksSummary.today > 0 && <> · <b>{tasksSummary.today}</b> на сегодня</>}
        </span>
        <label>Ответственный
          <select value={assignee} onChange={(event) => setAssignee(event.target.value)}>
            <option value="">все</option>
            {assignees.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>Сортировать
          <select value={sort} onChange={(event) => setSort(event.target.value as 'urgency' | 'money' | 'updated')}>
            <option value="urgency">по срочности</option>
            <option value="money">по сумме</option>
            <option value="updated">по последнему изменению</option>
          </select>
        </label>
      </section>

      <section className="crm-funnel" aria-label="Воронка">
        {stages.map((item) => (
          <button key={item.id} type="button" className={stage === item.id ? 'active' : ''}
            onClick={() => { setStage(stage === item.id ? '' : item.id); setFocus('all'); }}>
            <b>{item.count}</b>
            <span>{item.title}</span>
            <small>{fmtMoney(item.total)}</small>
          </button>
        ))}
      </section>

      {duplicates.length > 0 && (
        <div className="crm-duplicate-note">
          <b>Похоже, в базе есть дубли клиентов ({duplicates.length})</b>
          {duplicates.slice(0, 3).map((group) => (
            <span key={group.reason}>
              {group.reason}
              {group.clients.slice(1).map((client) => (
                <button key={client.id} type="button" onClick={() => props.onMergeClients(group.clients[0].id, client.id)}>
                  объединить «{client.name}» → «{group.clients[0].name}»
                </button>
              ))}
            </span>
          ))}
        </div>
      )}

      <section className="card crm-list-card">
        <div className="section-head">
          <div>
            <h3>{stage ? stages.find((item) => item.id === stage)?.title : CRM_FOCUS_LABELS[focus]}</h3>
            <p className="muted small">Строка — одна сделка. Кнопки справа меняют этап и срок, не открывая карточку.</p>
          </div>
          <b>{visible.length}</b>
        </div>

        {visible.length === 0 ? (
          <div className="empty small">Здесь пусто. Попробуйте другой фокус или сбросьте поиск.</div>
        ) : (
          <div className="crm-list">
            {visible.map((row) => (
              <article key={row.project.id} className={`crm-item tone-${row.tone}`}>
                <button type="button" className="crm-item-main" onClick={() => setOpenProjectId(row.project.id)}>
                  <div className="crm-item-title">
                    <b>{row.client?.name || row.project.client || 'Без клиента'}</b>
                    <span>{row.project.name}</span>
                    {row.workflow.assignee && <em className="crm-item-who">{row.workflow.assignee}</em>}
                  </div>
                  <div className="crm-item-sub">
                    <span className="crm-item-stage">{row.statusLabel}</span>
                    {row.task
                      ? <span className={`crm-item-task tone-${taskTone(row.task)}`}>
                          {taskKindMeta(row.task.kind).icon} {row.task.title}
                          {row.task.dueAt ? ` · ${toneLabel(taskTone(row.task) === 'overdue' ? 'overdue' : taskTone(row.task) === 'today' ? 'today' : 'planned', row.task.dueAt)}` : ' · без срока'}
                        </span>
                      : <span className={`crm-item-date tone-${row.tone}`}>{toneLabel(row.tone, row.workflow.nextContactAt)}</span>}
                    {row.openTasks > 1 && <span className="crm-item-taskcount">ещё задач: {row.openTasks - 1}</span>}
                    {row.phone && (
                      <a className="crm-item-phone" href={`tel:${row.phone.replace(/[^+\d]/g, '')}`}
                        onClick={(click) => click.stopPropagation()}>☎ {row.phone}</a>
                    )}
                  </div>
                </button>
                <div className="crm-item-money">
                  <b>{fmtMoney(row.total)}</b>
                  <small className={`crm-item-paid tone-${row.paidTone}`}>
                    {row.remainder > 0 && row.paidTone !== 'muted' ? `остаток ${fmtMoney(row.remainder)}` : row.paidLabel}
                  </small>
                  <small>{row.marginPct == null ? 'маржа —' : `маржа ${fmtNum(row.marginPct, 1)} %`}</small>
                </div>
                <div className="crm-item-actions">
                  <select value={row.status} aria-label="Этап" onChange={(event) => changeStatus(row, event.target.value as OrderWorkflowStatus)}>
                    {stages.flatMap((item) => item.statuses).map((status) => (
                      <option key={status} value={status}>{workflowStatusMeta(status).label}</option>
                    ))}
                  </select>
                  <button type="button" className="btn tiny ghost" title="Поставить звонок на сегодня"
                    onClick={() => addDealTask(row, { title: 'Позвонить клиенту', kind: 'call', dueAt: new Date().toISOString().slice(0, 10) })}>+ Звонок</button>
                  <button type="button" className="btn tiny ghost" onClick={() => schedule(row, 3)}>+3 дня</button>
                  <button type="button" className="btn tiny" onClick={() => setOpenProjectId(row.project.id)}>Карточка</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {openRow && (
        <CrmDealDialog
          card={dealCard(openRow)}
          message={dealMessage(openRow, openRow.remainder)}
          assignees={assignees}
          docBusy={docBusy}
          onClose={() => setOpenProjectId(null)}
          onOpenProject={() => { setOpenProjectId(null); props.onOpen(openRow.project.id); }}
          onWorkflow={(patch) => props.onWorkflowChange(openRow.project.id, patch)}
          onClient={(patch) => { if (openRow.client) updateClient(openRow.client, patch); }}
          onPaymentAdd={(entry) => addDealPayment(openRow, entry)}
          onPaymentRemove={(id) => {
            if (!openRow.client) return;
            const payment = removePayment(openRow.client.paymentsByProject?.[openRow.project.id], id);
            props.onClientChange(updateClientProjectPayment(openRow.client, openRow.project.id, payment));
          }}
          onDocuments={(patch) => { if (openRow.client) props.onClientChange(updateClientProjectDocuments(openRow.client, openRow.project.id, patch)); }}
          onTaskAdd={(task) => addDealTask(openRow, task)}
          onTaskToggle={(taskId) => {
            props.onProjectChange(toggleTask(openRow.project, taskId));
            const task = (openRow.project.tasks ?? []).find((item) => item.id === taskId);
            if (task && !task.done && openRow.client) {
              props.onClientHistory(openRow.client.id, { kind: 'contact', title: `Выполнено: ${task.title}`, projectId: openRow.project.id });
            }
          }}
          onTaskRemove={(taskId) => props.onProjectChange(removeTask(openRow.project, taskId))}
          onSchedulePatch={(patch) => props.onProjectChange({
            ...openRow.project,
            schedule: { ...(openRow.project.schedule ?? {}), ...patch },
            updatedAt: new Date().toISOString(),
          })}
          onNote={(text) => { if (openRow.client) props.onClientHistory(openRow.client.id, { kind: 'note', title: text, projectId: openRow.project.id }); }}
          onSchedule={(days) => schedule(openRow, days)}
          onDocumentExport={(kind) => void exportDocument(openRow, kind)}
        />
      )}

    </div>
  );
}
