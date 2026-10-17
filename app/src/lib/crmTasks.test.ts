import { describe, expect, it } from 'vitest';
import {
  addPayment, addTask, nextTask, openTasks, paidAmount, patchTask, paymentState,
  removePayment, removeTask, sortTasks, taskStats, taskTone, toggleTask,
} from './crmTasks';
import type { CrmTask, Project } from '../types';

const today = new Date('2026-10-15T12:00:00');
const task = (patch: Partial<CrmTask>): CrmTask => ({
  id: 't1', title: 'Позвонить', kind: 'call', createdAt: '2026-10-01T10:00:00Z', ...patch,
});
const project = (tasks: CrmTask[]): Project => ({ id: 'p1', tasks, updatedAt: '2026-10-01T00:00:00Z' } as unknown as Project);

describe('задачи CRM', () => {
  it('определяет срочность по дате', () => {
    expect(taskTone(task({ dueAt: '2026-10-10' }), today)).toBe('overdue');
    expect(taskTone(task({ dueAt: '2026-10-15' }), today)).toBe('today');
    expect(taskTone(task({ dueAt: '2026-10-17' }), today)).toBe('soon');
    expect(taskTone(task({ dueAt: '2026-11-01' }), today)).toBe('later');
    expect(taskTone(task({}), today)).toBe('none');
    expect(taskTone(task({ dueAt: '2026-10-10', done: true }), today)).toBe('done');
  });

  it('сортирует: сначала просрочка, потом сегодня', () => {
    const sorted = sortTasks([
      task({ id: 'later', dueAt: '2026-11-01' }),
      task({ id: 'today', dueAt: '2026-10-15' }),
      task({ id: 'overdue', dueAt: '2026-10-01' }),
    ], today);
    expect(sorted.map((item) => item.id)).toEqual(['overdue', 'today', 'later']);
  });

  it('ближайшая задача — первая невыполненная', () => {
    const p = project([task({ id: 'done', dueAt: '2026-10-01', done: true }), task({ id: 'open', dueAt: '2026-10-20' })]);
    expect(nextTask(p, today)?.id).toBe('open');
    expect(openTasks(p)).toHaveLength(1);
  });

  it('добавляет, правит, закрывает и удаляет задачу', () => {
    let p = addTask(project([]), { title: 'Замер', kind: 'measure', dueAt: '2026-10-20' });
    expect(p.tasks).toHaveLength(1);
    const id = p.tasks![0].id;
    p = patchTask(p, id, { title: 'Замер в 10:00' });
    expect(p.tasks![0].title).toBe('Замер в 10:00');
    p = toggleTask(p, id);
    expect(p.tasks![0].done).toBe(true);
    expect(p.tasks![0].doneAt).toBeTruthy();
    p = removeTask(p, id);
    expect(p.tasks).toHaveLength(0);
  });

  it('считает сводку по всем проектам', () => {
    const stats = taskStats([
      project([task({ id: '1', dueAt: '2026-10-01' }), task({ id: '2', dueAt: '2026-10-15' })]),
      project([task({ id: '3', dueAt: '2026-12-01' }), task({ id: '4', dueAt: '2026-10-01', done: true })]),
    ], today);
    expect(stats).toEqual({ open: 3, overdue: 1, today: 1 });
  });
});

describe('платежи по сделке', () => {
  it('складывает платежи и считает остаток', () => {
    let payment = addPayment(undefined, { amount: 100000, at: '2026-10-01', kind: 'prepay' });
    payment = addPayment(payment, { amount: 50000, at: '2026-10-10', kind: 'final' });
    expect(paidAmount(payment)).toBe(150000);
    const state = paymentState(payment, 240000);
    expect(state.remainder).toBe(90000);
    expect(state.tone).toBe('warn');
  });

  it('полная оплата закрывает остаток', () => {
    const payment = addPayment(undefined, { amount: 240000, at: '2026-10-11', kind: 'final' });
    expect(paymentState(payment, 240000)).toMatchObject({ remainder: 0, tone: 'ok' });
  });

  it('возврат уменьшает оплаченное', () => {
    let payment = addPayment(undefined, { amount: 100000, at: '2026-10-01', kind: 'prepay' });
    payment = addPayment(payment, { amount: -30000, at: '2026-10-05', kind: 'refund' });
    expect(paidAmount(payment)).toBe(70000);
  });

  it('платёж можно удалить, сумма пересчитается', () => {
    let payment = addPayment(undefined, { amount: 100000, at: '2026-10-01', kind: 'prepay' });
    const id = payment.entries![0].id;
    payment = removePayment(payment, id);
    expect(paidAmount(payment)).toBe(0);
  });

  it('старое поле «оплачено» продолжает работать', () => {
    expect(paidAmount({ paidTotal: 55000 })).toBe(55000);
    expect(paymentState({ paidTotal: 55000 }, 100000).remainder).toBe(45000);
  });
});
