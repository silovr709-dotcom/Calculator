// Карточка клиента: открывается и у клиента без сделок.
// Контакты, реквизиты, теги, список сделок и история — в одном окне.

import { useEffect, useState } from 'react';
import type { ClientProfile } from '../types';
import { Overlay } from './Portal';
import { fmtDate, fmtMoney } from '../lib/format';
import { CLIENT_TAGS, splitContactList } from '../lib/clientProfiles';

export interface ClientDealSummary {
  projectId: string;
  name: string;
  statusLabel: string;
  total: number;
  closed: boolean;
  installAt?: string;
}

type Tab = 'contacts' | 'deals' | 'history';

export default function CrmClientDialog(props: {
  client: ClientProfile;
  deals: ClientDealSummary[];
  onClose: () => void;
  onChange: (patch: Partial<ClientProfile>) => void;
  onOpenDeal: (projectId: string) => void;
  onCreateDeal: () => void;
  onNote: (text: string) => void;
  onDelete?: () => void;
}) {
  const { client, deals } = props;
  const [tab, setTab] = useState<Tab>('contacts');
  const [note, setNote] = useState('');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const openSum = deals.filter((deal) => !deal.closed).reduce((sum, deal) => sum + deal.total, 0);

  return (
    <Overlay className="crm-dialog-backdrop" onClick={props.onClose}>
      <div className="crm-dialog" role="dialog" aria-label={`Клиент ${client.name}`} onClick={(event) => event.stopPropagation()}>
        <header className="crm-dialog-head">
          <div>
            <span className="eyebrow">Клиент</span>
            <h2>{client.name || 'Без имени'}</h2>
            <p>
              {deals.length === 0 ? 'сделок пока нет' : `${deals.length} сделк(и) · в работе ${fmtMoney(openSum)}`}
              {client.source ? ` · источник: ${client.source}` : ''}
            </p>
          </div>
          <div className="crm-dialog-head-actions">
            <button type="button" className="btn primary" onClick={props.onCreateDeal}>+ Сделка</button>
            <button type="button" className="btn ghost" onClick={props.onClose} aria-label="Закрыть">✕</button>
          </div>
        </header>

        <nav className="crm-dialog-tabs">
          {([['contacts', 'Контакты и реквизиты'], ['deals', deals.length > 0 ? `Сделки · ${deals.length}` : 'Сделки'], ['history', 'История']] as Array<[Tab, string]>)
            .map(([id, label]) => (
              <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
            ))}
        </nav>

        <div className="crm-dialog-body">
          {tab === 'contacts' && (
            <>
              <div className="crm-dialog-grid">
                <label className="span-2">Имя или компания
                  <input value={client.name} onChange={(event) => props.onChange({ name: event.target.value })} />
                </label>
                <label>Телефоны
                  <input value={client.phones.join(', ')} placeholder="+7…, второй номер"
                    onChange={(event) => props.onChange({ phones: splitContactList(event.target.value) })} />
                </label>
                <label>Email
                  <input value={client.emails.join(', ')} placeholder="client@mail.ru"
                    onChange={(event) => props.onChange({ emails: splitContactList(event.target.value) })} />
                </label>
                <label>Адрес объекта
                  <input value={client.objectAddress ?? ''} onChange={(event) => props.onChange({ objectAddress: event.target.value })} />
                </label>
                <label>Адрес доставки
                  <input value={client.deliveryAddress ?? ''} onChange={(event) => props.onChange({ deliveryAddress: event.target.value })} />
                </label>
                <label>Источник
                  <input value={client.source ?? ''} placeholder="сайт, рекомендация, дизайнер"
                    onChange={(event) => props.onChange({ source: event.target.value })} />
                </label>
                <label className="span-2">Паспортные и договорные данные
                  <textarea rows={2} value={client.passport ?? ''} onChange={(event) => props.onChange({ passport: event.target.value })} />
                </label>
                <label className="span-2">Что важно помнить
                  <textarea rows={2} value={client.managerComment ?? ''} onChange={(event) => props.onChange({ managerComment: event.target.value })} />
                </label>
                <div className="span-2 crm-dialog-tags">
                  {CLIENT_TAGS.map((tag) => {
                    const active = client.tags.includes(tag.id);
                    return (
                      <button key={tag.id} type="button" className={active ? 'active' : ''}
                        onClick={() => props.onChange({ tags: active ? client.tags.filter((item) => item !== tag.id) : [...client.tags, tag.id] })}>
                        {tag.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="crm-dialog-contact">
                <b>Связаться</b>
                {client.phones[0]
                  ? <>
                      <a className="btn tiny ghost" href={`tel:${client.phones[0].replace(/[^+\d]/g, '')}`}>Позвонить</a>
                      <a className="btn tiny ghost" href={`https://wa.me/${client.phones[0].replace(/[^\d]/g, '')}`} target="_blank" rel="noreferrer">WhatsApp</a>
                    </>
                  : <span className="muted small">Добавьте телефон — появятся кнопки звонка и WhatsApp.</span>}
                {client.emails[0] && <a className="btn tiny ghost" href={`mailto:${client.emails[0]}`}>Написать</a>}
              </div>

              {props.onDelete && deals.length === 0 && (
                <div className="crm-client-danger">
                  <button type="button" className="btn ghost danger" onClick={props.onDelete}>Удалить клиента</button>
                  <span className="muted small">Доступно, пока у клиента нет сделок.</span>
                </div>
              )}
            </>
          )}

          {tab === 'deals' && (
            deals.length === 0 ? (
              <div className="empty small">
                <b>Сделок пока нет</b>
                Нажмите «+ Сделка» — создадим расчёт с этим клиентом, и он появится здесь.
              </div>
            ) : (
              <ul className="crm-client-deals">
                {deals.map((deal) => (
                  <li key={deal.projectId}>
                    <button type="button" onClick={() => props.onOpenDeal(deal.projectId)}>
                      <b>{deal.name}</b>
                      <span>{deal.statusLabel}{deal.installAt ? ` · монтаж ${fmtDate(deal.installAt)}` : ''}</span>
                    </button>
                    <span className="crm-client-deal-sum">{fmtMoney(deal.total)}</span>
                  </li>
                ))}
              </ul>
            )
          )}

          {tab === 'history' && (
            <>
              <div className="crm-dialog-note">
                <input value={note} placeholder="Записать: о чём договорились, что уточнить"
                  onChange={(event) => setNote(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter' && note.trim()) { props.onNote(note.trim()); setNote(''); } }} />
                <button type="button" className="btn ghost" disabled={!note.trim()} onClick={() => { props.onNote(note.trim()); setNote(''); }}>Записать</button>
              </div>
              <div className="crm-dialog-history">
                {client.history.length === 0
                  ? <div className="empty small">История пустая. Здесь копятся заметки, смены этапов, документы и оплаты.</div>
                  : client.history.slice(0, 30).map((entry) => (
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
