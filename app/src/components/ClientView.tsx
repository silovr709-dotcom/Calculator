import { useState } from 'react';
import type { ClientDocumentPackageSettings, ClientOfferModuleDetailMode, ClientOfferPresentationMode, ClientOfferSettings, EskizExportViewSettings, EskizLayerKey, EskizProIntegration, Pricebook, Project } from '../types';
import type { ClientOfferDetail, ClientOfferDetailKind } from '../lib/clientOffer';
import { calcTotals } from '../lib/engine';
import { calculateVariant } from '../lib/variants';
import { buildClientOfferDetails, buildClientProjectSummary, clientSketchSummaryLines, isModuleLine, moduleNoteMatches, stripModuleNote } from '../lib/clientOffer';
import { fmtMoney, fmtDate, fmtNum } from '../lib/format';
import { exportClientXlsx } from '../lib/exporters';
import { snapshotProject } from '../lib/eskizPro';
import { downloadEskizSketchPdf, renderEskizSketchPdf } from '../lib/eskizSketchExport';
import { downloadClientContractDocx, downloadClientDocumentZip, downloadClientOfferDocx, downloadClientOrderBlankDoc, downloadClientSpecificationDocx, normalizeClientDocumentPackage, type ClientDocumentArgs } from '../lib/clientPackage';
import EskizProjectPreview from './EskizProjectPreview';

/** Строка модуля в клиентской версии — без закупочных цен и внутренних данных. */
export interface ClientModuleGroup {
  id: string;
  title: string;
  sub: string;
  qty: number;
  lineIds: string[];
  composition: string[];
}

const MODE_LABELS: Record<ClientOfferPresentationMode, string> = {
  brief: 'Кратко',
  detailed: 'Подробно',
  technical: 'Техническое приложение',
};

const CLIENT_ESKIZ_LAYERS: { key: EskizLayerKey; label: string }[] = [
  { key: 'dimensions', label: 'Размеры' },
  { key: 'modules', label: 'Модули' },
  { key: 'hinges', label: 'Петли' },
  { key: 'communications', label: 'Коммуникации' },
  { key: 'callouts', label: 'Сноски' },
  { key: 'comments', label: 'Комментарии' },
  { key: 'equipment', label: 'Техника' },
  { key: 'links', label: 'Ссылки' },
];

const AGGREGATED_HARDWARE_KINDS: ClientOfferDetailKind[] = ['hinge', 'drawerSys', 'lift', 'handle', 'legs'];
const AGGREGATED_HARDWARE_SET = new Set<ClientOfferDetailKind>(AGGREGATED_HARDWARE_KINDS);

function isAggregatedHardware(detail: ClientOfferDetail): boolean {
  return AGGREGATED_HARDWARE_SET.has(detail.kind);
}

const MODULE_DETAIL_MODE_LABELS: Record<ClientOfferModuleDetailMode, string> = {
  summary: 'только список модулей',
  compact: 'компактно: материалы в модуле, фурнитура общими строками',
  full: 'полная детализация внутри каждого модуля',
};

function detailQtyText(detail: ClientOfferDetail): string {
  const unit = detail.unit || 'шт';
  if (detail.priceBasis === 'm2' || detail.priceBasis === 'lm') {
    const pieces = detail.qty > 0 ? `${fmtNum(detail.qty, 3)} шт` : '';
    const measured = `${fmtNum(detail.qtyEffective, 4)} ${unit}`;
    return pieces ? `${pieces} / ${measured}` : measured;
  }
  if (detail.priceBasis === 'sheet') return `${fmtNum(detail.qtyEffective, 3)} ${unit}`;
  if (detail.kind === 'bodySurcharge') return `${fmtNum(detail.qty, 3)} доп.`;
  return `${fmtNum(detail.qty, 3)} ${unit}`;
}

function detailBriefText(detail: ClientOfferDetail): string {
  return `${detail.kindLabel}: ${detailQtyText(detail)}`;
}

function sumKind(details: ClientOfferDetail[], kinds: ClientOfferDetailKind[]): number {
  const set = new Set(kinds);
  return details.filter((detail) => set.has(detail.kind)).reduce((sum, detail) => sum + detail.qty, 0);
}

function hasKind(details: ClientOfferDetail[], kinds: ClientOfferDetailKind[]): boolean {
  const set = new Set(kinds);
  return details.some((detail) => set.has(detail.kind));
}

function uniqueHighlights(details: ClientOfferDetail[], kinds: ClientOfferDetailKind[], limit: number): string[] {
  const set = new Set(kinds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const detail of details) {
    if (!set.has(detail.kind)) continue;
    const label = `${detail.kindLabel}: ${detail.name}`;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
    if (out.length >= limit) break;
  }
  return out;
}

const COMPOSITION_SECTIONS: { id: string; title: string; kinds: ClientOfferDetailKind[] }[] = [
  { id: 'body', title: 'Корпуса и каркас', kinds: ['body', 'bodySurcharge', 'shelf'] },
  { id: 'facades', title: 'Фасады и рамки', kinds: ['facade', 'frame'] },
  { id: 'hardware', title: 'Фурнитура и механизмы', kinds: ['hinge', 'drawerSys', 'lift', 'handle', 'legs'] },
  { id: 'tops', title: 'Столешницы и панели', kinds: ['worktop', 'wallPanel'] },
  { id: 'extra', title: 'Дополнительно', kinds: ['sink', 'electric', 'other'] },
];

function summarizeCompositionQty(details: ClientOfferDetail[]): string {
  const area = details.reduce((sum, detail) => {
    const unit = detail.unit.toLocaleLowerCase('ru-RU');
    return detail.priceBasis === 'm2' || unit.includes('м²') || unit.includes('м2') ? sum + detail.qtyEffective : sum;
  }, 0);
  const length = details.reduce((sum, detail) => {
    const unit = detail.unit.toLocaleLowerCase('ru-RU');
    return detail.priceBasis === 'lm' || unit.includes('п.м') || unit.includes('пог') ? sum + detail.qtyEffective : sum;
  }, 0);
  const pieces = details.reduce((sum, detail) => sum + detail.qty, 0);
  const parts = [
    `${details.length} поз.`,
    area > 0 ? `${fmtNum(area, 2)} м²` : '',
    length > 0 ? `${fmtNum(length, 2)} п.м` : '',
    pieces > 0 ? `${fmtNum(pieces, 3)} шт/компл.` : '',
  ].filter(Boolean);
  return parts.slice(0, 3).join(' · ');
}

function buildCompositionSections(details: ClientOfferDetail[]) {
  return COMPOSITION_SECTIONS.map((section) => {
    const allowed = new Set(section.kinds);
    const items = details.filter((detail) => allowed.has(detail.kind));
    const total = items.reduce((sum, detail) => sum + (detail.clientSum ?? 0), 0);
    const hasPrice = items.some((detail) => detail.clientSum != null);
    return {
      ...section,
      items,
      total: hasPrice ? total : null,
      qtyText: summarizeCompositionQty(items),
      preview: items.slice(0, 3).map((detail) => `${detail.kindLabel}: ${detail.name}`),
    };
  }).filter((section) => section.items.length > 0);
}

function DetailRow({ detail, showPrice, technical }: { detail: ClientOfferDetail; showPrice: boolean; technical: boolean }) {
  const visibleDetails = technical ? detail.details : detail.details.slice(0, 3);
  const hiddenCount = detail.details.length - visibleDetails.length;
  return (
    <div className={`cd-component cd-component-${detail.kind}${showPrice ? '' : ' no-price'}`}>
      <div className="cd-component-main">
        <span className="cd-component-kind">{detail.kindLabel}</span>
        <b>{detail.name}</b>
        {visibleDetails.length > 0 && (
          <div className="cd-component-notes">
            {visibleDetails.map((note) => <span key={note}>{note}</span>)}
            {hiddenCount > 0 && <span>ещё {hiddenCount}</span>}
          </div>
        )}
      </div>
      <div className="cd-component-qty">{detailQtyText(detail)}</div>
      {showPrice && <div className="cd-component-sum">{detail.clientSum != null ? fmtMoney(detail.clientSum) : '—'}</div>}
    </div>
  );
}

export default function ClientView({ project, pricebook, moduleGroups, onOfferChange, onEskizProChange }: {
  project: Project;
  pricebook?: Pricebook;
  moduleGroups?: ClientModuleGroup[];
  onOfferChange?: (offer: ClientOfferSettings) => void;
  onEskizProChange?: (eskizPro: EskizProIntegration) => void;
}) {
  const [packageExporting, setPackageExporting] = useState(false);
  const groups = moduleGroups ?? [];
  const baseProjectForVariants: Project = { ...project, lines: project.lines.filter((line) => !isModuleLine(line)) };
  const selectedVariant = project.variants?.find((variant) => variant.id === project.selectedVariantId);
  const activeCalculation = selectedVariant && pricebook
    ? calculateVariant(baseProjectForVariants, pricebook, selectedVariant)
    : { ...calcTotals(project.lines, project.settings), lines: project.lines };
  const { lineCalcs, totals } = activeCalculation;
  const presentationMode = project.clientOffer?.presentationMode ?? 'detailed';
  const showDetailPrices = project.clientOffer?.showDetailPrices !== false;
  const isBrief = presentationMode === 'brief';
  const isTechnical = presentationMode === 'technical';
  const moduleDetailMode: ClientOfferModuleDetailMode = project.clientOffer?.moduleDetailMode ?? (isTechnical ? 'full' : 'compact');
  const aggregateHardware = project.clientOffer?.aggregateHardware !== false;
  const extractHardwareFromModules = aggregateHardware && moduleDetailMode !== 'full';
  const linkedEskizIds = project.eskizPro?.linkedProjectIds ?? [];
  const eskizSnapshots = project.eskizPro?.snapshots ?? [];
  const eskizById = new Map(eskizSnapshots.map((snapshot) => [snapshot.id, snapshotProject(snapshot)]));
  const allLinkedEskizProjects = linkedEskizIds
    .map((id) => eskizById.get(id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const activeEskizId = project.eskizPro?.activeProjectId && linkedEskizIds.includes(project.eskizPro.activeProjectId) ? project.eskizPro.activeProjectId : linkedEskizIds[0] ?? null;
  const activeEskizProject = activeEskizId ? eskizById.get(activeEskizId) : null;
  const eskizClientMode = project.eskizPro?.clientMode ?? 'active';
  const linkedEskizProjects = eskizClientMode === 'all' ? allLinkedEskizProjects : (activeEskizProject ? [activeEskizProject] : allLinkedEskizProjects.slice(0, 1));
  const clientSketchVisible = linkedEskizProjects.length > 0 && project.eskizPro?.showInClient !== false;
  const showCommunicationSizeBadges = project.eskizPro?.showCommunicationSizeBadges !== false;
  const newestEskiz = allLinkedEskizProjects.reduce<NonNullable<typeof activeEskizProject> | null>((latest, item) => (!latest || item.updatedAt > latest.updatedAt ? item : latest), null);
  const eskizModuleIds = new Set(Object.values(project.eskizPro?.moduleBindings ?? {}));
  const eskizModules = (project.modules ?? []).filter((module) => eskizModuleIds.has(module.id));
  const updateEskizPro = (patch: Partial<EskizProIntegration>) => onEskizProChange?.({ ...(project.eskizPro ?? {}), ...patch });
  const eskizViewSettings = project.eskizPro?.exportView ?? {};
  const eskizLayerVisibility = eskizViewSettings.layerVisibility ?? {};
  const updateEskizView = (patch: EskizExportViewSettings) => updateEskizPro({
    exportView: {
      ...eskizViewSettings,
      ...patch,
      layerVisibility: { ...(eskizViewSettings.layerVisibility ?? {}), ...(patch.layerVisibility ?? {}) },
    },
  });
  const visibleVariants = (project.variants ?? []).filter((variant) => variant.clientVisible || variant.id === project.selectedVariantId);
  const groupLineIds = (group: ClientModuleGroup) => selectedVariant
    ? activeCalculation.lines.filter((line) => moduleNoteMatches(line.note, group.title, group.id)).map((line) => line.id)
    : group.lineIds;
  const groupedIds = new Set(groups.flatMap((group) => groupLineIds(group)));
  const extraLines = selectedVariant
    ? activeCalculation.lines.filter((line) => !isModuleLine(line))
    : project.lines.filter((line) => !groupedIds.has(line.id));
  const groupSum = (group: ClientModuleGroup) => {
    let sum = 0; let any = false;
    for (const id of groupLineIds(group)) { const calc = lineCalcs.get(id); if (calc?.clientSum != null) { sum += calc.clientSum; any = true; } }
    return any ? sum : null;
  };
  const variantSummaries = visibleVariants.map((variant) => ({ variant, totals: pricebook ? calculateVariant(baseProjectForVariants, pricebook, variant).totals : null }));
  const updateOffer = (patch: Partial<ClientOfferSettings>) => onOfferChange?.({ ...(project.clientOffer ?? {}), ...patch });
  const packageSettings = normalizeClientDocumentPackage(project.clientOffer?.documentPackage);
  const updatePackageSettings = (patch: Partial<ClientDocumentPackageSettings>) => updateOffer({ documentPackage: { ...packageSettings, ...patch } });
  const extraDetails = buildClientOfferDetails(extraLines, lineCalcs);
  const allDetails = buildClientOfferDetails(activeCalculation.lines, lineCalcs);
  const projectHardwareDetails = extractHardwareFromModules ? allDetails.filter(isAggregatedHardware) : [];
  const visibleExtraDetails = extractHardwareFromModules ? extraDetails.filter((detail) => !isAggregatedHardware(detail)) : extraDetails;
  const moduleQty = groups.reduce((sum, group) => sum + group.qty, 0);
  const projectSummary = buildClientProjectSummary(allDetails, moduleQty);
  const sketchSummaryLines = clientSketchSummaryLines(projectSummary);
  const facadeQty = sumKind(allDetails, ['facade', 'frame']);
  const hingeQty = sumKind(allDetails, ['hinge']);
  const drawerQty = sumKind(allDetails, ['drawerSys']);
  const liftQty = sumKind(allDetails, ['lift']);
  const includedChips = [
    groups.length > 0 || hasKind(allDetails, ['body', 'facade', 'frame']) ? 'Корпуса и фасады' : '',
    hingeQty > 0 || drawerQty > 0 || liftQty > 0 ? 'Фурнитура и механизмы' : '',
    hasKind(allDetails, ['worktop']) ? 'Столешница' : '',
    hasKind(allDetails, ['wallPanel']) ? 'Стеновая панель' : '',
    hasKind(allDetails, ['sink']) ? 'Мойка / смеситель' : '',
    hasKind(allDetails, ['electric']) ? 'Электрика / свет' : '',
    clientSketchVisible ? 'Эскиз PRO' : '',
  ].filter(Boolean);
  const materialHighlights = uniqueHighlights(allDetails, ['body', 'facade', 'frame', 'worktop', 'wallPanel'], isTechnical ? 10 : 6);
  const compositionSections = buildCompositionSections(allDetails);
  const offerTerms = [
    project.clientOffer?.validUntil ? { label: 'Действительно до', value: fmtDate(project.clientOffer.validUntil) } : null,
    { label: 'Оплата', value: project.clientOffer?.paymentTerms || 'по согласованию' },
    project.clientOffer?.productionTerms ? { label: 'Срок изготовления', value: project.clientOffer.productionTerms } : null,
    project.clientOffer?.warranty ? { label: 'Гарантия', value: project.clientOffer.warranty } : null,
    project.clientOffer?.installation ? { label: 'Монтаж', value: project.clientOffer.installation } : null,
    project.clientOffer?.delivery ? { label: 'Доставка', value: project.clientOffer.delivery } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));
  const packageDocumentNames = [
    packageSettings.includeSketch && clientSketchVisible ? 'Эскиз PDF' : '',
    packageSettings.includeOffer ? 'Полное КП Word' : '',
    packageSettings.includeSpecification ? 'Спецификация Word' : '',
    packageSettings.includeContract ? 'Договор Word' : '',
    packageSettings.includeReceipt ? 'Бланк заказа DOC' : '',
  ].filter(Boolean);
  const offerReadinessItems = [
    { label: 'Клиент', ready: Boolean(project.client?.trim()), value: project.client?.trim() || 'не указан' },
    { label: 'Условия', ready: Boolean(project.clientOffer?.paymentTerms || project.clientOffer?.validUntil), value: project.clientOffer?.paymentTerms || 'оплата/срок не заполнены' },
    { label: 'Сроки', ready: Boolean(project.clientOffer?.productionTerms || project.clientOffer?.delivery || project.clientOffer?.installation), value: project.clientOffer?.productionTerms || project.clientOffer?.delivery || 'добавьте срок/доставку' },
    { label: 'Эскиз', ready: clientSketchVisible, value: clientSketchVisible ? `${linkedEskizProjects.length} PDF` : 'не прикреплён' },
  ];
  const clientDocumentArgs: ClientDocumentArgs = {
    project: { ...project, lines: activeCalculation.lines, settings: selectedVariant?.settings ?? project.settings },
    offer: project.clientOffer ?? {},
    details: allDetails,
    modules: groups.map((group) => ({ title: group.title, sub: group.sub, qty: group.qty, total: groupSum(group) })),
    total: totals.client,
    summary: projectSummary,
  };
  const sketchPdfOptions = {
    ...(eskizViewSettings ?? {}),
    moduleMarkerMode: project.eskizPro?.moduleMarkerMode ?? 'full',
    communications: (project.eskizPro?.communications ?? []).filter((marker) => marker.showInClient !== false),
    showCommunicationSizeBadges,
  };
  const renderSketchFilesForPackage = async () => {
    const sketchProjects = packageSettings.includeSketch && clientSketchVisible ? linkedEskizProjects : [];
    return Promise.all(sketchProjects.map(async (eskiz, index) => {
      const pdf = await renderEskizSketchPdf(eskiz, { ...sketchPdfOptions, title: eskiz.title });
      return { title: eskiz.title, fileName: `Эскиз ${index + 1} — ${eskiz.title}.pdf`, blob: pdf.blob };
    }));
  };
  const runClientDownload = async (task: () => Promise<void>, errorTitle: string) => {
    setPackageExporting(true);
    try {
      await task();
    } catch (error) {
      alert(`${errorTitle}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPackageExporting(false);
    }
  };
  const exportSketchPdf = () => runClientDownload(async () => {
    if (!clientSketchVisible || linkedEskizProjects.length === 0) { alert('Нет привязанного Эскиз PRO для выгрузки.'); return; }
    for (const [index, eskiz] of linkedEskizProjects.entries()) {
      await downloadEskizSketchPdf(eskiz, { ...sketchPdfOptions, title: eskiz.title, fileName: `Эскиз ${index + 1} — ${eskiz.title}.pdf` });
    }
  }, 'Не получилось выгрузить эскиз');
  const exportClientPackage = () => runClientDownload(async () => {
    await downloadClientDocumentZip(clientDocumentArgs, await renderSketchFilesForPackage());
  }, 'Не получилось собрать пакет клиента');

  return (
    <div className="client-view">
      <div className="client-toolbar no-print">
        <div className="muted small">Клиент видит только этот документ: без себестоимости, закупочных цен и внутренних данных.{selectedVariant && <> Активен вариант: <b>{selectedVariant.name}</b>.</>}</div>
        <div className="client-toolbar-actions">
          <button className="btn ghost" onClick={() => exportClientXlsx({ ...project, lines: activeCalculation.lines, settings: selectedVariant?.settings ?? project.settings })}>Excel, если нужен</button>
          <button className="btn primary" onClick={() => window.print()}>Печать / PDF</button>
        </div>
      </div>

      <div className="client-offer-workbench">
        <aside className="client-offer-controls no-print">
      <section className="card client-document-hub no-print" aria-label="Документы для клиента">
        <div className="client-document-hub-main">
          <span className="eyebrow">КП для клиента</span>
          <h3>Один аккуратный пакет: эскиз, КП, спецификация, договор и бланк заказа</h3>
          <p>Без HTML и черновиков в самом КП: документы выгружаются отдельными файлами, а предпросмотр остаётся компактным коммерческим предложением.</p>
          <div className="client-document-readiness" aria-label="Готовность клиентского КП">
            {offerReadinessItems.map((item) => <span key={item.label} className={item.ready ? 'ready' : 'warn'}><b>{item.label}</b><small>{item.value}</small></span>)}
          </div>
        </div>
        <div className="client-document-actions big">
          <button type="button" className="btn ghost" disabled={packageExporting || !clientSketchVisible} onClick={exportSketchPdf}>Эскиз PDF</button>
          <button type="button" className="btn ghost" disabled={packageExporting} onClick={() => runClientDownload(() => downloadClientOfferDocx(clientDocumentArgs), 'Не получилось выгрузить КП')}>КП Word</button>
          <button type="button" className="btn ghost" disabled={packageExporting} onClick={() => runClientDownload(() => downloadClientSpecificationDocx(clientDocumentArgs), 'Не получилось выгрузить спецификацию')}>Спецификация Word</button>
          <button type="button" className="btn ghost" disabled={packageExporting} onClick={() => runClientDownload(() => downloadClientContractDocx(clientDocumentArgs), 'Не получилось выгрузить договор')}>Договор Word</button>
          <button type="button" className="btn ghost" disabled={packageExporting} onClick={() => runClientDownload(() => downloadClientOrderBlankDoc(clientDocumentArgs), 'Не получилось выгрузить бланк заказа')}>Бланк заказа DOC</button>
          <button type="button" className="btn primary" disabled={packageExporting} onClick={exportClientPackage}>{packageExporting ? 'Собираю…' : 'Пакет ZIP'}</button>
        </div>
        <div className="client-document-includes">
          <span className={packageSettings.includeSketch && clientSketchVisible ? 'ready' : ''}>Эскиз</span>
          <span className={packageSettings.includeOffer ? 'ready' : ''}>КП</span>
          <span className={packageSettings.includeSpecification ? 'ready' : ''}>Спецификация</span>
          <span className={packageSettings.includeContract ? 'ready' : ''}>Договор</span>
          <span className={packageSettings.includeReceipt ? 'ready' : ''}>Бланк заказа</span>
          <span className={packageSettings.sketchSummaryOverlay ? 'ready' : ''}>Сводка на эскизе</span>
        </div>
      </section>

      <section className="card client-offer-editor client-offer-drawer no-print">
        <div className="client-offer-editor-head">
          <div>
            <h3>Настройки КП</h3>
            <p className="muted small">Компактные блоки: откройте только то, что нужно сейчас.</p>
          </div>
          <span className="client-offer-mode-pill">{MODE_LABELS[presentationMode]}</span>
        </div>
        <div className="client-offer-quick-state">
          <span><b>{fmtMoney(totals.client)}</b><small>итог КП</small></span>
          <span><b>{fmtNum(moduleQty, 3)}</b><small>модулей</small></span>
          <span><b>{clientSketchVisible ? linkedEskizProjects.length : '—'}</b><small>эскизов</small></span>
        </div>
        <div className="client-control-stack">
          <details className="client-control-section" open>
            <summary><span>1. Вид, условия и детализация</span><small>{MODE_LABELS[presentationMode]} · {MODULE_DETAIL_MODE_LABELS[moduleDetailMode]}</small></summary>
            <div className="client-control-body client-control-grid">
              <label>Предложение действительно до<input type="date" value={project.clientOffer?.validUntil ?? ''} onChange={(event) => updateOffer({ validUntil: event.target.value || undefined })} /></label>
              <label>Условия оплаты<input value={project.clientOffer?.paymentTerms ?? ''} placeholder="например, 50% аванс" onChange={(event) => updateOffer({ paymentTerms: event.target.value })} /></label>
              <label>Монтаж<input value={project.clientOffer?.installation ?? ''} placeholder="например, включён" onChange={(event) => updateOffer({ installation: event.target.value })} /></label>
              <label>Доставка<input value={project.clientOffer?.delivery ?? ''} placeholder="например, по адресу клиента" onChange={(event) => updateOffer({ delivery: event.target.value })} /></label>
              <label>Вид КП
                <select value={presentationMode} onChange={(event) => updateOffer({ presentationMode: event.target.value as ClientOfferPresentationMode })}>
                  <option value="brief">Кратко — для отправки клиенту</option>
                  <option value="detailed">Подробно — состав по модулям</option>
                  <option value="technical">Техническое приложение — максимум деталей</option>
                </select>
              </label>
              <label>Состав модулей
                <select value={moduleDetailMode} onChange={(event) => updateOffer({ moduleDetailMode: event.target.value as ClientOfferModuleDetailMode })}>
                  <option value="summary">Только карточки модулей</option>
                  <option value="compact">Компактно: материалы в модуле, фурнитура общими строками</option>
                  <option value="full">Полностью: все строки внутри каждого модуля</option>
                </select>
              </label>
              <label className="client-detail-price-toggle"><input type="checkbox" checked={showDetailPrices} onChange={(event) => updateOffer({ showDetailPrices: event.target.checked })} /> Показывать суммы в детализации</label>
              <label className="client-detail-price-toggle"><input type="checkbox" checked={aggregateHardware} onChange={(event) => updateOffer({ aggregateHardware: event.target.checked })} /> Фурнитуру общими строками по проекту</label>
              <label className="span-2">Примечания для клиента<textarea rows={2} value={project.clientOffer?.notes ?? ''} onChange={(event) => updateOffer({ notes: event.target.value })} /></label>
            </div>
          </details>

          <details className="client-control-section">
            <summary><span>2. Состав ZIP и документов</span><small>{packageSettings.includeOffer ? 'КП' : ''}{packageSettings.includeSpecification ? ' · спецификация' : ''}{packageSettings.includeSketch ? ' · эскиз' : ''}{packageSettings.includeContract ? ' · договор' : ''}{packageSettings.includeReceipt ? ' · бланк' : ''}</small></summary>
            <div className="client-control-body">
              <div className="client-package-options compact">
                <label><input type="checkbox" checked={packageSettings.includeOffer} onChange={(event) => updatePackageSettings({ includeOffer: event.target.checked })} /> КП/сводка</label>
                <label><input type="checkbox" checked={packageSettings.includeSketch} onChange={(event) => updatePackageSettings({ includeSketch: event.target.checked })} /> Эскиз</label>
                <label><input type="checkbox" checked={packageSettings.includeSpecification} onChange={(event) => updatePackageSettings({ includeSpecification: event.target.checked })} /> Спецификация Word</label>
                <label><input type="checkbox" checked={packageSettings.includeContract} onChange={(event) => updatePackageSettings({ includeContract: event.target.checked })} /> Договор</label>
                <label><input type="checkbox" checked={packageSettings.includeReceipt} onChange={(event) => updatePackageSettings({ includeReceipt: event.target.checked })} /> Бланк заказа</label>
                <label><input type="checkbox" checked={packageSettings.sketchSummaryOverlay} onChange={(event) => updatePackageSettings({ sketchSummaryOverlay: event.target.checked })} /> Сводка на эскизе</label>
                <label><input type="checkbox" checked={packageSettings.compact} onChange={(event) => updatePackageSettings({ compact: event.target.checked })} /> Компактно</label>
              </div>
            </div>
          </details>

          <details className="client-control-section">
            <summary><span>3. Реквизиты договора и клиента</span><small>{project.clientOffer?.sellerName || project.client || 'заполнить перед договором'}</small></summary>
            <div className="client-control-body client-package-fields compact">
              <label>Исполнитель<input value={project.clientOffer?.sellerName ?? ''} placeholder="Название / ИП / ООО" onChange={(event) => updateOffer({ sellerName: event.target.value })} /></label>
              <label>№ договора<input value={project.clientOffer?.contractNumber ?? ''} placeholder="авто из проекта" onChange={(event) => updateOffer({ contractNumber: event.target.value })} /></label>
              <label>Предоплата / задаток<input value={project.clientOffer?.contractPrepayment ?? ''} placeholder="например, 50% или 120 000" onChange={(event) => updateOffer({ contractPrepayment: event.target.value })} /></label>
              <label>Доплата<input value={project.clientOffer?.contractRemainder ?? ''} placeholder="авто: итог − предоплата" onChange={(event) => updateOffer({ contractRemainder: event.target.value })} /></label>
              <label>Срок изготовления<input value={project.clientOffer?.productionTerms ?? ''} placeholder="например, 45 рабочих дней" onChange={(event) => updateOffer({ productionTerms: event.target.value })} /></label>
              <label>Гарантия<input value={project.clientOffer?.warranty ?? ''} placeholder="например, 12 месяцев" onChange={(event) => updateOffer({ warranty: event.target.value })} /></label>
              <label className="span-2">Реквизиты исполнителя<textarea rows={2} value={project.clientOffer?.sellerDetails ?? ''} placeholder="ИНН, адрес, телефон — появятся в договоре и бланке" onChange={(event) => updateOffer({ sellerDetails: event.target.value })} /></label>
              <label>Паспорт клиента<input value={project.clientOffer?.clientPassport ?? ''} placeholder="серия, номер, кем и когда выдан" onChange={(event) => updateOffer({ clientPassport: event.target.value })} /></label>
              <label>Адрес клиента<input value={project.clientOffer?.clientAddress ?? ''} placeholder="адрес регистрации / доставки" onChange={(event) => updateOffer({ clientAddress: event.target.value })} /></label>
              <label>Телефон клиента<input value={project.clientOffer?.clientPhone ?? ''} placeholder="+7…" onChange={(event) => updateOffer({ clientPhone: event.target.value })} /></label>
              <label>E-mail клиента<input value={project.clientOffer?.clientEmail ?? ''} placeholder="email@example.ru" onChange={(event) => updateOffer({ clientEmail: event.target.value })} /></label>
              <label className="span-2">Контакты клиента / комментарий<textarea rows={2} value={project.clientOffer?.clientContacts ?? ''} placeholder="дополнительные контакты, адрес доставки, примечания" onChange={(event) => updateOffer({ clientContacts: event.target.value })} /></label>
            </div>
          </details>

          <details className="client-control-section">
            <summary><span>4. Эскиз PRO в КП</span><small>{allLinkedEskizProjects.length > 0 ? `${allLinkedEskizProjects.length} эскиз(а), режим: ${eskizClientMode === 'all' ? 'все' : 'главный'}` : 'нет привязанных эскизов'}</small></summary>
            <div className="client-control-body client-eskiz-control compact">
              <div>
                <b>Эскиз PRO в КП</b>
                <span>{allLinkedEskizProjects.length > 0 ? `Привязано: ${allLinkedEskizProjects.length}. ${newestEskiz ? `Последний snapshot: ${fmtDate(newestEskiz.updatedAt)}` : ''}` : 'Эскиз ещё не привязан — добавьте его на вкладке «Эскиз PRO» или импортируйте .eskiz.'}</span>
              </div>
              <label className="chk-row"><input type="checkbox" disabled={allLinkedEskizProjects.length === 0 || !onEskizProChange} checked={project.eskizPro?.showInClient !== false && allLinkedEskizProjects.length > 0} onChange={(event) => updateEskizPro({ showInClient: event.target.checked })} /> Вставить в КП</label>
              <label>Показывать<select disabled={allLinkedEskizProjects.length === 0 || !onEskizProChange} value={eskizClientMode} onChange={(event) => updateEskizPro({ clientMode: event.target.value as EskizProIntegration['clientMode'] })}><option value="active">Только главный эскиз</option><option value="all">Все связанные эскизы</option></select></label>
              <label>Маркеры модулей<select disabled={allLinkedEskizProjects.length === 0 || !onEskizProChange} value={project.eskizPro?.moduleMarkerMode ?? 'full'} onChange={(event) => updateEskizPro({ moduleMarkerMode: event.target.value as EskizProIntegration['moduleMarkerMode'] })}><option value="full">Полные</option><option value="compact">Точками</option><option value="hidden">Скрыть</option></select></label>
              <label className="chk-row"><input type="checkbox" disabled={allLinkedEskizProjects.length === 0 || !onEskizProChange} checked={eskizViewSettings.showImage !== false} onChange={(event) => updateEskizView({ showImage: event.target.checked })} /> Фон/скрин</label>
              <label className="chk-row"><input type="checkbox" disabled={allLinkedEskizProjects.length === 0 || !onEskizProChange} checked={eskizViewSettings.showAnnotations !== false} onChange={(event) => updateEskizView({ showAnnotations: event.target.checked })} /> Пометки</label>
              <label className="chk-row"><input type="checkbox" disabled={allLinkedEskizProjects.length === 0 || !onEskizProChange} checked={showCommunicationSizeBadges} onChange={(event) => updateEskizPro({ showCommunicationSizeBadges: event.target.checked })} /> Размеры коммуникаций</label>
              <div className="client-eskiz-layer-controls">
                {CLIENT_ESKIZ_LAYERS.map((layer) => <button key={layer.key} type="button" disabled={allLinkedEskizProjects.length === 0 || !onEskizProChange || eskizViewSettings.showAnnotations === false} className={eskizLayerVisibility[layer.key] === false ? '' : 'active'} onClick={() => updateEskizView({ layerVisibility: { [layer.key]: !(eskizLayerVisibility[layer.key] !== false) } })}>{layer.label}</button>)}
              </div>
            </div>
          </details>
        </div>
      </section>

        </aside>
        <main className="client-offer-preview">

      <div className={`client-doc client-doc-${presentationMode}`} id="client-doc">
        <header className="cd-hero">
          <div className="cd-hero-main">
            <div className="cd-brand">РЕцепт</div>
            <div className="cd-sub">мебельное ателье · индивидуальная кухня</div>
            <h2>Коммерческое предложение</h2>
            <h1>{project.name}</h1>
            <div className="cd-hero-meta">{project.client && <span>Заказчик: <b>{project.client}</b></span>}<span>Дата: {fmtDate(project.date)}</span>{selectedVariant && <span>Вариант: <b>{selectedVariant.name}</b></span>}</div>
            <div className="cd-hero-tags"><span>{MODE_LABELS[presentationMode]}</span>{clientSketchVisible && <span>Эскиз PRO включён</span>}{groups.length > 0 && <span>{fmtNum(moduleQty, 3)} модулей</span>}</div>
          </div>
          <div className="cd-hero-price">
            <span>Итоговая стоимость</span>
            <b>{fmtMoney(totals.client)}</b>
            <em>без внутренних закупочных цен</em>
          </div>
        </header>

        {offerTerms.length > 0 && <div className="cd-terms">{offerTerms.map((term) => <div key={term.label}><b>{term.label}</b><span>{term.value}</span></div>)}</div>}

        <section className="cd-summary cd-summary-modern">
          <div className="cd-summary-copy">
            <h3>Кратко по проекту</h3>
            <p>Основные цифры без себестоимости и внутренних закупочных данных. Подробный состав ниже сгруппирован так, чтобы не повторять фурнитуру внутри каждого модуля.</p>
          </div>
          <div className="cd-summary-facts">
            <div><b>{fmtNum(moduleQty, 3)}</b><span>модулей</span></div>
            <div><b>{projectSummary.facadeAreaM2 > 0 ? fmtNum(projectSummary.facadeAreaM2, 2) : fmtNum(facadeQty, 3)}</b><span>{projectSummary.facadeAreaM2 > 0 ? 'м² фасадов' : 'фасадов / рамок'}</span></div>
            <div><b>{fmtNum(hingeQty, 3)}</b><span>петель</span></div>
            <div><b>{fmtNum(drawerQty, 3)}</b><span>систем ящиков</span></div>
            <div><b>{fmtNum(liftQty, 3)}</b><span>подъёмников</span></div>
            <div><b>{fmtMoney(projectSummary.bodyTotal)}</b><span>корпуса общ.</span></div>
          </div>
          {includedChips.length > 0 && <div className="cd-included"><b>В предложение входит</b><div>{includedChips.map((chip) => <span key={chip}>{chip}</span>)}</div></div>}
          {materialHighlights.length > 0 && <div className="cd-materials"><b>Ключевые материалы</b><ul>{materialHighlights.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        </section>

        <section className="cd-next-steps">
          <div><b>1</b><span>Согласование КП и эскиза</span></div>
          <div><b>2</b><span>Финальная проверка размеров</span></div>
          <div><b>3</b><span>Производство комплекта</span></div>
          <div><b>4</b><span>Доставка и монтаж</span></div>
        </section>

        {compositionSections.length > 0 && (
          <section className="cd-composition">
            <div className="cd-section-head"><h3>Смета по разделам</h3><span>коротко по категориям, без повторов внутри модулей</span></div>
            <div className="cd-composition-grid">
              {compositionSections.map((section) => <article className="cd-composition-card" key={section.id}>
                <div className="cd-composition-card-head"><div><b>{section.title}</b><span>{section.qtyText}</span></div><strong>{fmtMoney(section.total)}</strong></div>
                {section.preview.length > 0 && <ul>{section.preview.map((item) => <li key={item}>{item}</li>)}</ul>}
              </article>)}
            </div>
          </section>
        )}

        {(project.photos ?? []).some((photo) => photo.showToClient) && <div className="cd-photos">{(project.photos ?? []).filter((photo) => photo.showToClient).map((photo) => <figure key={photo.id}><img src={photo.dataUrl} alt={photo.name} /><figcaption>{photo.name}</figcaption></figure>)}</div>}

        {clientSketchVisible && (
          <section className="cd-sketch-pro">
            <div className="cd-section-head"><h3>Эскиз PRO</h3><span>{isTechnical ? 'внешний эскиз со скрином проекта и размерными аннотациями' : 'схема из внешнего Эскиз PRO'}</span></div>
            {linkedEskizProjects.map((eskiz) => <div key={eskiz.id} className="cd-sketch-wrap">
              <EskizProjectPreview project={eskiz} compact={!isTechnical} moduleMarkerMode={project.eskizPro?.moduleMarkerMode ?? 'full'} communicationMarkers={(project.eskizPro?.communications ?? []).filter((marker) => marker.showInClient !== false)} showCommunicationSizeBadges={showCommunicationSizeBadges} viewSettings={eskizViewSettings} />
              {packageSettings.sketchSummaryOverlay && sketchSummaryLines.length > 0 && <div className="cd-sketch-summary"><b>Сводка проекта</b>{sketchSummaryLines.slice(0, isTechnical ? 6 : 4).map((line) => <span key={line}>{line}</span>)}</div>}
            </div>)}
            {eskizModules.length > 0 && (
              <div className="cd-eskiz-modules">
                <b>Модули, добавленные с эскиза</b>
                <div>{eskizModules.map((module) => <span key={module.id}>{module.name}{module.widthMm ? ` · ${module.widthMm}×${module.heightMm ?? '—'}${module.depthMm ? `×${module.depthMm}` : ''} мм` : ''}</span>)}</div>
              </div>
            )}
          </section>
        )}

        {variantSummaries.length > 1 && <section className="cd-variants"><h3>Варианты комплектации</h3>{variantSummaries.map(({ variant, totals: variantTotals }) => <div className={`cd-variant-row ${variant.id === project.selectedVariantId ? 'active' : ''}`} key={variant.id}><div><b>{variant.name}</b><span>{variant.description}</span></div><strong>{variantTotals ? fmtMoney(variantTotals.client) : '—'}</strong></div>)}</section>}

        {groups.length > 0 && (
          <section className="cd-modules">
            <div className="cd-section-head">
              <h3>Состав мебели</h3>
              <span>{MODULE_DETAIL_MODE_LABELS[moduleDetailMode]}</span>
            </div>
            {groups.map((group, index) => {
              const ids = groupLineIds(group);
              const idSet = new Set(ids);
              const lines = activeCalculation.lines.filter((line) => idSet.has(line.id));
              const details = buildClientOfferDetails(lines, lineCalcs);
              const visibleDetails = extractHardwareFromModules ? details.filter((detail) => !isAggregatedHardware(detail)) : details;
              const extractedCount = details.length - visibleDetails.length;
              const total = groupSum(group);
              return (
                <article className="cd-module-card" key={group.id}>
                  <div className="cd-module-card-head">
                    <div className="cd-module-num">{index + 1}</div>
                    <div className="cd-module-name">
                      <b>{group.title}</b>
                      <span>{[group.sub, `${fmtNum(group.qty, 3)} шт`].filter(Boolean).join(' · ')}</span>
                    </div>
                    <strong>{total != null ? fmtMoney(total) : '—'}</strong>
                  </div>
                  {moduleDetailMode === 'summary' ? (
                    <div className="cd-module-brief cd-module-summary-only">
                      <span>{group.sub || 'габариты не указаны'}</span>
                      <span>{fmtNum(group.qty, 3)} шт</span>
                      {total != null && <span>{fmtMoney(total)}</span>}
                      {extractHardwareFromModules && extractedCount > 0 && <span>фурнитура вынесена в сводку</span>}
                    </div>
                  ) : visibleDetails.length > 0 ? (
                    isBrief ? (
                      <div className="cd-module-brief">
                        {visibleDetails.slice(0, 5).map((detail) => <span key={detail.id}>{detailBriefText(detail)}</span>)}
                        {visibleDetails.length > 5 && <span>ещё {visibleDetails.length - 5} поз.</span>}
                        {extractHardwareFromModules && extractedCount > 0 && <span>фурнитура — в общей сводке</span>}
                      </div>
                    ) : (
                      <>
                        <div className="cd-component-list">
                          {visibleDetails.map((detail) => <DetailRow key={detail.id} detail={detail} showPrice={showDetailPrices} technical={isTechnical} />)}
                        </div>
                        {extractHardwareFromModules && extractedCount > 0 && <div className="cd-module-compact-note">Петли, опоры, ручки, подъёмники и системы ящиков вынесены ниже в общую фурнитуру проекта.</div>}
                      </>
                    )
                  ) : extractHardwareFromModules && extractedCount > 0 ? (
                    <div className="cd-module-compact-note">Комплектация этого модуля вынесена в общую фурнитуру проекта.</div>
                  ) : (
                    <div className="cd-module-empty">Нет рассчитанных строк по модулю — проверьте комплектацию.</div>
                  )}
                </article>
              );
            })}
          </section>
        )}

        {projectHardwareDetails.length > 0 && (
          <section className="cd-project-hardware">
            <div className="cd-section-head"><h3>Фурнитура по проекту</h3><span>общими строками, без повторения в каждом модуле</span></div>
            <div className="cd-component-list cd-component-list-extra cd-hardware-list">
              {projectHardwareDetails.map((detail) => <DetailRow key={detail.id} detail={{ ...detail, details: detail.details.map((note) => stripModuleNote(note)) }} showPrice={showDetailPrices} technical={isTechnical} />)}
            </div>
          </section>
        )}

        {visibleExtraDetails.length > 0 && (
          <section className="cd-extra">
            <div className="cd-section-head"><h3>Дополнительно</h3><span>столешницы, цоколь, мойки, работы и прочие позиции</span></div>
            <div className="cd-component-list cd-component-list-extra">
              {visibleExtraDetails.map((detail) => <DetailRow key={detail.id} detail={{ ...detail, details: detail.details.map((note) => stripModuleNote(note)) }} showPrice={showDetailPrices && !isBrief} technical={isTechnical} />)}
            </div>
          </section>
        )}

        <div className="cd-total">Итоговая стоимость: <b>{fmtMoney(totals.client)}</b></div>
        {project.clientOffer?.notes && <div className="cd-comment"><b>Примечания:</b><br />{project.clientOffer.notes}</div>}
        {project.comment && <div className="cd-comment">{project.comment}</div>}

        {packageDocumentNames.length > 0 && (
          <section className="cd-package-docs cd-package-note">
            <div className="cd-section-head"><h3>Файлы клиентского пакета</h3><span>выгружаются отдельно, не раздувают печатное КП</span></div>
            <div className="cd-package-file-list">{packageDocumentNames.map((name) => <span key={name}>{name}</span>)}</div>
          </section>
        )}
      </div>
        </main>
      </div>
    </div>
  );
}
