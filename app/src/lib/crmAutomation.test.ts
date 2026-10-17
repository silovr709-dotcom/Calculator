import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, normalizeRules, planAutomation, type AutomationInput } from './crmAutomation';
import type { Project } from '../types';

const now = new Date('2026-10-20T10:00:00');
const project = (patch: Partial<Project> = {}): Project =>
  ({ id: 'p1', name: 'Кухня', client: 'Ирина', tasks: [], ...patch } as unknown as Project);

const input = (patch: Partial<AutomationInput>): AutomationInput => ({
  project: project(),
  status: 'offerSent',
  updatedAt: '2026-10-15T10:00:00',
  paid: 0,
  ...patch,
});

describe('автоматические правила CRM', () => {
  it('ставит звонок, если КП висит без ответа', () => {
    const actions = planAutomation(input({}), DEFAULT_RULES, now);
    expect(actions.some((action) => action.ruleId === 'callAfterOffer')).toBe(true);
  });

  it('не дублирует задачу, если автоматика её уже создала', () => {
    const withTask = project({ tasks: [{ id: 't1', title: 'Позвонить', kind: 'call', createdAt: '', origin: 'auto:callAfterOffer' }] as never });
    const actions = planAutomation(input({ project: withTask }), DEFAULT_RULES, now);
    expect(actions.some((action) => action.ruleId === 'callAfterOffer')).toBe(false);
  });

  it('после согласования КП готовит договор и двигает этап', () => {
    const actions = planAutomation(input({ offerApprovedAt: '2026-10-19T12:00:00' }), DEFAULT_RULES, now);
    const action = actions.find((item) => item.ruleId === 'contractAfterApproval');
    expect(action?.nextStatus).toBe('approved');
    expect(action?.task.kind).toBe('docs');
  });

  it('напоминает о предоплате только когда денег нет', () => {
    const withMoney = planAutomation(input({ status: 'approved', paid: 50000 }), DEFAULT_RULES, now);
    expect(withMoney.some((action) => action.ruleId === 'askPrepayment')).toBe(false);
    const without = planAutomation(input({ status: 'approved', paid: 0 }), DEFAULT_RULES, now);
    expect(without.some((action) => action.ruleId === 'askPrepayment')).toBe(true);
  });

  it('после монтажа ставит звонок через заданное число дней', () => {
    const actions = planAutomation(input({ status: 'delivered', installDoneAt: '2026-10-18T10:00:00' }), DEFAULT_RULES, now);
    const action = actions.find((item) => item.ruleId === 'afterInstall');
    expect(action?.task.dueAt).toBe('2026-10-21');
  });

  it('ловит зависшую сделку и не трогает закрытые', () => {
    const stuck = planAutomation(input({ status: 'clientThinking', updatedAt: '2026-10-01T10:00:00' }), DEFAULT_RULES, now);
    expect(stuck.some((action) => action.ruleId === 'stuckDeal')).toBe(true);
    const closed = planAutomation(input({ status: 'rejected', updatedAt: '2026-10-01T10:00:00' }), DEFAULT_RULES, now);
    expect(closed.some((action) => action.ruleId === 'stuckDeal')).toBe(false);
  });

  it('выключенное правило не срабатывает', () => {
    const rules = DEFAULT_RULES.map((rule) => (rule.id === 'callAfterOffer' ? { ...rule, enabled: false } : rule));
    expect(planAutomation(input({}), rules, now).some((action) => action.ruleId === 'callAfterOffer')).toBe(false);
  });

  it('настройки правил чистятся от мусора', () => {
    const rules = normalizeRules([{ id: 'callAfterOffer', days: 999, enabled: false }, { id: 'левое' }]);
    expect(rules.find((rule) => rule.id === 'callAfterOffer')).toMatchObject({ enabled: false, days: 2 });
    expect(rules).toHaveLength(DEFAULT_RULES.length);
  });
});
