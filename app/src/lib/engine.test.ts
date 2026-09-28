// Контрольные тесты: сверка движка с ручными расчётами по исходному прайсу Висмы.
// Все ожидаемые числа взяты руками из «ВИСМА 2026 КХМ.xlsm» (лист/строка указаны в комментариях).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pricebook, PriceItem, ProjectLine } from '../types';
import { calcTotals, lineFromItem, effectiveQty, sheetsFromLength, summaryGroupFor } from './engine';
import { defaultSettings } from './storage';

const here = dirname(fileURLToPath(import.meta.url));
const pb: Pricebook = JSON.parse(
  readFileSync(join(here, '../../public/data/pricebook-visma-2026.json'), 'utf-8'),
);

function find(pred: (i: PriceItem) => boolean): PriceItem {
  const it = pb.items.find(pred);
  if (!it) throw new Error('позиция не найдена в прайсе');
  return it;
}
const byNamePart = (part: string, more?: (i: PriceItem) => boolean) =>
  find((i) => i.name.toLowerCase().includes(part.toLowerCase()) && (!more || more(i)));

describe('снимок прайса: реперные цены из xlsm', () => {
  it('корпус: шкаф настенный 1-но дверный Н=720, 400мм, арт.34 = 2100 ₽ (каркас шк, стр.11)', () => {
    const it34 = find((i) => i.article === '34' && i.source.sheet === 'каркас шк');
    expect(it34.price).toBe(2100);
  });
  it('корпус: стол с 3-мя ящиками 600мм, арт.251 = 4500 ₽ (каркас ст)', () => {
    const it251 = find((i) => i.article === '251' && i.source.sheet === 'каркас ст');
    expect(it251.price).toBe(4500);
  });
  it('петля Blum 110 c дов = 650 ₽ (Доп комплект, стр.174)', () => {
    const p = byNamePart('Петля Blum 110° c дов', (i) => i.source.sheet === 'Доп комплект' && !i.name.includes('полунакладная'));
    expect(p.price).toBe(650);
  });
  it('МДФ(ПВХ) кв.м, 1 категория, 16мм = 3600 ₽', () => {
    const p = find((i) => i.group === 'mdf_pvh' && i.attrs['категория']?.startsWith('1 категория')
      && i.attrs['толщина'] === '16мм' && i.name.includes('Квадратный метр'));
    expect(p.price).toBe(3600);
  });
  it('эмаль глянец кв.м, фрезеровка 2 кат = 13500 ₽', () => {
    const p = find((i) => i.group === 'emal' && i.name.startsWith('глянец (кв.м)') && i.subcategory === 'фрезеровка 2 кат');
    expect(p.price).toBe(13500);
  });
  it('пластик ARPA 1 кат кв.м = 8000 ₽', () => {
    const p = find((i) => i.group === 'plastic' && i.attrs['категория'] === '1 кат' && i.attrs['бренд'].startsWith('ARPA') && i.priceBasis === 'm2');
    expect(p.price).toBe(8000);
  });
  it('МС столешница 600*3000, 26мм, 1 категория = 4700 ₽/хлыст', () => {
    const p = find((i) => i.group === 'ms' && i.attrs['толщина'] === '26мм'
      && i.attrs['категория'] === '1 категория' && i.name.includes('600*3000'));
    expect(p.price).toBe(4700);
  });
  it('Aventos HK-XS (1 механизм): Доп комплект = 3000 ₽, лист BLUM = 2600 ₽ (разные прайсы!)', () => {
    const a1 = find((i) => i.name.startsWith('Aventos HK-XS (с 1 силовым') && i.source.sheet === 'Доп комплект');
    const a2 = find((i) => i.name.startsWith('Aventos HK-XS (с 1 силовым') && i.source.sheet === 'BLUM');
    expect(a1.price).toBe(3000);
    expect(a2.price).toBe(2600);
  });
});

describe('количество × цена = сумма позиции', () => {
  it('простая кухня: корпуса, шт', () => {
    const it34 = find((i) => i.article === '34' && i.source.sheet === 'каркас шк'); // 2100
    const line = lineFromItem(it34, 'visma-2026', 3);
    const { lineCalcs, totals } = calcTotals([line], defaultSettings());
    expect(lineCalcs.get(line.id)!.sum).toBe(3 * 2100);
    expect(totals.cost).toBe(6300);
  });

  it('фасады МДФ по размерам: 2 фасада 396×716, 1 кат 16мм (3600 ₽/кв.м)', () => {
    const p = find((i) => i.group === 'mdf_pvh' && i.attrs['категория']?.startsWith('1 категория')
      && i.attrs['толщина'] === '16мм' && i.name.includes('Квадратный метр'));
    const line = lineFromItem(p, 'visma-2026', 2, { widthMm: 396, heightMm: 716 });
    const c = calcTotals([line], defaultSettings());
    const area = (0.396 * 0.716) * 2; // 0.567072
    expect(c.lineCalcs.get(line.id)!.qtyEffective).toBeCloseTo(area, 4);
    expect(c.lineCalcs.get(line.id)!.sum).toBeCloseTo(Math.round(area * 3600 * 100) / 100, 2);
  });

  it('п.м «кратно метру»: рейка 600 ₽/п.м, деталь 1750мм → 2 п.м за шт', () => {
    const p = byNamePart('Рейка ЛДСП 16мм в ПВХ 1мм (шириной от 60 до 40мм)');
    expect(p.price).toBe(600);
    const line = lineFromItem(p, 'visma-2026', 1, { lengthMm: 1750 });
    const c = calcTotals([line], defaultSettings());
    expect(c.lineCalcs.get(line.id)!.qtyEffective).toBe(2);
    expect(c.lineCalcs.get(line.id)!.sum).toBe(1200);
  });

  it('процентная надбавка: нестандартная глубина +10% к корпусу', () => {
    const it34 = find((i) => i.article === '34' && i.source.sheet === 'каркас шк'); // 2100
    const pct = byNamePart('Доплата не стандрт/глубину каркаса');
    expect(pct.priceKind).toBe('percent');
    expect(pct.price).toBe(10);
    const base = lineFromItem(it34, 'visma-2026', 1);
    const add = lineFromItem(pct, 'visma-2026', 1);
    add.baseLineId = base.id;
    const c = calcTotals([base, add], defaultSettings());
    expect(c.lineCalcs.get(add.id)!.sum).toBe(210);
    expect(c.totals.cost).toBe(2310);
  });
});

describe('столешницы: подбор хлыстов', () => {
  it('3000мм хлыст, полхлыста разрешено: длина 2600 → 1 хлыст; 3100 → 1.5', () => {
    expect(sheetsFromLength(2600, 3000, true)).toBe(1);
    expect(sheetsFromLength(3100, 3000, true)).toBe(1.5);
    expect(sheetsFromLength(1400, 3000, true)).toBe(0.5);
  });
  it('4100мм только целиком: длина 4200 → 2 хлыста', () => {
    expect(sheetsFromLength(4200, 4100, false)).toBe(2);
  });
  it('кухня со столешницей МС 38мм 3 кат: 1.5 хлыста × 7200 = 10800', () => {
    const p = find((i) => i.group === 'ms' && i.attrs['толщина'] === '38мм'
      && i.attrs['категория'] === '3 категория' && i.name.includes('600*3000'));
    expect(p.price).toBe(7200);
    const line = lineFromItem(p, 'visma-2026', 1.5);
    const c = calcTotals([line], defaultSettings());
    expect(c.lineCalcs.get(line.id)!.sum).toBe(10800);
  });
});

describe('правило прайса: эмаль менее 1 кв.м +30% (на сумму проекта)', () => {
  const emal = find((i) => i.group === 'emal' && i.name.startsWith('матовая (кв.м)') && i.subcategory === 'фрезеровка 19 мыло/R3'); // 8800
  it('0.5 кв.м эмали → +30% от суммы', () => {
    const line = lineFromItem(emal, 'visma-2026', 1, { areaM2: 0.5 });
    const { totals } = calcTotals([line], defaultSettings());
    expect(totals.emalAdjustment?.applied).toBe(true);
    // 0.5*8800=4400; +30% = 1320
    expect(totals.emalAdjustment?.amount).toBe(1320);
    expect(totals.cost).toBe(5720);
  });
  it('1.2 кв.м эмали → правило не применяется', () => {
    const line = lineFromItem(emal, 'visma-2026', 1, { areaM2: 1.2 });
    const { totals } = calcTotals([line], defaultSettings());
    expect(totals.emalAdjustment?.applied).toBe(false);
    expect(totals.cost).toBe(10560);
  });
});

describe('итоги, наценка, цена клиента, маржа', () => {
  it('кухня с дорогой фурнитурой BLUM + GOLA: суммы категорий и наценка по группам', () => {
    const it34 = find((i) => i.article === '34' && i.source.sheet === 'каркас шк'); // 2100 Корпуса
    const legra = byNamePart('Леграбокс низ. М 450мм', (i) => i.source.sheet === 'BLUM'); // 5000 Фурнитура
    const gola = find((i) => i.group === 'gola' && i.article === 'GL2.548A.4200.7F RU'); // 3800 GOLA
    expect(legra.price).toBe(5000);
    expect(gola.price).toBe(3800);

    const lines: ProjectLine[] = [
      lineFromItem(it34, 'visma-2026', 4),   // 8400
      lineFromItem(legra, 'visma-2026', 3),  // 15000
      lineFromItem(gola, 'visma-2026', 2),   // 7600
    ];
    const settings = defaultSettings();
    settings.markupBasePct = 100;
    settings.markupByGroup = { 'Фурнитура': 50 };
    settings.assemblyCost = 5000;
    settings.deliveryCost = 2000;

    const { totals } = calcTotals(lines, settings);
    expect(totals.byGroup['Корпуса'].cost).toBe(8400);
    expect(totals.byGroup['Фурнитура'].cost).toBe(15000);
    expect(totals.byGroup['GOLA / профили'].cost).toBe(7600);
    expect(totals.costLines).toBe(31000);
    expect(totals.extraTotal).toBe(7000);
    expect(totals.cost).toBe(38000);
    // клиент: корпуса 16800 + фурнитура 22500 + gola 15200 + 7000 = 61500
    expect(totals.client).toBe(61500);
    expect(totals.markupRub).toBe(23500);
    expect(totals.markupPct).toBeCloseTo((23500 / 38000) * 100, 2);
    expect(totals.marginPct).toBeCloseTo((23500 / 61500) * 100, 2);
  });

  it('процентные расходы считаются от клиентской суммы материалов (без рекурсии)', () => {
    const it34 = find((i) => i.article === '34' && i.source.sheet === 'каркас шк'); // 2100
    const lines: ProjectLine[] = [lineFromItem(it34, 'visma-2026', 10)]; // cost 21000
    const settings = defaultSettings();
    settings.markupBasePct = 100; // clientLines = 42000
    settings.extraExpenses = [
      { id: 'e1', name: 'Сборка', amount: null, percent: 10, toClient: true },   // 4200
      { id: 'e2', name: 'Дизайнеру', amount: null, percent: 5, toClient: false }, // 2100, только в себестоимость
      { id: 'e3', name: 'Доставка', amount: 3000, percent: null, toClient: true },
    ];
    const { totals } = calcTotals(lines, settings);
    expect(totals.extraDetails).toHaveLength(3);
    expect(totals.extraDetails![0]).toMatchObject({ name: 'Сборка', percent: 10, amount: 4200, toClient: true });
    expect(totals.extraDetails![1]).toMatchObject({ name: 'Дизайнеру', percent: 5, amount: 2100, toClient: false });
    expect(totals.extraDetails![2]).toMatchObject({ name: 'Доставка', percent: null, amount: 3000 });
    expect(totals.extraTotal).toBe(4200 + 2100 + 3000);
    expect(totals.cost).toBe(21000 + 9300);
    // клиент: 42000 + 4200 + 3000 (дизайнеру НЕ переносим) = 49200
    expect(totals.client).toBe(49200);
  });

  it('расход с незаданной суммой и без процента не участвует в итогах', () => {
    const it34 = find((i) => i.article === '34' && i.source.sheet === 'каркас шк');
    const settings = defaultSettings();
    settings.extraExpenses = [{ id: 'e1', name: 'Подъём', amount: null, percent: null, toClient: true }];
    const { totals } = calcTotals([lineFromItem(it34, 'visma-2026', 1)], settings);
    expect(totals.extraTotal).toBe(0);
    expect(totals.extraDetails).toHaveLength(0);
  });

  it('без наценки цена клиента = себестоимости (наценка не задана — не придумываем)', () => {
    const it34 = find((i) => i.article === '34' && i.source.sheet === 'каркас шк');
    const { totals } = calcTotals([lineFromItem(it34, 'visma-2026', 1)], defaultSettings());
    expect(totals.client).toBe(totals.cost);
    expect(totals.markupRub).toBe(0);
  });
});

describe('единицы и группы', () => {
  it('м² по прямой площади: стекло сатинато 2800 ₽/м² × 0.75 м²', () => {
    const glass = byNamePart('Сатинато светлое');
    expect(glass.price).toBe(2800);
    const line = lineFromItem(glass, 'visma-2026', 1, { areaM2: 0.75 });
    const c = calcTotals([line], defaultSettings());
    expect(c.lineCalcs.get(line.id)!.sum).toBe(2100);
  });
  it('сводные группы корректны', () => {
    expect(summaryGroupFor('Корпуса: шкафы навесные')).toBe('Корпуса');
    expect(summaryGroupFor('Фасады: Эмаль')).toBe('Фасады');
    expect(summaryGroupFor('Столешницы: Мир Столешниц (постформинг)')).toBe('Столешницы');
    expect(summaryGroupFor('Петли')).toBe('Фурнитура');
    expect(summaryGroupFor('GOLA / профили')).toBe('GOLA / профили');
    expect(summaryGroupFor('Электрика и свет')).toBe('Электрика');
    expect(summaryGroupFor('Мойки')).toBe('Мойки и смесители');
  });
  it('позиция без цены не ломает расчёт и попадает в предупреждения', () => {
    const monte = find((i) => i.name.includes('RT110BL.1/000/1200'));
    expect(monte.priceKind).toBe('empty');
    const line = lineFromItem(monte, 'visma-2026', 2);
    const { lineCalcs, totals } = calcTotals([line], defaultSettings());
    expect(lineCalcs.get(line.id)!.sum).toBeNull();
    expect(totals.unpricedCount).toBe(1);
    expect(totals.cost).toBe(0);
  });
  it('эффективное количество: площадь из размеров', () => {
    expect(effectiveQty({ priceBasis: 'm2', unit: 'кв.м', qty: 2, params: { widthMm: 500, heightMm: 700 } })).toBeCloseTo(0.7, 4);
  });
});
