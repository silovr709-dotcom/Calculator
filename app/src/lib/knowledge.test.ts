import { describe, expect, it } from 'vitest';
import { createKbArticle, filterKbArticles, kbCategoryLabel, removeKbArticle, seedKbArticles, upsertKbArticle } from './knowledge';

describe('база знаний РЕцепта', () => {
  it('живой поиск по словам с ё/е и регистром', () => {
    const seed = seedKbArticles();
    expect(seed.length).toBeGreaterThan(0);
    const found = filterKbArticles(seed, 'БЛАНК кухни', null);
    expect(found.some((a) => a.title.includes('бланка кухни'))).toBe(true);
    expect(filterKbArticles(seed, 'зазоры фрезеровка', null).some((a) => a.title.includes('Техничка'))).toBe(true);
    expect(filterKbArticles(seed, 'несуществующийтермин', null)).toHaveLength(0);
  });

  it('фильтр по категории и понятные ярлыки категорий', () => {
    const seed = seedKbArticles();
    expect(filterKbArticles(seed, '', 'facades').every((a) => a.category === 'facades')).toBe(true);
    expect(kbCategoryLabel('order-forms')).toBe('Оформление заказов');
  });

  it('upsert/удаление держат updatedAt и порядок', () => {
    const a = createKbArticle({ title: 'Разбивка цветов ЛДСП', category: 'materials', tags: ['лдсп', 'цвет'] });
    let list = upsertKbArticle([], a);
    expect(list).toHaveLength(1);
    const before = list[0].updatedAt;
    const edited = { ...a, title: 'Разбивка цветов ЛДСП (обновлено)' };
    list = upsertKbArticle(list, edited);
    expect(list).toHaveLength(1);
    expect(list[0].title).toContain('обновлено');
    expect(list[0].updatedAt >= before).toBe(true);
    list = removeKbArticle(list, a.id);
    expect(list).toHaveLength(0);
  });
});
