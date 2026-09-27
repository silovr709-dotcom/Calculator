// Контрольные тесты режима «Расчёт проекта» (модули): ручная сверка с прайсом.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pricebook, ModuleDefaults } from '../types';
import { newModule, moduleToLines, checkModule, resolveSlot } from './modules';
import { calcTotals } from './engine';
import { defaultSettings } from './storage';

const here = dirname(fileURLToPath(import.meta.url));
const pb: Pricebook = JSON.parse(readFileSync(join(here, '../../public/data/pricebook-visma-2026.json'), 'utf-8'));

const byArt = (a: string, sheet: string) => pb.items.find((i) => i.article === a && i.source.sheet === sheet)!;
const byName = (part: string) => pb.items.find((i) => i.name.toLowerCase().includes(part.toLowerCase()))!;

const corpus224 = byArt('224', 'каркас ст');            // стол 2-х дверный 600 = 3300
const mdf16 = pb.items.find((i) => i.group === 'mdf_pvh' && i.attrs['категория']?.startsWith('1 категория')
  && i.attrs['толщина'] === '16мм' && i.name.includes('Квадратный метр'))!; // 3600/м²
const hinge = byName('Петля Боярд с дов. 90°');          // 170
const emal = pb.items.find((i) => i.group === 'emal' && i.priceBasis === 'm2' && i.price === 13500)!;

describe('модуль → строки расчёта', () => {
  it('нижний шкаф 600: корпус + 2 фасада МДФ + 4 петли (ручная сверка)', () => {
    const m = newModule('Нижний шкаф');
    m.widthMm = 600; m.heightMm = 720; m.depthMm = 560;
    m.facades = 2; m.hinges = 4; m.facadeWmm = 296; m.facadeHmm = 716;
    m.slots.body = { mode: 'manual', itemId: corpus224.id };
    const defaults: ModuleDefaults = { facade: mdf16.id, hinge: hinge.id };

    const lines = moduleToLines(m, defaults, pb);
    expect(lines).toHaveLength(3);
    const { totals } = calcTotals(lines, defaultSettings());
    // руками: 3300 + 2×0.296×0.716×3600 (=1525.9392→1525.94) + 4×170 = 5505.94
    expect(totals.cost).toBeCloseTo(3300 + 1525.94 + 680, 2);
  });

  it('ручной выбор фасада сильнее настройки проекта и переживает её смену', () => {
    const m = newModule('Нижний шкаф');
    m.facades = 2; m.facadeWmm = 296; m.facadeHmm = 716;
    m.slots.facade = { mode: 'manual', itemId: emal.id };
    let r = resolveSlot(m, 'facade', { facade: mdf16.id }, pb);
    expect(r.item!.id).toBe(emal.id);
    expect(r.source).toBe('manual');
    r = resolveSlot(m, 'facade', { facade: hinge.id /* смена настройки */ }, pb);
    expect(r.item!.id).toBe(emal.id); // ручное значение сохранилось
  });

  it('ничего не угадывается: без выбора — нет строк, есть критические ошибки', () => {
    const m = newModule('Пенал');
    m.facades = 2; m.drawers = 4; m.hinges = 4;
    const lines = moduleToLines(m, {}, pb);
    expect(lines).toHaveLength(0); // ни одной придуманной строки
    const c = checkModule(m, {}, pb);
    expect(c.level).toBe('error');
    expect(c.errors.join(' ')).toMatch(/корпус/i);
    expect(c.errors.join(' ')).toMatch(/фасад/i);
    expect(c.errors.join(' ')).toMatch(/выдвижения/i);
    expect(c.errors.join(' ')).toMatch(/петл/i);
  });

  it('позиция без фиксированной цены в слоте — критическая ошибка, сумма не выдумывается', () => {
    const unav = pb.items.find((i) => i.priceKind === 'unavailable' && i.category === 'Петли');
    if (!unav) return; // если в новой версии базы таких нет — тест не нужен
    const m = newModule('Нижний шкаф');
    m.slots.body = { mode: 'manual', itemId: corpus224.id };
    m.facades = 1; m.hinges = 2; m.facadeWmm = 596; m.facadeHmm = 716;
    const defaults: ModuleDefaults = { facade: mdf16.id, hinge: unav.id };
    const c = checkModule(m, defaults, pb);
    expect(c.level).toBe('error');
    const lines = moduleToLines(m, defaults, pb);
    expect(lines.some((l) => l.itemId === unav.id)).toBe(false);
  });
});
