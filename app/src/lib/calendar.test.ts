import { describe, expect, it } from 'vitest';
import {
  agendaByDay, buildAgenda, eventAgenda, filterAgenda, isMine, makeEvent, patchEvent,
  peopleFromAgenda, remindersFor, removeEvent,
} from './calendar';
import type { CalendarEvent, Project } from '../types';

const event = (patch: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'e1', title: 'Замер у Ивановых', kind: 'measure', date: '2026-10-20',
  assignees: ['Пётр'], status: 'planned', createdAt: '', updatedAt: '', ...patch,
});

const project = { id: 'p1', name: 'Кухня Сидоров', client: 'Сидоров', schedule: { installAt: '2026-10-21', team: 'Бригада 1', address: 'ул. Мира' } } as unknown as Project;

describe('календарь работ', () => {
  it('своё дело можно создать без проекта', () => {
    const created = makeEvent({ title: 'Выезд на объект', date: '2026-10-22' }, 'admin');
    expect(created.projectId).toBeUndefined();
    expect(created.id).toMatch(/^evt_/);
    expect(created.createdBy).toBe('admin');
  });

  it('многодневное дело занимает все дни', () => {
    const items = eventAgenda([event({ days: 3 })]);
    expect(items.map((item) => item.date)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
    expect(items[2].dayIndex).toBe(3);
  });

  it('в ленту попадают и дела, и даты заказов', () => {
    const agenda = buildAgenda([project], [event({})]);
    expect(agenda.map((item) => item.source)).toEqual(['event', 'project']);
  });

  it('фильтр «мои» показывает только свои дела', () => {
    const agenda = buildAgenda([project], [event({}), event({ id: 'e2', assignees: ['Анна'] })]);
    const mine = filterAgenda(agenda, { assignee: 'пётр' });
    expect(mine).toHaveLength(1);
    expect(mine[0].assignees).toEqual(['Пётр']);
  });

  it('дело без исполнителя не считается чужим только при пустом фильтре', () => {
    const item = { assignees: [] } as never;
    expect(isMine(item, '')).toBe(true);
    expect(isMine(item, 'Анна')).toBe(false);
  });

  it('группировка по дням складывает совпадающие даты', () => {
    const agenda = buildAgenda([project], [event({ date: '2026-10-21' })]);
    expect(agendaByDay(agenda).get('2026-10-21')).toHaveLength(2);
  });

  it('список сотрудников собирается из дел', () => {
    const agenda = buildAgenda([project], [event({}), event({ id: 'e2', assignees: ['анна', 'Пётр'] })]);
    // Имя сохраняется в том виде, как его ввели первый раз.
    expect(peopleFromAgenda(agenda)).toEqual(['анна', 'Бригада 1', 'Пётр']);
  });

  it('напоминания берут просроченное, сегодня и завтра', () => {
    const agenda = buildAgenda([], [
      event({ id: 'past', date: '2026-10-18' }),
      event({ id: 'now', date: '2026-10-20' }),
      event({ id: 'next', date: '2026-10-21' }),
      event({ id: 'later', date: '2026-10-30' }),
    ]);
    const reminders = remindersFor(agenda, 'Пётр', '2026-10-20');
    expect(reminders.map((item) => item.tone)).toEqual(['overdue', 'today', 'tomorrow']);
  });

  it('выполненные дела не напоминают о себе', () => {
    const agenda = buildAgenda([], [event({ done: true })]);
    expect(remindersFor(agenda, 'Пётр', '2026-10-20')).toHaveLength(0);
  });

  it('дело можно изменить и удалить', () => {
    const list = [event({})];
    const patched = patchEvent(list, 'e1', { title: 'Перенесли' });
    expect(patched[0].title).toBe('Перенесли');
    expect(patched[0].updatedAt).not.toBe('');
    expect(removeEvent(patched, 'e1')).toHaveLength(0);
  });
});
