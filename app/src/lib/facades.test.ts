import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pricebook } from '../types';
import { newModule, moduleToLines } from './modules';
import { applyTechnicalFacadeSpec, inferFacadeSpec, inferHingeSpec, isTechnicalFacadeSpecOutdated, isTechnicalHingeSpecOutdated } from './facades';

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
      ['drawer', 296, 176], ['door', 296, 536],
    ]);
  });

  it('для стола 2 двери + ящик не делает все фасады полноширинными', () => {
    const result = inferFacadeSpec(newModule('Нижний шкаф'), body('261'))!;
    expect(result.parts.map((part) => [part.kind, part.widthMm, part.heightMm])).toEqual([
      ['drawer', 596, 176], ['door', 296, 536], ['door', 296, 536],
    ]);
  });

  it('уважает ручное количество фасадов в Эскиз PRO при пересчёте рекомендации', () => {
    const module = { ...newModule('Нижний шкаф'), facades: 1, drawers: 0, facadeSpecStatus: 'manual' as const };
    const result = inferFacadeSpec(module, body('224'))!;
    expect(result.confidence).toBe('suggestion');
    expect(result.parts.map((part) => [part.kind, part.widthMm, part.heightMm])).toEqual([
      ['door', 596, 716],
    ]);
  });

  it('для стола с 3 ящиками сохраняет ширину всех фасадов и техническую разбивку 176+176+356', () => {
    const result = inferFacadeSpec(newModule('Нижний шкаф'), body('251'))!;
    expect(result.parts.map((part) => [part.widthMm, part.heightMm, part.kind])).toEqual([
      [596, 176, 'drawer'], [596, 176, 'drawer'], [596, 356, 'drawer'],
    ]);
    expect(result.confidence).toBe('exact');
  });

  it('для стола с 2 ящиками 500 мм не делит ширину между ящиками', () => {
    const result = inferFacadeSpec(newModule('Нижний шкаф'), body('242'))!;
    expect(result.parts.map((part) => [part.widthMm, part.heightMm, part.kind])).toEqual([
      [496, 356, 'drawer'], [496, 356, 'drawer'],
    ]);
  });

  it('для нестандартной высоты пересчитывает нижний фасад и помечает рекомендацию', () => {
    const result = inferFacadeSpec({ ...newModule('Нижний шкаф'), heightMm: 800 }, body('251'))!;
    expect(result.parts.map((part) => part.heightMm)).toEqual([176, 176, 436]);
    expect(result.confidence).toBe('suggestion');
  });

  it('для пенала 4 двери не делит ширину фасада на все 4 створки подряд', () => {
    const result = inferFacadeSpec(newModule('Пенал'), body('302'))!;
    expect(result.confidence).toBe('suggestion');
    expect(result.parts.map((part) => [part.widthMm, part.heightMm, part.kind])).toEqual([
      [346, 1006, 'door'], [346, 1006, 'door'], [346, 1006, 'door'], [346, 1006, 'door'],
    ]);
  });

  it('видит устаревшую техническую разбивку даже без статуса outdated', () => {
    const applied = applyTechnicalFacadeSpec(newModule('Нижний шкаф'), body('251'));
    const changed = { ...applied, widthMm: 650, facadeSpecStatus: undefined };
    expect(isTechnicalFacadeSpecOutdated(changed, body('251'))).toBe(true);
    expect(isTechnicalFacadeSpecOutdated(applied, body('251'))).toBe(false);
    const refreshed = applyTechnicalFacadeSpec(changed, body('251'));
    expect(refreshed.facadeParts?.map((part) => part.widthMm)).toEqual([646, 646, 646]);
    expect(refreshed.facadeSpecStatus).toBe('applied');
  });

  it('ручную разбивку не помечает устаревшей автоматически', () => {
    const manual = { ...applyTechnicalFacadeSpec(newModule('Нижний шкаф'), body('251')), widthMm: 650, facadeSpecStatus: 'manual' as const };
    expect(isTechnicalFacadeSpecOutdated(manual, body('251'))).toBe(false);
  });

  it('рассчитывает 2 петли на каждую дверь высотой до 900 мм', () => {
    const result = inferHingeSpec(newModule('Нижний шкаф'), body('224'))!;
    expect(result.perDoor).toEqual([2, 2]);
    expect(result.hinges).toBe(4);
    expect(result.confidence).toBe('exact');
  });

  it('пересчитывает петли для каждой двери по высоте фасада', () => {
    const standard = inferHingeSpec(newModule('Нижний шкаф'), body('224'))!;
    const tall = inferHingeSpec({ ...newModule('Нижний шкаф'), heightMm: 1000 }, body('224'))!;
    expect(standard.perDoor).toEqual([2, 2]);
    expect(standard.hinges).toBe(4);
    expect(tall.perDoor).toEqual([3, 3]);
    expect(tall.hinges).toBe(6);
  });

  it('использует вручную заданное количество фасадов для рекомендации петель', () => {
    const module = { ...newModule('Нижний шкаф'), facades: 2, facadeWmm: 296, facadeHmm: 1000, facadeSpecStatus: 'recommended' as const };
    const result = inferHingeSpec(module, body('224'))!;
    expect(result.perDoor).toEqual([3, 3]);
    expect(result.hinges).toBe(6);
  });

  it('находит устаревшее количество петель без явного статуса', () => {
    const module = { ...applyTechnicalFacadeSpec(newModule('Нижний шкаф'), body('224')), heightMm: 1000, hingeSpecStatus: undefined };
    expect(isTechnicalHingeSpecOutdated(module, body('224'))).toBe(true);
    expect(isTechnicalHingeSpecOutdated({ ...module, hinges: 6 }, body('224'))).toBe(false);
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
    expect(module.hinges).toBe(4);
    expect(module.hingeSpecStatus).toBe('applied');
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
