// Контрольные тесты режима «Расчёт проекта» (модули): ручная сверка с прайсом.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pricebook, ModuleDefaults } from '../types';
import { newModule, moduleToLines, checkModule, resolveSlot, parseBodyDrawers, parseBodyDoors } from './modules';
import { calcTotals } from './engine';
import { defaultSettings } from './storage';

const here = dirname(fileURLToPath(import.meta.url));
const pb: Pricebook = JSON.parse(readFileSync(join(here, '../../public/data/pricebook-visma-2026.json'), 'utf-8'));

const byArt = (a: string, sheet: string) => pb.items.find((i) => i.article === a && i.source.sheet === sheet)!;
const byName = (part: string) => pb.items.find((i) => i.name.toLowerCase().includes(part.toLowerCase()))!;

const corpus224 = byArt('224', 'каркас ст');            // стол 2-х дверный 600 = 3300
const corpus228 = byArt('228', 'каркас ст');            // стол 1-но дверный с ящиком 300 = 2650
const corpus238 = byArt('238', 'каркас ст');            // стол с 2-мя ящиками 300 = 3200
const corpus246 = byArt('246', 'каркас ст');            // стол с 3-мя ящиками 300 = 3900
const corpus254 = byArt('254', 'каркас ст');            // стол с 4-мя ящиками 300 = 4600
const corpusWall1Door = byArt('32', 'каркас шк');       // шкаф настенный 1-но дверный Н=720 300 = 1800
const drawerSys = pb.items.find((i) => i.category === 'Системы выдвижения' && i.priceKind === 'fixed')!;

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

describe('процентные надбавки модуля', () => {
  it('нестандарт +10% считается от суммы корпуса', () => {
    const pct = pb.items.find((i) => i.priceKind === 'percent' && i.price === 10)!;
    const m = newModule('Нижний шкаф');
    m.slots.body = { mode: 'manual', itemId: corpus224.id };
    m.surcharges = [pct.id];
    const lines = moduleToLines(m, {}, pb);
    expect(lines).toHaveLength(2);
    const { totals } = calcTotals(lines, defaultSettings());
    expect(totals.cost).toBeCloseTo(3300 + 330, 2); // руками: 3300 × 10% = 330
  });

  it('надбавка без корпуса — критическая ошибка, ничего не считается', () => {
    const pct = pb.items.find((i) => i.priceKind === 'percent' && i.price === 10)!;
    const m = newModule('Нижний шкаф');
    m.surcharges = [pct.id];
    expect(moduleToLines(m, {}, pb)).toHaveLength(0);
    expect(checkModule(m, {}, pb).errors.join(' ')).toMatch(/корпус/i);
  });
});

describe('сверка названия корпуса с конструкцией модуля (ящики и фасады)', () => {
  it('парсинг количества ящиков из названия корпуса', () => {
    expect(parseBodyDrawers('Стол напольный с ящиком — 300мм')).toBe(1);
    expect(parseBodyDrawers('Стол напольный 1-но дверный с ящиком — 300мм')).toBe(1);
    expect(parseBodyDrawers('Стол напольный под ДШ с 1 ящиком — 600мм')).toBe(1);
    expect(parseBodyDrawers('Шкаф настенный 1-но дверный с ящ. Н=1282мм (буфет)')).toBe(1);
    expect(parseBodyDrawers('Стол напольный с 2-мя ящиками — 300мм')).toBe(2);
    expect(parseBodyDrawers('Стол напольный 2-х дверный с ящиками — 600мм')).toBe(2);
    expect(parseBodyDrawers('Пенал с 2мя ящиками,2мя дверками,под ДШ Н=2020мм')).toBe(2);
    expect(parseBodyDrawers('Стол напольный с 3-мя ящиками (180+180+360) — 300мм')).toBe(3);
    expect(parseBodyDrawers('Стол напольный с 4-мя ящиками — 300мм')).toBe(4);
    expect(parseBodyDrawers('Шкаф настенный 1-но дверный Н=720мм — 300мм')).toBeNull();
  });

  it('парсинг количества дверей/фасадов из названия корпуса', () => {
    expect(parseBodyDoors('Шкаф настенный 1-но дверный Н=720мм — 300мм')).toBe(1);
    expect(parseBodyDoors('Стол напольный 1-но дверный — 150мм')).toBe(1);
    expect(parseBodyDoors('Стол напольный 2-х дверный — 500мм')).toBe(2);
    expect(parseBodyDoors('Пенал с 2мя ящиками,2мя дверками,под ДШ')).toBe(2);
    expect(parseBodyDoors('Пенал с 2мя ящиками,1ой дверкой,под ДШ')).toBe(1);
    expect(parseBodyDoors('Пенал 4мя дверками . Н=2020 — 700мм')).toBe(4);
    expect(parseBodyDoors('Стол напольный с 2-мя ящиками — 300мм')).toBeNull();
  });

  it('предупреждение, если ящиков в конструкции меньше, чем в названии корпуса (2 ящика vs 0)', () => {
    const m = newModule('Нижний шкаф');
    m.widthMm = 300; m.heightMm = 720; m.depthMm = 560;
    m.slots.body = { mode: 'manual', itemId: corpus238.id }; // «Стол напольный с 2-мя ящиками — 300мм»
    m.drawers = 0; // в конструкции 0 ящиков

    const c = checkModule(m, {}, pb);
    expect(c.level).toBe('warn');
    expect(c.errors).toHaveLength(0);
    expect(c.warnings).toContain(
      'Корпус по названию — с 2 ящиками, а в конструкции указано 0. Если нужны системы выдвижения — укажите количество ящиков; если нет — подтвердите',
    );
  });

  it('предупреждение для формы «с ящиком» (1 ящик vs 0)', () => {
    const m = newModule('Нижний шкаф');
    m.widthMm = 300; m.heightMm = 720; m.depthMm = 560;
    m.slots.body = { mode: 'manual', itemId: corpus228.id }; // «Стол напольный 1-но дверный с ящиком — 300мм»
    m.drawers = 0;
    m.facades = 1; m.facadeWmm = 296; m.facadeHmm = 716; m.hinges = 2; m.handles = 1;
    const defaults: ModuleDefaults = { facade: mdf16.id, hinge: hinge.id, handle: hinge.id };

    const c = checkModule(m, defaults, pb);
    expect(c.level).toBe('warn');
    expect(c.warnings).toContain(
      'Корпус по названию — с 1 ящиком, а в конструкции указано 0. Если нужны системы выдвижения — укажите количество ящиков; если нет — подтвердите',
    );
  });

  it('предупреждение для 3-х ящиков при частичном указании (3 ящика vs 1)', () => {
    const m = newModule('Нижний шкаф');
    m.widthMm = 300; m.heightMm = 720; m.depthMm = 560;
    m.slots.body = { mode: 'manual', itemId: corpus246.id }; // «Стол напольный с 3-мя ящиками (180+180+360) — 300мм»
    m.drawers = 1;
    m.slots.drawerSys = { mode: 'manual', itemId: drawerSys.id };

    const c = checkModule(m, {}, pb);
    expect(c.level).toBe('warn');
    expect(c.warnings).toContain(
      'Корпус по названию — с 3 ящиками, а в конструкции указано 1. Если нужны системы выдвижения — укажите количество ящиков; если нет — подтвердите',
    );
  });

  it('предупреждение, если фасадов меньше, чем указано в названии (1-но дверный vs 0 фасадов)', () => {
    const m = newModule('Верхний шкаф');
    m.widthMm = 300; m.heightMm = 720; m.depthMm = 300;
    m.slots.body = { mode: 'manual', itemId: corpusWall1Door.id }; // «Шкаф настенный 1-но дверный Н=720мм — 300мм»
    m.facades = 0;

    const c = checkModule(m, {}, pb);
    expect(c.level).toBe('warn');
    expect(c.warnings).toContain('Фасады в цену каркаса не входят — укажите количество, либо подтвердите');
  });

  it('предупреждение для 2-х дверного шкафа при 0 или 1 фасаде', () => {
    const m = newModule('Нижний шкаф');
    m.widthMm = 600; m.heightMm = 720; m.depthMm = 560;
    m.slots.body = { mode: 'manual', itemId: corpus224.id }; // «Стол напольный 2-х дверный — 600мм»
    m.facades = 1; m.facadeWmm = 596; m.facadeHmm = 716; m.hinges = 2; m.handles = 1;
    const defaults: ModuleDefaults = { facade: mdf16.id, hinge: hinge.id, handle: hinge.id };

    const c = checkModule(m, defaults, pb);
    expect(c.level).toBe('warn');
    expect(c.warnings).toContain('Фасады в цену каркаса не входят — укажите количество, либо подтвердите');
  });

  it('нет предупреждений, когда количество ящиков и фасадов совпадает с названием каркаса', () => {
    const m = newModule('Нижний шкаф');
    m.widthMm = 300; m.heightMm = 720; m.depthMm = 560;
    m.slots.body = { mode: 'manual', itemId: corpus238.id }; // «Стол напольный с 2-мя ящиками — 300мм»
    m.drawers = 2;
    m.slots.drawerSys = { mode: 'manual', itemId: drawerSys.id };

    const c = checkModule(m, {}, pb);
    expect(c.warnings.some((w) => w.includes('Корпус по названию'))).toBe(false);
    expect(c.warnings.some((w) => w.includes('Фасады в цену каркаса не входят'))).toBe(false);
  });

  it('только предупреждение: без автоподстановки, поля модуля не изменяются', () => {
    const m = newModule('Нижний шкаф');
    m.widthMm = 300; m.heightMm = 720; m.depthMm = 560;
    m.slots.body = { mode: 'manual', itemId: corpus254.id }; // «Стол напольный с 4-мя ящиками — 300мм»
    m.drawers = 0;
    m.facades = 0;

    const beforeDrawers = m.drawers;
    const beforeFacades = m.facades;

    const c = checkModule(m, {}, pb);
    expect(c.warnings).toContain(
      'Корпус по названию — с 4 ящиками, а в конструкции указано 0. Если нужны системы выдвижения — укажите количество ящиков; если нет — подтвердите',
    );
    expect(m.drawers).toBe(beforeDrawers); // не изменилось на 4
    expect(m.facades).toBe(beforeFacades);
  });
});

