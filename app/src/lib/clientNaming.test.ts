import { describe, expect, it } from 'vitest';
import { clientFacadeName, clientLineName, makeClientNameResolver, normalizeFacadeCategory } from './clientNaming';
import type { PriceItem, ProjectLine } from '../types';

function item(partial: Partial<PriceItem>): PriceItem {
  return {
    id: 'it_1',
    category: 'Фасады: МДФ (ПВХ плёнка)',
    subcategory: '1 категория (плёнки)',
    name: 'Квадратный метр фасада (декор под вытяжку и цоколя считаютс по кв.м) — 19мм',
    article: null,
    unit: 'кв.м',
    priceKind: 'fixed',
    price: 4200,
    priceRaw: '4200',
    priceBasis: 'm2',
    attrs: { 'толщина': '19мм', 'категория': '1 категория (плёнки)' },
    note: null,
    group: 'mdf_pvh',
    source: { sheet: 'МДФ(ПВХ)', row: 10 },
    ...partial,
  };
}

function line(partial: Partial<ProjectLine> = {}): ProjectLine {
  return {
    id: 'l1',
    itemId: 'it_1',
    pricebookId: 'pb',
    category: 'Фасады: МДФ (ПВХ плёнка)',
    group: 'Фасады',
    name: 'Квадратный метр фасада (декор под вытяжку и цоколя считаютс по кв.м) — 19мм',
    article: null,
    unit: 'кв.м',
    priceKind: 'fixed',
    price: 4200,
    priceBasis: 'm2',
    priceGroup: 'mdf_pvh',
    qty: 2,
    params: {},
    ...partial,
  } as ProjectLine;
}

describe('названия позиций для клиента', () => {
  it('фасад в плёнке называется материалом с категорией и толщиной', () => {
    expect(clientLineName(line(), item({}))).toBe('МДФ ПВХ (1 категория; 19 мм)');
  });

  it('категория берётся из подкатегории, если атрибута нет', () => {
    const withoutAttr = item({ attrs: { 'толщина': '22мм' }, subcategory: '4 категория (плёнки)' });
    expect(clientLineName(line({ name: 'Квадратный метр фасада — 22мм' }), withoutAttr)).toBe('МДФ ПВХ (4 категория; 22 мм)');
  });

  it('без позиции прайса толщина разбирается из названия строки', () => {
    expect(clientLineName(line({ name: 'Квадратный метр фасада — 16мм' }), null)).toBe('МДФ ПВХ (16 мм)');
  });

  it('«1 кат» и «(плёнки)» приводятся к человеческому виду', () => {
    expect(normalizeFacadeCategory('1 категория (плёнки)')).toBe('1 категория');
    expect(normalizeFacadeCategory('2 кат')).toBe('2 категория');
  });

  it('эмаль: покрытие и фрезеровка', () => {
    const emal = item({
      category: 'Фасады: Эмаль',
      subcategory: 'фрезеровка 19 мыло/R3',
      name: 'матовая (кв.м) — фрезеровка 19 мыло/R3',
      attrs: { 'фрезеровка': 'фрезеровка 19 мыло/R3', 'изделие': 'матовая (кв.м)' },
    });
    expect(clientLineName(line({ category: 'Фасады: Эмаль', name: emal.name }), emal))
      .toBe('МДФ эмаль (матовая; фрезеровка 19 мыло/R3)');
  });

  it('пластик HPL: бренд без размеров листа и категория', () => {
    const hpl = item({
      category: 'Фасады: Пластик (HPL)',
      subcategory: '1 кат',
      name: 'Фасад пластик, кв.м — ARPA/ABET 1 кат',
      attrs: { 'бренд': 'ARPA/ABET (3050*1300), кромка ПВХ 1мм', 'категория': '1 кат' },
    });
    expect(clientLineName(line({ category: 'Фасады: Пластик (HPL)', name: hpl.name }), hpl))
      .toBe('Пластик HPL (ARPA/ABET; 1 категория)');
  });

  it('стекло: убираем размер листа', () => {
    const glass = item({
      category: 'Фасады: Стекло и зеркала',
      subcategory: 'Стекло',
      name: 'Бронза прозрачное 4мм (2600*1800*4)',
      attrs: {},
    });
    expect(clientLineName(line({ category: 'Фасады: Стекло и зеркала', name: glass.name }), glass))
      .toBe('Стекло/зеркало — Бронза прозрачное 4мм');
  });

  it('нефасадные позиции остаются как есть', () => {
    const hinge = item({ category: 'Петли', subcategory: 'Боярд', name: 'Петля Боярд 90°', attrs: {} });
    expect(clientFacadeName({ category: hinge.category, name: hinge.name, attrs: hinge.attrs })).toBeNull();
    expect(clientLineName(line({ category: 'Петли', name: 'Петля Боярд 90°' }), hinge)).toBe('Петля Боярд 90°');
  });

  it('ручная правка в КП важнее автоматического названия', () => {
    const resolve = makeClientNameResolver(new Map([['it_1', item({})]]), { it_1: 'Фасады МДФ, плёнка «Дуб»' });
    expect(resolve(line())).toBe('Фасады МДФ, плёнка «Дуб»');
  });

  it('пустая правка не ломает название', () => {
    const resolve = makeClientNameResolver(new Map([['it_1', item({})]]), { it_1: '   ' });
    expect(resolve(line())).toBe('МДФ ПВХ (1 категория; 19 мм)');
  });
});
