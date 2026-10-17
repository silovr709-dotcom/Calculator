import { describe, expect, it } from 'vitest';
import type { ClientProfile, Pricebook, Project } from '../types';
import { defaultSettings } from './storage';
import { buildDayDesk, buildProjectActionAlerts, projectNextStep } from './workflow';

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

  it('подсказывает контакт, если КП отправлено и дата просрочена', () => {
    const p = project({
      lines: [{ id: 'l1', itemId: 'x', pricebookId: 'pb', name: 'Комплект мебели', article: null, category: 'Прочее', group: 'Прочее', priceKind: 'fixed', priceBasis: 'unit', price: 1000, priceGroup: null, unit: 'шт', qty: 1, params: {}, note: '' }],
      checklistConfirmations: ['plinth', 'baseboard', 'worktop', 'wallPanel'],
      orderWorkflow: { status: 'offerSent', nextContactAt: '2026-01-01T12:00:00.000Z', nextAction: 'Позвонить' },
    });
    const step = projectNextStep(p, pb, client());
    expect(step.key).toBe('contact-due');
    expect(step.target).toBe('crm');
  });

  it('собирает рабочий стол дня с проблемами клиента, оплаты и фабрики', () => {
    const p = project({
      id: 'p2', client: '', clientId: 'c2', status: 'approved',
      modules: [{ id: 'm1', type: 'Нижний шкаф', name: 'Низ 600', qty: 1, widthMm: 600, heightMm: 720, depthMm: 560, facades: 0, drawers: 0, shelves: 0, hinges: 0, handles: 0, lifts: 0, legs: 0, facadeWmm: null, facadeHmm: null, slots: {} as never }],
      orderWorkflow: { status: 'approved' },
    });
    const c = client({ id: 'c2', name: 'Петров', phones: [] });
    const day = buildDayDesk([p], [pb], [c]);
    expect(day.missingPhone).toBe(1);
    expect(day.missingPayment).toBe(1);
    expect(day.factoryNotExported).toBe(1);
    expect(day.tasks.length).toBeGreaterThan(0);
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
