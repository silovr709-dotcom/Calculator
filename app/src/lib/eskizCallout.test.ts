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
