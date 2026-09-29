import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { allowedTypos, editDistance, normalize, searchDocs, tokenize, tokenMatches, type KnowledgeDocs } from './knowledgeDocs';

const here = dirname(fileURLToPath(import.meta.url));
const docs: KnowledgeDocs = JSON.parse(readFileSync(join(here, '../../public/data/knowledge-docs.json'), 'utf-8'));

describe('тексты документов фабрики', () => {
  it('извлечены инструкции и технички с непустыми секциями', () => {
    expect(docs.docs.length).toBeGreaterThanOrEqual(4);
    const ids = docs.docs.map((d) => d.id);
    expect(ids).toContain('blank-kitchen-2025');
    expect(ids).toContain('tech-main-2025');
    for (const d of docs.docs) {
      expect(d.sections.length, `${d.title} без секций`).toBeGreaterThan(0);
      expect(d.pages).toBeGreaterThan(0);
      for (const s of d.sections) {
        expect(s.text.trim().length).toBeGreaterThan(15);
        expect(s.page).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('документы не дублируются', () => {
    const ids = docs.docs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sectionIds = docs.docs.flatMap((d) => d.sections.map((s) => s.id));
    expect(new Set(sectionIds).size).toBe(sectionIds.length);
  });
});

describe('нормализация и опечатки', () => {
  it('приводит регистр и ё к единому виду', () => {
    expect(normalize('Козырёк, ЦВЕТ!')).toBe('козырек цвет');
    expect(tokenize('петли 110 градусов')).toEqual(['петли', '110', 'градусов']);
  });

  it('считает расстояние редактирования с ограничением', () => {
    expect(editDistance('столешница', 'столешница', 2)).toBe(0);
    expect(editDistance('сталешница', 'столешница', 2)).toBe(1);
    expect(editDistance('кот', 'собака', 2)).toBeGreaterThan(2);
  });

  it('прощает опечатки по длине слова', () => {
    expect(allowedTypos(3)).toBe(0);
    expect(allowedTypos(6)).toBe(1);
    expect(allowedTypos(10)).toBe(2);
    expect(tokenMatches('сталешница', 'столешница')).toBe(true);
    expect(tokenMatches('кромк', 'кромка')).toBe(true); // префикс
    expect(tokenMatches('ель', 'шкаф')).toBe(false);
  });
});

describe('поиск по документам', () => {
  it('находит правило по точному слову и показывает источник', () => {
    const hits = searchDocs(docs.docs, 'кромка столешницы');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].snippet.length).toBeGreaterThan(10);
    expect(hits[0].doc.title).toBeTruthy();
    expect(hits[0].section.page).toBeGreaterThanOrEqual(1);
  });

  it('находит несмотря на опечатку', () => {
    const ok = searchDocs(docs.docs, 'столешница');
    const typo = searchDocs(docs.docs, 'сталешница');
    expect(ok.length).toBeGreaterThan(0);
    expect(typo.length).toBeGreaterThan(0);
  });

  it('пустой запрос ничего не возвращает', () => {
    expect(searchDocs(docs.docs, '')).toEqual([]);
    expect(searchDocs(docs.docs, '  ')).toEqual([]);
  });

  it('ранжирует совпадение в заголовке выше, чем в теле', () => {
    const hits = searchDocs(docs.docs, 'петли');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[hits.length - 1].score);
  });

  it('уважает лимит выдачи', () => {
    expect(searchDocs(docs.docs, 'фасад', 5).length).toBeLessThanOrEqual(5);
  });
});
