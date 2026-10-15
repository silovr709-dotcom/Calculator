// Проверка цен: сверяем закупку (опт) и цену клиента (розница) по каждой позиции,
// ищем ошибки расчёта — нулевые цены, отрицательную маржу, расхождения с прайсом.

import type { LineCalc, Pricebook, PriceItem, Project, ProjectLine, Totals } from '../types';

export type AuditFlag = 'no-price' | 'zero-qty' | 'negative-margin' | 'low-margin' | 'huge-markup' | 'price-changed' | 'not-in-pricebook';

export interface AuditRow {
  lineId: string;
  name: string;
  article: string | null;
  group: string;
  category: string;
  unit: string | null;
  qty: number;
  qtyEffective: number;
  /** Опт: цена закупки за единицу и сумма. */
  unitCost: number | null;
  cost: number | null;
  /** Розница: цена для клиента за единицу и сумма. */
  unitClient: number | null;
  client: number | null;
  markupPct: number | null;
  marginRub: number | null;
  marginPct: number | null;
  /** Цена в текущем прайсе — чтобы увидеть, что снимок устарел или правили руками. */
  pricebookPrice?: number | null;
  flags: AuditFlag[];
}

export const AUDIT_FLAG_LABELS: Record<AuditFlag, string> = {
  'no-price': 'нет цены',
  'zero-qty': 'нулевое количество',
  'negative-margin': 'продаём дешевле закупки',
  'low-margin': 'маржа меньше 10 %',
  'huge-markup': 'наценка больше 300 %',
  'price-changed': 'цена отличается от прайса',
  'not-in-pricebook': 'позиции нет в текущем прайсе',
};

export const AUDIT_FLAG_TONE: Record<AuditFlag, 'bad' | 'warn'> = {
  'no-price': 'bad',
  'zero-qty': 'warn',
  'negative-margin': 'bad',
  'low-margin': 'warn',
  'huge-markup': 'warn',
  'price-changed': 'warn',
  'not-in-pricebook': 'warn',
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildAuditRows(lines: ProjectLine[], calcs: Map<string, LineCalc>, pricebook?: Pricebook): AuditRow[] {
  const byId = new Map<string, PriceItem>((pricebook?.items ?? []).map((item) => [item.id, item]));

  return lines.map((line) => {
    const calc = calcs.get(line.id);
    const qtyEffective = calc?.qtyEffective ?? line.qty;
    const cost = calc?.sum ?? null;
    const client = calc?.clientSum ?? null;
    const unitCost = cost != null && qtyEffective ? round2(cost / qtyEffective) : line.price;
    const unitClient = client != null && qtyEffective ? round2(client / qtyEffective) : null;
    const marginRub = cost != null && client != null ? round2(client - cost) : null;
    const marginPct = marginRub != null && client ? round2((marginRub / client) * 100) : null;

    const item = byId.get(line.itemId);
    const pricebookPrice = item ? item.price : undefined;

    const flags: AuditFlag[] = [];
    if (line.price == null || cost == null) flags.push('no-price');
    if (!line.qty) flags.push('zero-qty');
    if (marginRub != null && marginRub < 0) flags.push('negative-margin');
    else if (marginPct != null && marginPct >= 0 && marginPct < 10 && (client ?? 0) > 0) flags.push('low-margin');
    if (calc?.markupPct != null && calc.markupPct > 300) flags.push('huge-markup');
    if (pricebook && !item) flags.push('not-in-pricebook');
    if (item && line.price != null && pricebookPrice != null && Math.abs(pricebookPrice - line.price) > 0.01) flags.push('price-changed');

    return {
      lineId: line.id,
      name: line.name,
      article: line.article,
      group: line.group,
      category: line.category,
      unit: line.unit,
      qty: line.qty,
      qtyEffective,
      unitCost,
      cost,
      unitClient,
      client,
      markupPct: calc?.markupPct ?? null,
      marginRub,
      marginPct,
      pricebookPrice,
      flags,
    };
  });
}

export interface AuditGroup {
  group: string;
  rows: AuditRow[];
  cost: number;
  client: number;
  marginRub: number;
  marginPct: number | null;
}

export function groupAuditRows(rows: AuditRow[]): AuditGroup[] {
  const map = new Map<string, AuditRow[]>();
  for (const row of rows) {
    const list = map.get(row.group) ?? [];
    list.push(row);
    map.set(row.group, list);
  }
  return Array.from(map.entries()).map(([group, list]) => {
    const cost = round2(list.reduce((sum, row) => sum + (row.cost ?? 0), 0));
    const client = round2(list.reduce((sum, row) => sum + (row.client ?? 0), 0));
    const marginRub = round2(client - cost);
    return { group, rows: list, cost, client, marginRub, marginPct: client ? round2((marginRub / client) * 100) : null };
  }).sort((left, right) => right.client - left.client);
}

export interface AuditSummary {
  lines: number;
  problems: number;
  warnings: number;
  linesCost: number;
  linesClient: number;
  /** Сходится ли сумма строк с итогом расчёта (с учётом расходов и правила эмали). */
  totalsMatch: boolean;
  difference: number;
}

/**
 * Сверка «снизу вверх»: сумма позиций плюс расходы должна совпасть с итогом проекта.
 * Если нет — значит где-то потерялись деньги, и это нужно показать.
 */
export function auditSummary(rows: AuditRow[], totals: Totals): AuditSummary {
  const linesCost = round2(rows.reduce((sum, row) => sum + (row.cost ?? 0), 0));
  const linesClient = round2(rows.reduce((sum, row) => sum + (row.client ?? 0), 0));
  const problems = rows.filter((row) => row.flags.some((flag) => AUDIT_FLAG_TONE[flag] === 'bad')).length;
  const warnings = rows.filter((row) => row.flags.length > 0 && !row.flags.some((flag) => AUDIT_FLAG_TONE[flag] === 'bad')).length;
  const emal = totals.emalAdjustment?.applied ? totals.emalAdjustment.amount : 0;
  const difference = round2(totals.costLines - round2(linesCost + emal));
  return {
    lines: rows.length,
    problems,
    warnings,
    linesCost,
    linesClient,
    totalsMatch: Math.abs(difference) < 1,
    difference,
  };
}

/** Таблица для буфера обмена и Excel: разделитель — табуляция. */
export function auditToTsv(rows: AuditRow[]): string {
  const head = ['Группа', 'Наименование', 'Артикул', 'Кол-во', 'Ед.', 'Опт за ед.', 'Опт сумма', 'Наценка %', 'Розница за ед.', 'Розница сумма', 'Маржа ₽', 'Маржа %', 'Замечания'];
  const body = rows.map((row) => [
    row.group,
    row.name,
    row.article ?? '',
    row.qty,
    row.unit ?? '',
    row.unitCost ?? '',
    row.cost ?? '',
    row.markupPct ?? '',
    row.unitClient ?? '',
    row.client ?? '',
    row.marginRub ?? '',
    row.marginPct ?? '',
    row.flags.map((flag) => AUDIT_FLAG_LABELS[flag]).join('; '),
  ].join('\t'));
  return [head.join('\t'), ...body].join('\n');
}

/** Позиции проекта вместе с модулями — то, что реально уходит в расчёт. */
export function auditLines(project: Project, moduleLines: ProjectLine[]): ProjectLine[] {
  return [...moduleLines, ...project.lines];
}
