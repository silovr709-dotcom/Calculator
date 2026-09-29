import { describe, expect, it } from 'vitest';
import { formatRemainder, suggestWallLayouts, type LayoutCandidate } from './layoutPlanner';

describe('раскладка кухни по длине стены', () => {
  const candidates: LayoutCandidate[] = [
    { id: 'a', name: 'Низ 600', widthMm: 600, availableQty: 1 },
    { id: 'b', name: 'Низ 800', widthMm: 800, availableQty: 1 },
    { id: 'c', name: 'Низ 400', widthMm: 400, availableQty: 2 },
  ];

  it('предлагает комбинации и показывает свободный остаток', () => {
    const plans = suggestWallLayouts('back', 1400, candidates, ['a']);
    expect(plans.length).toBeGreaterThan(0);
    expect(plans[0].items.find((item) => item.candidateId === 'a')?.count).toBe(1);
    expect(plans[0].usedWidthMm).toBeLessThanOrEqual(1400);
    expect(plans[0].freeMm).toBe(0);
  });

  it('не создаёт предложение, если обязательный модуль не помещается', () => {
    expect(suggestWallLayouts('back', 500, candidates, ['a'])).toEqual([]);
  });

  it('не меняет исходные кандидаты и форматирует остаток', () => {
    const before = JSON.stringify(candidates);
    suggestWallLayouts('back', 1000, candidates);
    expect(JSON.stringify(candidates)).toBe(before);
    expect(formatRemainder(0)).toBe('без остатка');
    expect(formatRemainder(120)).toBe('свободно 120 мм');
  });

  it('не подставляет модули с другой стены в комбинацию', () => {
    const side: LayoutCandidate = { id: 'd', name: 'Низ 500 (правая стена)', widthMm: 500, availableQty: 1, wall: 'right' };
    const plans = suggestWallLayouts('back', 1400, [...candidates, side], ['a']);
    expect(plans.every((plan) => plan.items.every((item) => item.candidateId !== 'd'))).toBe(true);
    const rightPlans = suggestWallLayouts('right', 1400, [...candidates, side]);
    expect(rightPlans.some((plan) => plan.items.some((item) => item.candidateId === 'd'))).toBe(true);
  });
});
