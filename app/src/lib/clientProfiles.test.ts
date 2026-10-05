import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { applyClientProfileToProject, ensureClientProfiles, findDuplicateClientGroups, paymentStatusLabel } from './clientProfiles';

function project(id: string, client: string, phone = '+7 999 111-22-33'): Project {
  return {
    id,
    name: `Проект ${id}`,
    client,
    date: '2026-10-05',
    comment: '',
    status: 'draft',
    pricebookId: 'pb',
    pricebookName: 'Прайс',
    lines: [],
    settings: { markupBasePct: null, markupByGroup: {}, extraExpenses: [], applyEmalRule: true, assemblyCost: null, deliveryCost: null },
    clientOffer: { clientPhone: phone, clientEmail: 'client@example.com', clientAddress: 'Адрес объекта' },
    createdAt: '2026-10-05T10:00:00.000Z',
    updatedAt: '2026-10-05T10:00:00.000Z',
  };
}

describe('clientProfiles', () => {
  it('creates a reusable CRM client profile from existing projects and links projects to it', () => {
    let n = 0;
    const result = ensureClientProfiles([project('p1', 'Иванов'), project('p2', 'Иванов', '+7 999 111 22 33')], [], () => `cli_${++n}`);
    expect(result.changed).toBe(true);
    expect(result.clients).toHaveLength(1);
    expect(result.projects.every((item) => item.clientId === result.clients[0].id)).toBe(true);
    expect(result.clients[0].phones).toContain('+79991112233');
  });

  it('applies CRM client contacts back to project documents', () => {
    const base = project('p1', 'Старое имя');
    const hydrated = applyClientProfileToProject(base, {
      id: 'cli_1',
      name: 'Новое имя',
      phones: ['+7 900 000 00 00'],
      emails: ['new@example.com'],
      objectAddress: 'Новый адрес',
      tags: [],
      history: [],
      createdAt: '2026-10-05T10:00:00.000Z',
      updatedAt: '2026-10-05T10:00:00.000Z',
    });
    expect(hydrated.client).toBe('Новое имя');
    expect(hydrated.clientOffer?.clientPhone).toBe('+7 900 000 00 00');
    expect(hydrated.clientOffer?.clientEmail).toBe('new@example.com');
    expect(hydrated.clientOffer?.clientAddress).toBe('Новый адрес');
  });

  it('finds duplicate client cards and calculates payment state', () => {
    const duplicates = findDuplicateClientGroups([
      { id: 'a', name: 'Иванов', phones: ['+7 999 111 22 33'], emails: [], tags: [], history: [], createdAt: '2026-10-05', updatedAt: '2026-10-05' },
      { id: 'b', name: 'Иванов Сергей', phones: ['89991112233'], emails: [], tags: [], history: [], createdAt: '2026-10-05', updatedAt: '2026-10-05' },
    ]);
    expect(duplicates.some((group) => group.reason.includes('телефон'))).toBe(true);
    expect(paymentStatusLabel({ paidTotal: 50_000 }, 120_000)).toMatchObject({ label: 'предоплата', remainder: 70_000 });
    expect(paymentStatusLabel({ paidTotal: 120_000 }, 120_000)).toMatchObject({ label: 'оплачен', remainder: 0 });
  });
});
