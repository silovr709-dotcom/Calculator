import { describe, expect, it } from 'vitest';
import { FACADE_DEFAULT_COLOR, facadeInkColor, facadeMarkerRadius, type EskizFacadeObject, type EskizProject } from './eskizPro';
import { buildEskizSketchSvg } from './eskizSketchExport';

const base: EskizProject = {
  version: 1,
  id: 'eskiz-f',
  title: 'Фасады',
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
  image: { dataUrl: 'data:image/png;base64,AAA=', width: 800, height: 500, name: 'plan.png' },
  objects: [],
} as unknown as EskizProject;

describe('метка фасада (цифра в кружочке)', () => {
  it('радиус растёт с размером текста, но остаётся в разумных границах', () => {
    expect(facadeMarkerRadius(undefined)).toBeGreaterThan(12);
    expect(facadeMarkerRadius(4)).toBe(5);
    expect(facadeMarkerRadius(22)).toBeCloseTo(17.6);
    expect(facadeMarkerRadius(200)).toBe(30);
  });

  it('попадает в выгрузку SVG с номером и цветом по умолчанию', () => {
    const facade: EskizFacadeObject = { id: 'f1', type: 'facade', number: 3, x: 120, y: 80, color: FACADE_DEFAULT_COLOR, fontSize: 22 } as unknown as EskizFacadeObject;
    const svg = buildEskizSketchSvg({ ...base, objects: [facade] } as EskizProject, { moduleMarkerMode: 'full' });
    expect(svg).toContain('class="facade"');
    expect(svg).toContain('translate(120 80)');
    expect(svg).toContain('>3</text>');
    expect(svg).toContain(FACADE_DEFAULT_COLOR);
  });
});

describe('цвет цифры фасада', () => {
  it('на светлой заливке цифра тёмная, на тёмной — белая', () => {
    expect(facadeInkColor('#ffffff')).toBe('#1f2937');
    expect(facadeInkColor('#ffff00')).toBe('#1f2937');
    expect(facadeInkColor('#7c3aed')).toBe('#fff');
    expect(facadeInkColor('#1f2937')).toBe('#fff');
    expect(facadeInkColor(undefined)).toBe('#fff');
  });
  it('экспорт PNG/SVG: белая заливка даёт тёмную цифру и обводку', () => {
    const facade: EskizFacadeObject = { id: 'f1', type: 'facade', number: 3, x: 50, y: 50, fontSize: 22, color: '#ffffff' } as EskizFacadeObject;
    const svg = buildEskizSketchSvg({ ...base, objects: [facade] } as EskizProject);
    expect(svg).toContain('fill="#1f2937"');
    expect(svg).not.toMatch(/fill="#fff"[^>]*>3</);
  });
});
