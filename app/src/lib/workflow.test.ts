import { describe, expect, it } from 'vitest';
import type { ClientProfile, Pricebook, Project } from '../types';
import { defaultSettings } from './storage';
import { buildProjectActionAlerts, projectNextStep } from './workflow';

const pb: Pricebook = {
  meta: {
    id: 'pb', name: 'test', supplier: 'test', priceYear: 2026, importedAt: '2026-10-06', itemCount: 0, sourceFile: 'test',
    categories: [], stats: { byCategory: {}, byUnit: {} },
  },
  items: [],
  refs: {},
  notes: {},
  issues: [],
};

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'Кухня тест', client: 'Иванов', date: '2026-10-06', comment: '',
  status: 'draft', pricebookId: 'pb', pricebookName: 'test', lines: [], modules: [],
  settings: defaultSettings(), createdAt: '2026-10-06T10:00:00Z', updatedAt: '2026-10-06T10:00:00Z',
  ...over,
});

const client = (over: Partial<ClientProfile> = {}): ClientProfile => ({
  id: 'c1', name: 'Иванов', phones: ['+79990000000'], emails: [], tags: [], history: [], createdAt: '', updatedAt: '',
  ...over,
});

describe('workflow helpers', () => {
  it('ведёт пустой проект к заполнению состава', () => {
    const step = projectNextStep(project(), pb, client());
    expect(step.key).toBe('composition-empty');
    expect(step.target).toBe('modules');
  });

  it('без клиента первым шагом просит указать клиента', () => {
    const step = projectNextStep(project({ client: '' }), pb, null);
    expect(step.key).toBe('client-missing');
  });

  it('при составе без КП предлагает собрать КП клиенту', () => {
    const p = project({
      lines: [{ id: 'l1', itemId: 'x', pricebookId: 'pb', name: 'Комплект мебели', article: null, category: 'Прочее', group: 'Прочее', priceKind: 'fixed', priceBasis: 'unit', unit: 'шт', price: 1000, priceGroup: 'Прочее', qty: 1, params: {} }],
    });
    expect(projectNextStep(p, null, client()).key).toBe('prepare-offer');
  });

  it('находит незаполненную схему столешницы как задачу фабрики', () => {
    const p = project({
      lines: [{ id: 'l1', itemId: 'wt', pricebookId: 'pb', name: 'Столешница 38 мм', article: '', category: 'Столешницы: постформинг', group: 'Столешницы', priceKind: 'fixed', priceBasis: 'unit', price: 1, priceGroup: null, unit: 'шт', qty: 1, params: {}, note: '' }],
      orderWorkflow: { status: 'techCheck' },
    });
    const alerts = buildProjectActionAlerts(p, pb, client());
    expect(alerts.some((alert) => alert.id === 'no-worktop-plan')).toBe(true);
  });
});
