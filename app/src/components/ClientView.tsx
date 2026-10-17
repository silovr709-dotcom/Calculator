import { toast } from '../lib/toast';
import { useEffect, useMemo, useState } from 'react';
import type { ClientDocumentPackageSettings, ClientOfferDetailLevel, ClientOfferModuleDetailMode, ClientOfferPresentationMode, ClientOfferSettings, EskizExportViewSettings, EskizLayerKey, EskizProIntegration, Pricebook, Project, ProjectLine } from '../types';
import type { ClientOfferDetail, ClientOfferDetailKind } from '../lib/clientOffer';
import { calcTotals } from '../lib/engine';
import { calculateVariant } from '../lib/variants';
import { applyClientOfferEdits, buildClientOfferDetails, buildClientOfferRollup, buildClientProjectSummary, clientBodyTotal, clientDetailKey, clientOfferEditsDelta, clientSketchSummaryLines, isModuleLine, moduleNoteMatches, stripModuleNote } from '../lib/clientOffer';
import { clientLineName, makeClientNameResolver } from '../lib/clientNaming';
import EditableText from './EditableText';
import EditableDate from './EditableDate';
import EditableNumber from './EditableNumber';
import { fmtMoney, fmtDate, fmtDateLong, fmtNum } from '../lib/format';
import { exportClientXlsx } from '../lib/exporters';
import { snapshotProject } from '../lib/eskizPro';
import { downloadEskizSketchPdf, renderEskizSketchPdf } from '../lib/eskizSketchExport';
import { mergeEskizExportImage, mergeEskizExportLayers } from '../lib/eskizExportOptions';
import {
  clientOfferUrl,
  deleteProjectDocument, listProjectDocuments, listPublishedOffers, publishClientOffer,
  revokePublishedOffer, saveProjectDocument, serverFileUrl, setProjectDocumentStatus,
  type ProjectDocument, type ProjectDocumentKind, type ProjectDocumentStatus, type PublishedOffer,
} from '../lib/serverApi';
import { dehydrate } from '../lib/photoStore';
import { buildClientContractDocx, buildClientOfferDocx, buildClientPackageZip, buildClientReceiptDocx,
  buildClientSpecificationDocx, buildReceiptRows, downloadClientContractDocx, downloadClientDocumentZip, downloadClientOfferDocx, downloadClientReceiptDocx, downloadClientSpecificationDocx, normalizeClientDocumentPackage, type ClientDocumentArgs } from '../lib/clientPackage';
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

const DOCUMENT_KIND_LABELS: Record<string, string> = {
  offer: 'КП',
  specification: 'спецификация',
  contract: 'договор',
  receipt: 'товарный чек',
  sketch: 'эскиз',
  package: 'пакет клиента',
  blank: 'бланк фабрики',
  other: 'документ',
};

const DOCUMENT_STATUS_LABELS: Record<string, string> = {
  created: 'создан',
  sent: 'отправлен',
  signed: 'подписан',
  paid: 'оплачен',
};

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

const DEFAULT_SUMMARY_NOTE = 'Основные цифры без себестоимости и внутренних закупочных данных. Подробный состав ниже сгруппирован так, чтобы не повторять фурнитуру внутри каждого модуля.';

const AGGREGATED_HARDWARE_KINDS: ClientOfferDetailKind[] = ['hinge', 'drawerSys', 'lift', 'handle', 'legs'];
const AGGREGATED_HARDWARE_SET = new Set<ClientOfferDetailKind>(AGGREGATED_HARDWARE_KINDS);

function isAggregatedHardware(detail: ClientOfferDetail): boolean {
  return AGGREGATED_HARDWARE_SET.has(detail.kind);
}

/** Градация детализации КП — одна ручка для менеджера. */
const DETAIL_LEVELS: { value: ClientOfferDetailLevel; title: string; hint: string }[] = [
  { value: 'rollup', title: '1 — Сводка', hint: 'сколько модулей, петель, направляющих, м² фасадов и какие — и итог' },
  { value: 'sections', title: '2 — По разделам', hint: 'сводка + смета по разделам + перечень модулей' },
  { value: 'modules', title: '3 — По модулям', hint: 'состав каждого модуля, фурнитура общими строками по проекту' },
  { value: 'full', title: '4 — Полное', hint: 'все позиции внутри каждого модуля, техническое приложение' },
];
const DETAIL_LEVEL_LABELS: Record<ClientOfferDetailLevel, string> = {
  rollup: 'Сводка',
  sections: 'По разделам',
  modules: 'По модулям',
  full: 'Полное',
};
/** Уровень задаёт остальные режимы, чтобы Word/ZIP совпадали с экраном. */
const DETAIL_LEVEL_PRESETS: Record<ClientOfferDetailLevel, { presentationMode: ClientOfferPresentationMode; moduleDetailMode: ClientOfferModuleDetailMode; aggregateHardware: boolean }> = {
  rollup: { presentationMode: 'brief', moduleDetailMode: 'summary', aggregateHardware: true },
  sections: { presentationMode: 'detailed', moduleDetailMode: 'summary', aggregateHardware: true },
  modules: { presentationMode: 'detailed', moduleDetailMode: 'compact', aggregateHardware: true },
  full: { presentationMode: 'technical', moduleDetailMode: 'full', aggregateHardware: false },
};

function detailLevelFromLegacy(presentationMode: ClientOfferPresentationMode, moduleDetailMode: ClientOfferModuleDetailMode): ClientOfferDetailLevel {
  if (moduleDetailMode === 'full' || presentationMode === 'technical') return 'full';
  if (moduleDetailMode === 'compact') return 'modules';
  return presentationMode === 'brief' ? 'rollup' : 'sections';
}

/** Единица, в которой считается «штучное» количество позиции. */
function detailPieceUnit(detail: ClientOfferDetail): string {
  if (detail.kind === 'bodySurcharge') return 'доп.';
  if (detail.priceBasis === 'm2' || detail.priceBasis === 'lm') return 'шт';
  if (detail.priceBasis === 'sheet') return detail.unit || 'лист';
  return detail.unit || 'шт';
}

/** Пересчитанное количество (м²/п.м/листы), которое идёт в цену. */
function detailMeasuredText(detail: ClientOfferDetail): string {
  if (detail.priceBasis !== 'm2' && detail.priceBasis !== 'lm') return '';
  return `${fmtNum(detail.qtyEffective, 4)} ${detail.unit || (detail.priceBasis === 'm2' ? 'м²' : 'п.м')}`;
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

function DetailRow({ detail, showPrice, technical, onRename, onQty, onSum }: {
  detail: ClientOfferDetail;
  showPrice: boolean;
  technical: boolean;
  onRename?: (itemId: string, name: string) => void;
  /** Правка количества прямо в КП; null — вернуть расчётное значение. */
  onQty?: (detail: ClientOfferDetail, value: number | null) => void;
  /** Правка суммы прямо в КП; null — вернуть расчётную. */
  onSum?: (detail: ClientOfferDetail, value: number | null) => void;
}) {
  const visibleDetails = technical ? detail.details : detail.details.slice(0, 3);
  const hiddenCount = detail.details.length - visibleDetails.length;
  const measured = detailMeasuredText(detail);
  return (
    <div className={`cd-component cd-component-${detail.kind}${showPrice ? '' : ' no-price'}${detail.qtyEdited || detail.sumEdited ? ' cd-component-edited' : ''}`}>
      <div className="cd-component-main">
        <span className="cd-component-kind">{detail.kindLabel}</span>
        <b>{onRename && detail.itemId
          ? <EditableText value={detail.name} label="Название позиции в КП" onChange={(value) => onRename(detail.itemId, value)} />
          : detail.name}</b>
        {visibleDetails.length > 0 && (
          <div className="cd-component-notes">
            {visibleDetails.map((note) => <span key={note}>{note}</span>)}
            {hiddenCount > 0 && <span>ещё {hiddenCount}</span>}
          </div>
        )}
      </div>
      <div className="cd-component-qty">
        {onQty
          ? <>
              <EditableNumber
                value={detail.qty}
                edited={detail.qtyEdited}
                baseHint={`${fmtNum(detail.baseQty ?? detail.qty, 3)} ${detailPieceUnit(detail)}`}
                label={`Количество: ${detail.name}`}
                format={(value) => `${fmtNum(value ?? 0, 3)} ${detailPieceUnit(detail)}`}
                onChange={(value) => onQty(detail, value)}
              />
              {measured && <em className="cd-measured">{measured}</em>}
            </>
          : detailQtyText(detail)}
      </div>
      {showPrice && <div className="cd-component-sum">
        {onSum
          ? <EditableNumber
              value={detail.clientSum}
              edited={detail.sumEdited}
              baseHint={detail.baseClientSum != null ? fmtMoney(detail.baseClientSum) : '—'}
              label={`Сумма: ${detail.name}`}
              format={(value) => (value == null ? '—' : fmtMoney(value))}
              onChange={(value) => onSum(detail, value)}
            />
          : detail.clientSum != null ? fmtMoney(detail.clientSum) : '—'}
      </div>}
    </div>
  );
}

function moduleCompactSummary(details: ClientOfferDetail[]): string[] {
  const priority: ClientOfferDetailKind[] = ['body', 'bodySurcharge', 'facade', 'frame', 'worktop', 'wallPanel', 'shelf'];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const kind of priority) {
    for (const detail of details) {
      if (detail.kind !== kind) continue;
      const label = kind === 'bodySurcharge'
        ? `Надбавка: ${detail.name}`
        : `${detail.kindLabel}: ${detail.name}`;
      const short = label.length > 88 ? `${label.slice(0, 85)}…` : label;
      if (seen.has(short)) continue;
      seen.add(short);
      out.push(short);
      if (out.length >= 3) return out;
    }
  }
  return out;
}

export default function ClientView({ project, pricebook, moduleGroups, onOfferChange, onEskizProChange, onProjectMetaChange, publicMode = false }: {
  project: Project;
  pricebook?: Pricebook;
  moduleGroups?: ClientModuleGroup[];
  /** Страница для клиента по ссылке: без панели настроек и выгрузок. */
  publicMode?: boolean;
  onOfferChange?: (offer: ClientOfferSettings) => void;
  onEskizProChange?: (eskizPro: EskizProIntegration) => void;
  /** Правка шапки КП прямо на странице: название проекта, заказчик, дата. */
  onProjectMetaChange?: (patch: { name?: string; client?: string; date?: string }) => void;
}) {
  const [packageExporting, setPackageExporting] = useState(false);
  // Ссылка клиенту: публикация КП на своём сервере и отметка о согласовании.
  const [offerLink, setOfferLink] = useState<{ id: string; url: string } | null>(null);
  const [offerStatus, setOfferStatus] = useState<PublishedOffer | null>(null);
  const [offerBusy, setOfferBusy] = useState(false);
  const [offerCopied, setOfferCopied] = useState(false);
  // Документы проекта, сохранённые на хостинге: договор, чек, КП, пакет.
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const groups = moduleGroups ?? [];
  const baseProjectForVariants: Project = { ...project, lines: project.lines.filter((line) => !isModuleLine(line)) };
  const selectedVariant = project.variants?.find((variant) => variant.id === project.selectedVariantId);
  const activeCalculation = selectedVariant && pricebook
    ? calculateVariant(baseProjectForVariants, pricebook, selectedVariant)
    : { ...calcTotals(project.lines, project.settings), lines: project.lines };
  const { lineCalcs, totals } = activeCalculation;
  const showDetailPrices = project.clientOffer?.showDetailPrices !== false;
  const legacyPresentationMode = project.clientOffer?.presentationMode ?? 'detailed';
  const legacyModuleDetailMode: ClientOfferModuleDetailMode = project.clientOffer?.moduleDetailMode ?? (legacyPresentationMode === 'technical' ? 'full' : 'summary');
  // Уровень детализации — главная ручка. Старые проекты без него читаются из прежних режимов.
  const detailLevel: ClientOfferDetailLevel = project.clientOffer?.detailLevel ?? detailLevelFromLegacy(legacyPresentationMode, legacyModuleDetailMode);
  const levelPreset = DETAIL_LEVEL_PRESETS[detailLevel];
  const presentationMode = levelPreset.presentationMode;
  const moduleDetailMode = levelPreset.moduleDetailMode;
  const aggregateHardware = project.clientOffer?.aggregateHardware ?? levelPreset.aggregateHardware;
  const isBrief = presentationMode === 'brief';
  const isTechnical = presentationMode === 'technical';
  const extractHardwareFromModules = aggregateHardware && moduleDetailMode !== 'full';
  // Что показываем на каждом уровне.
  const showCompositionSections = detailLevel !== 'rollup';
  const showModuleList = detailLevel !== 'rollup';
  const showProjectHardware = detailLevel === 'modules' || detailLevel === 'sections';
  const showExtraDetails = detailLevel !== 'rollup';
  // Позиции внутри ведомости видны на всех уровнях: это единственное место,
  // где количество и сумма правятся вручную, поэтому доступ к ним не прячем.
  const showRollupItems = true;
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

  // Названия для клиента: «Квадратный метр фасада … — 19мм» → «МДФ ПВХ (1 категория; 19 мм)».
  // Ручная правка в КП (lineNames) всегда важнее автоматического названия.
  const pricebookItems = useMemo(() => new Map((pricebook?.items ?? []).map((item) => [item.id, item])), [pricebook]);
  const storedLineNames = project.clientOffer?.lineNames;
  const resolveClientName = useMemo(
    () => makeClientNameResolver(pricebookItems, storedLineNames),
    [pricebookItems, storedLineNames],
  );
  const nameOverrides = storedLineNames ?? {};
  const canEditInline = Boolean(onOfferChange);
  const renameDetail = (itemId: string, name: string) => {
    if (!itemId) return;
    const next = { ...nameOverrides };
    // Если менеджер вернул автоматическое название — правку не храним.
    const sample = activeCalculation.lines.find((line: ProjectLine) => line.itemId === itemId);
    const auto = sample ? clientLineName(sample, pricebookItems.get(itemId)) : '';
    if (!name.trim() || name.trim() === auto) delete next[itemId];
    else next[itemId] = name.trim();
    updateOffer({ lineNames: next });
  };
  const packageSettings = normalizeClientDocumentPackage(project.clientOffer?.documentPackage);
  const updatePackageSettings = (patch: Partial<ClientDocumentPackageSettings>) => updateOffer({ documentPackage: { ...packageSettings, ...patch } });
  // Ручные правки прямо в КП: количество (петли, направляющие…) и суммы позиций.
  const qtyOverrides = project.clientOffer?.lineQty ?? {};
  const sumOverrides = project.clientOffer?.lineSums ?? {};
  const offerEdits = { qty: qtyOverrides, sums: sumOverrides };
  const setDetailQty = (detail: ClientOfferDetail, value: number | null) => {
    const key = clientDetailKey(detail);
    const base = detail.baseQty ?? detail.qty;
    const next = { ...qtyOverrides };
    if (value == null || Math.abs(value - base) < 0.0005) delete next[key];
    else next[key] = value;
    updateOffer({ lineQty: next });
  };
  const setDetailSum = (detail: ClientOfferDetail, value: number | null) => {
    const key = clientDetailKey(detail);
    const base = detail.baseClientSum ?? detail.clientSum;
    const next = { ...sumOverrides };
    if (value == null || (base != null && Math.abs(value - base) < 0.5)) delete next[key];
    else next[key] = value;
    updateOffer({ lineSums: next });
  };
  const resetOfferEdits = () => updateOffer({ lineQty: {}, lineSums: {} });
  const editsCount = Object.keys(qtyOverrides).length + Object.keys(sumOverrides).length;

  const extraDetails = applyClientOfferEdits(buildClientOfferDetails(extraLines, lineCalcs, resolveClientName), offerEdits);
  const allDetails = applyClientOfferEdits(buildClientOfferDetails(activeCalculation.lines, lineCalcs, resolveClientName), offerEdits);
  // Итог КП = расчёт плюс/минус ручные правки менеджера.
  const editsDelta = clientOfferEditsDelta(allDetails);
  const offerTotal = totals.client + editsDelta;
  const rollupRows = buildClientOfferRollup(allDetails);
  const projectHardwareDetails = extractHardwareFromModules ? allDetails.filter(isAggregatedHardware) : [];
  const visibleExtraDetails = extractHardwareFromModules ? extraDetails.filter((detail) => !isAggregatedHardware(detail)) : extraDetails;
  const moduleQty = groups.reduce((sum, group) => sum + group.qty, 0);
  const projectSummary = buildClientProjectSummary(allDetails, moduleQty);
  const sketchSummaryLines = clientSketchSummaryLines(projectSummary);
  const sketchSummaryMode = packageSettings.sketchSummaryMode;
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
  const editableTerms: { label: string; value: string; field: keyof ClientOfferSettings; placeholder: string }[] = [
    { label: 'Действительно до', value: project.clientOffer?.validUntil ? fmtDateLong(project.clientOffer.validUntil) : '', field: 'validUntil', placeholder: 'дата' },
    { label: 'Оплата', value: project.clientOffer?.paymentTerms ?? '', field: 'paymentTerms', placeholder: 'например, 50% аванс' },
    { label: 'Срок изготовления', value: project.clientOffer?.productionTerms ?? '', field: 'productionTerms', placeholder: 'например, 45 рабочих дней' },
    { label: 'Гарантия', value: project.clientOffer?.warranty ?? '', field: 'warranty', placeholder: 'например, 12 месяцев' },
    { label: 'Монтаж', value: project.clientOffer?.installation ?? '', field: 'installation', placeholder: 'например, включён' },
    { label: 'Доставка', value: project.clientOffer?.delivery ?? '', field: 'delivery', placeholder: 'например, по адресу клиента' },
  ];
  const offerTerms = [
    project.clientOffer?.validUntil ? { label: 'Действительно до', value: fmtDateLong(project.clientOffer.validUntil) } : null,
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
    packageSettings.includeReceipt ? 'Товарный чек Word' : '',
  ].filter(Boolean);
  const offerReadinessItems = [
    { label: 'Клиент', ready: Boolean(project.client?.trim()), value: project.client?.trim() || 'не указан' },
    { label: 'Условия', ready: Boolean(project.clientOffer?.paymentTerms || project.clientOffer?.validUntil), value: project.clientOffer?.paymentTerms || 'оплата/срок не заполнены' },
    { label: 'Сроки', ready: Boolean(project.clientOffer?.productionTerms || project.clientOffer?.delivery || project.clientOffer?.installation), value: project.clientOffer?.productionTerms || project.clientOffer?.delivery || 'добавьте срок/доставку' },
    { label: 'Эскиз', ready: clientSketchVisible, value: clientSketchVisible ? `${linkedEskizProjects.length} PDF` : 'не прикреплён' },
  ];
  // Товарный чек перечисляет, какие именно корпуса вошли в комплект, поэтому
  // для каждого модуля считаем его корпусную часть (без фасадов и фурнитуры).
  const groupBodyTotals = groups.map((group) => {
    const ids = new Set(groupLineIds(group));
    const lines = activeCalculation.lines.filter((line) => ids.has(line.id));
    return clientBodyTotal(buildClientOfferDetails(lines, lineCalcs, resolveClientName));
  });
  const rawModuleBodyTotal = groupBodyTotals.reduce((sum, value) => sum + value, 0);
  const modulesBodyTarget = clientBodyTotal(allDetails) - clientBodyTotal(extraDetails);
  // Ручные правки сумм в КП распределяем по модулям пропорционально, чтобы чек сходился с итогом.
  const bodyFactor = rawModuleBodyTotal > 0 ? modulesBodyTarget / rawModuleBodyTotal : 1;
  const clientDocumentArgs: ClientDocumentArgs = {
    project: { ...project, lines: activeCalculation.lines, settings: selectedVariant?.settings ?? project.settings },
    offer: project.clientOffer ?? {},
    details: allDetails,
    modules: groups.map((group, index) => ({
      title: group.title,
      sub: group.sub,
      qty: group.qty,
      total: groupSum(group),
      bodyTotal: groupBodyTotals[index] * bodyFactor,
    })),
    total: offerTotal,
    summary: projectSummary,
  };
  // Короткая подсказка в настройках: сколько строк уйдёт в товарный чек.
  const receiptRows = buildReceiptRows(clientDocumentArgs);
  // Выключатели «Что включать в PNG и PDF» из Эскиз PRO действуют и на клиентскую выгрузку.
  const eskizExportOverrides = project.eskizPro?.exportOverrides ?? {};
  const sketchPdfOptions = {
    ...(eskizViewSettings ?? {}),
    showImage: mergeEskizExportImage(eskizViewSettings ?? {}, eskizExportOverrides),
    layerVisibility: mergeEskizExportLayers(eskizViewSettings ?? {}, eskizExportOverrides),
    linkLegend: eskizExportOverrides.linkLegend !== false,
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
      toast.info(`${errorTitle}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setPackageExporting(false);
    }
  };
  const exportSketchPdf = () => runClientDownload(async () => {
    if (!clientSketchVisible || linkedEskizProjects.length === 0) { toast.error('Нет привязанного Эскиз PRO для выгрузки.'); return; }
    for (const [index, eskiz] of linkedEskizProjects.entries()) {
      const pdf = await downloadEskizSketchPdf(eskiz, { ...sketchPdfOptions, title: eskiz.title, fileName: `Эскиз ${index + 1} — ${eskiz.title}.pdf` });
      if (index === 0) await keepDocument('sketch', `${project.name} — эскиз.pdf`, pdf.blob);
    }
  }, 'Не получилось выгрузить эскиз');
  // Подтягиваем состояние уже опубликованной ссылки: открывал ли клиент, согласовал ли.
  useEffect(() => {
    if (publicMode || !onOfferChange) return;
    let alive = true;
    listPublishedOffers()
      .then((offers) => {
        if (!alive) return;
        const mine = offers.find((item) => item.projectId === project.id);
        if (mine) {
          setOfferStatus(mine);
          setOfferLink({ id: mine.id, url: clientOfferUrl(mine.id) });
        }
      })
      .catch(() => { /* нет сервера — просто не показываем блок */ });
    listProjectDocuments(project.id)
      .then((list) => { if (alive) setDocuments(list); })
      .catch(() => { /* нет сервера — блок документов не показываем */ });
    return () => { alive = false; };
  }, [project.id, publicMode, onOfferChange]);

  /**
   * Любая выгрузка сразу кладётся на хостинг рядом с проектом: файл больше не теряется
   * в «Загрузках», и в карточке видно, что именно выдано клиенту и когда.
   */
  const keepDocument = async (kind: ProjectDocumentKind, name: string, blob: Blob) => {
    try {
      const saved = await saveProjectDocument({ projectId: project.id, kind, name, blob });
      setDocuments((current) => [...current.filter((item) => item.id !== saved.id), saved]);
    } catch {
      /* сервера нет — файл всё равно скачан пользователю */
    }
  };

  const changeDocumentStatus = async (id: string, status: ProjectDocumentStatus) => {
    try {
      const saved = await setProjectDocumentStatus(project.id, id, status);
      setDocuments((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    } catch (error) {
      toast.error(`Не получилось изменить статус: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const removeDocument = async (id: string) => {
    if (!confirm('Убрать документ из карточки проекта? Сам скачанный файл у вас останется.')) return;
    try {
      await deleteProjectDocument(project.id, id);
      setDocuments((current) => current.filter((item) => item.id !== id));
    } catch (error) {
      toast.error(`Не получилось удалить документ: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const publishOffer = async () => {
    setOfferBusy(true);
    try {
      const payload = await dehydrate({ project, moduleGroups: groups });
      const result = await publishClientOffer({
        id: offerLink?.id,
        projectId: project.id,
        title: project.name,
        client: project.client,
        total: offerTotal,
        payload,
      });
      setOfferLink({ id: result.id, url: result.url });
      setOfferStatus(result.offer);
      await navigator.clipboard.writeText(result.url).catch(() => { /* скопируют вручную */ });
      setOfferCopied(true);
      window.setTimeout(() => setOfferCopied(false), 2500);
    } catch (error) {
      toast.error(`Не получилось опубликовать КП: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setOfferBusy(false);
    }
  };

  const revokeOffer = async () => {
    if (!offerLink || !confirm('Отозвать ссылку? Клиент больше не сможет открыть это КП.')) return;
    setOfferBusy(true);
    try {
      await revokePublishedOffer(offerLink.id);
      setOfferLink(null);
      setOfferStatus(null);
    } catch (error) {
      toast.error(`Не получилось отозвать ссылку: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setOfferBusy(false);
    }
  };

  const exportClientPackage = () => runClientDownload(async () => {
    const sketches = await renderSketchFilesForPackage();
    await downloadClientDocumentZip(clientDocumentArgs, sketches);
    await keepDocument('package', `${project.name} — пакет клиента.zip`, await buildClientPackageZip(clientDocumentArgs, sketches));
  }, 'Не получилось собрать пакет клиента');

  return (
    <div className={`client-view${publicMode ? ' client-view-public' : ''}`}>
      <div className="client-offer-workbench">
        {!publicMode && (
        <aside className="client-offer-controls no-print">
      <section className="card client-document-hub no-print" aria-label="Документы для клиента">
        <div className="client-document-hub-main">
          <span className="eyebrow">КП для клиента</span>
          <h3>Один аккуратный пакет: эскиз, КП, спецификация, фирменный договор и товарный чек</h3>
          <p>Клиент видит только документы без себестоимости, закупочных цен и внутренних данных.{selectedVariant && <> Активен вариант: <b>{selectedVariant.name}</b>.</>} Договор заполняется из фирменного шаблона DOCX, товарный чек формируется в Word, всё выгружается из одного центра.</p>
          <div className="client-document-readiness" aria-label="Готовность клиентского КП">
            {offerReadinessItems.map((item) => <span key={item.label} className={item.ready ? 'ready' : 'warn'}><b>{item.label}</b><small>{item.value}</small></span>)}
          </div>
        </div>
        <div className="client-document-actions unified">
          <button type="button" className="btn primary" disabled={packageExporting} onClick={exportClientPackage}>{packageExporting ? 'Собираю…' : 'Пакет клиенту ZIP'}</button>
          <button type="button" className="btn ghost" onClick={() => window.print()}>Печать / PDF</button>
          <div className="dropdown">
            <button type="button" className="btn ghost">Отдельные файлы ▾</button>
            <div className="dropdown-menu">
              <button type="button" disabled={packageExporting || !clientSketchVisible} onClick={exportSketchPdf}>Эскиз PDF</button>
              <button type="button" disabled={packageExporting} onClick={() => runClientDownload(async () => { await downloadClientOfferDocx(clientDocumentArgs); await keepDocument('offer', `${project.name} — полное КП.docx`, await buildClientOfferDocx(clientDocumentArgs)); }, 'Не получилось выгрузить КП')}>КП Word</button>
              <button type="button" disabled={packageExporting} onClick={() => runClientDownload(async () => { await downloadClientSpecificationDocx(clientDocumentArgs); await keepDocument('specification', `${project.name} — спецификация.docx`, await buildClientSpecificationDocx(clientDocumentArgs)); }, 'Не получилось выгрузить спецификацию')}>Спецификация Word</button>
              <button type="button" disabled={packageExporting} onClick={() => runClientDownload(async () => { await downloadClientContractDocx(clientDocumentArgs); await keepDocument('contract', `${project.name} — договор.docx`, await buildClientContractDocx(clientDocumentArgs)); }, 'Не получилось выгрузить договор')}>Договор Word</button>
              <button type="button" disabled={packageExporting} onClick={() => runClientDownload(async () => { await downloadClientReceiptDocx(clientDocumentArgs); await keepDocument('receipt', `${project.name} — товарный чек.docx`, await buildClientReceiptDocx(clientDocumentArgs)); }, 'Не получилось выгрузить товарный чек')}>Товарный чек Word</button>
              <button type="button" onClick={() => exportClientXlsx({ ...project, lines: activeCalculation.lines, settings: selectedVariant?.settings ?? project.settings })}>Excel, если нужен</button>
            </div>
          </div>
        </div>
        {documents.length > 0 && (
          <div className="client-docs-store">
            <b>Документы проекта на хостинге</b>
            <p className="muted small">Каждая выгрузка сохраняется здесь: файл не потеряется в «Загрузках», а по статусу видно, что уже выдано клиенту.</p>
            <ul>
              {documents.map((doc) => (
                <li key={doc.id} className={`doc-status-${doc.status}`}>
                  <a href={serverFileUrl(doc.fileId)} target="_blank" rel="noreferrer" download={doc.name}>{doc.name}</a>
                  <small>{DOCUMENT_KIND_LABELS[doc.kind] ?? 'документ'} · {new Date(doc.createdAt).toLocaleString('ru-RU')} · {Math.max(1, Math.round(doc.size / 1024))} КБ</small>
                  <span className="doc-status-pill">{DOCUMENT_STATUS_LABELS[doc.status]}</span>
                  <span className="doc-status-actions">
                    {(['sent', 'signed', 'paid'] as ProjectDocumentStatus[]).map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={doc.status === status ? 'active' : ''}
                        onClick={() => void changeDocumentStatus(doc.id, doc.status === status ? 'created' : status)}
                      >
                        {DOCUMENT_STATUS_LABELS[status]}
                      </button>
                    ))}
                    <button type="button" className="danger" onClick={() => void removeDocument(doc.id)} aria-label="Убрать документ">✕</button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="client-offer-link">
          <div className="client-offer-link-main">
            <b>Ссылка клиенту</b>
            {offerLink
              ? <input readOnly value={offerLink.url} onFocus={(event) => event.target.select()} />
              : <span className="muted small">Опубликуйте КП — получится ссылка, которую можно отправить в мессенджер. Клиент увидит это же предложение и сможет нажать «Согласовать».</span>}
          </div>
          <div className="client-offer-link-actions">
            <button type="button" className="btn primary" disabled={offerBusy} onClick={() => void publishOffer()}>
              {offerBusy ? 'Публикую…' : offerCopied ? 'Ссылка скопирована ✓' : offerLink ? 'Обновить ссылку' : 'Опубликовать и скопировать'}
            </button>
            {offerLink && <>
              <a className="btn ghost" href={offerLink.url} target="_blank" rel="noreferrer">Посмотреть глазами клиента</a>
              <button type="button" className="btn ghost" disabled={offerBusy} onClick={() => void revokeOffer()}>Отозвать</button>
            </>}
          </div>
          {offerStatus && (
            <div className={`client-offer-link-status${offerStatus.approvedAt ? ' approved' : ''}`}>
              {offerStatus.approvedAt
                ? <><b>Клиент согласовал</b> · {offerStatus.approvedBy} · {new Date(offerStatus.approvedAt).toLocaleString('ru-RU')}{offerStatus.approveComment ? ` · «${offerStatus.approveComment}»` : ''}</>
                : offerStatus.views > 0
                  ? <>Клиент открывал {fmtNum(offerStatus.views, 0)} раз{offerStatus.lastViewAt ? `, последний — ${new Date(offerStatus.lastViewAt).toLocaleString('ru-RU')}` : ''}. Решения пока нет.</>
                  : <>Ссылку ещё не открывали.</>}
            </div>
          )}
        </div>
        <div className="client-document-includes" aria-label="Что входит в пакет — нажмите, чтобы включить или выключить">
          <button type="button" className={packageSettings.includeSketch && clientSketchVisible ? 'ready' : ''} onClick={() => updatePackageSettings({ includeSketch: !packageSettings.includeSketch })}>Эскиз</button>
          <button type="button" className={packageSettings.includeOffer ? 'ready' : ''} onClick={() => updatePackageSettings({ includeOffer: !packageSettings.includeOffer })}>КП</button>
          <button type="button" className={packageSettings.includeSpecification ? 'ready' : ''} onClick={() => updatePackageSettings({ includeSpecification: !packageSettings.includeSpecification })}>Спецификация</button>
          <button type="button" className={packageSettings.includeContract ? 'ready' : ''} onClick={() => updatePackageSettings({ includeContract: !packageSettings.includeContract })}>Договор</button>
          <button type="button" className={packageSettings.includeReceipt ? 'ready' : ''} onClick={() => updatePackageSettings({ includeReceipt: !packageSettings.includeReceipt })}>Товарный чек</button>
          <button
            type="button"
            className={sketchSummaryMode !== 'off' ? 'ready' : ''}
            title="Плашка «Сводка проекта» поверх эскиза: выключить · только на первом · на всех"
            onClick={() => updatePackageSettings({
              sketchSummaryMode: sketchSummaryMode === 'all' ? 'first' : sketchSummaryMode === 'first' ? 'off' : 'all',
              sketchSummaryOverlay: sketchSummaryMode === 'all' ? true : sketchSummaryMode !== 'first',
            })}
          >
            Сводка на эскизе{sketchSummaryMode === 'first' ? ': 1-й' : sketchSummaryMode === 'off' ? ': нет' : ''}
          </button>
        </div>
      </section>

      <section className="card client-offer-editor client-offer-drawer no-print">
        <div className="client-offer-editor-head">
          <div>
            <h3>Настройки КП</h3>
            <p className="muted small">Компактные блоки: откройте только то, что нужно сейчас.</p>
          </div>
          <span className="client-offer-mode-pill">{DETAIL_LEVEL_LABELS[detailLevel]}</span>
        </div>
        <div className="client-offer-quick-state">
          <span><b>{fmtMoney(offerTotal)}</b><small>итог КП{editsDelta !== 0 ? ' (с правками)' : ''}</small></span>
          <span><b>{fmtNum(moduleQty, 3)}</b><small>модулей</small></span>
          <span><b>{clientSketchVisible ? linkedEskizProjects.length : '—'}</b><small>эскизов</small></span>
        </div>
        <div className="client-control-stack">
          <details className="client-control-section" open>
            <summary><span>1. Вид, условия и детализация</span><small>{DETAIL_LEVEL_LABELS[detailLevel]} · {MODULE_DETAIL_MODE_LABELS[moduleDetailMode]}</small></summary>
            <div className="client-control-body client-control-grid">
              <label>Предложение действительно до<input type="date" value={project.clientOffer?.validUntil ?? ''} onChange={(event) => updateOffer({ validUntil: event.target.value || undefined })} /></label>
              <label>Условия оплаты<input value={project.clientOffer?.paymentTerms ?? ''} placeholder="например, 50% аванс" onChange={(event) => updateOffer({ paymentTerms: event.target.value })} /></label>
              <label>Монтаж<input value={project.clientOffer?.installation ?? ''} placeholder="например, включён" onChange={(event) => updateOffer({ installation: event.target.value })} /></label>
              <label>Доставка<input value={project.clientOffer?.delivery ?? ''} placeholder="например, по адресу клиента" onChange={(event) => updateOffer({ delivery: event.target.value })} /></label>
              <div className="span-2 client-detail-levels">
                <b>Уровень детализации КП</b>
                <div className="client-detail-level-list" role="radiogroup" aria-label="Уровень детализации КП">
                  {DETAIL_LEVELS.map((level) => (
                    <button
                      type="button"
                      key={level.value}
                      role="radio"
                      aria-checked={detailLevel === level.value}
                      className={detailLevel === level.value ? 'active' : ''}
                      onClick={() => updateOffer({ detailLevel: level.value, ...DETAIL_LEVEL_PRESETS[level.value] })}
                    >
                      <span>{level.title}</span>
                      <small>{level.hint}</small>
                    </button>
                  ))}
                </div>
              </div>
              <label className="client-detail-price-toggle"><input type="checkbox" checked={showDetailPrices} onChange={(event) => updateOffer({ showDetailPrices: event.target.checked })} /> Показывать суммы в детализации</label>
              <label className="client-detail-price-toggle"><input type="checkbox" checked={aggregateHardware} onChange={(event) => updateOffer({ aggregateHardware: event.target.checked })} /> Фурнитуру общими строками по проекту</label>
              <div className="span-2 client-offer-edits-state">
                <span>{editsCount > 0 ? `Ручных правок в КП: ${editsCount}${editsDelta !== 0 ? ` · итог сдвинут на ${fmtMoney(editsDelta)}` : ''}` : 'Количество и суммы можно править прямо в КП: нажмите на число.'}</span>
                {editsCount > 0 && <button type="button" className="btn tiny ghost" onClick={resetOfferEdits}>Вернуть расчётные значения</button>}
              </div>
              <label className="span-2">Примечания для клиента<textarea rows={2} value={project.clientOffer?.notes ?? ''} onChange={(event) => updateOffer({ notes: event.target.value })} /></label>
            </div>
          </details>

          <details className="client-control-section">
            <summary><span>2. Состав ZIP и документов</span><small>{packageSettings.includeOffer ? 'КП' : ''}{packageSettings.includeSpecification ? ' · спецификация' : ''}{packageSettings.includeSketch ? ' · эскиз' : ''}{packageSettings.includeContract ? ' · договор' : ''}{packageSettings.includeReceipt ? ' · чек' : ''}</small></summary>
            <div className="client-control-body">
              <div className="client-package-options compact">
                <label><input type="checkbox" checked={packageSettings.includeOffer} onChange={(event) => updatePackageSettings({ includeOffer: event.target.checked })} /> КП/сводка</label>
                <label><input type="checkbox" checked={packageSettings.includeSketch} onChange={(event) => updatePackageSettings({ includeSketch: event.target.checked })} /> Эскиз</label>
                <label><input type="checkbox" checked={packageSettings.includeSpecification} onChange={(event) => updatePackageSettings({ includeSpecification: event.target.checked })} /> Спецификация Word</label>
                <label><input type="checkbox" checked={packageSettings.includeContract} onChange={(event) => updatePackageSettings({ includeContract: event.target.checked })} /> Договор</label>
                <label><input type="checkbox" checked={packageSettings.includeReceipt} onChange={(event) => updatePackageSettings({ includeReceipt: event.target.checked })} /> Товарный чек</label>
                <label className="client-package-select">Сводка поверх эскиза
                  <select
                    value={sketchSummaryMode}
                    onChange={(event) => {
                      const mode = event.target.value as 'off' | 'first' | 'all';
                      updatePackageSettings({ sketchSummaryMode: mode, sketchSummaryOverlay: mode !== 'off' });
                    }}
                  >
                    <option value="off">не показывать</option>
                    <option value="first">только на первом эскизе</option>
                    <option value="all">на всех эскизах</option>
                  </select>
                </label>
                <label><input type="checkbox" checked={packageSettings.compact} onChange={(event) => updatePackageSettings({ compact: event.target.checked })} /> Компактно</label>
              </div>
              <p className="muted small">Товарный чек выгружается построчно: {fmtNum(receiptRows.length, 3)} позиций — какие корпуса по модулям, фасады, фурнитура и работы. Мелкие позиции схлопываются, чтобы чек оставался на 1–2 страницах.</p>
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
              <label className="span-2">Реквизиты исполнителя<textarea rows={2} value={project.clientOffer?.sellerDetails ?? ''} placeholder="ИНН, адрес, телефон — появятся в договоре и товарном чеке" onChange={(event) => updateOffer({ sellerDetails: event.target.value })} /></label>
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
        )}
        <main className="client-offer-preview">

      <div className={`client-doc client-doc-${presentationMode}`} id="client-doc">
        <header className="cd-hero">
          <div className="cd-hero-main">
            <div className="cd-brand">РЕцепт</div>
            <div className="cd-sub">мебельное ателье · индивидуальная кухня</div>
            <h2>Коммерческое предложение</h2>
            <h1>{onProjectMetaChange
              ? <EditableText value={project.name} label="Название проекта" placeholder="Название проекта" onChange={(value) => onProjectMetaChange({ name: value })} />
              : project.name}</h1>
            <div className="cd-hero-meta">
              <span>Заказчик: <b>{onProjectMetaChange
                ? <EditableText value={project.client} label="Заказчик" placeholder="имя заказчика" onChange={(value) => onProjectMetaChange({ client: value })} />
                : project.client}</b></span>
              <span>Дата: {onProjectMetaChange
                ? <EditableDate value={project.date} label="Дата КП" onChange={(value) => onProjectMetaChange({ date: value })} />
                : fmtDateLong(project.date)}</span>
              {selectedVariant && <span>Вариант: <b>{selectedVariant.name}</b></span>}
            </div>
            <div className="cd-hero-tags"><span>{MODE_LABELS[presentationMode]}</span><span>Детализация: {DETAIL_LEVEL_LABELS[detailLevel]}</span>{clientSketchVisible && <span>Эскиз PRO включён</span>}{groups.length > 0 && <span>{fmtNum(moduleQty, 3)} модулей</span>}</div>
          </div>
          <div className="cd-hero-price">
            <span>Итоговая стоимость</span>
            <b>{fmtMoney(offerTotal)}</b>
            <em>без внутренних закупочных цен</em>
          </div>
        </header>

        {(editableTerms.length > 0 || offerTerms.length > 0) && (
          <div className="cd-terms">
            {canEditInline
              ? editableTerms.map((term) => <div key={term.label} className={term.value ? '' : 'cd-term-empty no-print'}>
                  <b>{term.label}</b>
                  {term.field === 'validUntil'
                    ? <EditableDate value={project.clientOffer?.validUntil ?? ''} label="Предложение действительно до" onChange={(value) => updateOffer({ validUntil: value || undefined })} />
                    : <EditableText value={term.value} label={term.label} placeholder={term.placeholder} onChange={(value) => updateOffer({ [term.field]: value } as Partial<ClientOfferSettings>)} />}
                </div>)
              : offerTerms.map((term) => <div key={term.label}><b>{term.label}</b><span>{term.value}</span></div>)}
          </div>
        )}

        <section className="cd-summary cd-summary-modern">
          <div className="cd-summary-copy">
            <h3>Кратко по проекту</h3>
            <p>{canEditInline
              ? <EditableText as="span" multiline value={project.clientOffer?.summaryNote ?? DEFAULT_SUMMARY_NOTE} label="Описание в КП" onChange={(value) => updateOffer({ summaryNote: value || undefined })} />
              : (project.clientOffer?.summaryNote ?? DEFAULT_SUMMARY_NOTE)}</p>
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

        {rollupRows.length > 0 && (
          <section className="cd-rollup">
            <div className="cd-section-head">
              <h3>Сводная ведомость</h3>
              <span>сколько и какие — по типам{canEditInline ? '; количество и суммы правятся прямо здесь' : ''}</span>
            </div>
            <div className="cd-rollup-table" role="table" aria-label="Сводная ведомость по типам">
              <div className="cd-rollup-head" role="row"><span>Раздел / позиция</span><span>Количество</span><span>Сумма</span></div>
              {groups.length > 0 && (
                <div className="cd-rollup-row cd-rollup-total" role="row">
                  <b>Модули кухни</b>
                  <span>{fmtNum(moduleQty, 3)} шт</span>
                  <strong>{fmtMoney(projectSummary.bodyTotal + projectSummary.facadeTotal)}</strong>
                </div>
              )}
              {rollupRows.map((row) => (
                <div className="cd-rollup-group" key={row.kind}>
                  <div className="cd-rollup-row cd-rollup-total" role="row">
                    <b>{row.label}</b>
                    <span>{row.qtyText}</span>
                    <strong>{row.sum != null ? fmtMoney(row.sum) : '—'}</strong>
                  </div>
                  {showRollupItems && row.items.map((detail) => (
                    <div className={`cd-rollup-row cd-rollup-item${detail.qtyEdited || detail.sumEdited ? ' edited' : ''}`} role="row" key={detail.id}>
                      <span className="cd-rollup-name">{canEditInline && detail.itemId
                        ? <EditableText value={detail.name} label="Название позиции в КП" onChange={(value) => renameDetail(detail.itemId, value)} />
                        : detail.name}</span>
                      <span className="cd-rollup-qty">
                        {canEditInline
                          ? <EditableNumber
                              value={detail.qty}
                              edited={detail.qtyEdited}
                              baseHint={`${fmtNum(detail.baseQty ?? detail.qty, 3)} ${detailPieceUnit(detail)}`}
                              label={`Количество: ${detail.name}`}
                              format={(value) => `${fmtNum(value ?? 0, 3)} ${detailPieceUnit(detail)}`}
                              onChange={(value) => setDetailQty(detail, value)}
                            />
                          : detailQtyText(detail)}
                        {detailMeasuredText(detail) && <em className="cd-measured">{detailMeasuredText(detail)}</em>}
                      </span>
                      <span className="cd-rollup-sum">
                        {canEditInline && showDetailPrices
                          ? <EditableNumber
                              value={detail.clientSum}
                              edited={detail.sumEdited}
                              baseHint={detail.baseClientSum != null ? fmtMoney(detail.baseClientSum) : '—'}
                              label={`Сумма: ${detail.name}`}
                              format={(value) => (value == null ? '—' : fmtMoney(value))}
                              onChange={(value) => setDetailSum(detail, value)}
                            />
                          : detail.clientSum != null ? fmtMoney(detail.clientSum) : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
              <div className="cd-rollup-row cd-rollup-grand" role="row">
                <b>Итого по проекту</b>
                <span>{groups.length > 0 ? `${fmtNum(moduleQty, 3)} модулей` : ''}</span>
                <strong>{fmtMoney(offerTotal)}</strong>
              </div>
            </div>
            {editsDelta !== 0 && <div className="cd-rollup-note no-print">Итог учитывает ручные правки в КП: {fmtMoney(editsDelta)} к расчёту {fmtMoney(totals.client)}.</div>}
          </section>
        )}

        {showCompositionSections && compositionSections.length > 0 && (
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
            {linkedEskizProjects.map((eskiz, index) => <div key={eskiz.id} className="cd-sketch-wrap">
              <EskizProjectPreview project={eskiz} compact={!isTechnical} moduleMarkerMode={project.eskizPro?.moduleMarkerMode ?? 'full'} communicationMarkers={(project.eskizPro?.communications ?? []).filter((marker) => marker.showInClient !== false)} showCommunicationSizeBadges={showCommunicationSizeBadges} viewSettings={eskizViewSettings} />
              {(sketchSummaryMode === 'all' || (sketchSummaryMode === 'first' && index === 0)) && sketchSummaryLines.length > 0
                && <div className="cd-sketch-summary"><b>Сводка проекта</b>{sketchSummaryLines.slice(0, isTechnical ? 6 : 4).map((line) => <span key={line}>{line}</span>)}</div>}
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

        {showModuleList && groups.length > 0 && (
          <section className="cd-modules">
            <div className="cd-section-head">
              <h3>Состав мебели</h3>
              <span>{moduleDetailMode === 'full' ? MODULE_DETAIL_MODE_LABELS[moduleDetailMode] : 'компактная ведомость модулей, без растягивания КП'}</span>
            </div>
            {moduleDetailMode !== 'full' ? (
              <>
                <div className="cd-module-table" role="table" aria-label="Компактная ведомость модулей">
                  <div className="cd-module-table-head" role="row"><span>№</span><span>Модуль</span><span>{moduleDetailMode === 'compact' ? 'Основной состав' : 'Сводка'}</span><span>Сумма</span></div>
                  {groups.map((group, index) => {
                    const ids = groupLineIds(group);
                    const idSet = new Set(ids);
                    const lines = activeCalculation.lines.filter((line) => idSet.has(line.id));
                    const details = buildClientOfferDetails(lines, lineCalcs, resolveClientName);
                    const visibleDetails = extractHardwareFromModules ? details.filter((detail) => !isAggregatedHardware(detail)) : details;
                    const extractedCount = details.length - visibleDetails.length;
                    const total = groupSum(group);
                    const compactSummary = moduleDetailMode === 'compact' ? moduleCompactSummary(visibleDetails) : [];
                    return (
                      <div className="cd-module-table-row" role="row" key={group.id}>
                        <span className="cd-module-table-num">{index + 1}</span>
                        <div className="cd-module-table-title"><b>{group.title}</b><small>{[group.sub, `${fmtNum(group.qty, 3)} шт`].filter(Boolean).join(' · ') || `${fmtNum(group.qty, 3)} шт`}</small></div>
                        <div className="cd-module-table-materials">
                          {compactSummary.length > 0
                            ? compactSummary.map((item) => <span key={item}>{item}</span>)
                            : <span>{moduleDetailMode === 'summary' ? 'без повторения деталей; состав сгруппирован ниже' : 'состав в общей смете ниже'}</span>}
                          {extractHardwareFromModules && extractedCount > 0 && <em>фурнитура вынесена в общую строку</em>}
                        </div>
                        <strong>{total != null ? fmtMoney(total) : '—'}</strong>
                      </div>
                    );
                  })}
                </div>
                <div className="cd-compact-explain">Подробная комплектация не повторяется внутри каждого модуля: корпуса, фасады, фурнитура, столешницы и дополнительные позиции сведены по категориям ниже. Полную техдетализацию можно включить режимом «Техническое приложение».</div>
              </>
            ) : groups.map((group, index) => {
              const ids = groupLineIds(group);
              const idSet = new Set(ids);
              const lines = activeCalculation.lines.filter((line) => idSet.has(line.id));
              const details = buildClientOfferDetails(lines, lineCalcs, resolveClientName);
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
                    <div className="cd-component-list">
                      {details.map((detail) => <DetailRow key={detail.id} detail={detail} showPrice={showDetailPrices} technical onRename={canEditInline ? renameDetail : undefined} />)}
                    </div>
                  ) : (
                    <div className="cd-module-empty">Нет рассчитанных строк по модулю — проверьте комплектацию.</div>
                  )}
                </article>
              );
            })}
          </section>
        )}

        {showProjectHardware && projectHardwareDetails.length > 0 && (
          <section className="cd-project-hardware">
            <div className="cd-section-head"><h3>Фурнитура по проекту</h3><span>общими строками, без повторения в каждом модуле</span></div>
            <div className="cd-component-list cd-component-list-extra cd-hardware-list">
              {projectHardwareDetails.map((detail) => <DetailRow key={detail.id} detail={{ ...detail, details: detail.details.map((note) => stripModuleNote(note)) }} showPrice={showDetailPrices} technical={isTechnical} onRename={canEditInline ? renameDetail : undefined} onQty={canEditInline ? setDetailQty : undefined} onSum={canEditInline ? setDetailSum : undefined} />)}
            </div>
          </section>
        )}

        {showExtraDetails && visibleExtraDetails.length > 0 && (
          <section className="cd-extra">
            <div className="cd-section-head"><h3>Дополнительно</h3><span>столешницы, цоколь, мойки, работы и прочие позиции</span></div>
            <div className="cd-component-list cd-component-list-extra">
              {visibleExtraDetails.map((detail) => <DetailRow key={detail.id} detail={{ ...detail, details: detail.details.map((note) => stripModuleNote(note)) }} showPrice={showDetailPrices && !isBrief} technical={isTechnical} onRename={canEditInline ? renameDetail : undefined} onQty={canEditInline ? setDetailQty : undefined} onSum={canEditInline ? setDetailSum : undefined} />)}
            </div>
          </section>
        )}

        <div className="cd-total">Итоговая стоимость: <b>{fmtMoney(offerTotal)}</b></div>
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
