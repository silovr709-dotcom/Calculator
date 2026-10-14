// CRM: один список сделок, воронка строкой и карточка клиента во всплывающем окне.
// Принцип: на экране — только то, что помогает выбрать, с кем работать сейчас;
// всё подробное (деньги, документы, история, контакты) открывается по клику.

import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ClientHistoryEntry, ClientProfile, ClientProjectDocuments, ClientProjectPayment,
  OrderWorkflow, OrderWorkflowStatus, Pricebook, Project,
} from '../types';
import { calcTotals } from '../lib/engine';
import { fmtMoney, fmtNum } from '../lib/format';
import { moduleToLines } from '../lib/modules';
import { applyClientOfferEdits, buildClientOfferDetails, buildClientProjectSummary, clientBodyTotal, clientOfferEditsDelta } from '../lib/clientOffer';
import { makeClientNameResolver } from '../lib/clientNaming';
import { downloadClientContractDocx, downloadClientDocumentZip, downloadClientOfferDocx, downloadClientReceiptDocx, type ClientDocumentArgs } from '../lib/clientPackage';
import {
  applyClientProfileToProject, findDuplicateClientGroups, mergeClientPatch, paymentStatusLabel,
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
import CrmDealDialog, { type DealCard } from './CrmDealDialog';

interface CrmRow extends CrmRowLike {
  project: Project;
  client: ClientProfile | null;
  pricebook: Pricebook | null;
  workflow: OrderWorkflow;
  statusLabel: string;
  marginPct: number | null;
  phone: string;
  email: string;
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
function dealMessage(row: CrmRow, payment?: ClientProjectPayment): string {
  const name = row.client?.name || row.project.client || 'Добрый день';
  const total = fmtMoney(row.total);
  const pay = paymentStatusLabel(payment, row.total);
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
      return `${name}, ваш заказ «${row.project.name}» в производстве. Срок — ${terms}. Остаток к оплате: ${fmtMoney(pay.remainder)}.`;
    case 'ready':
      return `${name}, заказ «${row.project.name}» готов. Остаток к оплате ${fmtMoney(pay.remainder)} — давайте согласуем доставку и монтаж.`;
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
  onWorkflowChange: (id: string, patch: Partial<OrderWorkflow>) => void;
  onClientChange: (client: ClientProfile) => void;
  onClientHistory: (clientId: string, entry: Omit<ClientHistoryEntry, 'id' | 'createdAt'>) => void;
  onMergeClients: (targetId: string, sourceId: string) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [focus, setFocus] = useState<CrmFocus>('active');
  const [stage, setStage] = useState<string>('');
  const [openProjectId, setOpenProjectId] = useState<string | null>(null);
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
    return {
      project,
      client,
      pricebook,
      workflow,
      statusLabel: workflowStatusMeta(workflow.status).label,
      marginPct: money.marginPct,
      phone,
      email,
      status: workflow.status,
      tone: nextContactTone(workflow.nextContactAt),
      hasNextAction: Boolean(workflow.nextAction?.trim()),
      closed: isClosedWorkflowStatus(workflow.status),
      total: money.total,
      updatedAt: project.updatedAt,
      search: [project.name, project.client, client?.name, workflow.nextAction, workflow.managerComment, phone, email, client?.source, client?.tags?.join(' ')].filter(Boolean).join(' '),
    };
  }), [props.projects, props.clients, props.pricebooks]);

  const counts = useMemo(() => focusCounts(rows), [rows]);
  const stages = useMemo(() => summarizeStages(rows), [rows]);
  const duplicates = useMemo(() => findDuplicateClientGroups(props.clients), [props.clients]);

  const visible = useMemo(() => {
    const stageDef = stages.find((item) => item.id === stage);
    return rows
      .filter((row) => matchesFocus(row, focus) && matchesQuery(row, query))
      .filter((row) => !stageDef || stageDef.statuses.includes(row.status))
      .sort(compareCrmRows);
  }, [rows, focus, query, stage, stages]);

  const openRow = openProjectId ? rows.find((row) => row.project.id === openProjectId) ?? null : null;

  const updateClient = (client: ClientProfile, patch: Partial<ClientProfile>) => props.onClientChange(mergeClientPatch(client, patch));

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
    if (!args) { alert('Нет прайса для выгрузки документов.'); return; }
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
      alert(`Не получилось сформировать документ: ${(error as Error).message}`);
    } finally {
      setDocBusy(null);
    }
  };

  const dealCard = (row: CrmRow): DealCard => {
    const offer = offers.find((item) => item.projectId === row.project.id) ?? null;
    return {
      projectId: row.project.id,
      projectName: row.project.name,
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
      offerLink: offer ? { url: clientOfferUrl(offer.id), views: offer.views, approvedAt: offer.approvedAt, approvedBy: offer.approvedBy } : null,
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
                  </div>
                  <div className="crm-item-sub">
                    <span className="crm-item-stage">{row.statusLabel}</span>
                    <span className={`crm-item-date tone-${row.tone}`}>{toneLabel(row.tone, row.workflow.nextContactAt)}</span>
                    <span className="crm-item-next">{row.workflow.nextAction?.trim() || defaultNextAction(row.workflow.status)}</span>
                  </div>
                </button>
                <div className="crm-item-money">
                  <b>{fmtMoney(row.total)}</b>
                  <small>{row.marginPct == null ? 'маржа —' : `маржа ${fmtNum(row.marginPct, 1)} %`}</small>
                </div>
                <div className="crm-item-actions">
                  <select value={row.status} aria-label="Этап" onChange={(event) => changeStatus(row, event.target.value as OrderWorkflowStatus)}>
                    {stages.flatMap((item) => item.statuses).map((status) => (
                      <option key={status} value={status}>{workflowStatusMeta(status).label}</option>
                    ))}
                  </select>
                  <button type="button" className="btn tiny ghost" onClick={() => schedule(row, 0)}>Сегодня</button>
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
          message={dealMessage(openRow, openRow.client?.paymentsByProject?.[openRow.project.id])}
          docBusy={docBusy}
          onClose={() => setOpenProjectId(null)}
          onOpenProject={() => { setOpenProjectId(null); props.onOpen(openRow.project.id); }}
          onWorkflow={(patch) => props.onWorkflowChange(openRow.project.id, patch)}
          onClient={(patch) => { if (openRow.client) updateClient(openRow.client, patch); }}
          onPayment={(patch) => { if (openRow.client) props.onClientChange(updateClientProjectPayment(openRow.client, openRow.project.id, patch)); }}
          onDocuments={(patch) => { if (openRow.client) props.onClientChange(updateClientProjectDocuments(openRow.client, openRow.project.id, patch)); }}
          onNote={(text) => { if (openRow.client) props.onClientHistory(openRow.client.id, { kind: 'note', title: text, projectId: openRow.project.id }); }}
          onSchedule={(days) => schedule(openRow, days)}
          onDocumentExport={(kind) => void exportDocument(openRow, kind)}
        />
      )}
    </div>
  );
}
