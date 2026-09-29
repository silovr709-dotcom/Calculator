import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pricebook } from '../types';
import { materialEntries, materialGroupOf, searchMaterials } from './materials';

const here = dirname(fileURLToPath(import.meta.url));
const pricebook: Pricebook = JSON.parse(readFileSync(join(here, '../../public/data/pricebook-visma-2026.json'), 'utf-8'));

describe('каталог материалов из прайса', () => {
  it('раскладывает фасады, стекло, столешницы, корпуса и цоколь по группам', () => {
    const entries = materialEntries(pricebook);
    const groups = new Set(entries.map((entry) => entry.group.id));
    expect(groups).toEqual(new Set(['facades', 'glass', 'worktops', 'corpora', 'plinth']));
    expect(entries.length).toBeGreaterThan(700);
    expect(materialGroupOf(pricebook.items.find((item) => item.category === 'Петли')!)).toBeNull();
  });

  it('ищет по словам запроса, категории и оставляет реальные цены', () => {
    const entries = materialEntries(pricebook);
    const fenix = searchMaterials(entries, 'FENIX', { onlyPriced: true });
    expect(fenix.length).toBeGreaterThan(0);
    expect(fenix.every((entry) => entry.item.price != null)).toBe(true);

    const worktops = searchMaterials(entries, '600*3000', { groupId: 'worktops' });
    expect(worktops.length).toBeGreaterThan(0);
    expect(worktops.every((entry) => entry.group.id === 'worktops')).toBe(true);
  });
});
