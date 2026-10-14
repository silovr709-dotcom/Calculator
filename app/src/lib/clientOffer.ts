import type { LineCalc, PriceBasis, ProjectLine } from '../types';
import { fmtMoney, fmtNum } from './format';

export type ClientOfferDetailKind =
  | 'body'
  | 'bodySurcharge'
  | 'facade'
  | 'frame'
  | 'hinge'
  | 'drawerSys'
  | 'lift'
  | 'handle'
  | 'shelf'
  | 'legs'
  | 'worktop'
  | 'wallPanel'
  | 'sink'
  | 'electric'
  | 'other';

export interface ClientOfferDetail {
  id: string;
  kind: ClientOfferDetailKind;
  kindLabel: string;
  name: string;
  /** id позиции прайса — по нему хранится ручное переименование в КП. */
  itemId: string;
  lineIds: string[];
  /** Количество деталей/комплектов до пересчёта в м²/п.м. */
  qty: number;
  /** Расчётное количество для цены: м², п.м., листы или шт. */
  qtyEffective: number;
  unit: string;
  priceBasis: PriceBasis;
  details: string[];
  clientSum: number | null;
  hasUnpriced: boolean;
  sort: number;
  /** Количество из расчёта, до ручной правки менеджера в КП. */
  baseQty?: number;
  /** Сумма из расчёта, до ручной правки менеджера в КП. */
  baseClientSum?: number | null;
  /** true — количество в КП поправлено вручную. */
  qtyEdited?: boolean;
  /** true — сумма в КП поправлена вручную. */
  sumEdited?: boolean;
}

/** Ручные правки КП: количество и суммы по ключу позиции. */
export interface ClientOfferEdits {
  qty?: Record<string, number>;
  sums?: Record<string, number>;
}

/** Строка сводной ведомости: «Петли — 24 шт — Blum 110° с доводчиком …». */
export interface ClientOfferRollupRow {
  kind: ClientOfferDetailKind;
  label: string;
  qtyText: string;
  sum: number | null;
  items: ClientOfferDetail[];
}

export interface ClientProjectSummary {
  moduleCount: number;
  facadeQty: number;
  facadeAreaM2: number;
  hingeQty: number;
  hingeTypes: { name: string; qty: number }[];
  bodyTotal: number;
  facadeTotal: number;
  hardwareTotal: number;
}

interface ClientKindMeta {
  kind: ClientOfferDetailKind;
  label: string;
  sort: number;
}

const KIND_ORDER: Record<ClientOfferDetailKind, number> = {
  body: 10,
  bodySurcharge: 15,
  facade: 20,
  frame: 25,
  hinge: 30,
  drawerSys: 35,
  lift: 40,
  handle: 45,
  shelf: 50,
  legs: 55,
  worktop: 60,
  wallPanel: 65,
  sink: 70,
  electric: 75,
  other: 100,
};

const KIND_LABELS: Record<ClientOfferDetailKind, string> = {
  body: 'Корпус',
  bodySurcharge: 'Надбавка корпуса',
  facade: 'Фасады',
  frame: 'Рамка фасада',
  hinge: 'Петли',
  drawerSys: 'Система ящиков',
  lift: 'Подъёмники',
  handle: 'Ручки',
  shelf: 'Полки',
  legs: 'Опоры',
  worktop: 'Столешница',
  wallPanel: 'Стеновая панель',
  sink: 'Мойка / смеситель',
  electric: 'Электрика',
  other: 'Комплектация',
};

/** Единый служебный префикс для строк, созданных из кухонного модуля. */
export function moduleLinePrefix(moduleName: string, moduleId?: string): string {
  return moduleId ? `Модуль: ${moduleName} [${moduleId}]` : `Модуль: ${moduleName}`;
}

/** Совместимая проверка: новые строки содержат id модуля, старые — только название. */
export function moduleNoteMatches(note: string | undefined, moduleName: string, moduleId?: string): boolean {
  if (!note) return false;
  if (moduleId) {
    const prefix = moduleLinePrefix(moduleName, moduleId);
    if (note === prefix || note.startsWith(`${prefix} — `)) return true;
  }
  const legacyPrefix = moduleLinePrefix(moduleName);
  return note === legacyPrefix || note.startsWith(`${legacyPrefix} — `);
}

export function isModuleLine(line: Pick<ProjectLine, 'note'>): boolean {
  return line.note?.startsWith('Модуль:') ?? false;
}

/** Убирает служебный префикс «Модуль: …» из примечания; tag-only строки не показываются клиенту. */
export function stripModuleNote(note: string | undefined): string {
  if (!note) return '';
  if (!note.startsWith('Модуль:')) return note.trim();

  const withId = note.match(/^Модуль:\s*.*?\s+\[[^\]]+\]\s+—\s*(.*)$/u);
  if (withId) return withId[1].trim();

  const withoutId = note.match(/^Модуль:\s*.*?\s+—\s*(.*)$/u);
  if (withoutId) return withoutId[1].trim();

  return '';
}

function classifyClientLine(line: ProjectLine): ClientKindMeta {
  const category = line.category.toLocaleLowerCase('ru-RU');
  const group = line.group.toLocaleLowerCase('ru-RU');
  const name = line.name.toLocaleLowerCase('ru-RU');
  const note = stripModuleNote(line.note).toLocaleLowerCase('ru-RU');

  let kind: ClientOfferDetailKind = 'other';
  if (line.priceKind === 'percent' || line.priceBasis === 'percent_of_base') kind = 'bodySurcharge';
  else if (note.includes('опор')) kind = 'legs';
  else if (note.includes('полк')) kind = 'shelf';
  else if (category.startsWith('корпуса')) kind = 'body';
  else if (name.startsWith('алюм. рамка') || name.includes('алюминиевая рамка')) kind = 'frame';
  else if (category.startsWith('фасады')) kind = 'facade';
  else if (category.includes('петл') || name.includes('петл')) kind = 'hinge';
  else if (category.includes('системы выдвижения') || name.includes('тпо') || name.includes('тчо') || name.includes('нпв')) kind = 'drawerSys';
  else if (category.includes('подъём') || category.includes('подъем') || name.includes('aventos')) kind = 'lift';
  else if (category.includes('ручки') || group === 'ручки') kind = 'handle';
  else if (category.includes('опоры')) kind = 'legs';
  else if (category.includes('доп. комплектация каркасов')) kind = 'shelf';
  else if (category.startsWith('столешницы')) kind = 'worktop';
  else if (category.includes('стенов') && category.includes('панел')) kind = 'wallPanel';
  else if (category.includes('мойки') || category.includes('смесител')) kind = 'sink';
  else if (category.includes('электрика') || category.includes('свет')) kind = 'electric';
  else if (group === 'фурнитура') kind = 'other';

  return { kind, label: KIND_LABELS[kind], sort: KIND_ORDER[kind] };
}

function unitForClient(line: ProjectLine): string {
  if (line.priceBasis === 'm2') return line.unit || 'м²';
  if (line.priceBasis === 'lm') return line.unit || 'п.м';
  if (line.priceBasis === 'sheet') return line.unit || 'лист';
  return line.unit || 'шт';
}

function detailNoteForLine(line: ProjectLine): string {
  const note = stripModuleNote(line.note);
  if (note) return note;
  if (line.params.widthMm && line.params.heightMm) return `${line.params.widthMm}×${line.params.heightMm} мм`;
  if (line.params.lengthMm != null) return `L=${line.params.lengthMm} мм`;
  if (line.params.areaM2 != null) return `${line.params.areaM2} м²`;
  return '';
}

function dedupePush(list: string[], value: string): void {
  const normalized = value.trim();
  if (normalized && !list.includes(normalized)) list.push(normalized);
}

/**
 * Компактная детализация КП: одинаковые позиции внутри модуля схлопываются в одну строку
 * («Фасады — материал — 3 шт / 1,24 м²», «Петли — модель — 6 шт»), а размеры остаются в подстроке.
 */
export function buildClientOfferDetails(
  lines: ProjectLine[],
  lineCalcs: Map<string, LineCalc>,
  /** Имя позиции для клиента: понятное название материала или ручная правка из КП. */
  resolveName?: (line: ProjectLine) => string,
): ClientOfferDetail[] {
  const acc = new Map<string, ClientOfferDetail & { priced: boolean }>();

  for (const line of lines) {
    const meta = classifyClientLine(line);
    const unit = unitForClient(line);
    const displayName = resolveName?.(line) || line.name;
    const key = [meta.kind, line.itemId, displayName, unit, line.priceBasis ?? ''].join('|');
    const calc = lineCalcs.get(line.id);
    const qtyEffective = calc?.qtyEffective ?? line.qty;
    const clientSum = calc?.clientSum ?? null;
    let row = acc.get(key);
    if (!row) {
      row = {
        id: key,
        kind: meta.kind,
        kindLabel: meta.label,
        name: displayName,
        itemId: line.itemId,
        lineIds: [],
        qty: 0,
        qtyEffective: 0,
        unit,
        priceBasis: line.priceBasis,
        details: [],
        clientSum: 0,
        hasUnpriced: false,
        sort: meta.sort,
        priced: false,
      };
      acc.set(key, row);
    }

    row.lineIds.push(line.id);
    row.qty += line.qty;
    row.qtyEffective += qtyEffective;
    if (clientSum == null) row.hasUnpriced = true;
    else {
      row.clientSum = (row.clientSum ?? 0) + clientSum;
      row.priced = true;
    }
    dedupePush(row.details, detailNoteForLine(line));
  }

  return Array.from(acc.values())
    .map(({ priced, ...row }) => ({ ...row, clientSum: priced ? row.clientSum : null }))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'ru'));
}

/** Ключ позиции КП для ручных правок: стабилен между пересчётами проекта. */
export function clientDetailKey(detail: Pick<ClientOfferDetail, 'kind' | 'itemId' | 'name'>): string {
  return detail.itemId ? `${detail.kind}|${detail.itemId}` : `${detail.kind}|name:${detail.name}`;
}

/**
 * Накладывает ручные правки менеджера на рассчитанные строки КП.
 * Правка количества пересчитывает сумму по цене за единицу, правка суммы — побеждает.
 */
export function applyClientOfferEdits(details: ClientOfferDetail[], edits?: ClientOfferEdits): ClientOfferDetail[] {
  const qtyEdits = edits?.qty ?? {};
  const sumEdits = edits?.sums ?? {};
  if (Object.keys(qtyEdits).length === 0 && Object.keys(sumEdits).length === 0) return details;

  return details.map((detail) => {
    const key = clientDetailKey(detail);
    const nextQty = qtyEdits[key];
    const nextSum = sumEdits[key];
    if (nextQty == null && nextSum == null) return detail;

    const row: ClientOfferDetail = { ...detail, baseQty: detail.qty, baseClientSum: detail.clientSum };
    if (nextQty != null && Number.isFinite(nextQty) && nextQty >= 0 && nextQty !== detail.qty) {
      const factor = detail.qty > 0 ? nextQty / detail.qty : 0;
      row.qty = nextQty;
      row.qtyEffective = detail.qty > 0 ? detail.qtyEffective * factor : nextQty;
      if (detail.clientSum != null && detail.qty > 0) row.clientSum = detail.clientSum * factor;
      row.qtyEdited = true;
    }
    if (nextSum != null && Number.isFinite(nextSum) && nextSum >= 0) {
      row.clientSum = nextSum;
      row.sumEdited = true;
    }
    return row;
  });
}

/** Насколько ручные правки сдвинули итог КП относительно расчёта. */
export function clientOfferEditsDelta(details: ClientOfferDetail[]): number {
  return details.reduce((delta, detail) => {
    if (!detail.qtyEdited && !detail.sumEdited) return delta;
    return delta + ((detail.clientSum ?? 0) - (detail.baseClientSum ?? 0));
  }, 0);
}

/** Есть ли в КП хотя бы одна ручная правка количества/суммы. */
export function hasClientOfferEdits(details: ClientOfferDetail[]): boolean {
  return details.some((detail) => detail.qtyEdited || detail.sumEdited);
}

function rollupQtyText(items: ClientOfferDetail[]): string {
  const area = items.reduce((sum, detail) => {
    const unit = detail.unit.toLocaleLowerCase('ru-RU');
    return detail.priceBasis === 'm2' || unit.includes('м²') || unit.includes('м2') ? sum + detail.qtyEffective : sum;
  }, 0);
  const length = items.reduce((sum, detail) => {
    const unit = detail.unit.toLocaleLowerCase('ru-RU');
    return detail.priceBasis === 'lm' || unit.includes('п.м') || unit.includes('пог') ? sum + detail.qtyEffective : sum;
  }, 0);
  const pieces = items.reduce((sum, detail) => sum + detail.qty, 0);
  return [
    area > 0 ? `${fmtNum(area, 2)} м²` : '',
    length > 0 ? `${fmtNum(length, 2)} п.м` : '',
    pieces > 0 ? `${fmtNum(pieces, 3)} шт` : '',
  ].filter(Boolean).join(' / ') || '—';
}

/**
 * Сводная ведомость самого короткого КП: по типам — сколько и какие.
 * «Петли — 24 шт — Blum 110° с доводчиком 16 шт; Boyard 8 шт — 18 400 ₽».
 */
export function buildClientOfferRollup(details: ClientOfferDetail[]): ClientOfferRollupRow[] {
  const byKind = new Map<ClientOfferDetailKind, ClientOfferDetail[]>();
  for (const detail of details) {
    const list = byKind.get(detail.kind);
    if (list) list.push(detail);
    else byKind.set(detail.kind, [detail]);
  }
  return Array.from(byKind.entries())
    .sort(([a], [b]) => KIND_ORDER[a] - KIND_ORDER[b])
    .map(([kind, items]) => {
      const priced = items.some((detail) => detail.clientSum != null);
      return {
        kind,
        label: KIND_LABELS[kind],
        qtyText: rollupQtyText(items),
        sum: priced ? items.reduce((sum, detail) => sum + (detail.clientSum ?? 0), 0) : null,
        items: [...items].sort((a, b) => (b.clientSum ?? 0) - (a.clientSum ?? 0) || a.name.localeCompare(b.name, 'ru')),
      };
    });
}

/** Корпусная часть позиции: именно она идёт строкой «какой корпус» в товарном чеке. */
export const CLIENT_BODY_KINDS: ClientOfferDetailKind[] = ['body', 'bodySurcharge', 'shelf'];

export function clientBodyTotal(details: ClientOfferDetail[]): number {
  const allowed = new Set(CLIENT_BODY_KINDS);
  return details.filter((detail) => allowed.has(detail.kind)).reduce((sum, detail) => sum + (detail.clientSum ?? 0), 0);
}

function sumClient(details: ClientOfferDetail[], kinds: ClientOfferDetailKind[]): number {
  const allowed = new Set(kinds);
  return details
    .filter((detail) => allowed.has(detail.kind))
    .reduce((sum, detail) => sum + (detail.clientSum ?? 0), 0);
}

/** Сводка для клиентского пакета и плашки поверх эскиза: только клиентские суммы, без себестоимости. */
export function buildClientProjectSummary(details: ClientOfferDetail[], moduleCount = 0): ClientProjectSummary {
  const facadeDetails = details.filter((detail) => detail.kind === 'facade' || detail.kind === 'frame');
  const hingeDetails = details.filter((detail) => detail.kind === 'hinge');
  return {
    moduleCount,
    facadeQty: facadeDetails.reduce((sum, detail) => sum + detail.qty, 0),
    facadeAreaM2: facadeDetails.reduce((sum, detail) => {
      const unit = detail.unit.toLocaleLowerCase('ru-RU');
      return detail.priceBasis === 'm2' || unit.includes('м²') || unit.includes('м2') ? sum + detail.qtyEffective : sum;
    }, 0),
    hingeQty: hingeDetails.reduce((sum, detail) => sum + detail.qty, 0),
    hingeTypes: hingeDetails.map((detail) => ({ name: detail.name, qty: detail.qty })),
    bodyTotal: sumClient(details, ['body', 'bodySurcharge', 'shelf']),
    facadeTotal: sumClient(details, ['facade', 'frame']),
    hardwareTotal: sumClient(details, ['hinge', 'drawerSys', 'lift', 'handle', 'legs']),
  };
}

/** Короткие строки, которые можно положить компактной плашкой на эскиз. */
export function clientSketchSummaryLines(summary: ClientProjectSummary): string[] {
  const hingeNames = summary.hingeTypes
    .slice(0, 2)
    .map((item) => `${item.name} — ${fmtNum(item.qty, 3)} шт`);
  const extraHinges = summary.hingeTypes.length > 2 ? `ещё ${summary.hingeTypes.length - 2}` : '';
  return [
    summary.moduleCount > 0 ? `Модули: ${fmtNum(summary.moduleCount, 3)} шт` : '',
    summary.hingeQty > 0 ? `Петли: ${fmtNum(summary.hingeQty, 3)} шт${hingeNames.length ? ` (${[...hingeNames, extraHinges].filter(Boolean).join('; ')})` : ''}` : '',
    summary.facadeAreaM2 > 0 ? `Фасады: ${fmtNum(summary.facadeAreaM2, 2)} м²${summary.facadeQty > 0 ? ` / ${fmtNum(summary.facadeQty, 3)} шт` : ''}` : summary.facadeQty > 0 ? `Фасады: ${fmtNum(summary.facadeQty, 3)} шт` : '',
    summary.bodyTotal > 0 ? `Корпуса: ${fmtMoney(summary.bodyTotal)}` : '',
    summary.facadeTotal > 0 ? `Фасады сумма: ${fmtMoney(summary.facadeTotal)}` : '',
    summary.hardwareTotal > 0 ? `Фурнитура: ${fmtMoney(summary.hardwareTotal)}` : '',
  ].filter(Boolean);
}
