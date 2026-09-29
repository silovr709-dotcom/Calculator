import { describe, expect, it } from 'vitest';
import { newModule } from './modules';
import { applyBulkModuleEdits, copyModuleValues, fillFromAbove } from './bulkEdit';

describe('массовое редактирование модулей', () => {
  it('меняет только выбранные поля и позиции', () => {
    const a = newModule('A');
    const b = newModule('B');
    const c = newModule('C');
    const result = applyBulkModuleEdits([a, b, c], [a.id, c.id], { widthMm: 800, wall: 'left' });
    expect(result[0].widthMm).toBe(800);
    expect(result[1]).toBe(b);
    expect(result[2].wall).toBe('left');
    expect(result[0].heightMm).toBeNull();
  });

  it('помечает технические фасады устаревшими после изменения габаритов', () => {
    const module = newModule('A');
    module.facadeSpecStatus = 'applied';
    module.widthMm = 600;
    const result = applyBulkModuleEdits([module], [module.id], { widthMm: 650 });
    expect(result[0].facadeSpecStatus).toBe('outdated');
  });

  it('копирует manual комплектацию как явное значение', () => {
    const source = newModule('A');
    source.widthMm = 600;
    source.slots.handle = { mode: 'manual', itemId: 'handle-1' };
    const patch = copyModuleValues(source);
    expect(patch.widthMm).toBe(600);
    expect(patch.slots?.handle).toBe('handle-1');
    expect(patch.slots?.facade).toBeNull();
  });

  it('копирует отдельные фасадные детали и надбавки только выбранным, без общих ссылок', () => {
    const source = newModule('Пенал');
    source.extraFacadeParts = [{ widthMm: 596, heightMm: 2100, qty: 1, kind: 'panel', label: 'Боковина', source: 'manual' }];
    source.surcharges = ['surcharge-10'];
    const target = newModule('Шкаф');
    const other = newModule('Тумба');
    const result = applyBulkModuleEdits([source, target, other], [target.id], copyModuleValues(source));
    expect(result[1].extraFacadeParts).toEqual(source.extraFacadeParts);
    expect(result[1].surcharges).toEqual(['surcharge-10']);
    expect(result[2].extraFacadeParts).toBeUndefined();
    // глубокое копирование: изменение копии не трогает источник
    result[1].extraFacadeParts![0].widthMm = 400;
    expect(source.extraFacadeParts![0].widthMm).toBe(596);
    expect(result[0]).toBe(source);
  });

  it('отдельные детали можно снять массово пустым списком', () => {
    const target = newModule('Шкаф');
    target.extraFacadeParts = [{ widthMm: 596, heightMm: 2100, qty: 1, kind: 'panel', label: 'Боковина', source: 'manual' }];
    const result = applyBulkModuleEdits([target], [target.id], { extraFacadeParts: [] });
    expect(result[0].extraFacadeParts).toEqual([]);
  });
});

describe('Ctrl+D: заполнить как у верхней позиции', () => {
  it('копирует высоту, глубину, опоры и слоты, но не ширину/фасады', () => {
    const source = newModule('Нижний шкаф');
    source.heightMm = 720; source.depthMm = 560; source.legs = 4;
    source.widthMm = 800; source.facades = 2;
    source.slots.hinge = { mode: 'manual', itemId: 'h-1' };
    const target = newModule('Верхний шкаф');
    target.heightMm = 720; target.depthMm = 320; target.legs = 0;
    target.widthMm = 450; target.facades = 1;
    const other = newModule('Пенал');

    const { modules, changed, sourceName } = fillFromAbove([source, target, other], [target.id]);
    expect(changed).toBe(1);
    expect(sourceName).toBe('Нижний шкаф');
    const updated = modules[1];
    expect(updated.heightMm).toBe(720);
    expect(updated.depthMm).toBe(560);
    expect(updated.legs).toBe(4);
    expect(updated.slots.hinge.itemId).toBe('h-1');
    expect(updated.widthMm).toBe(450);   // ширина не трогается
    expect(updated.facades).toBe(1);     // фасады не трогаются
    expect(modules[2]).toBe(other);      // невыбранные не меняются
  });

  it('не работает, если над первым выбранным нет позиции или сама позиция выбрана', () => {
    const a = newModule('A');
    const b = newModule('B');
    expect(fillFromAbove([a, b], [a.id]).changed).toBe(0);
    expect(fillFromAbove([a, b], [a.id, b.id]).changed).toBe(0);
    expect(fillFromAbove([a, b], []).changed).toBe(0);
  });
});
