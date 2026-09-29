import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pricebook, Project } from '../types';
import { portfolioFinance, projectFinance } from './finance';
import { defaultSettings } from './storage';
import { lineFromItem } from './engine';

const here = dirname(fileURLToPath(import.meta.url));
const pb: Pricebook = JSON.parse(readFileSync(join(here, '../../public/data/pricebook-visma-2026.json'), 'utf-8'));

const makeProject = (over: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'Кухня Ивановых', client: 'Иванов', date: '2026-09-29', comment: '',
  status: 'draft', pricebookId: 'visma-2026', pricebookName: '', lines: [],
  settings: defaultSettings(), modules: [], createdAt: '2026-09-29', updatedAt: '2026-09-29',
  ...over,
});

describe('финансы проекта и портфеля (РЕцепт PRO)', () => {
  it('считает цену клиента, себестоимость, расходы, прибыль и маржу из существующих данных', () => {
    const corpus = pb.items.find((i) => i.article === '34' && i.source.sheet === 'каркас шк')!; // 2100
    const settings = defaultSettings();
    settings.markupBasePct = 100;
    settings.deliveryCost = 3000;
    settings.extraExpenses = [{ id: 'e1', name: 'Дизайнеру', amount: null, percent: 10, toClient: false }];
    const project = makeProject({ lines: [lineFromItem(corpus, 'visma-2026', 10)], settings });

    const finance = projectFinance(project, pb);
    expect(finance.clientPrice).toBe(21000 * 2 + 3000); // 45000
    expect(finance.cost).toBe(21000 + 3000 + Math.round(42000 * 0.10 * 100) / 100); // 28200
    expect(finance.extrasTotal).toBe(3000 + 4200);
    expect(finance.grossProfit).toBeCloseTo(45000 - 28200, 2);
    expect(finance.marginPct).toBeCloseTo(((45000 - 28200) / 45000) * 100, 1);
    expect(finance.unpricedCount).toBe(0);
  });

  it('сводка портфеля: суммы и маржа по деньгам, подсчёт проектов без цен', () => {
    const corpus = pb.items.find((i) => i.article === '34' && i.source.sheet === 'каркас шк')!;
    const settings = defaultSettings();
    settings.markupBasePct = 100;
    const good = makeProject({ lines: [lineFromItem(corpus, 'visma-2026', 10)], settings }); // 42000/21000
    const noPriceItem = { ...corpus, id: 'ghost', price: null, priceKind: 'empty' as const };
    const bad = makeProject({ id: 'p2', lines: [lineFromItem(noPriceItem, 'visma-2026', 1)] });

    const pf = portfolioFinance([good, bad], pb);
    expect(pf.projectsCount).toBe(2);
    expect(pf.revenue).toBe(42000);
    expect(pf.cost).toBe(21000);
    expect(pf.grossProfit).toBe(21000);
    expect(pf.marginPct).toBe(50);
    expect(pf.unpricedProjects).toBe(1);
  });

  it('пустой портфель не делит на ноль', () => {
    const pf = portfolioFinance([], pb);
    expect(pf.marginPct).toBeNull();
    expect(pf.revenue).toBe(0);
  });
});
