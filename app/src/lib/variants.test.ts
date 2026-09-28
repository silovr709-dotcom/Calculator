import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pricebook, Project, ProjectLine } from '../types';
import { calculateVariant, createVariant, linesForVariant, moduleForVariant, VARIANT_PRESETS } from './variants';
import { defaultSettings } from './storage';
import { lineFromItem } from './engine';
import { lineMatchesChecklistKey } from './checklist';
import { newModule } from './modules';

const here = dirname(fileURLToPath(import.meta.url));
const pb: Pricebook = JSON.parse(readFileSync(join(here, '../../public/data/pricebook-visma-2026.json'), 'utf-8'));

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

describe('варианты: столешница и стеновая панель', () => {
  const projectWithWorktop = (lines: ProjectLine[]): Project => ({
    id: 'p1', name: 'Тест', client: '', date: '2026-09-29', comment: '', status: 'draft',
    pricebookId: 'visma-2026', pricebookName: '', lines, settings: defaultSettings(),
    modules: [], createdAt: '2026-09-29', updatedAt: '2026-09-29',
  });

  it('переопределение столешницы меняет позицию, но сохраняет количество и параметры', () => {
    const worktops = pb.items.filter((i) => i.category.startsWith('Столешницы:') && !i.category.includes('комплектующие') && i.name.includes('Столешница 600*3000'));
    const [worktop, premium] = worktops; // две разные столешницы из прайса
    expect(worktops.length).toBeGreaterThanOrEqual(2);
    expect(worktop.id).not.toBe(premium.id);
    // обе позиции действительно распознаются как столешница чек-листом
    expect(lineMatchesChecklistKey('worktop', lineFromItem(worktop, 'visma-2026', 1))).toBe(true);
    const line = lineFromItem(worktop, 'visma-2026', 2, { lengthMm: 2600 });
    const project = projectWithWorktop([line]);

    const variant = createVariant('Премиум', '', defaultSettings());
    variant.surfaceOverrides = { worktop: premium.id };
    const swapped = linesForVariant(project, pb, variant);
    expect(swapped).toHaveLength(1);
    expect(swapped[0].itemId).toBe(premium.id);
    expect(swapped[0].qty).toBe(2);
    expect(swapped[0].params.lengthMm).toBe(2600);
    // исходная строка не тронута
    expect(project.lines[0].itemId).toBe(worktop.id);

    const without = calculateVariant(project, pb, createVariant('Эконом', '', defaultSettings()));
    const withSwap = calculateVariant(project, pb, variant);
    expect(withSwap.totals.cost).not.toBe(without.totals.cost);
  });

  it('переопределение не трогает чужие строки (стеновая ≠ столешница) и отсутствует без переопределения', () => {
    const worktop = pb.items.find((i) => i.category.startsWith('Столешницы:') && !i.category.includes('комплектующие') && !i.name.toLowerCase().includes('стеновая панель') && !/панель.*\*4|\*4.*панель/i.test(i.name))!;
    const wallPanel = pb.items.find((i) => i.name.toLowerCase().includes('стеновая панель') || /панель.*\*4|\*4.*панель/i.test(i.name))!;
    const variant = createVariant('Эконом', '', defaultSettings());
    variant.surfaceOverrides = { wallPanel: wallPanel.id };

    const worktopLine = lineFromItem(worktop, 'visma-2026', 1);
    const project = projectWithWorktop([worktopLine]);
    const swapped = linesForVariant(project, pb, variant);
    // столешница не совпадает с ключом стеновой — остаётся исходной
    expect(swapped[0].itemId).toBe(worktop.id);

    // без surfaceOverrides строки не меняются вообще
    const plain = createVariant('Стандарт', '', defaultSettings());
    expect(linesForVariant(project, pb, plain)[0]).toBe(worktopLine);
  });
});
