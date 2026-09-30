import { describe, expect, it } from 'vitest';
import type { LineCalc, ProjectLine } from '../types';
import { roundClientPrice } from './engine';
import { buildClientOfferDetails, moduleLinePrefix, moduleNoteMatches, stripModuleNote } from './clientOffer';

const line = (patch: Partial<ProjectLine>): ProjectLine => ({
  id: patch.id ?? 'ln',
  itemId: patch.itemId ?? 'item',
  pricebookId: 'pb',
  category: patch.category ?? 'Фасады: МДФ ПВХ',
  group: patch.group ?? 'Фасады',
  name: patch.name ?? 'МДФ ПВХ 1 категория',
  article: null,
  unit: patch.unit ?? 'м²',
  priceKind: patch.priceKind ?? 'fixed',
  price: patch.price ?? 1000,
  priceBasis: patch.priceBasis ?? 'm2',
  priceGroup: null,
  qty: patch.qty ?? 1,
  params: patch.params ?? {},
  baseLineId: null,
  note: patch.note,
});

const calc = (lineId: string, qtyEffective: number, clientSum: number | null): LineCalc => ({
  lineId,
  qtyEffective,
  sum: clientSum,
  clientSum,
  markupPct: null,
});

describe('клиентская цена', () => {
  it('округляет вверх до выбранного шага и не меняет точную цену', () => {
    expect(roundClientPrice(1234.01, 1)).toBe(1234.01);
    expect(roundClientPrice(1234.01, 10)).toBe(1240);
    expect(roundClientPrice(1234.01, 100)).toBe(1300);
    expect(roundClientPrice(1234.01, 1000)).toBe(2000);
  });
});

describe('детализация КП клиента', () => {
  it('прячет служебный тег модуля и оставляет клиентскую детализацию', () => {
    const prefix = moduleLinePrefix('Низ 800', 'mod_1');
    expect(stripModuleNote(prefix)).toBe('');
    expect(stripModuleNote(`${prefix} — Фасад двери 1: 396×716 мм`)).toBe('Фасад двери 1: 396×716 мм');
    expect(moduleNoteMatches(`${prefix} — 4 петли`, 'Низ 800', 'mod_1')).toBe(true);
    expect(moduleNoteMatches('Модуль: Низ 800 — 4 петли', 'Низ 800', 'mod_1')).toBe(true);
  });

  it('схлопывает одинаковые фасады в одну компактную строку с количеством деталей и м²', () => {
    const lines = [
      line({ id: 'f1', itemId: 'facade-a', qty: 1, params: { widthMm: 396, heightMm: 716 }, note: 'Модуль: Низ 800 [mod_1] — Фасад двери 1: 396×716 мм' }),
      line({ id: 'f2', itemId: 'facade-a', qty: 1, params: { widthMm: 396, heightMm: 716 }, note: 'Модуль: Низ 800 [mod_1] — Фасад двери 2: 396×716 мм' }),
      line({ id: 'h1', itemId: 'hinge-a', category: 'Петли', group: 'Фурнитура', name: 'Петля Boyard', unit: 'шт', priceBasis: 'unit', qty: 4, note: 'Модуль: Низ 800 [mod_1] — 4 петли' }),
    ];
    const lineCalcs = new Map([
      ['f1', calc('f1', 0.283536, 1000)],
      ['f2', calc('f2', 0.283536, 1000)],
      ['h1', calc('h1', 4, 680)],
    ]);

    const details = buildClientOfferDetails(lines, lineCalcs);
    expect(details).toHaveLength(2);
    expect(details[0].kindLabel).toBe('Фасады');
    expect(details[0].qty).toBe(2);
    expect(details[0].qtyEffective).toBeCloseTo(0.567072, 6);
    expect(details[0].clientSum).toBe(2000);
    expect(details[0].details).toEqual(['Фасад двери 1: 396×716 мм', 'Фасад двери 2: 396×716 мм']);
    expect(details[1].kindLabel).toBe('Петли');
    expect(details[1].qty).toBe(4);
  });
});
