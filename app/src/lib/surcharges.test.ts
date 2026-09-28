import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pricebook } from '../types';
import { newModule, moduleToLines } from './modules';
import { calcTotals } from './engine';
import { defaultSettings } from './storage';
import { applyDimensionSurcharges, inferDimensionSurcharges, nominalBodyDimensions } from './surcharges';

const here = dirname(fileURLToPath(import.meta.url));
const pricebook: Pricebook = JSON.parse(readFileSync(join(here, '../../public/data/pricebook-visma-2026.json'), 'utf-8'));
const byArticle = (article: string, sheet: string) => pricebook.items.find((item) => item.article === article && item.source.sheet === sheet)!;
const byName = (part: string) => pricebook.items.find((item) => item.name.toLowerCase().includes(part.toLowerCase()))!;

describe('надбавки за нестандартные габариты корпуса', () => {
  it('для стола 600 → 650 предлагает +10% только на корпус', () => {
    const body = byArticle('224', 'каркас ст');
    const module = newModule('Нижний шкаф');
    module.widthMm = 650;
    module.heightMm = 720;
    module.depthMm = 560;

    const result = inferDimensionSurcharges(module, body, pricebook);
    expect(result).toHaveLength(1);
    expect(result[0].dimension).toBe('width');
    expect(result[0].percent).toBe(10);
    expect(result[0].bodyOnly).toBe(true);
    expect(pricebook.items.find((item) => item.id === result[0].itemId)?.name).toMatch(/ширину/i);
  });

  it('для ширины, не кратной 10 мм, предлагает правило +50%', () => {
    const body = byArticle('224', 'каркас ст');
    const module = newModule('Нижний шкаф');
    module.widthMm = 653;
    const result = inferDimensionSurcharges(module, body, pricebook);
    expect(result.find((item) => item.dimension === 'width')?.percent).toBe(50);
  });

  it('для навесного шкафа +20 мм высоты предлагает +10%', () => {
    const body = byArticle('32', 'каркас шк');
    const module = newModule('Верхний шкаф');
    module.widthMm = 300;
    module.heightMm = 740;
    module.depthMm = 300;
    const result = inferDimensionSurcharges(module, body, pricebook);
    expect(result).toHaveLength(1);
    expect(result[0].dimension).toBe('height');
    expect(result[0].percent).toBe(10);
  });

  it('для глубины +50 мм предлагает +10%', () => {
    const body = byArticle('224', 'каркас ст');
    const module = newModule('Нижний шкаф');
    module.widthMm = 600;
    module.heightMm = 720;
    module.depthMm = 610;
    const result = inferDimensionSurcharges(module, body, pricebook);
    expect(result.find((item) => item.dimension === 'depth')?.percent).toBe(10);
  });

  it('берёт стандартную глубину из типа корпуса, если её нет в названии прайса', () => {
    expect(nominalBodyDimensions(byArticle('224', 'каркас ст')).depthMm).toBe(560);
    expect(nominalBodyDimensions(byArticle('32', 'каркас шк')).depthMm).toBe(300);
    expect(nominalBodyDimensions(byName('Пенал с 2мя ящиками,2мя дверками')).depthMm).toBe(560);
  });

  it('процентная строка надбавки имеет базой корпус, а не фасады или фурнитуру', () => {
    const body = byArticle('224', 'каркас ст');
    const module = newModule('Нижний шкаф');
    module.widthMm = 650;
    module.heightMm = 720;
    module.depthMm = 560;
    const applied = applyDimensionSurcharges(module, body, pricebook);
    applied.slots.body = { mode: 'manual', itemId: body.id };
    const lines = moduleToLines(applied, {}, pricebook);
    const bodyLine = lines.find((line) => line.itemId === body.id)!;
    const surchargeLine = lines.find((line) => line.priceKind === 'percent')!;
    expect(surchargeLine.baseLineId).toBe(bodyLine.id);
    const { totals } = calcTotals(lines, defaultSettings());
    expect(totals.cost).toBe(3630); // 3300 + 10% от корпуса, без других строк
  });
});
