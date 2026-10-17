// Автоматические правила CRM: система сама ставит задачи и двигает этапы,
// чтобы сделки не повисали. Логика чистая — её легко проверить тестами.

import type { CrmTaskKind, OrderWorkflowStatus, Project } from '../types';

export type RuleId = 'callAfterOffer' | 'contractAfterApproval' | 'askPrepayment' | 'afterInstall' | 'stuckDeal';

export interface AutomationRule {
  id: RuleId;
  label: string;
  hint: string;
  /** Через сколько дней срабатывает. */
  days: number;
  enabled: boolean;
}

export const DEFAULT_RULES: AutomationRule[] = [
  { id: 'callAfterOffer', label: 'Позвонить после КП', hint: 'если клиент не ответил на отправленное предложение', days: 2, enabled: true },
  { id: 'contractAfterApproval', label: 'Договор после согласования', hint: 'клиент согласовал КП по ссылке — готовим документы', days: 0, enabled: true },
  { id: 'askPrepayment', label: 'Запросить предоплату', hint: 'сделка согласована, но денег нет', days: 3, enabled: true },
  { id: 'afterInstall', label: 'Позвонить после монтажа', hint: 'узнать впечатления и попросить рекомендацию', days: 3, enabled: true },
  { id: 'stuckDeal', label: 'Сделка зависла', hint: 'по активной сделке давно нет движения', days: 10, enabled: true },
];

export interface AutomationInput {
  project: Project;
  status: OrderWorkflowStatus;
  updatedAt: string;
  paid: number;
  /** Клиент согласовал КП по ссылке. */
  offerApprovedAt?: string | null;
  /** Монтаж выполнен (отметка мастера или статус в графике). */
  installDoneAt?: string | null;
}

export interface AutomationAction {
  ruleId: RuleId;
  projectId: string;
  /** Задача, которую нужно поставить. */
  task: { title: string; kind: CrmTaskKind; dueAt: string; origin: string };
  /** Если правило требует сменить этап. */
  nextStatus?: OrderWorkflowStatus;
}

function day(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function addDays(from: Date, days: number): string {
  const date = new Date(from);
  date.setDate(date.getDate() + days);
  return day(date);
}

function daysBetween(fromIso: string, now: Date): number {
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return 0;
  return Math.floor((now.getTime() - from.getTime()) / 86400000);
}

function hasAutoTask(project: Project, ruleId: RuleId): boolean {
  return (project.tasks ?? []).some((task) => task.origin === `auto:${ruleId}` && !task.done);
}

/** Какие задачи нужно создать прямо сейчас. Повторы исключены по метке origin. */
export function planAutomation(input: AutomationInput, rules: AutomationRule[], now = new Date()): AutomationAction[] {
  const actions: AutomationAction[] = [];
  const enabled = (id: RuleId) => rules.find((rule) => rule.id === id && rule.enabled);
  const client = input.project.client || 'клиент';

  const callRule = enabled('callAfterOffer');
  if (callRule && (input.status === 'offerSent' || input.status === 'clientThinking')
    && daysBetween(input.updatedAt, now) >= callRule.days && !hasAutoTask(input.project, 'callAfterOffer')) {
    actions.push({
      ruleId: 'callAfterOffer',
      projectId: input.project.id,
      task: { title: `Позвонить ${client}: узнать решение по КП`, kind: 'call', dueAt: day(now), origin: 'auto:callAfterOffer' },
    });
  }

  const contractRule = enabled('contractAfterApproval');
  if (contractRule && input.offerApprovedAt && !hasAutoTask(input.project, 'contractAfterApproval')) {
    actions.push({
      ruleId: 'contractAfterApproval',
      projectId: input.project.id,
      task: { title: `Подготовить договор: ${client} согласовал КП`, kind: 'docs', dueAt: day(now), origin: 'auto:contractAfterApproval' },
      nextStatus: input.status === 'offerSent' || input.status === 'clientThinking' ? 'approved' : undefined,
    });
  }

  const prepayRule = enabled('askPrepayment');
  if (prepayRule && (input.status === 'approved' || input.status === 'techCheck') && input.paid <= 0
    && daysBetween(input.updatedAt, now) >= prepayRule.days && !hasAutoTask(input.project, 'askPrepayment')) {
    actions.push({
      ruleId: 'askPrepayment',
      projectId: input.project.id,
      task: { title: `Запросить предоплату у ${client}`, kind: 'payment', dueAt: day(now), origin: 'auto:askPrepayment' },
    });
  }

  const afterInstallRule = enabled('afterInstall');
  if (afterInstallRule && input.installDoneAt && !hasAutoTask(input.project, 'afterInstall')) {
    actions.push({
      ruleId: 'afterInstall',
      projectId: input.project.id,
      task: {
        title: `Позвонить ${client} после монтажа: впечатления и отзыв`,
        kind: 'call',
        dueAt: addDays(new Date(input.installDoneAt), afterInstallRule.days),
        origin: 'auto:afterInstall',
      },
    });
  }

  const stuckRule = enabled('stuckDeal');
  const closed = input.status === 'delivered' || input.status === 'rejected';
  if (stuckRule && !closed && daysBetween(input.updatedAt, now) >= stuckRule.days && !hasAutoTask(input.project, 'stuckDeal')) {
    actions.push({
      ruleId: 'stuckDeal',
      projectId: input.project.id,
      task: {
        title: `Сделка без движения ${daysBetween(input.updatedAt, now)} дн. — связаться с ${client}`,
        kind: 'call',
        dueAt: day(now),
        origin: 'auto:stuckDeal',
      },
    });
  }

  return actions;
}

export function normalizeRules(raw: unknown): AutomationRule[] {
  const saved = Array.isArray(raw) ? (raw as Array<Partial<AutomationRule>>) : [];
  return DEFAULT_RULES.map((rule) => {
    const found = saved.find((item) => item?.id === rule.id);
    if (!found) return rule;
    const days = Number(found.days);
    return {
      ...rule,
      enabled: found.enabled !== false,
      days: Number.isFinite(days) && days >= 0 && days <= 90 ? Math.round(days) : rule.days,
    };
  });
}
