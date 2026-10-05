import { useMemo, useRef, useState } from 'react';
import type { ClientDocumentState, ClientHistoryEntry, ClientProfile, ClientProjectDocuments, ClientProjectPayment, OrderWorkflow, OrderWorkflowStatus, Pricebook, Project } from '../types';
import { calcTotals } from '../lib/engine';
import { fmtDate, fmtMoney, fmtNum } from '../lib/format';
import { moduleToLines } from '../lib/modules';
import { projectReadiness } from '../lib/dashboard';
import { buildClientOfferDetails, buildClientProjectSummary } from '../lib/clientOffer';
import { downloadClientContractDocx, downloadClientDocumentZip, downloadClientOfferDocx, downloadClientReceiptDocx, type ClientDocumentArgs } from '../lib/clientPackage';
import {
  CLIENT_TAGS,
  applyClientProfileToProject,
  findDuplicateClientGroups,
  mergeClientPatch,
  paymentStatusLabel,
  splitContactList,
  updateClientProjectDocuments,
  updateClientProjectPayment,
} from '../lib/clientProfiles';
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
  client: ClientProfile | null;
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
  { value: 'week', label: 'На неделю' },
  { value: 'no-next', label: 'Без следующего шага' },
  { value: 'closed', label: 'Закрытые' },
  { value: 'all', label: 'Все' },
] as const;

type CrmFilter = (typeof statusFilterOptions)[number]['value'];
type MessageTemplate = 'afterCalc' | 'offerSent' | 'reminder' | 'contract' | 'prepayment' | 'ready' | 'delivery';

const MESSAGE_TEMPLATES: Array<{ id: MessageTemplate; label: string }> = [
  { id: 'afterCalc', label: 'После расчёта' },
  { id: 'offerSent', label: 'КП отправлено' },
  { id: 'reminder', label: 'Напоминание' },
  { id: 'contract', label: 'Договор' },
  { id: 'prepayment', label: 'Предоплата' },
  { id: 'ready', label: 'Заказ готов' },
  { id: 'delivery', label: 'Выдача / монтаж' },
];

const DOC_LABELS: Record<keyof Omit<ClientProjectDocuments, 'updatedAt' | 'comment'>, string> = {
  offer: 'КП',
  contract: 'Договор',
  receipt: 'Чек',
  package: 'Пакет',
  factoryBlank: 'Фабрика',
  sketch: 'Эскиз',
};

const DOC_STATES: Array<{ value: ClientDocumentState; label: string }> = [
  { value: 'none', label: 'нет' },
  { value: 'created', label: 'создан' },
  { value: 'sent', label: 'отправлен' },
  { value: 'approved', label: 'согласован' },
];

function calcProjectData(project: Project, pricebook: Pricebook | null) {
  if (!pricebook) return { client: 0, marginPct: null, lineCalcs: new Map(), lines: [] as Project['lines'], modules: [] as Array<{ title: string; sub?: string; qty: number; total: number | null }> };
  const moduleGroups = (project.modules ?? []).map((module) => ({ module, lines: moduleToLines(module, project.moduleDefaults ?? {}, pricebook) }));
  const moduleLines = moduleGroups.flatMap((group) => group.lines);
  const lines = [...moduleLines, ...project.lines];
  const result = calcTotals(lines, project.settings);
  return {
    client: result.totals.client,
    marginPct: result.totals.marginPct,
    lineCalcs: result.lineCalcs,
    lines,
    modules: moduleGroups.map(({ module, lines: groupLines }) => ({
      title: module.name,
      sub: module.widthMm && module.heightMm ? `${module.widthMm}×${module.heightMm}${module.depthMm ? `×${module.depthMm}` : ''} мм` : undefined,
      qty: module.qty,
      total: groupLines.reduce((sum, line) => sum + (result.lineCalcs.get(line.id)?.clientSum ?? 0), 0),
    })),
  };
}

function buildClientArgs(project: Project, pricebook: Pricebook | null): ClientDocumentArgs | null {
  if (!pricebook) return null;
  const data = calcProjectData(project, pricebook);
  const details = buildClientOfferDetails(data.lines, data.lineCalcs);
  return {
    project: { ...project, lines: data.lines },
    offer: project.clientOffer ?? {},
    details,
    modules: data.modules,
    total: data.client,
    summary: buildClientProjectSummary(details, project.modules?.length ?? 0),
  };
}

function projectContact(project: Project, client: ClientProfile | null) {
  const offer = project.clientOffer;
  const phone = client?.phones?.[0] || offer?.clientPhone?.trim() || '';
  const email = client?.emails?.[0] || offer?.clientEmail?.trim() || '';
  return {
    phone,
    email,
    contact: offer?.clientContacts?.trim() || [phone, email].filter(Boolean).join(' · '),
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

function clientKey(project: Project, client: ClientProfile | null) {
  return client?.id ?? normalizeClientName(project.client);
}

function buildMessage(template: MessageTemplate, row: CrmRow, client: ClientProfile | null, payment?: ClientProjectPayment) {
  const name = client?.name || row.project.client || 'клиент';
  const total = fmtMoney(row.total);
  const pay = paymentStatusLabel(payment, row.total);
  const nextDate = row.workflow.nextContactAt ? fmtDate(row.workflow.nextContactAt) : 'договорённую дату';
  const terms = row.project.clientOffer?.productionTerms || row.project.clientOffer?.delivery || row.project.clientOffer?.installation || 'согласованный срок';
  switch (template) {
    case 'afterCalc': return `${name}, добрый день! Подготовили предварительный расчёт по проекту «${row.project.name}»: ${total}. Могу отправить КП и уточнить комплектацию.`;
    case 'offerSent': return `${name}, отправили КП по проекту «${row.project.name}» на сумму ${total}. Посмотрите, пожалуйста, и напишите, что скорректировать или согласовываем дальше.`;
    case 'reminder': return `${name}, добрый день! Напоминаю по проекту «${row.project.name}». Договорились вернуться к вопросу ${nextDate}. Подскажите, актуально ли двигаемся дальше?`;
    case 'contract': return `${name}, проект «${row.project.name}» согласован. Подготовим договор и товарный чек. Срок: ${terms}.`;
    case 'prepayment': return `${name}, для запуска проекта «${row.project.name}» нужна предоплата. Сумма проекта ${total}, оплачено ${fmtMoney(pay.paid)}, остаток ${fmtMoney(pay.remainder)}.`;
    case 'ready': return `${name}, ваш заказ «${row.project.name}» готов. Остаток к оплате: ${fmtMoney(pay.remainder)}. Давайте согласуем выдачу/доставку.`;
    case 'delivery': return `${name}, по проекту «${row.project.name}» согласуем выдачу/монтаж. Напишите, пожалуйста, удобные дату и время.`;
    default: return `${name}, добрый день! По проекту «${row.project.name}» следующий шаг: ${row.workflow.nextAction || defaultNextAction(row.workflow.status)}.`;
  }
}

function hasSoonOrWeek(tone: NextContactTone) {
  return tone === 'overdue' || tone === 'today' || tone === 'soon';
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
  const [filter, setFilter] = useState<CrmFilter>('active');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(props.clients[0]?.id ?? null);
  const [historyText, setHistoryText] = useState('');
  const [messageTemplate, setMessageTemplate] = useState<MessageTemplate>('reminder');
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [docBusy, setDocBusy] = useState<string | null>(null);

  const rows = useMemo<CrmRow[]>(() => props.projects.map((rawProject) => {
    const linked = props.clients.find((client) => client.id === rawProject.clientId) ?? null;
    const project = applyClientProfileToProject(rawProject, linked ?? undefined);
    const pricebook = props.pricebooks.find((item) => item.meta.id === project.pricebookId) ?? props.pricebooks[0] ?? null;
    const workflow = workflowForProject(project);
    const totals = calcProjectData(project, pricebook);
    const contacts = projectContact(project, linked);
    return {
      project,
      client: linked,
      pricebook,
      workflow,
      status: workflowStatusMeta(workflow.status),
      nextTone: nextContactTone(workflow.nextContactAt),
      total: totals.client,
      marginPct: totals.marginPct,
      readiness: projectReadiness(project, pricebook),
      ...contacts,
    };
  }).sort(rowSort), [props.projects, props.clients, props.pricebooks]);

  const activeRows = rows.filter((row) => !isClosedWorkflowStatus(row.workflow.status));
  const dueRows = activeRows.filter((row) => row.nextTone === 'overdue' || row.nextTone === 'today');
  const weekRows = activeRows.filter((row) => hasSoonOrWeek(row.nextTone));
  const noNextRows = activeRows.filter((row) => !row.workflow.nextAction?.trim() || row.nextTone === 'none');
  const duplicateGroups = useMemo(() => findDuplicateClientGroups(props.clients), [props.clients]);

  const clientGroups = useMemo(() => {
    const map = new Map<string, { client: ClientProfile | null; name: string; rows: CrmRow[]; total: number; phone: string; email: string; lastUpdated: string }>();
    for (const row of rows) {
      const key = clientKey(row.project, row.client);
      const existing = map.get(key) ?? { client: row.client, name: row.client?.name || row.project.client?.trim() || 'Без клиента', rows: [], total: 0, phone: '', email: '', lastUpdated: '' };
      existing.rows.push(row);
      existing.total += row.total;
      if (!existing.phone && row.phone) existing.phone = row.phone;
      if (!existing.email && row.email) existing.email = row.email;
      if (!existing.lastUpdated || row.project.updatedAt > existing.lastUpdated) existing.lastUpdated = row.project.updatedAt;
      map.set(key, existing);
    }
    for (const client of props.clients) {
      if (!map.has(client.id)) map.set(client.id, { client, name: client.name || 'Без клиента', rows: [], total: 0, phone: client.phones[0] ?? '', email: client.emails[0] ?? '', lastUpdated: client.updatedAt });
    }
    return Array.from(map.values()).sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
  }, [rows, props.clients]);

  const selectedClient = props.clients.find((client) => client.id === selectedClientId) ?? clientGroups[0]?.client ?? null;
  const selectedRows = selectedClient ? rows.filter((row) => row.client?.id === selectedClient.id) : [];
  const selectedTotal = selectedRows.reduce((sum, row) => sum + row.total, 0);
  const selectedActive = selectedRows.filter((row) => !isClosedWorkflowStatus(row.workflow.status));
  const selectedMessageRow = selectedRows[0] ?? rows[0] ?? null;

  const filteredRows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('ru-RU');
    return rows.filter((row) => {
      if (filter === 'active' && isClosedWorkflowStatus(row.workflow.status)) return false;
      if (filter === 'closed' && !isClosedWorkflowStatus(row.workflow.status)) return false;
      if (filter === 'due' && !(row.nextTone === 'overdue' || row.nextTone === 'today')) return false;
      if (filter === 'week' && !hasSoonOrWeek(row.nextTone)) return false;
      if (filter === 'no-next' && row.workflow.nextAction?.trim() && row.nextTone !== 'none') return false;
      if (!needle) return true;
      return [row.project.name, row.project.client, row.project.comment, row.workflow.nextAction, row.workflow.managerComment, row.phone, row.email, row.contact, row.client?.source, row.client?.tags?.join(' ')]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('ru-RU')
        .includes(needle);
    }).sort(rowSort);
  }, [filter, query, rows]);

  const pipelineRevenue = activeRows.reduce((sum, row) => sum + row.total, 0);
  const updateSelectedClient = (patch: Partial<ClientProfile>) => {
    if (!selectedClient) return;
    props.onClientChange(mergeClientPatch(selectedClient, patch));
  };
  const updatePayment = (client: ClientProfile, projectId: string, patch: Partial<ClientProjectPayment>) => props.onClientChange(updateClientProjectPayment(client, projectId, patch));
  const updateDocs = (client: ClientProfile, projectId: string, patch: Partial<ClientProjectDocuments>) => props.onClientChange(updateClientProjectDocuments(client, projectId, patch));
  const quickSchedule = (row: CrmRow, days: number, action?: string) => {
    props.onWorkflowChange(row.project.id, {
      nextContactAt: scheduleDate(days),
      nextAction: action ?? row.workflow.nextAction ?? defaultNextAction(row.workflow.status),
    });
    if (row.client) props.onClientHistory(row.client.id, { kind: 'contact', title: `Назначен контакт: ${days === 0 ? 'сегодня' : `через ${days} дн.`}`, projectId: row.project.id });
  };
  const changeStatus = (row: CrmRow, status: OrderWorkflowStatus) => props.onWorkflowChange(row.project.id, {
    status,
    nextAction: row.workflow.nextAction?.trim() || defaultNextAction(status),
    nextContactAt: row.workflow.nextContactAt ?? scheduleDate(status === 'clientThinking' ? 2 : 1),
  });

  const runDocumentAction = async (row: CrmRow, kind: 'offer' | 'contract' | 'receipt' | 'package') => {
    const args = buildClientArgs(row.project, row.pricebook);
    if (!args) { alert('Нет прайса для выгрузки документов.'); return; }
    const key = `${row.project.id}-${kind}`;
    setDocBusy(key);
    try {
      if (kind === 'offer') await downloadClientOfferDocx(args);
      if (kind === 'contract') await downloadClientContractDocx(args);
      if (kind === 'receipt') await downloadClientReceiptDocx(args);
      if (kind === 'package') await downloadClientDocumentZip(args, []);
      if (row.client) {
        const docPatch: Partial<ClientProjectDocuments> = kind === 'package' ? { package: 'created' } : { [kind]: 'created' };
        updateDocs(row.client, row.project.id, docPatch);
        props.onClientHistory(row.client.id, { kind: 'document', title: `${kind === 'offer' ? 'КП' : kind === 'contract' ? 'Договор' : kind === 'receipt' ? 'Товарный чек' : 'Пакет клиента'} сформирован`, projectId: row.project.id });
      }
    } catch (error) {
      alert(`Не получилось сформировать документ: ${(error as Error).message}`);
    } finally {
      setDocBusy(null);
    }
  };

  const copyMessage = async () => {
    if (!selectedMessageRow || !selectedClient) return;
    const text = buildMessage(messageTemplate, selectedMessageRow, selectedClient, selectedClient.paymentsByProject?.[selectedMessageRow.project.id]);
    await navigator.clipboard.writeText(text);
    props.onClientHistory(selectedClient.id, { kind: 'contact', title: `Скопирован шаблон сообщения: ${MESSAGE_TEMPLATES.find((item) => item.id === messageTemplate)?.label}`, text, projectId: selectedMessageRow.project.id });
    setCopiedMessage(true);
    setTimeout(() => setCopiedMessage(false), 1200);
  };

  return (
    <div className="page crm-view">
      <header className="page-head crm-page-head">
        <div>
          <span className="eyebrow">CRM 2.0</span>
          <h1>Клиенты, заказы и документы</h1>
          <div className="muted">Единая клиентская база: карточка клиента, проекты, задачи, оплаты, документы и история в одном месте.</div>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => searchRef.current?.focus()}>Найти клиента</button>
          <button className="btn primary" onClick={() => setFilter('due')}>Что сделать сегодня</button>
        </div>
      </header>

      <section className="crm-command card">
        <div className="crm-command-main">
          <h2>{dueRows.length > 0 ? `Сегодня нужно связаться: ${dueRows.length}` : 'На сегодня критичных контактов нет'}</h2>
          <p>CRM сама подсвечивает просрочки, задачи на неделю, клиентов без контактов, проекты без следующего шага и дубли в базе.</p>
        </div>
        <div className="crm-metrics">
          <button type="button" onClick={() => setFilter('active')}><b>{activeRows.length}</b><span>активных заказов</span></button>
          <button type="button" onClick={() => setFilter('due')}><b>{dueRows.length}</b><span>сегодня / просрочено</span></button>
          <button type="button" onClick={() => setFilter('week')}><b>{weekRows.length}</b><span>на неделю</span></button>
          <button type="button" onClick={() => setFilter('no-next')}><b>{noNextRows.length}</b><span>без шага/даты</span></button>
          <button type="button" onClick={() => setFilter('active')}><b>{fmtMoney(pipelineRevenue)}</b><span>активный портфель</span></button>
          <button type="button" onClick={() => setQuery('') }><b>{duplicateGroups.length}</b><span>дублей в базе</span></button>
        </div>
      </section>

      <section className="crm-board card">
        <div className="section-head"><div><h3>Воронка заказов</h3><p className="muted small">Статусы CRM, суммы и срочность контакта по всем клиентам.</p></div></div>
        <div className="crm-columns">
          {CRM_COLUMNS.map((column) => {
            const columnRows = rows.filter((row) => column.statuses.includes(row.workflow.status));
            return <div className="crm-column" key={column.id}>
              <div className="crm-column-head"><b>{column.title}</b><span>{columnRows.length} · {fmtMoney(columnRows.reduce((sum, row) => sum + row.total, 0))}</span><small>{column.subtitle}</small></div>
              <div className="crm-column-cards">
                {columnRows.slice(0, 8).map((row) => <button type="button" className={`crm-mini-card tone-${row.nextTone}`} key={row.project.id} onClick={() => row.client ? setSelectedClientId(row.client.id) : props.onOpen(row.project.id)}>
                  <b>{row.client?.name || row.project.client || 'Без клиента'}</b>
                  <span>{row.project.name}</span>
                  <small>{toneLabel(row.nextTone, row.workflow.nextContactAt)} · {fmtMoney(row.total)}</small>
                </button>)}
                {columnRows.length === 0 && <div className="crm-column-empty">Нет проектов на этапе</div>}
              </div>
            </div>;
          })}
        </div>
      </section>

      {selectedClient && (
        <section className="card crm-client-360">
          <div className="crm-client-360-head">
            <div><span className="eyebrow">Карточка клиента 360°</span><h2>{selectedClient.name}</h2><p>{selectedRows.length} проект(а), активных: {selectedActive.length}, сумма: {fmtMoney(selectedTotal)}</p></div>
            <div className="crm-client-tags">{selectedClient.tags.length === 0 ? <span>без тегов</span> : selectedClient.tags.map((tag) => <span key={tag}>{CLIENT_TAGS.find((item) => item.id === tag)?.label ?? tag}</span>)}</div>
          </div>
          <div className="crm-client-360-grid">
            <div className="crm-client-fields">
              <label>Имя клиента<input value={selectedClient.name} onChange={(event) => updateSelectedClient({ name: event.target.value })} /></label>
              <label>Телефоны<input value={selectedClient.phones.join(', ')} onChange={(event) => updateSelectedClient({ phones: splitContactList(event.target.value) })} placeholder="+7…, второй телефон" /></label>
              <label>Email<input value={selectedClient.emails.join(', ')} onChange={(event) => updateSelectedClient({ emails: splitContactList(event.target.value) })} /></label>
              <label>Адрес объекта<input value={selectedClient.objectAddress ?? ''} onChange={(event) => updateSelectedClient({ objectAddress: event.target.value })} /></label>
              <label>Адрес доставки/монтажа<input value={selectedClient.deliveryAddress ?? ''} onChange={(event) => updateSelectedClient({ deliveryAddress: event.target.value })} /></label>
              <label>Источник клиента<input value={selectedClient.source ?? ''} onChange={(event) => updateSelectedClient({ source: event.target.value })} placeholder="сайт, рекомендации, дизайнер…" /></label>
              <label className="span-2">Паспорт / договорные данные<textarea rows={2} value={selectedClient.passport ?? ''} onChange={(event) => updateSelectedClient({ passport: event.target.value })} /></label>
              <label className="span-2">Комментарий менеджера<textarea rows={3} value={selectedClient.managerComment ?? ''} onChange={(event) => updateSelectedClient({ managerComment: event.target.value })} placeholder="Что важно помнить по клиенту" /></label>
              <div className="span-2 crm-tag-picker">{CLIENT_TAGS.map((tag) => {
                const active = selectedClient.tags.includes(tag.id);
                return <button type="button" key={tag.id} className={active ? 'active' : ''} onClick={() => updateSelectedClient({ tags: active ? selectedClient.tags.filter((item) => item !== tag.id) : [...selectedClient.tags, tag.id] })}>{tag.label}</button>;
              })}</div>
            </div>

            <div className="crm-client-message">
              <h3>Сообщение клиенту</h3>
              <label>Шаблон<select value={messageTemplate} onChange={(event) => setMessageTemplate(event.target.value as MessageTemplate)}>{MESSAGE_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}</select></label>
              <textarea readOnly rows={6} value={selectedMessageRow ? buildMessage(messageTemplate, selectedMessageRow, selectedClient, selectedClient.paymentsByProject?.[selectedMessageRow.project.id]) : 'Нет проекта для сообщения'} />
              <button type="button" className="btn primary" disabled={!selectedMessageRow} onClick={() => void copyMessage()}>{copiedMessage ? '✓ Скопировано' : 'Скопировать в WhatsApp'}</button>
            </div>
          </div>

          <div className="crm-client-projects">
            <div className="section-head"><div><h3>Проекты, деньги и документы</h3><p className="muted small">Сумма, предоплата, остаток, документы и быстрые действия без перехода по вкладкам.</p></div></div>
            {selectedRows.length === 0 ? <div className="empty small">У клиента пока нет проектов.</div> : selectedRows.map((row) => {
              const payment = selectedClient.paymentsByProject?.[row.project.id];
              const pay = paymentStatusLabel(payment, row.total);
              const docs = selectedClient.documentsByProject?.[row.project.id] ?? {};
              return <article className="crm-client-project-row" key={row.project.id}>
                <div className="crm-client-project-main"><button className="linkish" onClick={() => props.onOpen(row.project.id)}><b>{row.project.name}</b><span>{row.status.label} · {toneLabel(row.nextTone, row.workflow.nextContactAt)}</span></button><strong>{fmtMoney(row.total)}</strong></div>
                <div className="crm-client-money">
                  <label>Оплачено<input type="number" value={payment?.paidTotal ?? payment?.prepayment ?? ''} onChange={(event) => updatePayment(selectedClient, row.project.id, { paidTotal: event.target.value === '' ? null : Number(event.target.value), status: Number(event.target.value) >= row.total ? 'paid' : Number(event.target.value) > 0 ? 'prepaid' : 'none' })} /></label>
                  <span className={`payment-pill ${pay.tone}`}>{pay.label}: оплачено {fmtMoney(pay.paid)} · остаток {fmtMoney(pay.remainder)}</span>
                  <label>Дата оплаты<input type="date" value={payment?.paymentDate ?? ''} onChange={(event) => updatePayment(selectedClient, row.project.id, { paymentDate: event.target.value || undefined })} /></label>
                  <label>Комментарий<input value={payment?.comment ?? ''} onChange={(event) => updatePayment(selectedClient, row.project.id, { comment: event.target.value })} placeholder="предоплата, долг, банк…" /></label>
                </div>
                <div className="crm-doc-status-grid">{(Object.keys(DOC_LABELS) as Array<keyof typeof DOC_LABELS>).map((key) => <label key={key}>{DOC_LABELS[key]}<select value={docs[key] ?? 'none'} onChange={(event) => updateDocs(selectedClient, row.project.id, { [key]: event.target.value as ClientDocumentState })}>{DOC_STATES.map((state) => <option key={state.value} value={state.value}>{state.label}</option>)}</select></label>)}</div>
                <div className="crm-client-project-actions">
                  <button className="btn tiny ghost" onClick={() => props.onOpen(row.project.id)}>Открыть проект</button>
                  <button className="btn tiny ghost" onClick={() => changeStatus(row, 'offerSent')}>КП отправлено</button>
                  <button className="btn tiny ghost" onClick={() => changeStatus(row, 'approved')}>Согласовано</button>
                  <button className="btn tiny ghost" onClick={() => changeStatus(row, 'factorySent')}>Фабрика</button>
                  <button className="btn tiny ghost" disabled={docBusy === `${row.project.id}-offer`} onClick={() => void runDocumentAction(row, 'offer')}>КП Word</button>
                  <button className="btn tiny ghost" disabled={docBusy === `${row.project.id}-contract`} onClick={() => void runDocumentAction(row, 'contract')}>Договор</button>
                  <button className="btn tiny ghost" disabled={docBusy === `${row.project.id}-receipt`} onClick={() => void runDocumentAction(row, 'receipt')}>Чек</button>
                  <button className="btn tiny primary" disabled={docBusy === `${row.project.id}-package`} onClick={() => void runDocumentAction(row, 'package')}>ZIP</button>
                </div>
              </article>;
            })}
          </div>

          <div className="crm-client-history">
            <div className="section-head"><div><h3>История общения и действий</h3><p className="muted small">Статусы и документы пишутся автоматически, заметки можно добавить вручную.</p></div></div>
            <div className="crm-history-add"><input value={historyText} onChange={(event) => setHistoryText(event.target.value)} placeholder="Например: клиент попросил вариант дешевле, согласовал Rehau…" onKeyDown={(event) => { if (event.key === 'Enter' && historyText.trim()) { props.onClientHistory(selectedClient.id, { kind: 'note', title: historyText.trim() }); setHistoryText(''); } }} /><button className="btn ghost" onClick={() => { if (historyText.trim()) { props.onClientHistory(selectedClient.id, { kind: 'note', title: historyText.trim() }); setHistoryText(''); } }}>Добавить</button></div>
            <div className="crm-history-list">{selectedClient.history.length === 0 ? <div className="empty small">История пока пустая.</div> : selectedClient.history.slice(0, 12).map((entry) => <div key={entry.id}><b>{entry.title}</b><span>{fmtDate(entry.createdAt)} · {entry.kind}</span>{entry.text && <small>{entry.text}</small>}</div>)}</div>
          </div>
        </section>
      )}

      <div className="crm-workbench">
        <section className="card crm-action-panel">
          <div className="section-head"><div><h3>Рабочий список CRM</h3><p className="muted small">Меняйте этап, следующий шаг и дату контакта прямо здесь.</p></div><b>{filteredRows.length}</b></div>
          <div className="crm-filters">
            <label className="crm-search">Поиск<input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Клиент, проект, телефон, комментарий…" /></label>
            <label>Фокус<select value={filter} onChange={(event) => setFilter(event.target.value as CrmFilter)}>{statusFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          </div>
          <div className="crm-action-list">
            {filteredRows.length === 0 ? <div className="empty small">По выбранным фильтрам задач нет.</div> : filteredRows.map((row) => (
              <article className={`crm-row tone-${row.nextTone}`} key={row.project.id}>
                <div className="crm-row-main">
                  <button type="button" className="linkish" onClick={() => row.client ? setSelectedClientId(row.client.id) : props.onOpen(row.project.id)}><b>{row.client?.name || row.project.client || 'Без клиента'}</b><span>{row.project.name}</span></button>
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
          <div className="section-head"><div><h3>Клиентская база</h3><p className="muted small">Открывайте карточку клиента, находите дубли и пустые контакты.</p></div><b>{clientGroups.length}</b></div>
          {duplicateGroups.length > 0 && <div className="crm-duplicates"><b>Возможные дубли</b>{duplicateGroups.slice(0, 4).map((group) => <div key={group.reason}><span>{group.reason}</span>{group.clients.slice(1).map((client) => <button key={client.id} onClick={() => props.onMergeClients(group.clients[0].id, client.id)}>объединить {client.name} → {group.clients[0].name}</button>)}</div>)}</div>}
          <div className="crm-client-list">
            {clientGroups.slice(0, 24).map((client) => {
              const activeCount = client.rows.filter((row) => !isClosedWorkflowStatus(row.workflow.status)).length;
              const noContact = !client.phone && !client.email;
              return <button type="button" className={`${selectedClient?.id === client.client?.id ? 'active' : ''} ${noContact ? 'needs-contact' : ''}`} key={client.client?.id ?? client.name} onClick={() => { if (client.client) setSelectedClientId(client.client.id); setQuery(client.name === 'Без клиента' ? '' : client.name); setFilter('all'); }}>
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
