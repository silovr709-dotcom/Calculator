import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pricebook } from '../types';
import { newModule, moduleToLines } from './modules';
import { applyTechnicalFacadeSpec, inferFacadeSpec, inferHingeSpec } from './facades';

const here = dirname(fileURLToPath(import.meta.url));
const pb: Pricebook = JSON.parse(readFileSync(join(here, '../../public/data/pricebook-visma-2026.json'), 'utf8'));
const body = (article: string) => pb.items.find((item) => item.article === article && item.source.sheet === 'каркас ст')!;

describe('размеры фасадов по техничке Висмы', () => {
  it('для стола 2-х дверного 600 автоматически получает 2 фасада 296×716', () => {
    const module = newModule('Нижний шкаф');
    const result = inferFacadeSpec(module, body('224'))!;
    expect(result.facades).toBe(2);
    expect(result.confidence).toBe('exact');
    expect(result.parts).toEqual([
      { widthMm: 296, heightMm: 716, kind: 'door', source: 'technical' },
      { widthMm: 296, heightMm: 716, kind: 'door', source: 'technical' },
    ]);
  });

  it('для стола с 1 ящиком и дверью использует разбивку 176+536', () => {
    const module = newModule('Нижний шкаф');
    const result = inferFacadeSpec(module, body('228'))!;
    expect(result.parts.map((part) => [part.kind, part.widthMm, part.heightMm])).toEqual([
      ['drawer', 146, 176], ['door', 146, 536],
    ]);
  });

  it('рассчитывает 2 петли на каждую дверь высотой до 900 мм', () => {
    const result = inferHingeSpec(newModule('Нижний шкаф'), body('224'))!;
    expect(result.perDoor).toEqual([2, 2]);
    expect(result.hinges).toBe(4);
    expect(result.confidence).toBe('exact');
  });

  it('не затирает ручное количество петель при применении технической схемы', () => {
    const module = { ...newModule('Нижний шкаф'), hinges: 3, hingeSpecStatus: 'manual' as const };
    const result = applyTechnicalFacadeSpec(module, body('224'));
    expect(result.hinges).toBe(3);
    expect(result.hingeSpecStatus).toBe('manual');
  });

  it('для старого ручного фасада использует сохранённую высоту при рекомендации петель', () => {
    const module = { ...newModule('Нижний шкаф'), facades: 1, facadeWmm: 296, facadeHmm: 1200, facadeSpecStatus: 'manual' as const };
    const result = inferHingeSpec(module, body('224'))!;
    expect(result.perDoor).toEqual([3]);
  });

  it('при заполнении новой позиции подтягиваются и габариты корпуса, и фасады', () => {
    const module = applyTechnicalFacadeSpec(newModule('Нижний шкаф'), body('224'));
    expect(module.widthMm).toBe(600);
    expect(module.heightMm).toBe(720);
    expect(module.facades).toBe(2);
    expect(module.drawers).toBe(0);
    expect(module.facadeParts?.map((part) => `${part.widthMm}×${part.heightMm}`)).toEqual(['296×716', '296×716']);
  });

  it('для корпуса с ящиком заполняется и конструктивное число ящиков', () => {
    const module = applyTechnicalFacadeSpec(newModule('Нижний шкаф'), body('228'));
    expect(module.drawers).toBe(1);
    expect(module.facadeParts?.map((part) => part.kind)).toEqual(['drawer', 'door']);
  });

  it('явное обновление после изменения ширины пересчитывает ширину фасадов', () => {
    const module = applyTechnicalFacadeSpec({ ...newModule('Нижний шкаф'), widthMm: 650, facadeSpecStatus: 'outdated' }, body('224'), true);
    expect(module.facadeSpecStatus).toBe('applied');
    expect(module.facadeParts?.map((part) => part.widthMm)).toEqual([321, 321]);
  });

  it('разные размеры фасадов считаются отдельными строками площади', () => {
    const module = applyTechnicalFacadeSpec(newModule('Нижний шкаф'), body('228'));
    const facade = pb.items.find((item) => item.priceBasis === 'm2' && item.priceKind === 'fixed')!;
    const lines = moduleToLines({ ...module, slots: { ...module.slots, facade: { mode: 'manual', itemId: facade.id }, body: { mode: 'manual', itemId: null } } }, {}, pb);
    expect(lines.filter((line) => line.note?.includes('Фасад')).map((line) => line.params.heightMm)).toEqual([176, 536]);
  });
});
