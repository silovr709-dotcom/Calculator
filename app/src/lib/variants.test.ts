import { describe, expect, it } from 'vitest';
import { createVariant, moduleForVariant, VARIANT_PRESETS } from './variants';
import { defaultSettings } from './storage';
import { newModule } from './modules';

describe('варианты расчёта', () => {
  it('создаёт три понятных пресета', () => {
    expect(VARIANT_PRESETS.map((preset) => preset.name)).toEqual(['Эконом', 'Стандарт', 'Премиум']);
    expect(createVariant('Эконом', 'test', defaultSettings()).slotOverrides).toEqual({});
  });

  it('переопределяет комплектацию только внутри варианта', () => {
    const module = newModule('Нижний шкаф');
    module.slots.handle = { mode: 'manual', itemId: 'old' };
    const variant = createVariant('Премиум', '', defaultSettings());
    variant.slotOverrides.handle = 'new';
    const changed = moduleForVariant(module, variant);
    expect(changed.slots.handle.itemId).toBe('new');
    expect(module.slots.handle.itemId).toBe('old');
  });
});
