import { describe, expect, it } from 'vitest';
import { analyticsByClient, analyticsByMonth, analyticsTopModules, analyticsTotals, monthLabel, type ProjectMoney } from './analytics';
import type { Project } from '../types';

const row = (patch: Partial<ProjectMoney>): ProjectMoney => ({
  id: 'p', name: 'Кухня', client: 'Иван', date: '2026-10-01', status: 'draft',
  client_total: 0, cost: 0, margin: 0, marginPct: null, ...patch,
});

describe('аналитика по базе проектов', () => {
  const rows = [
    row({ id: '1', status: 'delivered', client_total: 300000, cost: 180000, margin: 120000 }),
    row({ id: '2', status: 'approved', client_total: 200000, cost: 140000, margin: 60000, client: 'Пётр' }),
    row({ id: '3', status: 'rejected', client_total: 150000, cost: 100000, margin: 50000 }),
    row({ id: '4', status: 'draft', client_total: 100000, cost: 70000, margin: 30000 }),
    row({ id: '5', status: 'offerSent', client_total: 250000, cost: 160000, margin: 90000, date: '2026-09-12' }),
  ];

  it('считает конверсию только по отправленным КП', () => {
    const totals = analyticsTotals(rows);
    expect(totals.sent).toBe(4);           // черновик не считается
    expect(totals.won).toBe(2);
    expect(totals.lost).toBe(1);
    expect(totals.conversionPct).toBe(50);
  });

  it('выручку и маржу берёт только по выигранным', () => {
    const totals = analyticsTotals(rows);
    expect(totals.wonRevenue).toBe(500000);
    expect(totals.wonMargin).toBe(180000);
    expect(totals.wonMarginPct).toBe(36);
    expect(totals.averageCheck).toBe(250000);
  });

  it('в воронке учитывает открытые проекты', () => {
    expect(analyticsTotals(rows).pipeline).toBe(350000);  // черновик + отправленное КП
  });

  it('группирует по месяцам', () => {
    const months = analyticsByMonth(rows);
    expect(months.map((item) => item.month)).toEqual(['2026-09', '2026-10']);
    expect(months[1].revenue).toBe(500000);
    expect(months[0].won).toBe(0);
  });

  it('называет месяц по-русски', () => {
    expect(monthLabel('2026-10')).toBe('октябрь 2026');
  });

  it('сортирует клиентов по выручке', () => {
    const clients = analyticsByClient(rows);
    expect(clients[0].client).toBe('Иван');
    expect(clients[0].revenue).toBe(300000);
  });

  it('считает самые частые модули', () => {
    const projects = [
      { id: 'a', modules: [{ id: 'm1', name: 'Стол под мойку', qty: 1 }, { id: 'm2', name: 'Пенал', qty: 2 }] },
      { id: 'b', modules: [{ id: 'm3', name: 'Стол под мойку', qty: 3 }] },
    ] as unknown as Project[];
    const top = analyticsTopModules(projects);
    expect(top[0]).toEqual({ name: 'Стол под мойку', qty: 4, projects: 2 });
  });
});
