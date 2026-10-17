import { describe, expect, it } from 'vitest';
import {
  addDays, collectEvents, eventsByDay, monthGrid, projectEvents, scheduleFieldForKind,
  scheduleWarnings, teamLoad, upcomingEvents, weekGrid,
} from './schedule';
import type { Project } from '../types';

const project = (id: string, schedule: Project['schedule'], name = `Кухня ${id}`): Project =>
  ({ id, name, client: 'Иванов', schedule } as unknown as Project);

describe('график работ', () => {
  it('раскладывает даты проекта по событиям', () => {
    const events = projectEvents(project('p1', { measureAt: '2026-10-05', readyAt: '2026-11-01', deliveryAt: '2026-11-03', installAt: '2026-11-04' }));
    expect(events.map((event) => event.kind)).toEqual(['measure', 'ready', 'delivery', 'install']);
  });

  it('монтаж на несколько дней занимает каждый день', () => {
    const events = projectEvents(project('p1', { installAt: '2026-11-04', installDays: 3 }));
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.date)).toEqual(['2026-11-04', '2026-11-05', '2026-11-06']);
    expect(events[1].dayIndex).toBe(2);
    expect(events[1].dayCount).toBe(3);
  });

  it('события группируются по дням', () => {
    const map = eventsByDay(collectEvents([
      project('p1', { installAt: '2026-11-04' }),
      project('p2', { deliveryAt: '2026-11-04' }),
    ]));
    expect(map.get('2026-11-04')).toHaveLength(2);
  });

  it('сетка месяца начинается с понедельника и содержит 42 дня', () => {
    const grid = monthGrid(new Date('2026-11-15T12:00:00'));
    expect(grid).toHaveLength(42);
    expect(new Date(`${grid[0]}T00:00:00`).getDay()).toBe(1);
  });

  it('неделя строится от понедельника', () => {
    const week = weekGrid(new Date('2026-11-12T12:00:00'));
    expect(week[0]).toBe('2026-11-09');
    expect(week).toHaveLength(7);
  });

  it('предупреждает о монтаже раньше готовности', () => {
    const warnings = scheduleWarnings([project('p1', { readyAt: '2026-11-10', installAt: '2026-11-05', team: 'Бригада 1', address: 'ул. Ленина' })]);
    expect(warnings.some((item) => item.text.includes('раньше готовности'))).toBe(true);
  });

  it('ловит занятость одной бригады в один день', () => {
    const warnings = scheduleWarnings([
      project('p1', { installAt: '2026-11-05', team: 'Бригада 1', address: 'адрес' }),
      project('p2', { installAt: '2026-11-05', team: 'Бригада 1', address: 'адрес' }, 'Кухня соседа'),
    ]);
    expect(warnings.some((item) => item.text.includes('одновременно 2 монтажа'))).toBe(true);
  });

  it('напоминает про адрес и бригаду', () => {
    const warnings = scheduleWarnings([project('p1', { installAt: '2026-11-05' })]);
    expect(warnings.some((item) => item.text.includes('адрес'))).toBe(true);
    expect(warnings.some((item) => item.text.includes('бригада'))).toBe(true);
  });

  it('ближайшие события ограничены окном', () => {
    const events = collectEvents([
      project('p1', { installAt: '2026-11-05' }),
      project('p2', { installAt: '2026-12-20' }),
    ]);
    expect(upcomingEvents(events, '2026-11-01', 14)).toHaveLength(1);
  });

  it('считает загрузку бригад', () => {
    const load = teamLoad(collectEvents([
      project('p1', { installAt: '2026-11-05', installDays: 2, team: 'Бригада 1' }),
      project('p2', { installAt: '2026-11-09', team: 'Бригада 1' }),
      project('p3', { installAt: '2026-11-09', team: 'Бригада 2' }),
    ]));
    expect(load[0]).toEqual({ team: 'Бригада 1', days: 3, projects: 2 });
  });

  it('перенос мышью знает, какую дату менять', () => {
    expect(scheduleFieldForKind('measure')).toBe('measureAt');
    expect(scheduleFieldForKind('delivery')).toBe('deliveryAt');
    expect(scheduleFieldForKind('install')).toBe('installAt');
    expect(scheduleFieldForKind('ready')).toBe('readyAt');
  });

  it('сдвиг дат не ломается на границе месяца', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});
