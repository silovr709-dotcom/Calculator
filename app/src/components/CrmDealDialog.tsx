// Карточка сделки в всплывающем окне: контакты, деньги, документы, история.
// Список на экране остаётся списком — всё подробное открывается здесь.

import { useEffect, useState } from 'react';
import type {
  ClientDocumentState, ClientProfile, ClientProjectDocuments, ClientProjectPayment,
  OrderWorkflow, OrderWorkflowStatus,
} from '../types';
import { Overlay } from './Portal';
import { fmtDate, fmtMoney } from '../lib/format';
import { CLIENT_TAGS, paymentStatusLabel, splitContactList } from '../lib/clientProfiles';
import { ORDER_WORKFLOW_STATUSES, dateInputToIso, dateInputValue, defaultNextAction } from '../lib/crm';
import { toneLabel } from '../lib/crmBoard';
import type { NextContactTone } from '../lib/crm';

export interface DealCard {
  projectId: string;
  projectName: string;
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
  offerLink?: { url: string; views: number; approvedAt: string | null; approvedBy: string | null } | null;
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

type Tab = 'deal' | 'money' | 'client' | 'history';

export default function CrmDealDialog(props: {
  card: DealCard;
  message: string;
  onClose: () => void;
  onOpenProject: () => void;
  onWorkflow: (patch: Partial<OrderWorkflow>) => void;
  onClient: (patch: Partial<ClientProfile>) => void;
  onPayment: (patch: Partial<ClientProjectPayment>) => void;
  onDocuments: (patch: Partial<ClientProjectDocuments>) => void;
  onNote: (text: string) => void;
  onSchedule: (days: number) => void;
  onDocumentExport: (kind: 'offer' | 'contract' | 'receipt' | 'package') => void;
  docBusy: string | null;
}) {
  const { card } = props;
  const [tab, setTab] = useState<Tab>('deal');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const pay = paymentStatusLabel(card.payment, card.total);

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

  return (
    <Overlay className="crm-dialog-backdrop" onClick={props.onClose}>
      <div className="crm-dialog" role="dialog" aria-label={`Сделка ${card.projectName}`} onClick={(event) => event.stopPropagation()}>
        <header className="crm-dialog-head">
          <div>
            <span className="eyebrow">{card.clientName}</span>
            <h2>{card.projectName}</h2>
            <p>
              {fmtMoney(card.total)}
              {card.marginPct != null && ` · маржа ${card.marginPct.toFixed(1)} %`}
              {` · ${toneLabel(card.tone, card.workflow.nextContactAt)}`}
            </p>
          </div>
          <div className="crm-dialog-head-actions">
            <button type="button" className="btn primary" onClick={props.onOpenProject}>Открыть проект</button>
            <button type="button" className="btn ghost" onClick={props.onClose} aria-label="Закрыть">✕</button>
          </div>
        </header>

        <nav className="crm-dialog-tabs">
          {([['deal', 'Сделка'], ['money', 'Деньги и документы'], ['client', 'Клиент'], ['history', 'История']] as Array<[Tab, string]>)
            .map(([id, label]) => (
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
                <label>Дата следующего контакта
                  <input type="date" value={dateInputValue(card.workflow.nextContactAt)}
                    onChange={(event) => props.onWorkflow({ nextContactAt: dateInputToIso(event.target.value) })} />
                </label>
                <label className="span-2">Следующий шаг
                  <input defaultValue={card.workflow.nextAction ?? ''} placeholder={defaultNextAction(card.workflow.status)}
                    onBlur={(event) => { if (event.target.value !== (card.workflow.nextAction ?? '')) props.onWorkflow({ nextAction: event.target.value }); }} />
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
                {card.phone ? <a className="btn tiny ghost" href={`tel:${card.phone.replace(/[^+\d]/g, '')}`}>Позвонить {card.phone}</a> : <span className="muted small">Телефон не заполнен — добавьте его во вкладке «Клиент».</span>}
                {card.email && <a className="btn tiny ghost" href={`mailto:${card.email}`}>Написать {card.email}</a>}
                <button type="button" className="btn tiny" onClick={() => void copyMessage()}>{copied ? '✓ Текст скопирован' : 'Скопировать сообщение'}</button>
              </div>
              <p className="crm-dialog-message">{props.message}</p>
            </>
          )}

          {tab === 'money' && (
            <>
              <div className={`crm-dialog-payment ${pay.tone}`}>
                <b>{pay.label}</b>
                <span>оплачено {fmtMoney(pay.paid)} · остаток {fmtMoney(pay.remainder)} из {fmtMoney(card.total)}</span>
              </div>
              <div className="crm-dialog-grid">
                <label>Оплачено, ₽
                  <input type="number" value={card.payment?.paidTotal ?? card.payment?.prepayment ?? ''}
                    onChange={(event) => {
                      const value = event.target.value === '' ? null : Number(event.target.value);
                      props.onPayment({ paidTotal: value, status: value != null && value >= card.total ? 'paid' : value ? 'prepaid' : 'none' });
                    }} />
                </label>
                <label>Дата оплаты
                  <input type="date" value={card.payment?.paymentDate ?? ''} onChange={(event) => props.onPayment({ paymentDate: event.target.value || undefined })} />
                </label>
                <label className="span-2">Комментарий к оплате
                  <input value={card.payment?.comment ?? ''} placeholder="предоплата, долг, банк…"
                    onChange={(event) => props.onPayment({ comment: event.target.value })} />
                </label>
              </div>

              {card.offerLink && (
                <div className={`crm-dialog-offerlink${card.offerLink.approvedAt ? ' approved' : ''}`}>
                  <b>Ссылка клиенту</b>
                  <input readOnly value={card.offerLink.url} onFocus={(event) => event.target.select()} />
                  <span>
                    {card.offerLink.approvedAt
                      ? `Согласовано: ${card.offerLink.approvedBy} · ${fmtDate(card.offerLink.approvedAt)}`
                      : card.offerLink.views > 0 ? `Клиент открывал ${card.offerLink.views} раз, решения пока нет` : 'Ссылку ещё не открывали'}
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
                      <button key={kind} type="button" className="btn tiny ghost" disabled={props.docBusy === `${card.projectId}-${kind}`}
                        onClick={() => props.onDocumentExport(kind)}>
                        {props.docBusy === `${card.projectId}-${kind}` ? 'Готовлю…' : label}
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
            <div className="empty small">Проект не привязан к карточке клиента. Откройте проект и укажите клиента — тогда здесь появятся контакты, оплаты и история.</div>
          ))}

          {tab === 'history' && (
            <>
              <div className="crm-dialog-note">
                <input value={note} placeholder="Например: просил вариант дешевле, согласовал Rehau"
                  onChange={(event) => setNote(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && note.trim()) { props.onNote(note.trim()); setNote(''); } }} />
                <button type="button" className="btn ghost" disabled={!note.trim()} onClick={() => { props.onNote(note.trim()); setNote(''); }}>Записать</button>
              </div>
              <div className="crm-dialog-history">
                {!card.client || card.client.history.length === 0
                  ? <div className="empty small">История пока пустая. Статусы и документы будут записываться сюда автоматически.</div>
                  : card.client.history.slice(0, 20).map((entry) => (
                    <div key={entry.id}>
                      <b>{entry.title}</b>
                      <span>{fmtDate(entry.createdAt)}</span>
                      {entry.text && <small>{entry.text}</small>}
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
