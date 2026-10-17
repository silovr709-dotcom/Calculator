import type { EskizCommunicationMarker, KitchenModule, ModuleDefaults, PriceItem, Pricebook, Project, SlotKey } from '../types';
import type { BlankIssue } from './factoryBlank';
import type { EskizModuleObject, EskizProject } from './eskizPro';
import { COMMUNICATION_ANCHOR_LABELS, COMMUNICATION_KIND_META, communicationDistanceText, communicationSizeText } from './eskizCommunications';
import { checkModule, resolveSlot } from './modules';
import type { FactoryTechCommunicationRow, FactoryTechModuleRow, FactoryTechReadinessRow } from './factoryBlankXls';

const SLOT_ORDER: SlotKey[] = ['body', 'facade', 'hinge', 'drawerSys', 'lift', 'handle', 'legs'];

function itemLabel(item: PriceItem | null): string {
  if (!item) return '—';
  const article = item.article ? `${item.article} · ` : '';
  return `${article}${item.name}`;
}

function moduleSize(module: KitchenModule): string {
  const w = module.widthMm ? `${module.widthMm}` : '—';
  const h = module.heightMm ? `${module.heightMm}` : '—';
  const d = module.depthMm ? `${module.depthMm}` : '—';
  return `${w}×${h}×${d} мм`;
}

function facadeSummary(module: KitchenModule): string {
  const parts: string[] = [];
  if (module.facadeParts?.length) {
    parts.push(...module.facadeParts.map((part, index) => `${index + 1}) ${part.kind === 'drawer' ? 'ящик' : part.kind === 'panel' ? 'панель' : 'дверь'} ${part.widthMm}×${part.heightMm}`));
  } else if (module.facades > 0) {
    parts.push(`${module.facades} шт. ${module.facadeWmm ?? '—'}×${module.facadeHmm ?? '—'} мм`);
  } else {
    parts.push('фасадов нет');
  }
  if (module.extraFacadeParts?.length) {
    parts.push(...module.extraFacadeParts.map((part) => `${part.label?.trim() || 'доп. фасад'}: ${part.qty}× ${part.widthMm}×${part.heightMm}`));
  }
  return parts.join('\n');
}

function hardwareSummary(module: KitchenModule, defaults: ModuleDefaults, pricebook: Pricebook): string {
  const get = (key: SlotKey) => itemLabel(resolveSlot(module, key, defaults, pricebook).item);
  const parts = [
    module.hinges > 0 ? `Петли ${module.hinges} шт.: ${get('hinge')}` : null,
    module.drawers > 0 ? `Ящики ${module.drawers} шт.: ${get('drawerSys')}` : null,
    module.lifts > 0 ? `Подъёмники ${module.lifts} шт.: ${get('lift')}` : null,
    module.handles > 0 ? `Ручки ${module.handles} шт.: ${get('handle')}` : null,
    (module.legs ?? 0) > 0 ? `Опоры ${(module.legs ?? 0)} шт.: ${get('legs')}` : null,
  ].filter((value): value is string => Boolean(value));
  return parts.length ? parts.join('\n') : '—';
}

function materialSummary(module: KitchenModule, defaults: ModuleDefaults, pricebook: Pricebook): { body: string; facade: string } {
  return {
    body: itemLabel(resolveSlot(module, 'body', defaults, pricebook).item),
    facade: itemLabel(resolveSlot(module, 'facade', defaults, pricebook).item),
  };
}

function markerObjects(eskizProject: EskizProject | null): EskizModuleObject[] {
  return eskizProject?.objects.filter((object): object is EskizModuleObject => object.type === 'module' && !object.hidden) ?? [];
}

function moduleRow(args: {
  marker: string;
  markerText: string;
  status: string;
  module: KitchenModule | null;
  pricebook: Pricebook;
  defaults: ModuleDefaults;
  note?: string;
}): FactoryTechModuleRow {
  const { marker, markerText, status, module, pricebook, defaults, note } = args;
  if (!module) {
    return {
      marker,
      status,
      module: '—',
      type: '—',
      size: '—',
      qty: '—',
      body: '—',
      facadeMaterial: '—',
      facadeDetails: '—',
      hardware: '—',
      note: note || markerText,
    };
  }
  const materials = materialSummary(module, defaults, pricebook);
  return {
    marker,
    status,
    module: module.name,
    type: module.type,
    size: moduleSize(module),
    qty: `${module.qty}`,
    body: materials.body,
    facadeMaterial: materials.facade,
    facadeDetails: facadeSummary(module),
    hardware: hardwareSummary(module, defaults, pricebook),
    note: [markerText, module.note, note].filter(Boolean).join('\n'),
  };
}

export function buildFactoryTechModuleRows(project: Project, pricebook: Pricebook, eskizProject: EskizProject | null): FactoryTechModuleRow[] {
  const modules = project.modules ?? [];
  const bindings = project.eskizPro?.moduleBindings ?? {};
  const defaults = project.moduleDefaults ?? {};
  const boundModuleIds = new Set<string>();
  const rows = markerObjects(eskizProject).map((marker) => {
    const key = `${eskizProject?.id}:${marker.id}`;
    const boundId = bindings[key];
    const module = boundId ? modules.find((item) => item.id === boundId) ?? null : null;
    if (boundId) boundModuleIds.add(boundId);
    return moduleRow({
      marker: marker.number.trim() || 'Маркер',
      markerText: marker.description.trim(),
      status: module ? 'связан с расчётом' : 'маркер без модуля',
      module,
      pricebook,
      defaults,
      note: module ? undefined : 'Проверьте: маркер есть на эскизе, но не связан с позицией расчёта.',
    });
  });

  for (const module of modules) {
    if (boundModuleIds.has(module.id)) continue;
    rows.push(moduleRow({
      marker: '—',
      markerText: '',
      status: 'модуль без маркера',
      module,
      pricebook,
      defaults,
      note: 'Позиция есть в расчёте, но не отмечена на выбранном эскизе.',
    }));
  }
  return rows;
}

export function buildFactoryTechCommunicationRows(project: Project, eskizProject: EskizProject | null, showCommunicationSizeBadges = project.eskizPro?.showCommunicationSizeBadges !== false): FactoryTechCommunicationRow[] {
  const eskizId = eskizProject?.id;
  const communications = (project.eskizPro?.communications ?? []).filter((marker) => !eskizId || marker.eskizId === eskizId);
  const effectiveShowCommunicationSizeBadges = showCommunicationSizeBadges && project.eskizPro?.showCommunicationSizeBadges !== false;
  return communications.map((marker) => {
    const meta = COMMUNICATION_KIND_META[marker.kind] ?? COMMUNICATION_KIND_META.other;
    const distances = (marker.distances ?? []).map((distance) => `${distance.label || COMMUNICATION_ANCHOR_LABELS[distance.anchor]}: ${communicationDistanceText(distance.valueMm)}`);
    const showSize = effectiveShowCommunicationSizeBadges && marker.showSizeBadge !== false;
    return {
      kind: meta.label,
      name: marker.name || meta.defaultName,
      size: showSize ? (communicationSizeText(marker) || '—') : 'скрыто на эскизе',
      location: `x=${Math.round(marker.x)}, y=${Math.round(marker.y)}`,
      distances: distances.length ? distances.join('\n') : '—',
      note: marker.note ?? '',
    };
  });
}

function communicationIssues(markers: EskizCommunicationMarker[]): FactoryTechReadinessRow[] {
  return markers.flatMap((marker) => {
    const rows: FactoryTechReadinessRow[] = [];
    if ((marker.distances ?? []).length === 0) rows.push({ level: 'warn', area: 'Коммуникации', text: `${marker.name || COMMUNICATION_KIND_META[marker.kind].label}: нет привязочных расстояний` });
    if (!marker.widthMm && !marker.heightMm && !marker.diameterMm) rows.push({ level: 'warn', area: 'Коммуникации', text: `${marker.name || COMMUNICATION_KIND_META[marker.kind].label}: не указан размер/диаметр` });
    return rows;
  });
}

export function buildFactoryTechReadinessRows(args: {
  project: Project;
  pricebook: Pricebook;
  eskizProject: EskizProject | null;
  blankIssues: BlankIssue[];
  includeCommunications?: boolean;
}): FactoryTechReadinessRow[] {
  const { project, pricebook, eskizProject, blankIssues, includeCommunications = true } = args;
  const rows: FactoryTechReadinessRow[] = blankIssues.map((issue) => ({
    level: issue.level,
    area: issue.label,
    text: issue.text,
  }));
  const markers = markerObjects(eskizProject);
  const modules = project.modules ?? [];
  const bindings = project.eskizPro?.moduleBindings ?? {};
  const boundModuleIds = new Set<string>();

  if (!eskizProject) rows.push({ level: 'warn', area: 'Эскиз PRO', text: 'К бланку не выбран snapshot Эскиз PRO' });
  for (const marker of markers) {
    const boundId = bindings[`${eskizProject?.id}:${marker.id}`];
    const module = boundId ? modules.find((item) => item.id === boundId) : null;
    if (boundId) boundModuleIds.add(boundId);
    if (!module) rows.push({ level: 'error', area: 'Эскиз PRO', text: `Маркер ${marker.number || marker.id} не связан с модулем расчёта` });
  }
  for (const module of modules) {
    const check = checkModule(module, project.moduleDefaults ?? {}, pricebook);
    for (const error of check.errors) rows.push({ level: 'error', area: module.name, text: error });
    for (const warning of check.warnings) rows.push({ level: 'warn', area: module.name, text: warning });
    if (!boundModuleIds.has(module.id) && markers.length > 0) rows.push({ level: 'warn', area: module.name, text: 'Модуль есть в расчёте, но не отмечен на выбранном эскизе' });
  }
  if (includeCommunications) rows.push(...communicationIssues((project.eskizPro?.communications ?? []).filter((marker) => !eskizProject || marker.eskizId === eskizProject.id)));
  if (rows.length === 0) rows.push({ level: 'ok', area: 'Готовность', text: 'Критичных проблем и предупреждений не найдено' });
  return rows;
}

export function factoryTechReadinessSummary(rows: FactoryTechReadinessRow[]) {
  return {
    errors: rows.filter((row) => row.level === 'error').length,
    warnings: rows.filter((row) => row.level === 'warn').length,
    ok: rows.filter((row) => row.level === 'ok').length,
  };
}

export function selectedSlotSummary(module: KitchenModule, defaults: ModuleDefaults, pricebook: Pricebook): string {
  return SLOT_ORDER
    .map((slot) => `${slot}: ${itemLabel(resolveSlot(module, slot, defaults, pricebook).item)}`)
    .join('\n');
}
