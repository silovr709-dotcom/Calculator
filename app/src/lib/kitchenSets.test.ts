import { describe, expect, it } from 'vitest';
import { KITCHEN_SETS, kitchenSetWallWidth, modulesFromKitchenSet } from './kitchenSets';
import { layoutWalls } from './kitchenSketch';
import { moduleStandsOnFloor } from './modules';

describe('готовые комплекты кухонь', () => {
  it('составы сходятся по стенам: прямые комплекты точно вписываются в длину', () => {
    const s24 = KITCHEN_SETS.find((s) => s.id === 'straight-2400')!;
    const s30 = KITCHEN_SETS.find((s) => s.id === 'straight-3000')!;
    const lower = (set: typeof s24) => set.modules.filter((m) => m.heightMm === 720 && m.depthMm === 560);
    expect(lower(s24).reduce((a, m) => a + m.widthMm, 0)).toBe(2400);
    expect(lower(s30).reduce((a, m) => a + m.widthMm, 0)).toBe(3000);
  });

  for (const set of KITCHEN_SETS) {
    it(`«${set.name}»: модули корректны`, () => {
      const modules = modulesFromKitchenSet(set);
      expect(modules).toHaveLength(set.modules.length);

      // уникальные id и осмысленные имена
      expect(new Set(modules.map((m) => m.id)).size).toBe(modules.length);
      expect(modules.every((m) => m.name.length > 0)).toBe(true);

      // каждая стена существует в планировке комплекта
      const walls = layoutWalls(set.shape);
      for (const m of modules) expect(walls).toContain(m.wall);

      // размеры заданы у всех, конструкция есть у всех (фасады/ящики/полки заданы)
      for (const m of modules) {
        expect(m.widthMm).toBeGreaterThan(0);
        expect(m.heightMm).toBeGreaterThan(0);
        expect(m.depthMm).toBeGreaterThan(0);
      }

      // стоящие модули получают 4 опоры, навесные — 0
      for (const m of modules) {
        expect(m.legs).toBe(moduleStandsOnFloor(m.type) ? 4 : 0);
      }

      // комплект НЕ навязывает корпус и материалы — их выбирает менеджер
      for (const m of modules) {
        expect(m.slots.body.itemId).toBeNull();
        expect(m.slots.facade.itemId).toBeNull();
      }
    });
  }

  it('пресетные ячейки наследуют конструкцию пресета, переопределения сильнее', () => {
    const s24 = KITCHEN_SETS.find((s) => s.id === 'straight-2400')!;
    const modules = modulesFromKitchenSet(s24);
    const sink = modules.find((m) => m.name === 'Шкаф под мойку')!;
    expect(sink.drawers).toBe(0);
    expect(sink.facades).toBe(2); // из пресета sink
    const narrow = modules.find((m) => m.name === 'Нижний шкаф узкий')!;
    expect(narrow.facades).toBe(1); // переопределение в комплекте
  });

  it('ширины по стенам считаются раздельно', () => {
    const l = KITCHEN_SETS.find((s) => s.id === 'l-2400-1800')!;
    const backLower = l.modules.filter((m) => m.wall === 'back' && m.depthMm === 560).reduce((a, m) => a + m.widthMm, 0);
    expect(backLower).toBe(2400);
    expect(kitchenSetWallWidth(l, 'left')).toBeGreaterThan(0);
  });
});
