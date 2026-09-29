import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pricebook } from '../types';
import { checkDictRules, millingsOf, dictSuggestions, type FactoryDicts } from './factoryDicts';
import { VISMA_KITCHEN_BLANK, type FactoryBlankField } from './factoryBlank';
import { findMilling, millingPriceFrom, millingPrices, searchMillings, type Milling } from './millings';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => JSON.parse(readFileSync(join(here, rel), 'utf-8'));

const dicts: FactoryDicts = read('../../public/data/factory-dicts-visma.json');
const pricebook: Pricebook = read('../../public/data/pricebook-visma-2026.json');
const millings = millingsOf(dicts);
const byName = (name: string) => millings.find((m) => m.name === name)!;
const field = (key: string): FactoryBlankField => VISMA_KITCHEN_BLANK.fields.find((f) => f.key === key)!;

describe('каталог фрезеровок Висма 2026', () => {
  it('содержит все 60 позиций каталога, по 4 категориям', () => {
    expect(millings).toHaveLength(60);
    const byCategory = new Map<number, number>();
    for (const m of millings) byCategory.set(m.category, (byCategory.get(m.category) ?? 0) + 1);
    expect([...byCategory.keys()].sort()).toEqual([1, 2, 3, 4]);
    expect(byCategory.get(1)).toBe(26);
    expect(byCategory.get(2)).toBe(15);
    expect(byCategory.get(3)).toBe(14);
    expect(byCategory.get(4)).toBe(5);
  });

  it('каждая позиция ссылается на свою страницу PDF каталога и на картинку', () => {
    const pages = millings.map((m) => m.source.pdfPage);
    expect(new Set(pages).size).toBe(millings.length);
    expect(Math.min(...pages)).toBe(2);
    expect(Math.max(...pages)).toBe(61);
    expect(millings.every((m) => m.image === `img/millings/${m.slug}.jpg`)).toBe(true);
    expect(millings.every((m) => m.coatings.length > 0 && m.sizes.blind)).toBe(true);
  });

  it('значения совпадают со страницами каталога (контрольные позиции)', () => {
    // стр. 19 PDF: Пирамида — 1 категория, R3, 60/23, 16 мм, РК не изготавливается
    const piramida = byName('Пирамида');
    expect(piramida).toMatchObject({
      category: 1, faska: 'R3', frameWidthMm: '60/23', mdfThicknessMm: '16', onlyEnamel: false,
    });
    expect(piramida.sizes.rk).toBeNull();
    expect(piramida.sizes.blind).toBe('246-2290*246-1036');

    // стр. 49 PDF: Дублин — 3 категория, только эмаль, фирменная фаска
    const dublin = byName('Дублин');
    expect(dublin.category).toBe(3);
    expect(dublin.coatings).toEqual(['эмаль']);
    expect(dublin.onlyEnamel).toBe(true);
    expect(dublin.faska).toBe('дублин');

    // стр. 32 PDF: Лорето — сплошной рисунок, шаг 14 мм и предупреждение каталога
    const loreto = byName('Лорето');
    expect(loreto.stepMm).toBe('14');
    expect(loreto.note).toBe('Переход рисунка не совпадает.');
    expect(loreto.faska).toBeNull();
  });

  it('позиции, исчезнувшие из каталога 2026, не притворяются существующими', () => {
    for (const gone of ['Яна', 'Эфес', 'Барнео 2', 'Бридж 2']) {
      expect(millings.some((m) => m.name === gone)).toBe(false);
    }
    // а новинки каталога 2026 — на месте
    for (const added of ['Джулия', 'Марко', 'Римини', 'Фостер', 'Арецио', 'Бергамо',
      'Дублин', 'Жалюзи', 'Мальта', 'София', 'Капелла', 'Луиджи', 'Паола', 'Помпея']) {
      expect(millings.some((m) => m.name === added)).toBe(true);
    }
  });
});

describe('поиск и распознавание фрезеровок', () => {
  it('ищет по названию, фаске, толщине и покрытию', () => {
    expect(searchMillings(millings, 'пирамида').map((m) => m.name)).toEqual(['Пирамида']);
    expect(searchMillings(millings, 'мыло').map((m) => m.name)).toContain('Мыло');
    expect(searchMillings(millings, '', { category: 4 })).toHaveLength(5);
    const enamelOnly = searchMillings(millings, '', { coating: 'ПВХ' });
    expect(enamelOnly.every((m) => m.coatings.includes('ПВХ'))).toBe(true);
    expect(enamelOnly.some((m) => m.name === 'Дублин')).toBe(false);
  });

  it('в тексте бланка находит самое длинное совпадение, а не первое', () => {
    expect(findMilling('Фасад: Арка 2, плёнка', millings)?.name).toBe('Арка 2');
    expect(findMilling('Марокко 2', millings)?.name).toBe('Марокко 2');
    expect(findMilling('Ситро Р', millings)?.name).toBe('Ситро Р');
    expect(findMilling('какая-то своя фрезеровка', millings)).toBeNull();
  });
});

describe('цена фасада по категории фрезеровки — из прайса, без выдумок', () => {
  it('ПВХ: категория + толщина → строка «Квадратный метр фасада» нужного раздела', () => {
    const prices = millingPrices(byName('Пирамида'), pricebook).filter((p) => p.coating === 'ПВХ');
    expect(prices.length).toBeGreaterThanOrEqual(3);
    const p16 = prices.find((p) => p.variant === '16мм')!;
    expect(p16.price).toBe(3600);
    expect(p16.item.subcategory).toBe('1 категория (плёнки)');

    const cat4 = millingPrices(byName('Помпея'), pricebook).find((p) => p.coating === 'ПВХ' && p.variant === '16мм')!;
    expect(cat4.price).toBe(5200);
    expect(cat4.item.subcategory).toBe('4 категория (плёнки)');
  });

  it('эмаль: категория → матовая/глянец/металлик из раздела «фрезеровка N кат»', () => {
    const enamel = millingPrices(byName('Пирамида'), pricebook).filter((p) => p.coating === 'эмаль');
    expect(enamel.map((p) => p.variant)).toEqual(['матовая', 'глянец', 'металлик-глянец']);
    expect(enamel[0].price).toBe(9300);
    expect(enamel[0].item.subcategory).toBe('фрезеровка 1 кат');
  });

  it('для «только эмаль» цены ПВХ не показываются', () => {
    const prices = millingPrices(byName('Дублин'), pricebook);
    expect(prices.every((p) => p.coating === 'эмаль')).toBe(true);
    expect(prices[0].item.subcategory).toBe('фрезеровка 3 кат');
  });

  it('без прайса цену не придумываем', () => {
    expect(millingPrices(byName('Пирамида'), undefined)).toEqual([]);
    expect(millingPriceFrom(byName('Пирамида'), undefined)).toBeNull();
    expect(millingPriceFrom(byName('Пирамида'), pricebook)!.price).toBe(3600);
  });
});

describe('проверки бланка по каталогу фрезеровок', () => {
  const check = (milling: string, extra: { key: string; value: string }[] = []) =>
    checkDictRules([
      { field: field('facadeMilling'), value: milling },
      ...extra.map((e) => ({ field: field(e.key), value: e.value })),
    ], dicts);

  it('известная фрезеровка без противоречий — без замечаний', () => {
    expect(check('Пирамида')).toEqual([]);
  });

  it('неизвестная фрезеровка — предупреждение, а не молчание', () => {
    const issues = check('Вензель');
    expect(issues.some((i) => i.level === 'warn' && i.text.includes('не найдена в каталоге'))).toBe(true);
  });

  it('«только эмаль» + ПВХ в бланке — ошибка', () => {
    const issues = check('Дублин', [{ key: 'facadeType', value: 'МДФ ПВХ плёнка' }]);
    expect(issues.some((i) => i.level === 'error' && i.text.includes('только в эмали'))).toBe(true);
    const ok = check('Дублин', [{ key: 'facadeType', value: 'эмаль матовая' }]);
    expect(ok.some((i) => i.text.includes('только в эмали'))).toBe(false);
  });

  it('примечание каталога показывается как предупреждение', () => {
    const issues = check('Волна');
    expect(issues.some((i) => i.level === 'warn' && i.text.includes('Переход рисунка не совпадает'))).toBe(true);
  });

  it('плёнка «только Мыло» с другой фрезеровкой — ошибка', () => {
    const film = dicts.groups.films.items.find((f) => f.onlyMillingMilo && f.status === 'в работе')!;
    const issues = check('Пирамида', [{ key: 'facadeColor', value: `${film.code} — ${film.name}` }]);
    expect(issues.some((i) => i.level === 'error' && i.text.includes('только с фрезеровкой «Мыло»'))).toBe(true);
    const ok = check('Мыло', [{ key: 'facadeColor', value: `${film.code} — ${film.name}` }]);
    expect(ok.some((i) => i.text.includes('только с фрезеровкой «Мыло»'))).toBe(false);
  });

  it('подсказки для поля «Тип фрезеровки» берутся из каталога', () => {
    const hints = dictSuggestions('facadeMilling', dicts, 100);
    expect(hints.length).toBe(60);
    expect(hints.some((h) => h.startsWith('Пирамида (1 категория, 16 мм'))).toBe(true);
  });
});

describe('картинки фрезеровок лежат в public и не раздувают сборку', () => {
  it('на каждую позицию есть файл превью', async () => {
    const { statSync } = await import('node:fs');
    let total = 0;
    for (const m of millings as Milling[]) {
      const file = join(here, '../../public', m.image);
      const size = statSync(file).size;
      expect(size).toBeGreaterThan(1000);
      total += size;
    }
    expect(total).toBeLessThan(3 * 1024 * 1024);
  });
});
