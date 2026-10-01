import { describe, expect, it } from 'vitest';
import type { Pricebook, PriceItem, Project } from '../types';
import type { EskizProject } from './eskizPro';
import { buildFactoryTechCommunicationRows, buildFactoryTechModuleRows, buildFactoryTechReadinessRows, factoryTechReadinessSummary } from './factoryTechPack';
import { newModule } from './modules';
import { defaultSettings } from './storage';

const item = (id: string, category: string, name: string, article: string | null = null): PriceItem => ({
  id,
  category,
  subcategory: null,
  name,
  article,
  unit: 'шт',
  priceKind: 'fixed',
  price: 100,
  priceRaw: '100',
  priceBasis: 'unit',
  attrs: {},
  note: null,
  group: null,
  source: { sheet: 'test', row: 1 },
});

const pricebook: Pricebook = {
  meta: {
    id: 'pb', name: 'Прайс', supplier: 'Висма', priceYear: 2026, sourceFile: 'test.xlsx', importedAt: '2026-10-01', itemCount: 3,
    categories: [], stats: { byCategory: {}, byUnit: {} },
  },
  items: [
    item('body-600', 'Корпуса', 'Стол напольный 600', '260'),
    item('facade-pvh', 'Фасады МДФ', 'МДФ ПВХ Белый'),
    item('hinge', 'Петли', 'Петля Titus 110'),
  ],
  refs: {}, notes: {}, issues: [],
};

const module = {
  ...newModule('Нижний шкаф'),
  id: 'mod-1',
  name: 'Низ 600',
  widthMm: 600,
  heightMm: 720,
  depthMm: 560,
  facades: 1,
  hinges: 2,
  handles: 0,
  facadeWmm: 596,
  facadeHmm: 716,
  slots: {
    ...newModule('Нижний шкаф').slots,
    body: { mode: 'manual' as const, itemId: 'body-600' },
    facade: { mode: 'manual' as const, itemId: 'facade-pvh' },
    hinge: { mode: 'manual' as const, itemId: 'hinge' },
  },
};

const eskiz: EskizProject = {
  version: 1,
  id: 'eskiz-1',
  title: 'Эскиз кухни',
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:05:00.000Z',
  image: { dataUrl: 'data:image/png;base64,AAA=', width: 800, height: 500, name: 'plan.png' },
  objects: [
    { id: 'marker-1', type: 'module', x: 100, y: 100, number: 'М1', description: 'Низ 600', color: '#7c3aed', fontSize: 12 },
    { id: 'marker-2', type: 'module', x: 200, y: 100, number: 'М2', description: 'Без связи', color: '#dc2626', fontSize: 12 },
  ],
  header: { enabled: true, project: 'Проект', room: 'Кухня', date: '01.10.2026', variant: 'A' },
  integration: {},
};

const project: Project = {
  id: 'p1',
  name: 'Кухня Иванов',
  client: 'Иванов',
  date: '2026-10-01',
  comment: '',
  status: 'draft',
  pricebookId: 'pb',
  pricebookName: 'Прайс',
  lines: [],
  settings: defaultSettings(),
  moduleDefaults: {},
  modules: [module],
  eskizPro: {
    activeProjectId: 'eskiz-1',
    moduleBindings: { 'eskiz-1:marker-1': 'mod-1' },
    communications: [{
      id: 'com-1', eskizId: 'eskiz-1', kind: 'socket', name: 'Розетка', x: 320, y: 180, widthMm: 70, heightMm: 70,
      distances: [{ id: 'd1', label: 'от левого края', anchor: 'left', valueMm: 320 }], createdAt: '2026-10-01T08:06:00.000Z',
    }],
  },
  createdAt: '2026-10-01',
  updatedAt: '2026-10-01',
};

describe('factoryTechPack', () => {
  it('строит таблицу связи маркеров Эскиз PRO с модулями расчёта', () => {
    const rows = buildFactoryTechModuleRows(project, pricebook, eskiz);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ marker: 'М1', status: 'связан с расчётом', module: 'Низ 600', body: '260 · Стол напольный 600' });
    expect(rows[0].facadeDetails).toContain('596×716');
    expect(rows[1]).toMatchObject({ marker: 'М2', status: 'маркер без модуля' });
  });

  it('выносит коммуникации и привязки в таблицу техлиста', () => {
    const rows = buildFactoryTechCommunicationRows(project, eskiz);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'Розетка', name: 'Розетка', size: '70×70 мм' });
    expect(rows[0].distances).toContain('320 мм');
  });

  it('скрывает габариты коммуникаций в техлисте, если плашка размера отключена', () => {
    const hiddenProject = { ...project, eskizPro: { ...project.eskizPro, communications: project.eskizPro?.communications?.map((marker) => ({ ...marker, showSizeBadge: false })) } };
    const rows = buildFactoryTechCommunicationRows(hiddenProject, eskiz);
    expect(rows[0].size).toBe('скрыто на эскизе');
    expect(rows[0].distances).toContain('320 мм');
  });

  it('собирает ошибки готовности для фабрики', () => {
    const rows = buildFactoryTechReadinessRows({ project, pricebook, eskizProject: eskiz, blankIssues: [] });
    expect(rows.some((row) => row.level === 'error' && row.text.includes('М2'))).toBe(true);
    const summary = factoryTechReadinessSummary(rows);
    expect(summary.errors).toBeGreaterThan(0);
  });
});
