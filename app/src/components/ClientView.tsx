import { useState } from 'react';
import type { ClientOfferSettings, Pricebook, Project } from '../types';
import { calcTotals } from '../lib/engine';
import { calculateVariant } from '../lib/variants';
import { fmtMoney, fmtDate } from '../lib/format';
import { exportClientXlsx } from '../lib/exporters';
import KitchenSketch from './KitchenSketch';

/** Строка модуля в клиентской версии — без закупочных цен и внутренних данных. */
export interface ClientModuleGroup {
  id: string;
  title: string;
  sub: string;
  qty: number;
  lineIds: string[];
  composition: string[];
}

export default function ClientView({ project, pricebook, moduleGroups, onSketchVisibilityChange, onOfferChange }: {
  project: Project;
  pricebook?: Pricebook;
  moduleGroups?: ClientModuleGroup[];
  onSketchVisibilityChange?: (showInClient: boolean) => void;
  onOfferChange?: (offer: ClientOfferSettings) => void;
}) {
  const groups = moduleGroups ?? [];
  const groupedIds = new Set(groups.flatMap((group) => group.lineIds));
  const baseProjectForVariants: Project = { ...project, lines: project.lines.filter((line) => !line.note?.startsWith('Модуль:')) };
  const selectedVariant = project.variants?.find((variant) => variant.id === project.selectedVariantId);
  const activeCalculation = selectedVariant && pricebook
    ? calculateVariant(baseProjectForVariants, pricebook, selectedVariant)
    : { ...calcTotals(project.lines, project.settings), lines: project.lines };
  const { lineCalcs, totals } = activeCalculation;
  const [showSketch, setShowSketch] = useState(project.sketch?.showInClient !== false);
  const visibleVariants = (project.variants ?? []).filter((variant) => variant.clientVisible || variant.id === project.selectedVariantId);
  const extraLines = selectedVariant
    ? baseProjectForVariants.lines
    : project.lines.filter((line) => !groupedIds.has(line.id));
  const groupLineIds = (group: ClientModuleGroup) => selectedVariant
    ? activeCalculation.lines.filter((line) => line.note?.startsWith(`Модуль: ${group.title}`)).map((line) => line.id)
    : group.lineIds;
  const groupSum = (group: ClientModuleGroup) => {
    let sum = 0; let any = false;
    for (const id of groupLineIds(group)) { const calc = lineCalcs.get(id); if (calc?.clientSum != null) { sum += calc.clientSum; any = true; } }
    return any ? sum : null;
  };
  const variantSummaries = visibleVariants.map((variant) => ({ variant, totals: pricebook ? calculateVariant(baseProjectForVariants, pricebook, variant).totals : null }));
  const updateOffer = (patch: Partial<ClientOfferSettings>) => onOfferChange?.({ ...(project.clientOffer ?? {}), ...patch });

  return (
    <div className="client-view">
      <div className="client-toolbar no-print">
        <div className="muted small">Клиент видит только этот документ: без себестоимости, закупочных цен и внутренних данных.{selectedVariant && <> Активен вариант: <b>{selectedVariant.name}</b>.</>}</div>
        <div className="client-toolbar-actions">
          {(project.modules?.length ?? 0) > 0 && <label className="client-sketch-toggle"><input type="checkbox" checked={showSketch} onChange={(event) => { const visible = event.target.checked; setShowSketch(visible); onSketchVisibilityChange?.(visible); }} /> Эскиз кухни</label>}
          <button className="btn ghost" onClick={() => exportClientXlsx(project)}>Excel для клиента</button>
          <button className="btn primary" onClick={() => window.print()}>Печать / PDF</button>
        </div>
      </div>

      <section className="card client-offer-editor no-print">
        <div className="client-offer-editor-head"><div><h3>Условия предложения</h3><p className="muted small">Эти поля видны клиенту, но не влияют на расчёт себестоимости.</p></div><span className="muted small">Цена округляется по настройкам проекта</span></div>
        <div className="grid3">
          <label>Предложение действительно до<input type="date" value={project.clientOffer?.validUntil ?? ''} onChange={(event) => updateOffer({ validUntil: event.target.value || undefined })} /></label>
          <label>Условия оплаты<input value={project.clientOffer?.paymentTerms ?? ''} placeholder="например, 50% аванс" onChange={(event) => updateOffer({ paymentTerms: event.target.value })} /></label>
          <label>Монтаж<input value={project.clientOffer?.installation ?? ''} placeholder="например, включён" onChange={(event) => updateOffer({ installation: event.target.value })} /></label>
          <label>Доставка<input value={project.clientOffer?.delivery ?? ''} placeholder="например, по адресу клиента" onChange={(event) => updateOffer({ delivery: event.target.value })} /></label>
          <label className="span-2">Примечания для клиента<textarea rows={2} value={project.clientOffer?.notes ?? ''} onChange={(event) => updateOffer({ notes: event.target.value })} /></label>
        </div>
      </section>

      <div className="client-doc" id="client-doc">
        <div className="cd-head">
          <div><div className="cd-brand">РЕцепт</div><div className="cd-sub">мебельное ателье</div></div>
          <div className="cd-title"><h2>Коммерческое предложение</h2><div>{project.name}</div><div className="muted">{project.client && <>Заказчик: {project.client} · </>}{fmtDate(project.date)}</div></div>
        </div>

        {project.clientOffer && <div className="cd-terms"><div><b>Действительно до</b><span>{project.clientOffer.validUntil ? fmtDate(project.clientOffer.validUntil) : 'не указано'}</span></div><div><b>Оплата</b><span>{project.clientOffer.paymentTerms || 'не указано'}</span></div><div><b>Монтаж</b><span>{project.clientOffer.installation || 'не указано'}</span></div><div><b>Доставка</b><span>{project.clientOffer.delivery || 'не указано'}</span></div></div>}
        {(project.photos ?? []).some((photo) => photo.showToClient) && <div className="cd-photos">{(project.photos ?? []).filter((photo) => photo.showToClient).map((photo) => <figure key={photo.id}><img src={photo.dataUrl} alt={photo.name} /><figcaption>{photo.name}</figcaption></figure>)}</div>}
        {showSketch && (project.modules?.length ?? 0) > 0 && <KitchenSketch mode="client" modules={project.modules ?? []} settings={project.sketch} />}

        {variantSummaries.length > 1 && <section className="cd-variants"><h3>Варианты комплектации</h3>{variantSummaries.map(({ variant, totals: variantTotals }) => <div className={`cd-variant-row ${variant.id === project.selectedVariantId ? 'active' : ''}`} key={variant.id}><div><b>{variant.name}</b><span>{variant.description}</span></div><strong>{variantTotals ? fmtMoney(variantTotals.client) : '—'}</strong></div>)}</section>}

        <table className="table client-table"><thead><tr><th>№</th><th>Наименование</th><th className="num">Кол-во</th><th>Ед.</th><th className="num">Стоимость</th></tr></thead><tbody>
          {groups.map((group, index) => <tr key={group.id}><td>{index + 1}</td><td><b>{group.title}</b>{group.sub && <span className="muted"> · {group.sub}</span>}{group.composition.length > 0 && <div className="cd-comp">{group.composition.join(' · ')}</div>}</td><td className="num">{group.qty}</td><td>шт</td><td className="num">{groupSum(group) != null ? fmtMoney(groupSum(group)) : '—'}</td></tr>)}
          {groups.length > 0 && extraLines.length > 0 && <tr className="cd-section"><td colSpan={5}>Дополнительно</td></tr>}
          {extraLines.map((line, index) => { const calc = lineCalcs.get(line.id); return <tr key={line.id}><td>{groups.length + index + 1}</td><td>{line.name}</td><td className="num">{line.qty}</td><td>{line.unit ?? ''}</td><td className="num">{calc?.clientSum != null ? fmtMoney(calc.clientSum) : '—'}</td></tr>; })}
        </tbody></table>

        <div className="cd-total">Итоговая стоимость: <b>{fmtMoney(totals.client)}</b></div>
        {project.clientOffer?.notes && <div className="cd-comment"><b>Примечания:</b><br />{project.clientOffer.notes}</div>}
        {project.comment && <div className="cd-comment">{project.comment}</div>}
      </div>
    </div>
  );
}
