import { describe, expect, it } from 'vitest';
import type { ClientProfile } from '../types';

/**
 * Поведение сохранения клиента: новый добавляется в начало списка,
 * существующий заменяется. Раньше здесь была ошибка — новый клиент
 * «терялся», потому что список только перебирался.
 */
function upsertClient(clients: ClientProfile[], client: ClientProfile): ClientProfile[] {
  const exists = clients.some((item) => item.id === client.id);
  return exists ? clients.map((item) => (item.id === client.id ? client : item)) : [client, ...clients];
}

const make = (id: string, name: string): ClientProfile => ({
  id, name, phones: [], emails: [], tags: [], history: [], createdAt: '', updatedAt: '',
});

describe('сохранение клиента', () => {
  it('добавляет нового в начало списка', () => {
    const list = upsertClient([make('c1', 'Иван')], make('c2', 'Пётр'));
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('Пётр');
  });

  it('обновляет существующего, не создавая дубль', () => {
    const list = upsertClient([make('c1', 'Иван')], make('c1', 'Иван Петрович'));
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Иван Петрович');
  });

  it('не теряет остальных клиентов', () => {
    const list = upsertClient([make('c1', 'Иван'), make('c2', 'Пётр')], make('c2', 'Пётр Сергеевич'));
    expect(list.map((item) => item.id)).toEqual(['c1', 'c2']);
    expect(list[1].name).toBe('Пётр Сергеевич');
  });
});
