// КОНТРОЛЬНЫЙ ТЕСТ (ЭТАП 43): полная кухня из 17 позиций всех категорий.
// Каждая реперная цена сверена вручную с «ВИСМА 2026 КХМ.xlsm», итог посчитан на бумаге.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pricebook, PriceItem, ProjectLine } from '../types';
import { calcTotals, lineFromItem, sheetsFromLength } from './engine';
import { defaultSettings } from './storage';

const here = dirname(fileURLToPath(import.meta.url));
const pb: Pricebook = JSON.parse(readFileSync(join(here, '../../public/data/pricebook-visma-2026.json'), 'utf-8'));

const find = (pred: (i: PriceItem) => boolean, what: string): PriceItem => {
  const it = pb.items.find(pred);
  if (!it) throw new Error(`не найдено: ${what}`);
  return it;
};
const art = (a: string, sheet: string) => find((i) => i.article === a && i.source.sheet === sheet, `арт ${a}`);
const name = (part: string, extra?: (i: PriceItem) => boolean) =>
  find((i) => i.name.toLowerCase().includes(part.toLowerCase()) && (!extra || extra(i)), part);

describe('полная кухня: 17 позиций, все категории', () => {
  it('итог совпадает с ручным расчётом по прайсу', () => {
    // --- реперные цены (сверены с xlsm вручную) ---
    const sh34 = art('34', 'каркас шк');   expect(sh34.price).toBe(2100);  // шкаф 720/400
    const st224 = art('224', 'каркас ст'); expect(st224.price).toBe(3300); // стол 2-х дверный 600
    const st251 = art('251', 'каркас ст'); expect(st251.price).toBe(4500); // стол 3 ящика 600
    const mdf = find((i) => i.group === 'mdf_pvh' && i.attrs['категория']?.startsWith('1 категория')
      && i.attrs['толщина'] === '16мм' && i.name.includes('Квадратный метр'), 'мдф 1кат 16');
    expect(mdf.price).toBe(3600);
    const hinge = name('Петля Боярд с дов. 90°', (i) => !i.name.includes('полунакладная') && !i.name.includes('вкладная'));
    expect(hinge.price).toBe(170);
    const tpo = name('ТПО Боярд дов'); expect(tpo.price).toBe(1600);
    const dryer = name('п/с хром 2 поддона 600'); expect(dryer.price).toBe(1100);
    const bottle = name('Бутылочница KR11'); expect(bottle.price).toBe(3600);
    const leg = name('Опора регулируемая пвх h100'); expect(leg.price).toBe(25);
    const plinth = name('Цоколь ПВХ 100мм/4м , (korner) 1 кат'.replace(/\s+/g, ' '), (i) => i.name.includes('1 кат')); expect(plinth.price).toBe(600);
    const wt = find((i) => i.group === 'ms' && i.attrs['толщина'] === '38мм'
      && i.attrs['категория'] === '1 категория' && i.name.includes('600*3000'), 'столешница МС 38 1кат');
    expect(wt.price).toBe(6800);
    const evro = name('1 кат: Еврозапил 2ст'); expect(evro.price).toBe(1500);
    const sink = name('Мойка G-20'); expect(sink.price).toBe(4300);
    const mixer = find((i) => i.category === 'Смесители' && i.name === 'Смеситель G-2', 'смеситель G-2');
    expect(mixer.price).toBe(4500);
    const handle = name('Ручка скоба Бабочка 96 хром'); expect(handle.price).toBe(100);
    const lamp = name('SOLO светильник 4000К, 4W, SL65-CH'); expect(lamp.price).toBe(600);
    const gola = find((i) => i.article === 'GL2.548A.4200.7F RU', 'GOLA под столешницу'); expect(gola.price).toBe(3800);

    // --- сборка проекта ---
    const pbId = pb.meta.id;
    const wtQty = sheetsFromLength(3400, 3000, true); // 1.5 хлыста
    expect(wtQty).toBe(1.5);

    const lines: ProjectLine[] = [
      lineFromItem(sh34, pbId, 3),                                    // 6300
      lineFromItem(st224, pbId, 2),                                   // 6600
      lineFromItem(st251, pbId, 1),                                   // 4500
      lineFromItem(mdf, pbId, 5, { widthMm: 596, heightMm: 716 }),    // 5×0.426736×3600 = 7681.25
      lineFromItem(hinge, pbId, 10),                                  // 1700
      lineFromItem(tpo, pbId, 3),                                     // 4800
      lineFromItem(dryer, pbId, 1),                                   // 1100
      lineFromItem(bottle, pbId, 1),                                  // 3600
      lineFromItem(leg, pbId, 20),                                    // 500
      lineFromItem(plinth, pbId, 2),                                  // 1200
      lineFromItem(wt, pbId, wtQty),                                  // 10200
      lineFromItem(evro, pbId, 1),                                    // 1500
      lineFromItem(sink, pbId, 1),                                    // 4300
      lineFromItem(mixer, pbId, 1),                                   // 4500
      lineFromItem(handle, pbId, 10),                                 // 1000
      lineFromItem(lamp, pbId, 2),                                    // 1200
      lineFromItem(gola, pbId, 1),                                    // 3800
    ];

    const settings = defaultSettings();
    settings.markupBasePct = 80;
    settings.assemblyCost = 7000;
    settings.deliveryCost = 3000;

    const { totals } = calcTotals(lines, settings);

    // ручной расчёт: 6300+6600+4500+7681.25+1700+4800+1100+3600+500+1200+10200+1500+4300+4500+1000+1200+3800 = 64481.25
    expect(totals.costLines).toBeCloseTo(64481.25, 2);
    expect(totals.extraTotal).toBe(10000);
    expect(totals.cost).toBeCloseTo(74481.25, 2);
    // клиент: 64481.25 × 1.8 + 10000 = 126066.25
    expect(totals.client).toBeCloseTo(126066.25, 2);
    expect(totals.markupRub).toBeCloseTo(51585.00, 2);
    expect(totals.marginPct).toBeCloseTo((51585 / 126066.25) * 100, 1);
    expect(totals.unpricedCount).toBe(0);

    // проверка сумм категорий
    expect(totals.byGroup['Корпуса'].cost).toBeCloseTo(17400, 2);
    expect(totals.byGroup['Фасады'].cost).toBeCloseTo(7681.25, 2);
    expect(totals.byGroup['Столешницы'].cost).toBeCloseTo(10200, 2);
    // еврозапил — работа фабрики с листа «Доп комплект», попадает в группу «Работы и упаковка»
    expect(totals.byGroup['Работы и упаковка'].cost).toBeCloseTo(1500, 2);
  });
});
