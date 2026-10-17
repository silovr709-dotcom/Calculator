// Карточка сделки: всё по клиенту и заказу в одном окне — задачи, деньги,
// документы, контакты и лента событий. Список на экране CRM остаётся списком.

import { useEffect, useMemo, useState } from 'react';
import type {
  ClientDocumentState, ClientProfile, ClientProjectDocuments, ClientProjectPayment,
  CrmTask, CrmTaskKind, OrderWorkflow, OrderWorkflowStatus, PaymentKind, Project, ProjectSchedule,
} from '../types';
import { Overlay } from './Portal';
import { fmtDate, fmtMoney } from '../lib/format';
import { CLIENT_TAGS, splitContactList } from '../lib/clientProfiles';
import { ORDER_WORKFLOW_STATUSES, dateInputToIso, dateInputValue, defaultNextAction } from '../lib/crm';
import { toneLabel } from '../lib/crmBoard';
import {
  PAYMENT_KINDS, TASK_KINDS, paymentEntries, paymentState, sortTasks, taskKindMeta, taskTone,
} from '../lib/crmTasks';
import { buildDealTimeline } from '../lib/crmTimeline';
import type { NextContactTone } from '../lib/crm';

export interface DealOfferLink {
  url: string;
  views: number;
  lastViewAt: string | null;
  createdAt?: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

export interface DealCard {
  project: Project;
  clientName: string;
  client: ClientProfile | null;
  workflow: OrderWorkflow;
  tone: NextContactTone;
  total: number;
  marginPct: number | null;
  phone: string;
  email: string;
  payment?: ClientProjectPayment;
  documents: Partial<ClientProjectDocuments>;
  offerLink: DealOfferLink | null;
}

const DOC_LABELS: Array<{ key: keyof Omit<ClientProjectDocuments, 'updatedAt' | 'comment'>; label: string }> = [
  { key: 'offer', label: 'КП' },
  { key: 'contract', label: 'Договор' },
  { key: 'receipt', label: 'Чек' },
  { key: 'sketch', label: 'Эскиз' },
  { key: 'factoryBlank', label: 'Фабрика' },
  { key: 'package', label: 'Пакет' },
];

const DOC_STATES: Array<{ value: ClientDocumentState; label: string }> = [
  { value: 'none', label: '—' },
  { value: 'created', label: 'создан' },
  { value: 'sent', label: 'отправлен' },
  { value: 'approved', label: 'согласован' },
];

const LOST_REASONS = ['Дорого', 'Выбрал другого подрядчика', 'Передумал / отложил', 'Не устроили сроки', 'Не вышли на связь', 'Другое'];

type Tab = 'deal' | 'tasks' | 'works' | 'money' | 'client' | 'timeline';

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function CrmDealDialog(props: {
  card: DealCard;
  message: string;
  assignees: string[];
  docBusy: string | null;
  onClose: () => void;
  onOpenProject: () => void;
  onWorkflow: (patch: Partial<OrderWorkflow>) => void;
  onClient: (patch: Partial<ClientProfile>) => void;
  onPaymentAdd: (entry: { amount: number; at: string; kind: PaymentKind; comment?: string }) => void;
  onPaymentRemove: (id: string) => void;
  onDocuments: (patch: Partial<ClientProjectDocuments>) => void;
  onTaskAdd: (task: { title: string; kind: CrmTaskKind; dueAt?: string; assignee?: string }) => void;
  onTaskToggle: (taskId: string) => void;
  onTaskRemove: (taskId: string) => void;
  onSchedulePatch: (patch: Partial<ProjectSchedule>) => void;
  onOpenSchedule: () => void;
  onNote: (text: string) => void;
  onSchedule: (days: number) => void;
  onDocumentExport: (kind: 'offer' | 'contract' | 'receipt' | 'package') => void;
}) {
  const { card } = props;
  const [tab, setTab] = useState<Tab>('deal');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);

  const [taskTitle, setTaskTitle] = useState('');
  const [taskKind, setTaskKind] = useState<CrmTaskKind>('call');
  const [taskDue, setTaskDue] = useState(todayInput());
  const [taskWho, setTaskWho] = useState('');

  const [payAmount, setPayAmount] = useState('');
  const [payKind, setPayKind] = useState<PaymentKind>('prepay');
  const [payDate, setPayDate] = useState(todayInput());
  const [payComment, setPayComment] = useState('');

  const pay = paymentState(card.payment, card.total);
  const tasks = useMemo(() => sortTasks(card.project.tasks ?? []), [card.project.tasks]);
  const openCount = tasks.filter((task) => !task.done).length;
  const timeline = useMemo(() => buildDealTimeline({
    project: card.project,
    history: card.client?.history ?? [],
    payment: card.payment,
    offer: card.offerLink,
  }), [card.project, card.client, card.payment, card.offerLink]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const copyMessage = async () => {
    await navigator.clipboard.writeText(props.message).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const submitTask = () => {
    const title = taskTitle.trim() || taskKindMeta(taskKind).label;
    props.onTaskAdd({ title, kind: taskKind, dueAt: taskDue || undefined, assignee: taskWho.trim() || undefined });
    setTaskTitle('');
  };

  const submitPayment = () => {
    const amount = Number(payAmount.replace(',', '.'));
    if (!Number.isFinite(amount) || amount === 0) return;
    props.onPaymentAdd({
      amount: payKind === 'refund' ? -Math.abs(amount) : Math.abs(amount),
      at: payDate || todayInput(),
      kind: payKind,
      comment: payComment.trim() || undefined,
    });
    setPayAmount('');
    setPayComment('');
  };

  const taskRow = (task: CrmTask) => {
    const tone = taskTone(task);
    const meta = taskKindMeta(task.kind);
    return (
      <li key={task.id} className={`crm-task tone-${tone}`}>
        <label>
          <input type="checkbox" checked={Boolean(task.done)} onChange={() => props.onTaskToggle(task.id)} />
          <span className="crm-task-icon" aria-hidden="true">{meta.icon}</span>
          <span className="crm-task-text">
            <b>{task.title}</b>
            <small>
              {meta.label}
              {task.dueAt ? ` · ${fmtDate(task.dueAt)}` : ' · без срока'}
              {tone === 'overdue' ? ' · просрочено' : tone === 'today' ? ' · сегодня' : ''}
              {task.assignee ? ` · ${task.assignee}` : ''}
            </small>
          </span>
        </label>
        <button type="button" className="crm-task-remove" aria-label="Удалить задачу" onClick={() => props.onTaskRemove(task.id)}>✕</button>
      </li>
    );
  };

  return (
    <Overlay className="crm-dialog-backdrop" onClick={props.onClose}>
      <div className="crm-dialog" role="dialog" aria-label={`Сделка ${card.project.name}`} onClick={(event) => event.stopPropagation()}>
        <header className="crm-dialog-head">
          <div>
            <span className="eyebrow">{card.clientName}</span>
            <h2>{card.project.name}</h2>
            <p>
              {fmtMoney(card.total)}
              {card.marginPct != null && ` · маржа ${card.marginPct.toFixed(1)} %`}
              {` · ${toneLabel(card.tone, card.workflow.nextContactAt)}`}
              {card.workflow.assignee ? ` · ведёт ${card.workflow.assignee}` : ''}
            </p>
          </div>
          <div className="crm-dialog-head-actions">
            <button type="button" className="btn primary" onClick={props.onOpenProject}>Открыть проект</button>
            <button type="button" className="btn ghost" onClick={props.onClose} aria-label="Закрыть">✕</button>
          </div>
        </header>

        <nav className="crm-dialog-tabs">
          {([
            ['deal', 'Сделка'],
            ['tasks', openCount > 0 ? `Задачи · ${openCount}` : 'Задачи'],
            ['works', card.project.schedule?.installAt ? 'Работы · назначено' : 'Работы'],
            ['money', 'Деньги и документы'],
            ['client', 'Клиент'],
            ['timeline', 'Лента'],
          ] as Array<[Tab, string]>).map(([id, label]) => (
            <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>

        <div className="crm-dialog-body">
          {tab === 'deal' && (
            <>
              <div className="crm-dialog-grid">
                <label>Этап
                  <select value={card.workflow.status} onChange={(event) => props.onWorkflow({ status: event.target.value as OrderWorkflowStatus })}>
                    {ORDER_WORKFLOW_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}
                  </select>
                </label>
                <label>Ответственный
                  <input list="crm-assignees" value={card.workflow.assignee ?? ''} placeholder="кто ведёт сделку"
                    onChange={(event) => props.onWorkflow({ assignee: event.target.value })} />
                  <datalist id="crm-assignees">
                    {props.assignees.map((name) => <option key={name} value={name} />)}
                  </datalist>
                </label>
                <label>Дата следующего контакта
                  <input type="date" value={dateInputValue(card.workflow.nextContactAt)}
                    onChange={(event) => props.onWorkflow({ nextContactAt: dateInputToIso(event.target.value) })} />
                </label>
                <label>Следующий шаг
                  <input defaultValue={card.workflow.nextAction ?? ''} placeholder={defaultNextAction(card.workflow.status)}
                    onBlur={(event) => { if (event.target.value !== (card.workflow.nextAction ?? '')) props.onWorkflow({ nextAction: event.target.value }); }} />
                </label>
                {card.workflow.status === 'rejected' && (
                  <label className="span-2">Причина отказа
                    <select value={card.workflow.lostReason ?? ''} onChange={(event) => props.onWorkflow({ lostReason: event.target.value })}>
                      <option value="">выберите причину</option>
                      {LOST_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                    </select>
                  </label>
                )}
                <label>Дата монтажа
                  <input type="date" value={card.project.schedule?.installAt ?? ''}
                    onChange={(event) => props.onSchedulePatch({ installAt: event.target.value || undefined })} />
                </label>
                <label>Бригада на монтаж
                  <input value={card.project.schedule?.team ?? ''} placeholder="кто монтирует"
                    onChange={(event) => props.onSchedulePatch({ team: event.target.value })} />
                </label>
                <label className="span-2">Заметка менеджера
                  <textarea rows={2} defaultValue={card.workflow.managerComment ?? ''} placeholder="Что согласовано, чего ждём, возражения"
                    onBlur={(event) => { if (event.target.value !== (card.workflow.managerComment ?? '')) props.onWorkflow({ managerComment: event.target.value }); }} />
                </label>
              </div>

              <div className="crm-dialog-quick">
                <b>Напомнить</b>
                <button type="button" onClick={() => props.onSchedule(0)}>сегодня</button>
                <button type="button" onClick={() => props.onSchedule(1)}>завтра</button>
                <button type="button" onClick={() => props.onSchedule(3)}>через 3 дня</button>
                <button type="button" onClick={() => props.onSchedule(7)}>через неделю</button>
                <button type="button" onClick={() => props.onWorkflow({ nextContactAt: undefined })}>убрать дату</button>
              </div>

              <div className="crm-dialog-contact">
                <b>Связаться</b>
                {card.phone
                  ? <a className="btn tiny ghost" href={`tel:${card.phone.replace(/[^+\d]/g, '')}`}>Позвонить {card.phone}</a>
                  : <span className="muted small">Телефон не заполнен — добавьте во вкладке «Клиент».</span>}
                {card.email && <a className="btn tiny ghost" href={`mailto:${card.email}`}>Написать</a>}
                {card.phone && <a className="btn tiny ghost" href={`https://wa.me/${card.phone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(props.message)}`} target="_blank" rel="noreferrer">WhatsApp</a>}
                <button type="button" className="btn tiny" onClick={() => void copyMessage()}>{copied ? '✓ Скопировано' : 'Скопировать текст'}</button>
              </div>
              <p className="crm-dialog-message">{props.message}</p>
            </>
          )}

          {tab === 'tasks' && (
            <>
              <div className="crm-task-form">
                <input value={taskTitle} placeholder="Что сделать: позвонить, согласовать цвет…" onChange={(event) => setTaskTitle(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') submitTask(); }} />
                <select value={taskKind} onChange={(event) => setTaskKind(event.target.value as CrmTaskKind)}>
                  {TASK_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
                </select>
                <input type="date" value={taskDue} onChange={(event) => setTaskDue(event.target.value)} />
                <input list="crm-assignees" value={taskWho} placeholder="кто" onChange={(event) => setTaskWho(event.target.value)} />
                <button type="button" className="btn primary" onClick={submitTask}>Добавить</button>
              </div>
              {tasks.length === 0
                ? <div className="empty small">Задач нет. Добавьте звонок, замер или напоминание об оплате — они появятся в списке «Сегодня».</div>
                : <ul className="crm-task-list">{tasks.map(taskRow)}</ul>}
            </>
          )}

          {tab === 'works' && (
            <>
              <div className="crm-works-grid">
                <label>Замер
                  <input type="date" value={card.project.schedule?.measureAt ?? ''}
                    onChange={(event) => props.onSchedulePatch({ measureAt: event.target.value || undefined })} />
                </label>
                <label>Готовность на фабрике
                  <input type="date" value={card.project.schedule?.readyAt ?? ''}
                    onChange={(event) => props.onSchedulePatch({ readyAt: event.target.value || undefined })} />
                </label>
                <label>Доставка
                  <input type="date" value={card.project.schedule?.deliveryAt ?? ''}
                    onChange={(event) => props.onSchedulePatch({ deliveryAt: event.target.value || undefined })} />
                </label>
                <label>Монтаж
                  <input type="date" value={card.project.schedule?.installAt ?? ''}
                    onChange={(event) => props.onSchedulePatch({ installAt: event.target.value || undefined })} />
                </label>
                <label>Дней монтажа
                  <input type="number" min={1} max={14} value={card.project.schedule?.installDays ?? 1}
                    onChange={(event) => props.onSchedulePatch({ installDays: Math.max(1, Number(event.target.value) || 1) })} />
                </label>
                <label>Бригада
                  <input value={card.project.schedule?.team ?? ''} placeholder="кто монтирует"
                    onChange={(event) => props.onSchedulePatch({ team: event.target.value })} />
                </label>
                <label className="span-2">Адрес объекта
                  <input value={card.project.schedule?.address ?? ''} placeholder="куда ехать"
                    onChange={(event) => props.onSchedulePatch({ address: event.target.value })} />
                </label>
              </div>

              <div className="crm-works-actions">
                <button type="button" className="btn ghost" onClick={props.onOpenSchedule}>Открыть график работ</button>
                {!card.project.schedule?.address && card.client?.objectAddress && (
                  <button type="button" className="btn ghost"
                    onClick={() => props.onSchedulePatch({ address: card.client?.objectAddress })}>
                    Подставить адрес клиента
                  </button>
                )}
              </div>

              <div className="crm-works-summary">
                {['measureAt', 'readyAt', 'deliveryAt', 'installAt'].every((field) => !card.project.schedule?.[field as 'installAt'])
                  ? <span className="muted small">Даты ещё не назначены. Поставьте замер или монтаж — они сразу появятся в графике работ, в подписке календаря и в напоминаниях.</span>
                  : <ul>
                      {card.project.schedule?.measureAt && <li><b>Замер</b><span>{fmtDate(card.project.schedule.measureAt)}</span></li>}
                      {card.project.schedule?.readyAt && <li><b>Готовность</b><span>{fmtDate(card.project.schedule.readyAt)}</span></li>}
                      {card.project.schedule?.deliveryAt && <li><b>Доставка</b><span>{fmtDate(card.project.schedule.deliveryAt)}</span></li>}
                      {card.project.schedule?.installAt && (
                        <li className="accent">
                          <b>Монтаж</b>
                          <span>{fmtDate(card.project.schedule.installAt)}{card.project.schedule.team ? ` · ${card.project.schedule.team}` : ''}</span>
                        </li>
                      )}
                    </ul>}
              </div>
            </>
          )}

          {tab === 'money' && (
            <>
              <div className={`crm-dialog-payment ${pay.tone}`}>
                <b>{pay.label}</b>
                <span>оплачено {fmtMoney(pay.paid)} · остаток {fmtMoney(pay.remainder)} из {fmtMoney(card.total)}</span>
              </div>

              <div className="crm-pay-form">
                <input value={payAmount} inputMode="decimal" placeholder="Сумма, ₽" onChange={(event) => setPayAmount(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') submitPayment(); }} />
                <select value={payKind} onChange={(event) => setPayKind(event.target.value as PaymentKind)}>
                  {PAYMENT_KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
                </select>
                <input type="date" value={payDate} onChange={(event) => setPayDate(event.target.value)} />
                <input value={payComment} placeholder="комментарий" onChange={(event) => setPayComment(event.target.value)} />
                <button type="button" className="btn primary" onClick={submitPayment}>Записать платёж</button>
              </div>

              {paymentEntries(card.payment).length > 0 && (
                <ul className="crm-pay-list">
                  {paymentEntries(card.payment).map((entry) => (
                    <li key={entry.id}>
                      <b>{fmtMoney(entry.amount)}</b>
                      <span>{PAYMENT_KINDS.find((kind) => kind.id === entry.kind)?.label} · {fmtDate(entry.at)}{entry.comment ? ` · ${entry.comment}` : ''}</span>
                      <button type="button" aria-label="Удалить платёж" onClick={() => props.onPaymentRemove(entry.id)}>✕</button>
                    </li>
                  ))}
                </ul>
              )}

              {card.offerLink && (
                <div className={`crm-dialog-offerlink${card.offerLink.approvedAt ? ' approved' : ''}`}>
                  <b>Ссылка клиенту на КП</b>
                  <input readOnly value={card.offerLink.url} onFocus={(event) => event.target.select()} />
                  <span>
                    {card.offerLink.approvedAt
                      ? `Согласовано: ${card.offerLink.approvedBy} · ${fmtDate(card.offerLink.approvedAt)}`
                      : card.offerLink.views > 0
                        ? `Клиент открывал ${card.offerLink.views} раз${card.offerLink.lastViewAt ? `, последний — ${fmtDate(card.offerLink.lastViewAt)}` : ''}`
                        : 'Ссылку ещё не открывали'}
                  </span>
                </div>
              )}

              <div className="crm-dialog-docs">
                <b>Документы</b>
                <div className="crm-dialog-docs-grid">
                  {DOC_LABELS.map((doc) => (
                    <label key={doc.key}>{doc.label}
                      <select value={card.documents[doc.key] ?? 'none'} onChange={(event) => props.onDocuments({ [doc.key]: event.target.value as ClientDocumentState })}>
                        {DOC_STATES.map((state) => <option key={state.value} value={state.value}>{state.label}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
                <div className="crm-dialog-docs-actions">
                  {([['offer', 'КП Word'], ['contract', 'Договор'], ['receipt', 'Товарный чек'], ['package', 'Пакет ZIP']] as Array<['offer' | 'contract' | 'receipt' | 'package', string]>)
                    .map(([kind, label]) => (
                      <button key={kind} type="button" className="btn tiny ghost" disabled={props.docBusy === `${card.project.id}-${kind}`}
                        onClick={() => props.onDocumentExport(kind)}>
                        {props.docBusy === `${card.project.id}-${kind}` ? 'Готовлю…' : label}
                      </button>
                    ))}
                </div>
              </div>
            </>
          )}

          {tab === 'client' && (card.client ? (
            <div className="crm-dialog-grid">
              <label>Имя<input value={card.client.name} onChange={(event) => props.onClient({ name: event.target.value })} /></label>
              <label>Источник<input value={card.client.source ?? ''} placeholder="сайт, рекомендация, дизайнер" onChange={(event) => props.onClient({ source: event.target.value })} /></label>
              <label>Телефоны<input value={card.client.phones.join(', ')} placeholder="+7…" onChange={(event) => props.onClient({ phones: splitContactList(event.target.value) })} /></label>
              <label>Email<input value={card.client.emails.join(', ')} onChange={(event) => props.onClient({ emails: splitContactList(event.target.value) })} /></label>
              <label>Адрес объекта<input value={card.client.objectAddress ?? ''} onChange={(event) => props.onClient({ objectAddress: event.target.value })} /></label>
              <label>Адрес доставки<input value={card.client.deliveryAddress ?? ''} onChange={(event) => props.onClient({ deliveryAddress: event.target.value })} /></label>
              <label className="span-2">Паспортные и договорные данные<textarea rows={2} value={card.client.passport ?? ''} onChange={(event) => props.onClient({ passport: event.target.value })} /></label>
              <label className="span-2">Что важно помнить<textarea rows={2} value={card.client.managerComment ?? ''} onChange={(event) => props.onClient({ managerComment: event.target.value })} /></label>
              <div className="span-2 crm-dialog-tags">
                {CLIENT_TAGS.map((tag) => {
                  const active = card.client?.tags.includes(tag.id) ?? false;
                  return (
                    <button key={tag.id} type="button" className={active ? 'active' : ''}
                      onClick={() => props.onClient({ tags: active ? (card.client?.tags ?? []).filter((item) => item !== tag.id) : [...(card.client?.tags ?? []), tag.id] })}>
                      {tag.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="empty small">Сделка не привязана к карточке клиента. Откройте проект и укажите клиента — появятся контакты, оплаты и история.</div>
          ))}

          {tab === 'timeline' && (
            <>
              <div className="crm-dialog-note">
                <input value={note} placeholder="Записать в ленту: о чём договорились"
                  onChange={(event) => setNote(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && note.trim()) { props.onNote(note.trim()); setNote(''); } }} />
                <button type="button" className="btn ghost" disabled={!note.trim()} onClick={() => { props.onNote(note.trim()); setNote(''); }}>Записать</button>
              </div>
              <div className="crm-timeline">
                {timeline.length === 0
                  ? <div className="empty small">Событий пока нет: статусы, задачи, оплаты и документы появятся здесь сами.</div>
                  : timeline.map((event) => (
                    <div key={event.id} className={`crm-timeline-item kind-${event.kind}`}>
                      <span className="crm-timeline-date">{fmtDate(event.at)}</span>
                      <div>
                        <b>{event.title}</b>
                        {event.detail && <small>{event.detail}</small>}
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
      </div>
    </Overlay>
  );
}
