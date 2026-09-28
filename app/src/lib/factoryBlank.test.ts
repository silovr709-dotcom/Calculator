import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { KitchenModule, Pricebook, Project } from '../types';
import { autofillValue, checkFactoryBlank, draftFactoryBlank, factoryBlankProgress, FACTORY_BLANK_SPECS, getFactoryBlankSpec, VISMA_CORPUS_BLANK, VISMA_KITCHEN_BLANK } from './factoryBlank';
import { lineFromItem } from './engine';
import { newModule } from './modules';
import { defaultSettings } from './storage';

const here = dirname(fileURLToPath(import.meta.url));
const pb: Pricebook = JSON.parse(readFileSync(join(here, '../../public/data/pricebook-visma-2026.json'), 'utf-8'));

const makeProject = (over: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'Кухня тест', client: '', date: '2026-09-29', comment: '',
  status: 'draft', pricebookId: 'visma-2026', pricebookName: '', lines: [],
  settings: defaultSettings(), modules: [], createdAt: '2026-09-29', updatedAt: '2026-09-29',
  ...over,
});

const baseModule: KitchenModule = { ...newModule('Нижний шкаф'), id: 'm1', name: 'Тестовый стол 600' };
Object.assign(baseModule, {
  heightMm: 720, widthMm: 600, depthMm: 520,
  doors: 2, facades: 2, legs: 4, hinges: 2, handles: 2, drawers: 0, lifts: 0, shelves: 1, facadeWmm: 596, facadeHmm: 713,
});

describe('бланк на фабрику (РЕцепт PRO)', () => {
  it('подставляет из калькулятора: высоты, ножки, петли, направляющие из слотов', () => {
    const project = makeProject({ modules: [baseModule] });
    expect(autofillValue('hBase', project, pb)).toBe('820'); // 720 + 100
    expect(autofillValue('legs', project, pb)).toBe('Н=100 мм — 4 шт');
    const hinges = autofillValue('hinges', project, pb);
    expect(hinges).toContain('2 шт');
    // ручки: слот не назначен и модели ручки в прайсе может не быть → не молчим
    expect(autofillValue('handles', project, pb)).toContain('2 шт');
  });

  it('пустой проект → пустая подстановка, проверка ругается на обязательные поля', () => {
    const project = makeProject();
    expect(autofillValue('hBase', project, pb)).toBe('');
    const draft = draftFactoryBlank(project, pb, VISMA_KITCHEN_BLANK);
    const issues = checkFactoryBlank(project, pb, VISMA_KITCHEN_BLANK, draft);
    // productName подставляется типом изделия автоматически — ошибки нет
    expect(issues.some((i) => i.fieldKey === 'productName')).toBe(false);
    expect(issues.some((i) => i.fieldKey === 'ldspColor')).toBe(true);
    expect(issues.some((i) => i.fieldKey === 'worktopType' && i.text.includes('столешница'))).toBe(true);
  });

  it('ручной черновик имеет приоритет над автоподстановкой и сохраняется по ключу бланка', () => {
    const project = makeProject({
      modules: [baseModule],
      factoryBlankDrafts: { 'visma-kitchen-2025': { ldspColor: 'Белый 019 PE', hBase: 'h общ 860 (вручную)' } },
    });
    const draft = draftFactoryBlank(project, pb, VISMA_KITCHEN_BLANK);
    const ldsp = draft.find((d) => d.field.key === 'ldspColor')!;
    expect(ldsp.value).toBe('Белый 019 PE');
    expect(ldsp.source).toBe('draft');
    const hBase = draft.find((d) => d.field.key === 'hBase')!;
    expect(hBase.source).toBe('draft');
    const progress = factoryBlankProgress(draft);
    expect(progress.draftCount).toBe(2);
    expect(progress.auto).toBeGreaterThan(0);
    // обязательное ldspColor заполнено → проверка его не ругает
    const issues = checkFactoryBlank(project, pb, VISMA_KITCHEN_BLANK, draft);
    expect(issues.some((i) => i.fieldKey === 'ldspColor')).toBe(false);
  });

  it('корпусный бланк: размеры модулей «В*Ш*Г — N шт» подставляются из проекта', () => {
    const project = makeProject({ modules: [{ ...baseModule, heightMm: 2400, widthMm: 1600, depthMm: 600 }] });
    const value = autofillValue('moduleSizesVHD', project, pb);
    expect(value).toBe('2400*1600*600 — 1 шт');
    const draft = draftFactoryBlank(project, pb, VISMA_CORPUS_BLANK);
    expect(draft.find((d) => d.field.key === 'corpusSizes')!.value).toBe('2400*1600*600 — 1 шт');
    expect(draft.some((d) => d.field.required && d.value === '')).toBe(true); // цвет корпуса не придумываем
  });

  it('спецификация неделима по инструкции: не придумывает полей, все секции на месте', () => {
    for (const spec of FACTORY_BLANK_SPECS) {
      const sections = new Set(spec.fields.map((f) => f.section));
      expect(sections.has('Шапка')).toBe(true);
      expect(spec.fields.every((f) => f.label && f.key)).toBe(true);
    }
    expect(new Set(VISMA_KITCHEN_BLANK.fields.map((f) => f.section))).toEqual(new Set(['Шапка', 'Каркас', 'Фасад', 'Дополнения', 'Столешница', 'Фурнитура']));
    expect(getFactoryBlankSpec('visma-kitchen-2025')!.blankName).toBe('Бланк заказа кухни 2025');
    // столешница в чек-листе проекта подставляет тип и цвет
    const wt = pb.items.find((i) => i.category.startsWith('Столешницы:') && !i.category.includes('комплектующие') && !/панель/i.test(i.name))!;
    const project = makeProject({ lines: [lineFromItem(wt, 'visma-2026', 1)] });
    expect(autofillValue('worktop', project, pb).length).toBeGreaterThan(3);
    expect(autofillValue('worktopColor', project, pb)).toBe(autofillValue('worktop', project, pb));
  });
});
