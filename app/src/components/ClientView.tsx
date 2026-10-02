import { useState } from 'react';
import type { ClientDocumentPackageSettings, ClientOfferPresentationMode, ClientOfferSettings, EskizExportViewSettings, EskizLayerKey, EskizProIntegration, Pricebook, Project } from '../types';
import type { ClientOfferDetail, ClientOfferDetailKind } from '../lib/clientOffer';
import { calcTotals } from '../lib/engine';
import { calculateVariant } from '../lib/variants';
import { buildClientOfferDetails, buildClientProjectSummary, clientSketchSummaryLines, isModuleLine, moduleNoteMatches, stripModuleNote } from '../lib/clientOffer';
import { fmtMoney, fmtDate, fmtNum } from '../lib/format';
import { exportClientXlsx } from '../lib/exporters';
import { snapshotProject } from '../lib/eskizPro';
import { downloadEskizSketchPdf, renderEskizSketchPdf } from '../lib/eskizSketchExport';
import { downloadClientContractDocx, downloadClientDocumentZip, downloadClientOfferDocx, downloadClientReceiptDocx, normalizeClientDocumentPackage, type ClientDocumentArgs } from '../lib/clientPackage';
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
  const moduleQty = groups.reduce((sum, group) => sum + group.qty, 0);
  const projectSummary = buildClientProjectSummary(allDetails, moduleQty);
  const sketchSummaryLines = clientSketchSummaryLines(projectSummary);
  const facadeQty = sumKind(allDetails, ['facade', 'frame']);
  const hingeQty = sumKind(allDetails, ['hinge']);
  const drawerQty = sumKind(allDetails, ['drawerSys']);
  const liftQty = sumKind(allDetails, ['lift']);
  const includedChips = [
    groups.length > 0 ? `Мебельные модули — ${fmtNum(moduleQty, 3)} шт` : '',
    facadeQty > 0 ? `Фасады — ${fmtNum(facadeQty, 3)} шт` : '',
    hingeQty > 0 ? `Петли — ${fmtNum(hingeQty, 3)} шт` : '',
    drawerQty > 0 ? `Системы ящиков — ${fmtNum(drawerQty, 3)} компл.` : '',
    liftQty > 0 ? `Подъёмники — ${fmtNum(liftQty, 3)} шт` : '',
    hasKind(allDetails, ['worktop']) ? 'Столешница' : '',
    hasKind(allDetails, ['wallPanel']) ? 'Стеновая панель' : '',
    hasKind(allDetails, ['sink']) ? 'Мойка / смеситель' : '',
  ].filter(Boolean);
  const materialHighlights = uniqueHighlights(allDetails, ['body', 'facade', 'frame', 'worktop', 'wallPanel', 'handle'], isTechnical ? 10 : 6);
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
          <button className="btn ghost" onClick={() => exportClientXlsx({ ...project, lines: activeCalculation.lines, settings: selectedVariant?.settings ?? project.settings })}>Excel для клиента</button>
          <button className="btn ghost" disabled={packageExporting} onClick={exportClientPackage}>{packageExporting ? 'Собираю пакет…' : 'Пакет клиента ZIP'}</button>
          <button className="btn primary" onClick={() => window.print()}>Печать / PDF</button>
        </div>
      </div>

      <section className="card client-document-hub no-print" aria-label="Документы для клиента">
        <div className="client-document-hub-main">
          <span className="eyebrow">Клиентский пакет</span>
          <h3>Отдельные файлы для клиента: эскиз, КП, договор и чек</h3>
          <p>Выгрузка идёт не HTML: Word/PDF можно сразу отправлять, править и складывать в общий ZIP.</p>
        </div>
        <div className="client-document-actions big">
          <button type="button" className="btn ghost" disabled={packageExporting || !clientSketchVisible} onClick={exportSketchPdf}>Эскиз PDF</button>
          <button type="button" className="btn ghost" disabled={packageExporting} onClick={() => runClientDownload(() => downloadClientOfferDocx(clientDocumentArgs), 'Не получилось выгрузить КП')}>Полное КП Word</button>
          <button type="button" className="btn ghost" disabled={packageExporting} onClick={() => runClientDownload(() => downloadClientContractDocx(clientDocumentArgs), 'Не получилось выгрузить договор')}>Договор Word</button>
          <button type="button" className="btn ghost" disabled={packageExporting} onClick={() => runClientDownload(() => downloadClientReceiptDocx(clientDocumentArgs), 'Не получилось выгрузить товарный чек')}>Товарный чек Word</button>
          <button type="button" className="btn primary" disabled={packageExporting} onClick={exportClientPackage}>{packageExporting ? 'Собираю…' : 'Пакет ZIP'}</button>
        </div>
        <div className="client-document-includes">
          <span className={packageSettings.includeSketch && clientSketchVisible ? 'ready' : ''}>Эскиз</span>
          <span className={packageSettings.includeOffer ? 'ready' : ''}>КП</span>
          <span className={packageSettings.includeContract ? 'ready' : ''}>Договор</span>
          <span className={packageSettings.includeReceipt ? 'ready' : ''}>Товарный чек</span>
          <span className={packageSettings.sketchSummaryOverlay ? 'ready' : ''}>Сводка на эскизе</span>
        </div>
      </section>

      <section className="card client-offer-editor no-print">
        <div className="client-offer-editor-head"><div><h3>Условия предложения</h3><p className="muted small">Эти поля видны клиенту, но не влияют на расчёт себестоимости.</p></div><span className="muted small">Цена округляется по настройкам проекта</span></div>
        <div className="grid3">
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
          <label className="client-detail-price-toggle"><input type="checkbox" checked={showDetailPrices} onChange={(event) => updateOffer({ showDetailPrices: event.target.checked })} /> Показывать суммы в детализации</label>
          <label className="span-2">Примечания для клиента<textarea rows={2} value={project.clientOffer?.notes ?? ''} onChange={(event) => updateOffer({ notes: event.target.value })} /></label>
        </div>
        <div className="client-package-control">
          <div className="client-package-head">
            <div><b>Что попадёт в ZIP и КП</b><span>Настройте состав пакета и временные реквизиты. Кнопки выгрузки вынесены выше в блок «Клиентский пакет».</span></div>
          </div>
          <div className="client-package-options">
            <label><input type="checkbox" checked={packageSettings.includeOffer} onChange={(event) => updatePackageSettings({ includeOffer: event.target.checked })} /> КП/сводка</label>
            <label><input type="checkbox" checked={packageSettings.includeSketch} onChange={(event) => updatePackageSettings({ includeSketch: event.target.checked })} /> Эскиз</label>
            <label><input type="checkbox" checked={packageSettings.includeSpecification} onChange={(event) => updatePackageSettings({ includeSpecification: event.target.checked })} /> Спецификация</label>
            <label><input type="checkbox" checked={packageSettings.includeContract} onChange={(event) => updatePackageSettings({ includeContract: event.target.checked })} /> Договор</label>
            <label><input type="checkbox" checked={packageSettings.includeReceipt} onChange={(event) => updatePackageSettings({ includeReceipt: event.target.checked })} /> Товарный чек</label>
            <label><input type="checkbox" checked={packageSettings.sketchSummaryOverlay} onChange={(event) => updatePackageSettings({ sketchSummaryOverlay: event.target.checked })} /> Сводка на эскизе</label>
            <label><input type="checkbox" checked={packageSettings.compact} onChange={(event) => updatePackageSettings({ compact: event.target.checked })} /> Компактно</label>
          </div>
          <div className="client-package-fields">
            <label>Исполнитель<input value={project.clientOffer?.sellerName ?? ''} placeholder="Название / ИП / ООО" onChange={(event) => updateOffer({ sellerName: event.target.value })} /></label>
            <label>№ договора<input value={project.clientOffer?.contractNumber ?? ''} placeholder="авто из проекта" onChange={(event) => updateOffer({ contractNumber: event.target.value })} /></label>
            <label>Срок изготовления<input value={project.clientOffer?.productionTerms ?? ''} placeholder="например, 35 рабочих дней" onChange={(event) => updateOffer({ productionTerms: event.target.value })} /></label>
            <label>Гарантия<input value={project.clientOffer?.warranty ?? ''} placeholder="например, 12 месяцев" onChange={(event) => updateOffer({ warranty: event.target.value })} /></label>
            <label className="span-2">Реквизиты исполнителя<textarea rows={2} value={project.clientOffer?.sellerDetails ?? ''} placeholder="ИНН, адрес, телефон — появятся в договоре и чеке" onChange={(event) => updateOffer({ sellerDetails: event.target.value })} /></label>
            <label>Контакты клиента<textarea rows={2} value={project.clientOffer?.clientContacts ?? ''} placeholder="телефон, адрес" onChange={(event) => updateOffer({ clientContacts: event.target.value })} /></label>
          </div>
        </div>
        <div className="client-eskiz-control">
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
      </section>

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

        {project.clientOffer && <div className="cd-terms"><div><b>Действительно до</b><span>{project.clientOffer.validUntil ? fmtDate(project.clientOffer.validUntil) : 'не указано'}</span></div><div><b>Оплата</b><span>{project.clientOffer.paymentTerms || 'не указано'}</span></div><div><b>Монтаж</b><span>{project.clientOffer.installation || 'не указано'}</span></div><div><b>Доставка</b><span>{project.clientOffer.delivery || 'не указано'}</span></div></div>}

        <section className="cd-summary">
          <div className="cd-summary-price">
            <span>Итоговая стоимость</span>
            <b>{fmtMoney(totals.client)}</b>
            <em>{MODE_LABELS[presentationMode]}</em>
          </div>
          <div className="cd-summary-facts">
            <div><b>{fmtNum(moduleQty, 3)}</b><span>модулей</span></div>
            <div><b>{projectSummary.facadeAreaM2 > 0 ? fmtNum(projectSummary.facadeAreaM2, 2) : fmtNum(facadeQty, 3)}</b><span>{projectSummary.facadeAreaM2 > 0 ? 'м² фасадов' : 'фасадов / рамок'}</span></div>
            <div><b>{fmtNum(hingeQty, 3)}</b><span>петель</span></div>
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
              <span>{isBrief ? 'краткая сводка по модулям' : isTechnical ? 'техническая детализация по каждому модулю' : 'компактная детализация по каждому модулю'}</span>
            </div>
            {groups.map((group, index) => {
              const ids = groupLineIds(group);
              const idSet = new Set(ids);
              const lines = activeCalculation.lines.filter((line) => idSet.has(line.id));
              const details = buildClientOfferDetails(lines, lineCalcs);
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
                  {details.length > 0 ? (
                    isBrief ? (
                      <div className="cd-module-brief">
                        {details.slice(0, 6).map((detail) => <span key={detail.id}>{detailBriefText(detail)}</span>)}
                        {details.length > 6 && <span>ещё {details.length - 6} поз.</span>}
                      </div>
                    ) : (
                      <div className="cd-component-list">
                        {details.map((detail) => <DetailRow key={detail.id} detail={detail} showPrice={showDetailPrices} technical={isTechnical} />)}
                      </div>
                    )
                  ) : (
                    <div className="cd-module-empty">Нет рассчитанных строк по модулю — проверьте комплектацию.</div>
                  )}
                </article>
              );
            })}
          </section>
        )}

        {extraDetails.length > 0 && (
          <section className="cd-extra">
            <div className="cd-section-head"><h3>Дополнительно</h3><span>столешницы, цоколь, мойки, работы и прочие позиции</span></div>
            <div className="cd-component-list cd-component-list-extra">
              {extraDetails.map((detail) => <DetailRow key={detail.id} detail={{ ...detail, details: detail.details.map((note) => stripModuleNote(note)) }} showPrice={showDetailPrices && !isBrief} technical={isTechnical} />)}
            </div>
          </section>
        )}

        <div className="cd-total">Итоговая стоимость: <b>{fmtMoney(totals.client)}</b></div>
        {project.clientOffer?.notes && <div className="cd-comment"><b>Примечания:</b><br />{project.clientOffer.notes}</div>}
        {project.comment && <div className="cd-comment">{project.comment}</div>}

        {(packageSettings.includeContract || packageSettings.includeReceipt) && (
          <section className="cd-package-docs">
            <div className="cd-section-head"><h3>Пакет документов</h3><span>черновые типовые формы — позже заменим на ваши шаблоны</span></div>
            {packageSettings.includeContract && <article className="cd-legal-card"><h4>Договор на изготовление мебели</h4><p><b>Исполнитель:</b> {project.clientOffer?.sellerName || 'Исполнитель / мебельное ателье'} · <b>Заказчик:</b> {project.client || '—'} · <b>№:</b> {project.clientOffer?.contractNumber || project.id.slice(0, 8).toUpperCase()}</p><p>Предмет: изготовление и/или комплектация мебельного изделия по согласованному эскизу, спецификации и коммерческому предложению. Стоимость: <b>{fmtMoney(totals.client)}</b>. Оплата: {project.clientOffer?.paymentTerms || 'по согласованию'}. Срок: {project.clientOffer?.productionTerms || 'после утверждения размеров и материалов'}. Гарантия: {project.clientOffer?.warranty || '12 месяцев, если иное не указано'}.</p><div className="cd-sign-row"><span>Исполнитель __________________</span><span>Заказчик __________________</span></div></article>}
            {packageSettings.includeReceipt && <article className="cd-legal-card"><h4>Товарный чек</h4><div className="cd-receipt-grid"><span>Комплект мебели по проекту</span><b>{fmtMoney(totals.client)}</b><span>Корпуса общ.</span><b>{fmtMoney(projectSummary.bodyTotal)}</b><span>Фасады</span><b>{projectSummary.facadeAreaM2 > 0 ? `${fmtNum(projectSummary.facadeAreaM2, 2)} м² · ${fmtMoney(projectSummary.facadeTotal)}` : fmtMoney(projectSummary.facadeTotal)}</b><span>Фурнитура</span><b>{fmtMoney(projectSummary.hardwareTotal)}</b></div><div className="cd-sign-row"><span>Продавец __________________</span><span>Покупатель __________________</span></div></article>}
          </section>
        )}
      </div>
    </div>
  );
}
