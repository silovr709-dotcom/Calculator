import { describe, expect, it } from 'vitest';
import { can, capabilitiesFor, normalizeRole, ROLE_LABELS } from './permissions';

describe('права доступа по ролям', () => {
  it('владелец видит всё', () => {
    expect(can('admin', 'viewCost')).toBe(true);
    expect(can('admin', 'manageUsers')).toBe(true);
  });

  it('менеджер не видит закупку и не правит сотрудников', () => {
    expect(can('manager', 'viewClientPrices')).toBe(true);
    expect(can('manager', 'viewCost')).toBe(false);
    expect(can('manager', 'manageUsers')).toBe(false);
  });

  it('замерщик работает с проектом, но без цен', () => {
    expect(can('measurer', 'editProjects')).toBe(true);
    expect(can('measurer', 'viewClientPrices')).toBe(false);
  });

  it('монтажник не видит проекты и цены', () => {
    expect(can('installer', 'editProjects')).toBe(false);
    expect(can('installer', 'viewClientPrices')).toBe(false);
  });

  it('старая роль user приравнивается к менеджеру', () => {
    expect(normalizeRole('user')).toBe('manager');
    expect(normalizeRole(undefined)).toBe('manager');
    expect(ROLE_LABELS[normalizeRole('user')]).toBe('Менеджер');
  });

  it('без сервера ограничений нет', () => {
    expect(capabilitiesFor('installer', false).viewCost).toBe(true);
    expect(capabilitiesFor('installer', true).viewCost).toBe(false);
  });
});
