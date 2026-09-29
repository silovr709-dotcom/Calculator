import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pricebook } from '../types';
import { hardwareCounts, hardwareEntries, HARDWARE_GROUPS, searchHardware } from './hardware';

const here = dirname(fileURLToPath(import.meta.url));
const pb: Pricebook = JSON.parse(readFileSync(join(here, '../../public/data/pricebook-visma-2026.json'), 'utf-8'));

describe('справочник фурнитуры из прайса', () => {
  const entries = hardwareEntries(pb);

  it('собирает позиции по группам', () => {
    expect(entries.length).toBeGreaterThan(300);
    const counts = hardwareCounts(entries);
    expect(counts.hinges).toBeGreaterThan(50);
    expect(counts.handles).toBeGreaterThan(40);
    expect(counts.drawers).toBeGreaterThan(30);
  });

  it('каждая группа ссылается на реальные категории прайса', () => {
    const categories = new Set(pb.items.map((i) => i.category));
    const unknown = HARDWARE_GROUPS.flatMap((g) => g.categories).filter((c) => !categories.has(c));
    expect(unknown, 'категории групп, которых нет в прайсе').toEqual([]);
  });

  it('без прайса возвращает пусто и не падает', () => {
    expect(hardwareEntries(undefined)).toEqual([]);
    expect(hardwareCounts([])).toEqual({});
  });

  it('находит «петля 110» и не путает с другими числами', () => {
    const found = searchHardware(entries, 'петля 110', null);
    expect(found.length).toBeGreaterThan(0);
    for (const e of found) {
      const hay = `${e.item.name} ${e.item.article ?? ''}`;
      expect(hay).toMatch(/110/);
    }
  });

  it('фильтрует по выбранной группе', () => {
    const onlyHandles = searchHardware(entries, '', 'handles');
    expect(onlyHandles.length).toBeGreaterThan(0);
    expect(onlyHandles.every((e) => e.group.id === 'handles')).toBe(true);
  });

  it('требует все слова запроса', () => {
    const nonsense = searchHardware(entries, 'петля верблюд', null);
    expect(nonsense).toEqual([]);
  });

  it('пустой запрос отдаёт всю группу в пределах лимита', () => {
    const all = searchHardware(entries, '', null, 10);
    expect(all.length).toBe(10);
  });
});
