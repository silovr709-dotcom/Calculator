// Расчётный движок. Все цены — из снимков позиций прайса; движок ничего не придумывает.
import type {
  PriceItem, ProjectLine, ProjectSettings, LineCalc, Totals, SummaryGroup, LineParams,
} from '../types';
import { SUMMARY_GROUPS } from '../types';

export const round2 = (v: number) => Math.round(v * 100) / 100;

/** Клиентская цена округляется вверх, чтобы не уменьшать рассчитанную стоимость. */
export function roundClientPrice(value: number, step: ProjectSettings['clientRounding'] = 1): number {
  const safeStep = step === 10 || step === 100 || step === 1000 ? step : 1;
  if (safeStep === 1) return round2(value);
  return round2(Math.ceil(value / safeStep) * safeStep);
}

// ---------- Сводная группа по категории прайса ----------
export function summaryGroupFor(category: string): SummaryGroup {
  const c = category.toLowerCase();
  if (c.startsWith('корпуса')) return 'Корпуса';
  if (c.startsWith('фасады')) return 'Фасады';
  if (c.startsWith('столешницы')) return 'Столешницы';
  if (c.includes('ручки')) return 'Ручки';
  if (c.includes('gola') || c.includes('профил')) return 'GOLA / профили';
  if (c.includes('мойки') || c.includes('смесител')) return 'Мойки и смесители';
  if (c.includes('электрика') || c.includes('свет')) return 'Электрика';
  if (c.includes('цоколь') || c.includes('опоры')) return 'Цоколь и опоры';
  if (c.includes('упаковка') || c.includes('доп. комплектация каркасов')) return 'Работы и упаковка';
  if (
    c.includes('петли') || c.includes('выдвижен') || c.includes('подъём') || c.includes('подъем') ||
    c.includes('посудосуш') || c.includes('бутылочниц') || c.includes('карго') ||
    c.includes('наполнение') || c.includes('фурнитура') || c.includes('blum')
  ) return 'Фурнитура';
  return 'Прочее';
}

// ---------- Правила единиц ----------
export function unitIsPerMeterMultiple(unit: string | null): boolean {
  if (!unit) return false;
  const u = unit.toLowerCase();
  return u.includes('кратно метру') || u.includes('округляется до метра');
}

export function unitIsHalfSheetAllowed(unit: string | null): boolean {
  if (!unit) return false;
  const u = unit.toLowerCase().replace(/\s/g, '');
  return u.includes('0,5хл') || u.includes('0.5хл') || u.includes('хлыст3000');
}

/** Эффективное количество единиц измерения для строки */
export function effectiveQty(line: Pick<ProjectLine, 'priceBasis' | 'unit' | 'qty' | 'params'>): number {
  const { priceBasis, unit, qty, params } = line;
  if (priceBasis === 'm2') {
    if (params.widthMm && params.heightMm) {
      return round4((params.widthMm / 1000) * (params.heightMm / 1000) * qty);
    }
    if (params.areaM2 != null) return round4(params.areaM2 * qty);
    return qty; // qty интерпретируется как площадь
  }
  if (priceBasis === 'lm') {
    if (params.lengthMm != null) {
      const meters = params.lengthMm / 1000;
      const perPiece = unitIsPerMeterMultiple(unit) ? Math.ceil(meters) : meters;
      return round4(perPiece * qty);
    }
    return qty; // qty — метры
  }
  // unit | sheet | percent_of_base
  return qty;
}

const round4 = (v: number) => Math.round(v * 1e9) / 1e9; // без потери точности, округляется только итог

/** Подбор количества хлыстов столешницы из нужной длины (правила прайса МС/СОЮЗ) */
export function sheetsFromLength(lengthMm: number, sheetLengthMm: number, halfAllowed: boolean): number {
  if (lengthMm <= 0) return 0;
  if (halfAllowed) {
    const halves = Math.ceil(lengthMm / (sheetLengthMm / 2));
    return halves / 2;
  }
  return Math.ceil(lengthMm / sheetLengthMm);
}

/** Длина хлыста из атрибутов позиции (3000/3500/4100) */
export function sheetLengthOf(item: { name: string; attrs?: Record<string, string> }): number {
  const s = `${item.attrs?.['формат'] ?? ''} ${item.name}`;
  const m = s.match(/(\d{4})\s*(?:\*|х|x|мм)/i) ?? s.match(/\*\s*(\d{4})/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 2000 && n <= 4200) return n;
  }
  if (/4100/.test(s)) return 4100;
  if (/3500/.test(s)) return 3500;
  return 3000;
}

// ---------- Расчёт строк ----------

export function calcLines(lines: ProjectLine[]): Map<string, LineCalc> {
  const res = new Map<string, LineCalc>();
  // первый проход: обычные строки
  for (const line of lines) {
    if (line.priceKind === 'percent') continue;
    const qtyEff = effectiveQty(line);
    let sum: number | null = null;
    let warning: string | undefined;
    if (line.priceKind === 'fixed' || line.priceKind === 'surcharge') {
      if (line.price != null) sum = round2(qtyEff * line.price);
      else warning = 'Цена не задана в прайсе';
    } else if (line.priceKind === 'unavailable') {
      warning = 'Позиция недоступна/выведена из прайса';
    } else if (line.priceKind === 'text') {
      warning = 'Текстовая цена в прайсе — требуется ручной ввод';
    } else {
      warning = 'Пустая цена в прайсе';
    }
    res.set(line.id, { lineId: line.id, qtyEffective: qtyEff, sum, clientSum: null, markupPct: null, warning });
  }
  // второй проход: процентные строки (от базовой строки)
  for (const line of lines) {
    if (line.priceKind !== 'percent') continue;
    let sum: number | null = null;
    let warning: string | undefined;
    if (line.price == null) {
      warning = 'Процент не задан';
    } else if (!line.baseLineId) {
      warning = 'Не выбрана базовая позиция для процентной надбавки';
    } else {
      const base = res.get(line.baseLineId);
      if (!base || base.sum == null) warning = 'Базовая позиция не рассчитана';
      else sum = round2((base.sum * line.price) / 100 * line.qty);
    }
    res.set(line.id, { lineId: line.id, qtyEffective: line.qty, sum, clientSum: null, markupPct: null, warning });
  }
  return res;
}

// ---------- Наценка ----------

export function markupPctForGroup(settings: ProjectSettings, group: SummaryGroup): number | null {
  const o = settings.markupByGroup[group];
  if (o != null) return o;
  return settings.markupBasePct;
}

// ---------- Итоги проекта ----------

export function calcTotals(lines: ProjectLine[], settings: ProjectSettings): { lineCalcs: Map<string, LineCalc>; totals: Totals } {
  const lineCalcs = calcLines(lines);

  // правило прайса: эмаль — заказ менее 1 кв.м считается +30% (на сумму фасадов эмали проекта)
  let emalAdjustment: Totals['emalAdjustment'] = null;
  if (settings.applyEmalRule) {
    let area = 0; let cost = 0;
    for (const line of lines) {
      if (line.priceGroup === 'emal' && line.priceBasis === 'm2') {
        const c = lineCalcs.get(line.id);
        if (c?.sum != null) { area += c.qtyEffective; cost += c.sum; }
      }
    }
    if (area > 0 && area < 1) {
      emalAdjustment = { applied: true, area: round4(area), amount: round2(cost * 0.30) };
    } else if (area > 0) {
      emalAdjustment = { applied: false, area: round4(area), amount: 0 };
    }
  }

  const byGroup: Record<string, { cost: number; client: number }> = {};
  for (const g of SUMMARY_GROUPS) byGroup[g] = { cost: 0, client: 0 };

  let unpricedCount = 0;
  for (const line of lines) {
    const c = lineCalcs.get(line.id)!;
    if (c.sum == null) { unpricedCount += 1; continue; }
    const pct = markupPctForGroup(settings, line.group);
    const client = pct != null ? round2(c.sum * (1 + pct / 100)) : c.sum;
    c.clientSum = client;
    c.markupPct = pct;
    byGroup[line.group].cost = round2(byGroup[line.group].cost + c.sum);
    byGroup[line.group].client = round2(byGroup[line.group].client + client);
  }

  if (emalAdjustment?.applied) {
    const pct = markupPctForGroup(settings, 'Фасады');
    byGroup['Фасады'].cost = round2(byGroup['Фасады'].cost + emalAdjustment.amount);
    byGroup['Фасады'].client = round2(
      byGroup['Фасады'].client + (pct != null ? emalAdjustment.amount * (1 + pct / 100) : emalAdjustment.amount),
    );
  }

  let costLines = 0; let clientLines = 0;
  for (const g of SUMMARY_GROUPS) { costLines = round2(costLines + byGroup[g].cost); clientLines = round2(clientLines + byGroup[g].client); }

  // доп. расходы (сборка/доставка/прочее) — без наценки, к клиенту добавляются если toClient
  let extraTotal = 0; let extraClient = 0;
  const extras: { name: string; amount: number; toClient: boolean }[] = [];
  if (settings.assemblyCost != null) extras.push({ name: 'Сборка', amount: settings.assemblyCost, toClient: true });
  if (settings.deliveryCost != null) extras.push({ name: 'Доставка', amount: settings.deliveryCost, toClient: true });
  for (const e of settings.extraExpenses) if (e.amount != null) extras.push({ name: e.name, amount: e.amount, toClient: e.toClient });
  for (const e of extras) { extraTotal = round2(extraTotal + e.amount); if (e.toClient) extraClient = round2(extraClient + e.amount); }

  const cost = round2(costLines + extraTotal);
  const client = roundClientPrice(round2(clientLines + extraClient), settings.clientRounding);
  const markupRub = round2(client - cost);
  const markupPct = cost > 0 ? round2((markupRub / cost) * 100) : null;
  const marginPct = client > 0 ? round2((markupRub / client) * 100) : null;

  return {
    lineCalcs,
    totals: { byGroup, emalAdjustment, costLines, extraTotal, cost, client, markupRub, markupPct, marginPct, unpricedCount },
  };
}

// ---------- Создание строки проекта из позиции прайса ----------

let lineSeq = 0;
export function newLineId(): string {
  lineSeq += 1;
  return `ln_${Date.now().toString(36)}_${lineSeq}_${Math.random().toString(36).slice(2, 6)}`;
}

export function lineFromItem(item: PriceItem, pricebookId: string, qty: number, params: LineParams = {}): ProjectLine {
  return {
    id: newLineId(),
    itemId: item.id,
    pricebookId,
    category: item.category,
    group: summaryGroupFor(item.category),
    name: item.name,
    article: item.article,
    unit: item.unit,
    priceKind: item.priceKind,
    price: item.price,
    priceBasis: item.priceBasis,
    priceGroup: item.group,
    qty,
    params,
    baseLineId: null,
  };
}
