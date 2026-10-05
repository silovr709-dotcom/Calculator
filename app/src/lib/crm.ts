import type { OrderWorkflow, OrderWorkflowStatus, Project } from '../types';

export interface OrderWorkflowStatusMeta {
  value: OrderWorkflowStatus;
  label: string;
  hint: string;
  stage: 'lead' | 'offer' | 'approved' | 'production' | 'closed';
}

export const ORDER_WORKFLOW_STATUSES: OrderWorkflowStatusMeta[] = [
  { value: 'draft', label: 'Черновик', hint: 'собираем исходные данные', stage: 'lead' },
  { value: 'calculating', label: 'На просчёте', hint: 'комплектуем и считаем', stage: 'lead' },
  { value: 'offerSent', label: 'КП отправлено', hint: 'ждём реакцию клиента', stage: 'offer' },
  { value: 'clientThinking', label: 'Клиент думает', hint: 'следующий контакт обязателен', stage: 'offer' },
  { value: 'approved', label: 'Согласовано', hint: 'можно отдавать технологу', stage: 'approved' },
  { value: 'techCheck', label: 'На проверке технолога', hint: 'проверка перед фабрикой', stage: 'approved' },
  { value: 'factorySent', label: 'Передано на фабрику', hint: 'пакет отправлен', stage: 'production' },
  { value: 'production', label: 'В производстве', hint: 'контроль сроков', stage: 'production' },
  { value: 'ready', label: 'Готово', hint: 'готово к выдаче', stage: 'production' },
  { value: 'delivered', label: 'Выдано', hint: 'заказ закрыт', stage: 'closed' },
  { value: 'rejected', label: 'Отказ', hint: 'зафиксировать причину', stage: 'closed' },
];

export function workflowStatusMeta(status: OrderWorkflowStatus): OrderWorkflowStatusMeta {
  return ORDER_WORKFLOW_STATUSES.find((item) => item.value === status) ?? ORDER_WORKFLOW_STATUSES[0];
}

export function workflowForProject(project: Project): OrderWorkflow {
  if (project.orderWorkflow?.status) return project.orderWorkflow;
  const status = project.status === 'sent' ? 'offerSent' : project.status === 'approved' ? 'approved' : project.status === 'archived' ? 'rejected' : 'draft';
  return { status };
}

export function projectStatusForWorkflow(status: OrderWorkflowStatus, fallback: Project['status']): Project['status'] {
  if (status === 'draft' || status === 'calculating') return 'draft';
  if (status === 'offerSent' || status === 'clientThinking') return 'sent';
  if (status === 'approved' || status === 'techCheck' || status === 'factorySent' || status === 'production' || status === 'ready' || status === 'delivered') return 'approved';
  if (status === 'rejected') return 'archived';
  return fallback === 'archived' ? 'draft' : fallback;
}

export function isClosedWorkflowStatus(status: OrderWorkflowStatus): boolean {
  return status === 'delivered' || status === 'rejected';
}

export type NextContactTone = 'none' | 'overdue' | 'today' | 'soon' | 'planned';

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function nextContactTone(value?: string, now = new Date()): NextContactTone {
  if (!value) return 'none';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'none';
  const day = startOfDay(date).getTime();
  const today = startOfDay(now).getTime();
  const diffDays = Math.round((day - today) / 86400000);
  if (diffDays < 0) return 'overdue';
  if (diffDays === 0) return 'today';
  if (diffDays <= 3) return 'soon';
  return 'planned';
}

export function dateInputValue(value?: string): string {
  if (!value) return '';
  return value.slice(0, 10);
}

export function dateInputToIso(value: string): string | undefined {
  return value ? new Date(`${value}T12:00:00`).toISOString() : undefined;
}

export function scheduleDate(daysFromNow: number, now = new Date()): string {
  const date = new Date(now);
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
}

export function defaultNextAction(status: OrderWorkflowStatus): string {
  switch (status) {
    case 'draft': return 'Собрать исходные данные и замер';
    case 'calculating': return 'Досчитать комплект и подготовить КП';
    case 'offerSent': return 'Связаться с клиентом после отправки КП';
    case 'clientThinking': return 'Уточнить решение клиента и возражения';
    case 'approved': return 'Подготовить договор, чек и пакет на проверку';
    case 'techCheck': return 'Проверить замечания технолога';
    case 'factorySent': return 'Получить подтверждение фабрики';
    case 'production': return 'Проверить срок производства и готовность';
    case 'ready': return 'Согласовать выдачу, доставку или монтаж';
    case 'delivered': return 'Закрыть заказ и запросить отзыв';
    case 'rejected': return 'Зафиксировать причину отказа';
    default: return 'Следующий контакт с клиентом';
  }
}

export function normalizeClientName(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU') || 'без клиента';
}
