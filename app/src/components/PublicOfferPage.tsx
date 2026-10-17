// Страница коммерческого предложения для клиента: открывается по ссылке без входа.
// Показывает то же КП, что видит менеджер, и даёт кнопку «Согласовать».

import { useEffect, useState } from 'react';
import type { Project } from '../types';
import ClientView, { type ClientModuleGroup } from './ClientView';
import { approvePublicOffer, fetchPublicOffer, type PublicOffer } from '../lib/serverApi';
import { hydrate } from '../lib/photoStore';
import { fmtDateLong, fmtMoney } from '../lib/format';

interface OfferPayload {
  project: Project;
  moduleGroups?: ClientModuleGroup[];
}

export default function PublicOfferPage(props: { id: string }) {
  const [offer, setOffer] = useState<PublicOffer<OfferPayload> | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [approved, setApproved] = useState<{ at: string; by: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPublicOffer<OfferPayload>(props.id)
      .then(async (loaded) => {
        const payload = await hydrate(loaded.payload);
        if (!alive) return;
        setOffer({ ...loaded, payload });
        setName(loaded.client || '');
        if (loaded.approvedAt) setApproved({ at: loaded.approvedAt, by: loaded.approvedBy ?? loaded.client });
      })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [props.id]);

  const approve = async () => {
    setSending(true);
    try {
      const result = await approvePublicOffer(props.id, { name: name.trim(), comment: comment.trim() || undefined });
      setApproved({ at: result.approvedAt, by: result.approvedBy });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (error) {
    return (
      <div className="public-offer-state">
        <h1>Предложение недоступно</h1>
        <p>{error}</p>
        <p className="muted">Попросите менеджера прислать свежую ссылку.</p>
      </div>
    );
  }

  if (!offer) return <div className="public-offer-state"><h1>Загружаем предложение…</h1></div>;

  return (
    <div className="public-offer">
      <header className="public-offer-head no-print">
        <div>
          <span className="eyebrow">Коммерческое предложение</span>
          <h1>{offer.title}</h1>
          <p>{offer.client ? `${offer.client} · ` : ''}от {fmtDateLong(offer.createdAt)} · {fmtMoney(offer.total)}</p>
        </div>
        <button type="button" className="btn ghost" onClick={() => window.print()}>Сохранить в PDF</button>
      </header>

      <ClientView project={offer.payload.project} moduleGroups={offer.payload.moduleGroups ?? []} publicMode />

      <section className={`public-offer-approve no-print${approved ? ' done' : ''}`}>
        {approved ? (
          <>
            <b>Предложение согласовано</b>
            <p>{approved.by} · {new Date(approved.at).toLocaleString('ru-RU')}. Менеджер видит это у себя и свяжется с вами.</p>
          </>
        ) : (
          <>
            <b>Всё устраивает?</b>
            <p>Нажмите «Согласовать» — менеджер сразу увидит ваше решение и перейдёт к договору.</p>
            <div className="public-offer-approve-form">
              <label>Ваше имя<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Как к вам обращаться" /></label>
              <label>Комментарий (необязательно)<input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Например: без подсветки" /></label>
              <button type="button" className="btn primary" disabled={sending || name.trim().length < 2} onClick={() => void approve()}>
                {sending ? 'Отправляем…' : 'Согласовать предложение'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
