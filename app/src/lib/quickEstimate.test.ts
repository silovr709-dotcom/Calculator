import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pricebook } from '../types';
import { calcTotals } from './engine';
import { defaultSettings } from './storage';
import { buildQuickEstimate, quickEstimateRange, type QuickEstimateInput } from './quickEstimate';

const here = dirname(fileURLToPath(import.meta.url));
const pb: Pricebook = JSON.parse(readFileSync(join(here, '../../public/data/pricebook-visma-2026.json'), 'utf8'));

const baseInput: QuickEstimateInput = {
  lowerLengthMm: 2400,
  upperLengthMm: 2400,
  upperHeightMm: 720,
  avgModuleWidthMm: 600,
  tallCount: 0,
  drawerCount: 2,
  worktopLengthMm: 2400,
  facadeTier: 'pvc-standard',
  worktopTier: 'postforming-38',
  hardwareTier: 'soft-close',
  includeHandles: true,
  includeLegs: true,
  includePlinth: true,
  includeDryer: true,
  includeSink: false,
  includeMixer: false,
};

describe('экспресс-оценка кухни', () => {
  it('собирает быстрый набор строк только из реальных позиций прайса', () => {
    const estimate = buildQuickEstimate(baseInput, pb);

    expect(estimate.missing).toEqual([]);
    expect(estimate.metrics.lowerModules).toBe(4);
    expect(estimate.metrics.upperModules).toBe(4);
    expect(estimate.metrics.lowerPlannedLengthMm).toBe(2400);
    expect(estimate.metrics.upperPlannedLengthMm).toBe(2400);
    expect(estimate.metrics.facadeAreaM2).toBeGreaterThan(3);
    expect(estimate.metrics.hingeCount).toBeLessThan(estimate.metrics.facadeCount * 2);
    expect(estimate.tolerancePct).toBeLessThanOrEqual(0.1);
    expect(estimate.lines.length).toBeGreaterThan(7);
    expect(estimate.lines.every((line) => pb.items.some((item) => item.id === line.itemId))).toBe(true);
    expect(estimate.lines.some((line) => line.category.startsWith('Фасады'))).toBe(true);
    expect(estimate.lines.some((line) => line.category.startsWith('Столешницы'))).toBe(true);

    const { totals } = calcTotals(estimate.lines, defaultSettings());
    expect(totals.cost).toBeGreaterThan(0);
    expect(totals.unpricedCount).toBe(0);
  });

  it('даёт коридор цены вокруг рассчитанной суммы', () => {
    const range = quickEstimateRange(100_000, 0.15);
    expect(range).toEqual({ low: 85_000, high: 115_000 });
  });

  it('не добавляет столешницу, если она отключена', () => {
    const estimate = buildQuickEstimate({ ...baseInput, worktopTier: 'none', worktopLengthMm: 0 }, pb);
    expect(estimate.lines.some((line) => line.category.startsWith('Столешницы'))).toBe(false);
    expect(estimate.tolerancePct).toBeGreaterThan(0.08);
  });

  it('подбирает постформинг хлыстом 600×3000, а не угловым куском 800×800', () => {
    const estimate = buildQuickEstimate({ ...baseInput, worktopTier: 'ms-38-cat1', worktopLengthMm: 2400 }, pb);
    const worktop = estimate.lines.find((line) => line.category === 'Столешницы: Мир Столешниц (постформинг)');
    expect(worktop).toBeTruthy();
    expect(worktop?.name).toMatch(/600\*3000/);
    expect(worktop?.name).not.toMatch(/800\*800/);
    expect(worktop?.qty).toBe(1);
  });

  it('подбирает категории разных производителей столешниц в экспресс-расчёте', () => {
    const soyuz = buildQuickEstimate({ ...baseInput, worktopTier: 'souz-38-premium-plus', worktopLengthMm: 2400 }, pb);
    const worktop = soyuz.lines.find((line) => line.category === 'Столешницы: СОЮЗ (постформинг)');
    expect(worktop?.name).toMatch(/600\*3000\*38/);
    expect(worktop?.name).toMatch(/Premium\+/);
  });

  it('подбирает компакт-плиту хлыстом, а не теряет длину формата 3.050/4.200', () => {
    const estimate = buildQuickEstimate({ ...baseInput, worktopTier: 'compact', worktopLengthMm: 3050 }, pb);
    const worktop = estimate.lines.find((line) => line.category.startsWith('Столешницы: компакт-плита'));
    expect(worktop).toBeTruthy();
    expect(worktop?.qty).toBe(1);
  });

  it('может включить мойку и смеситель в экспресс-комплект', () => {
    const estimate = buildQuickEstimate({ ...baseInput, includeSink: true, includeMixer: true }, pb);
    expect(estimate.lines.some((line) => line.category === 'Мойки')).toBe(true);
    expect(estimate.lines.some((line) => line.category === 'Смесители')).toBe(true);
  });

  it('умеет считать расширенные пресеты фасадов и основные уровни петель', () => {
    const rehau = buildQuickEstimate({ ...baseInput, facadeTier: 'plastic-agt-rehau-cat1', hardwareTier: 'titus-soft-close' }, pb);
    expect(rehau.missing).toEqual([]);
    expect(rehau.lines.some((line) => line.category === 'Фасады: Пластик (HPL)' && /AGT|пластик/i.test(line.name))).toBe(true);
    expect(rehau.lines.some((line) => line.category === 'Петли' && /Titus/i.test(line.name) && /110/.test(line.name) && /дов/i.test(line.name))).toBe(true);

    const premium = buildQuickEstimate({ ...baseInput, hardwareTier: 'blum-soft-close' }, pb);
    expect(premium.lines.some((line) => (line.category.includes('BLUM') || /Blum|Блюм/i.test(line.name)) && /110/.test(line.name) && /дов/i.test(line.name))).toBe(true);
  });

});
