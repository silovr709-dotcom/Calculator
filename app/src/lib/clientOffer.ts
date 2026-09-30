import type { LineCalc, PriceBasis, ProjectLine } from '../types';

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
export function buildClientOfferDetails(lines: ProjectLine[], lineCalcs: Map<string, LineCalc>): ClientOfferDetail[] {
  const acc = new Map<string, ClientOfferDetail & { priced: boolean }>();

  for (const line of lines) {
    const meta = classifyClientLine(line);
    const unit = unitForClient(line);
    const key = [meta.kind, line.itemId, line.name, unit, line.priceBasis ?? ''].join('|');
    const calc = lineCalcs.get(line.id);
    const qtyEffective = calc?.qtyEffective ?? line.qty;
    const clientSum = calc?.clientSum ?? null;
    let row = acc.get(key);
    if (!row) {
      row = {
        id: key,
        kind: meta.kind,
        kindLabel: meta.label,
        name: line.name,
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
