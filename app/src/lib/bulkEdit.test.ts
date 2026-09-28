import { describe, expect, it } from 'vitest';
import { newModule } from './modules';
import { applyBulkModuleEdits, copyModuleValues } from './bulkEdit';

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
});
