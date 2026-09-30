import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkDictRules, dictSuggestions, type FactoryDicts } from './factoryDicts';
import { VISMA_KITCHEN_BLANK, type FactoryBlankField } from './factoryBlank';

const here = dirname(fileURLToPath(import.meta.url));
const dicts: FactoryDicts = JSON.parse(readFileSync(join(here, '../../public/data/factory-dicts-visma.json'), 'utf-8'));

const field = (key: string): FactoryBlankField => VISMA_KITCHEN_BLANK.fields.find((f) => f.key === key)!;

describe('справочники разбивок Висма', () => {
  it('загружаются с ожидаемым объёмом и структурой', () => {
    expect(dicts.groups.ldspColors.items.length).toBeGreaterThan(400);
    expect(dicts.groups.films.items.length).toBeGreaterThan(900);
    expect(dicts.groups.plastics.items.length).toBeGreaterThan(700);
    expect(dicts.groups.ldspThickness?.items.length).toBeGreaterThan(200);
    expect(dicts.groups.ldspEdges?.items.length).toBeGreaterThan(100);
    expect(dicts.groups.compactHpl?.items.length).toBeGreaterThan(100);
    expect(dicts.groups.ldspColors.items.every((i) => i.name && i.brand)).toBe(true);
  });

  it('подсказки для полей бланка: цвет ЛДСП, кромка каркаса, плёнки; выведенные плёнки не предлагаем', () => {
    const ldsp = dictSuggestions('ldspColor', dicts);
    expect(ldsp.length).toBeGreaterThan(20);
    expect(ldsp.some((s) => s.startsWith('!'))).toBe(true); // текстурные помечены
    const films = dictSuggestions('facadeColor', dicts);
    expect(films.every((s) => !s.includes('выведена') && !s.includes('снята'))).toBe(true);
    expect(dictSuggestions('bodyEdging', dicts).some((s) => s.startsWith('0,4мм'))).toBe(true);
    expect(dictSuggestions('packNotes', dicts)).toEqual([]);
  });

  it('правила разбивки: текстура без «!» в значении — ошибка; с «!» — ок', () => {
    const textured = dicts.groups.ldspColors.items.find((i) => i.texture)!;
    const bad = checkDictRules([{ field: field('ldspColor'), value: `Низ — ${textured.name}` }], dicts);
    expect(bad.some((i) => i.level === 'error' && i.text.includes('!'))).toBe(true);
    const good = checkDictRules([{ field: field('ldspColor'), value: `Низ — !${textured.name}` }], dicts);
    expect(good.filter((i) => i.text.includes('!'))).toHaveLength(0);
  });

  it('«выведена»/«снята» позиции блокируются ошибкой', () => {
    const retired = dicts.groups.films.items.find((i) => i.status === 'выведена')!;
    const issues = checkDictRules([{ field: field('facadeColor'), value: `${retired.code} ${retired.name}` }], dicts);
    expect(issues.some((i) => i.level === 'error' && i.text.includes('не берётся'))).toBe(true);
    const active = dicts.groups.films.items.find((i) => i.status === 'в работе')!;
    expect(checkDictRules([{ field: field('facadeColor'), value: active.code }], dicts)
      .filter((i) => i.text.includes('не берётся'))).toHaveLength(0);
  });
});
