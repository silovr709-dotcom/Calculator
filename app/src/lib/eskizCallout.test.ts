import { describe, expect, it } from 'vitest';
import { calloutTargets, shiftCallout, type EskizCalloutObject } from './eskizPro';

const base: EskizCalloutObject = {
  id: 'c1', type: 'callout', x: 100, y: 100, color: '#000', fontSize: 16,
  targetX: 10, targetY: 20, text: 'Текст',
};

describe('выноска с несколькими линиями', () => {
  it('без дополнительных линий — одна цель', () => {
    expect(calloutTargets(base)).toEqual([{ x: 10, y: 20 }]);
  });

  it('дополнительные линии идут после основной', () => {
    const o = { ...base, extraTargets: [{ x: 50, y: 60 }, { x: 70, y: 80 }] };
    expect(calloutTargets(o)).toEqual([{ x: 10, y: 20 }, { x: 50, y: 60 }, { x: 70, y: 80 }]);
  });

  it('сдвиг выноски двигает все линии вместе', () => {
    const o: EskizCalloutObject = { ...base, extraTargets: [{ x: 50, y: 60 }] };
    shiftCallout(o, 5, -3);
    expect(o.targetX).toBe(15);
    expect(o.targetY).toBe(17);
    expect(o.extraTargets).toEqual([{ x: 55, y: 57 }]);
  });

  it('сдвиг не трогает исходный массив линий', () => {
    const extra = [{ x: 50, y: 60 }];
    const o: EskizCalloutObject = { ...base, extraTargets: extra };
    shiftCallout(o, 1, 1);
    expect(extra).toEqual([{ x: 50, y: 60 }]);
  });
});

describe('значение нового размера по калибровке', () => {
  it('без калибровки — 600 мм', async () => {
    const { dimensionDefaultValue } = await import('./eskizPro');
    expect(dimensionDefaultValue('horizontal', 0, 0, 300, 0)).toBe('600');
  });
  it('с калибровкой — длина отрезка в мм', async () => {
    const { dimensionDefaultValue } = await import('./eskizPro');
    expect(dimensionDefaultValue('horizontal', 0, 0, 300, 40, 2)).toBe('600');
    expect(dimensionDefaultValue('vertical', 0, 0, 40, 900, 0.5)).toBe('450');
    expect(dimensionDefaultValue('free', 0, 0, 30, 40, 1)).toBe('50');
  });
});

describe('точка выхода линий выноски', () => {
  it('по умолчанию — середина края, обращённого к цели', async () => {
    const { calloutAnchor } = await import('./eskizPro');
    const o: EskizCalloutObject = { ...base };
    expect(calloutAnchor(o, 200, 80, 10)).toEqual({ x: 100, y: 140, side: 'left' });
    expect(calloutAnchor(o, 200, 80, 500)).toEqual({ x: 300, y: 140, side: 'right' });
  });
  it('выбранная точка выхода сохраняется при перемещении выноски', async () => {
    const { calloutAnchor } = await import('./eskizPro');
    const o: EskizCalloutObject = { ...base, leaderStart: { side: 'top', t: 0.25 } };
    expect(calloutAnchor(o, 200, 80, 10)).toEqual({ x: 150, y: 100, side: 'top' });
    o.x += 30;
    o.y += 10;
    shiftCallout(o, 30, 10);
    expect(calloutAnchor(o, 200, 80, 10)).toEqual({ x: 180, y: 110, side: 'top' });
  });
  it('точка прилипает к ближайшей стороне рамки', async () => {
    const { nearestCalloutEdge } = await import('./eskizPro');
    expect(nearestCalloutEdge({ x: 100, y: 100 }, 200, 80, { x: 103, y: 130 })).toEqual({ side: 'left', t: 0.375 });
    expect(nearestCalloutEdge({ x: 100, y: 100 }, 200, 80, { x: 200, y: 98 })).toEqual({ side: 'top', t: 0.5 });
    expect(nearestCalloutEdge({ x: 100, y: 100 }, 200, 80, { x: 310, y: 140 })).toEqual({ side: 'right', t: 0.5 });
  });
  it('ломаная линии: цель → излом → точка выхода', async () => {
    const { calloutLeaderPoints } = await import('./eskizPro');
    expect(calloutLeaderPoints({ x: 100, y: 140, side: 'left' }, { x: 10, y: 20 })).toBe('10,20 82,140 100,140');
  });
});
