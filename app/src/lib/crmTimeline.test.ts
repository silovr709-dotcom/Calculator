import { describe, expect, it } from 'vitest';
import { buildDealTimeline } from './crmTimeline';
import type { ClientHistoryEntry, Project } from '../types';

const project = {
  id: 'p1',
  createdAt: '2026-10-01T09:00:00Z',
  tasks: [
    { id: 't1', title: 'Позвонить', kind: 'call', createdAt: '2026-10-02T09:00:00Z', dueAt: '2026-10-03', done: true, doneAt: '2026-10-03T12:00:00Z' },
  ],
} as unknown as Project;

const history: ClientHistoryEntry[] = [
  { id: 'h1', createdAt: '2026-10-04T09:00:00Z', kind: 'document', title: 'Договор сформирован', projectId: 'p1' },
  { id: 'h2', createdAt: '2026-10-05T09:00:00Z', kind: 'note', title: 'Чужая заметка', projectId: 'other' },
];

describe('лента событий сделки', () => {
  const events = buildDealTimeline({
    project,
    history,
    payment: { entries: [{ id: 'pay1', amount: 120000, at: '2026-10-06T10:00:00Z', kind: 'prepay' }] },
    offer: { createdAt: '2026-10-03T08:00:00Z', views: 3, lastViewAt: '2026-10-07T08:00:00Z', approvedAt: '2026-10-08T08:00:00Z', approvedBy: 'Ирина' },
  });

  it('новые события идут первыми', () => {
    expect(events[0].title).toBe('Клиент согласовал КП');
    expect(events[events.length - 1].title).toBe('Сделка создана');
  });

  it('собирает задачи, оплаты, документы и действия клиента', () => {
    const kinds = new Set(events.map((event) => event.kind));
    expect(kinds.has('task')).toBe(true);
    expect(kinds.has('payment')).toBe(true);
    expect(kinds.has('document')).toBe(true);
    expect(kinds.has('offer')).toBe(true);
  });

  it('не показывает события чужих проектов', () => {
    expect(events.some((event) => event.title === 'Чужая заметка')).toBe(false);
  });

  it('показывает и постановку, и выполнение задачи', () => {
    expect(events.filter((event) => event.kind === 'task')).toHaveLength(2);
  });

  it('сумму платежа пишет по-русски', () => {
    expect(events.find((event) => event.kind === 'payment')?.title).toContain('₽');
  });
});
