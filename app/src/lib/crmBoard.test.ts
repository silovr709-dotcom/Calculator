import { describe, expect, it } from 'vitest';
import { compareCrmRows, focusCounts, matchesFocus, matchesQuery, summarizeStages, toneLabel, type CrmRowLike } from './crmBoard';

const row = (patch: Partial<CrmRowLike>): CrmRowLike => ({
  status: 'offerSent', tone: 'planned', hasNextAction: true, closed: false,
  total: 100000, updatedAt: '2026-10-10T10:00:00Z', search: 'иванов кухня', ...patch,
});

describe('список сделок CRM', () => {
  const rows = [
    row({ tone: 'overdue', updatedAt: '2026-10-01T10:00:00Z' }),
    row({ tone: 'today' }),
    row({ tone: 'none', hasNextAction: false, status: 'draft' }),
    row({ tone: 'planned', closed: true, status: 'delivered', total: 300000 }),
  ];

  it('фокус «сегодня» берёт просроченные и сегодняшние', () => {
    expect(rows.filter((item) => matchesFocus(item, 'today'))).toHaveLength(2);
  });

  it('фокус «без шага» ловит пустой следующий шаг', () => {
    expect(rows.filter((item) => matchesFocus(item, 'no-next'))).toHaveLength(1);
  });

  it('закрытые не попадают в активные', () => {
    expect(rows.filter((item) => matchesFocus(item, 'active'))).toHaveLength(3);
    expect(rows.filter((item) => matchesFocus(item, 'closed'))).toHaveLength(1);
  });

  it('поиск ищет по строке карточки', () => {
    expect(matchesQuery(row({ search: 'Петров кухня угловая' }), 'петров')).toBe(true);
    expect(matchesQuery(row({ search: 'Петров' }), 'сидоров')).toBe(false);
  });

  it('сначала показываются просрочки, потом сегодня', () => {
    const sorted = [...rows].sort(compareCrmRows);
    expect(sorted[0].tone).toBe('overdue');
    expect(sorted[1].tone).toBe('today');
  });

  it('считает воронку по этапам', () => {
    const stages = summarizeStages(rows);
    expect(stages.find((stage) => stage.id === 'offer')?.count).toBe(2);
    expect(stages.find((stage) => stage.id === 'closed')?.total).toBe(300000);
  });

  it('считает счётчики фокусов и активный портфель', () => {
    const counts = focusCounts(rows);
    expect(counts.today).toBe(2);
    expect(counts.active).toBe(3);
    expect(counts.closed).toBe(1);
    expect(counts.pipeline).toBe(300000);
  });

  it('подписывает срок понятным текстом', () => {
    expect(toneLabel('none')).toBe('срок не назначен');
    expect(toneLabel('today')).toBe('сегодня');
    expect(toneLabel('overdue', '2026-10-01')).toContain('просрочено');
  });
});
