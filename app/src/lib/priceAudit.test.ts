import { describe, expect, it } from 'vitest';
import { auditSummary, auditToTsv, buildAuditRows, groupAuditRows } from './priceAudit';
import type { LineCalc, Pricebook, ProjectLine, Totals } from '../types';

const line = (patch: Partial<ProjectLine>): ProjectLine => ({
  id: 'l1', itemId: 'i1', pricebookId: 'pb', category: 'Корпус', group: 'Корпуса',
  name: 'ЛДСП 16 мм', article: 'A-1', unit: 'м²', priceKind: 'area', price: 1000,
  priceBasis: 'area', priceGroup: null, qty: 2, params: {}, ...patch,
} as ProjectLine);

const calc = (patch: Partial<LineCalc>): LineCalc => ({ lineId: 'l1', qtyEffective: 2, sum: 2000, clientSum: 3000, markupPct: 50, ...patch });

const pricebook = { meta: { id: 'pb' }, items: [{ id: 'i1', price: 1000 }] } as unknown as Pricebook;

describe('проверка цен', () => {
  it('считает опт, розницу и маржу по строке', () => {
    const [row] = buildAuditRows([line({})], new Map([['l1', calc({})]]), pricebook);
    expect(row.unitCost).toBe(1000);
    expect(row.unitClient).toBe(1500);
    expect(row.marginRub).toBe(1000);
    expect(row.marginPct).toBeCloseTo(33.33, 1);
    expect(row.flags).toEqual([]);
  });

  it('ловит позицию без цены', () => {
    const [row] = buildAuditRows([line({ price: null })], new Map([['l1', calc({ sum: null, clientSum: null })]]), pricebook);
    expect(row.flags).toContain('no-price');
  });

  it('ловит продажу дешевле закупки', () => {
    const [row] = buildAuditRows([line({})], new Map([['l1', calc({ clientSum: 1500 })]]), pricebook);
    expect(row.flags).toContain('negative-margin');
  });

  it('предупреждает о маленькой марже', () => {
    const [row] = buildAuditRows([line({})], new Map([['l1', calc({ clientSum: 2100 })]]), pricebook);
    expect(row.flags).toContain('low-margin');
  });

  it('видит расхождение снимка цены с прайсом', () => {
    const [row] = buildAuditRows([line({ price: 900 })], new Map([['l1', calc({})]]), pricebook);
    expect(row.flags).toContain('price-changed');
    expect(row.pricebookPrice).toBe(1000);
  });

  it('помечает позицию, которой нет в прайсе', () => {
    const [row] = buildAuditRows([line({ itemId: 'нет-такой' })], new Map([['l1', calc({})]]), pricebook);
    expect(row.flags).toContain('not-in-pricebook');
  });

  it('группирует и считает итоги по группам', () => {
    const rows = buildAuditRows(
      [line({}), line({ id: 'l2', group: 'Фасады' })],
      new Map([['l1', calc({})], ['l2', calc({ lineId: 'l2', sum: 5000, clientSum: 9000 })]]),
      pricebook,
    );
    const groups = groupAuditRows(rows);
    expect(groups[0].group).toBe('Фасады');
    expect(groups[0].marginRub).toBe(4000);
  });

  it('сверяет сумму строк с итогом проекта', () => {
    const rows = buildAuditRows([line({})], new Map([['l1', calc({})]]), pricebook);
    const ok = auditSummary(rows, { costLines: 2000, emalAdjustment: null } as Totals);
    expect(ok.totalsMatch).toBe(true);
    const broken = auditSummary(rows, { costLines: 2500, emalAdjustment: null } as Totals);
    expect(broken.totalsMatch).toBe(false);
    expect(broken.difference).toBe(500);
  });

  it('учитывает правило эмали при сверке', () => {
    const rows = buildAuditRows([line({})], new Map([['l1', calc({})]]), pricebook);
    const result = auditSummary(rows, { costLines: 2600, emalAdjustment: { applied: true, area: 0.5, amount: 600 } } as Totals);
    expect(result.totalsMatch).toBe(true);
  });

  it('выгружает таблицу для Excel', () => {
    const rows = buildAuditRows([line({})], new Map([['l1', calc({})]]), pricebook);
    const tsv = auditToTsv(rows);
    expect(tsv.split('\n')).toHaveLength(2);
    expect(tsv).toContain('Опт за ед.');
    expect(tsv).toContain('ЛДСП 16 мм');
  });
});
