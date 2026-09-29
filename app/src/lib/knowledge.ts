// База знаний РЕцепта. Чистые функции работы со статьями; хранение — storage.ts
// (K_KNOWLEDGE, входит в резервные копии). Статья — самодостаточный документ
// с метаданными: позже каждая станет чанком для AI-поиска, структуру менять не нужно.
import type { KbArticle, KbCategory } from '../types';
import { uid } from './storage';

export const KB_CATEGORIES: { id: KbCategory; label: string }[] = [
  { id: 'instructions', label: 'Инструкции' },
  { id: 'calc-rules', label: 'Правила расчёта' },
  { id: 'factories', label: 'Фабрики' },
  { id: 'materials', label: 'Материалы' },
  { id: 'facades', label: 'Фасады' },
  { id: 'hardware', label: 'Фурнитура' },
  { id: 'tech-requirements', label: 'Технические требования' },
  { id: 'order-forms', label: 'Оформление заказов' },
  { id: 'regulations', label: 'Регламенты РЕцепта' },
  { id: 'faq', label: 'Частые вопросы' },
];

export const kbCategoryLabel = (id: KbCategory): string =>
  KB_CATEGORIES.find((c) => c.id === id)?.label ?? id;

const norm = (value: string) => value.toLocaleLowerCase('ru').replace(/ё/g, 'е');

/** Живой поиск по заголовку, тегам и тексту. Через пробел — все слова должны встретиться. */
export function filterKbArticles(articles: KbArticle[], query: string, category: KbCategory | null): KbArticle[] {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  return articles.filter((article) => {
    if (category && article.category !== category) return false;
    if (!terms.length) return true;
    const hay = norm(`${article.title} ${article.tags.join(' ')} ${article.body}`);
    return terms.every((term) => hay.includes(term));
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createKbArticle(draft: Partial<KbArticle> = {}): KbArticle {
  return {
    id: uid('kb'),
    title: draft.title ?? '',
    category: draft.category ?? 'instructions',
    tags: draft.tags ?? [],
    body: draft.body ?? '',
    attachment: draft.attachment,
    updatedAt: draft.updatedAt ?? new Date().toISOString(),
  };
}

export function upsertKbArticle(articles: KbArticle[], article: KbArticle): KbArticle[] {
  const next = { ...article, updatedAt: new Date().toISOString() };
  const exists = articles.some((a) => a.id === article.id);
  return exists ? articles.map((a) => (a.id === article.id ? next : a)) : [next, ...articles];
}

export function removeKbArticle(articles: KbArticle[], id: string): KbArticle[] {
  return articles.filter((a) => a.id !== id);
}

/**
 * Стартовые статьи — только ссылки на РЕАЛЬНЫЕ документы, уже есть в репозитории.
 * Контент базы ведёт сама команда; структура пустая не должна быть.
 */
export function seedKbArticles(): KbArticle[] {
  const now = new Date().toISOString();
  return [
    {
      id: uid('kb'),
      title: 'Инструкция: заполнение бланка кухни (Висма, 2025)',
      category: 'order-forms',
      tags: ['бланк', 'висма', 'заказ', 'фабрика'],
      body: 'Правила заполнения бланка заказа кухни: шапка, каркас, фасад, столешница, фурнитура. Документ: «Инструкция по заполнению бланк а кухни 2025.pdf» в корне репозитория.',
      attachment: 'Инструкция по заполнению бланк а кухни 2025.pdf',
      updatedAt: now,
    },
    {
      id: uid('kb'),
      title: 'Инструкция: заполнение бланка корпус (2025)',
      category: 'order-forms',
      tags: ['бланк', 'корпус', 'заказ', 'фабрика'],
      body: 'Правила заполнения бланка корпусных изделий: размеры по каркасу (без фасадов!), цвет по разбивке ЛДСП, фасады, столешница, доп. комплектация. Документ: «Инструкция по заполнению бланка корпус 2025.pdf» в корне репозитория.',
      attachment: 'Инструкция по заполнению бланка корпус 2025.pdf',
      updatedAt: now,
    },
    {
      id: uid('kb'),
      title: 'Техничка фабрики по фасадам',
      category: 'facades',
      tags: ['техничка', 'фасады', 'фрезеровка', 'зазоры'],
      body: 'Технические правила фабрики по фасадам: размеры, зазоры, фрезеровки. См. документ «Техничка 1.08.2025.pdf» и разбор docs/ТЕХНИЧКА-ФАСАДЫ.md. Правило эмали: заказ < 1 кв.м считается +30%.',
      attachment: 'Техничка 1.08.2025.pdf',
      updatedAt: now,
    },
    {
      id: uid('kb'),
      title: 'Каталог фрезеровок Висма 2026',
      category: 'facades',
      tags: ['каталог', 'фрезеровка', 'фасады', 'категория', 'висма'],
      body: 'Действующий каталог: 60 фрезеровок, 4 категории. Категория задаёт цену квадратного метра фасада в прайсе 2026 (ПВХ — «N категория (плёнки)», эмаль — «фрезеровка N кат»). Открыть с картинками, размерами и ценами: База знаний → вкладка «🪚 Фрезеровки». Разбор отличий от техинички 2023 — docs/ФРЕЗЕРОВКИ-2026.md.',
      attachment: 'Каталог Фрезеровок ВИСМА 2026_compressed (1).pdf',
      updatedAt: now,
    },
  ];
}
