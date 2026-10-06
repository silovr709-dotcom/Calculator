import type { ClientProfile, ClientProjectDocuments, ClientProjectPayment, Pricebook, Project } from '../types';
import { calcTotals } from './engine';
import { moduleToLines } from './modules';
import { validateProject } from './validation';
import { findClientForProject } from './clientProfiles';
import { defaultNextAction, isClosedWorkflowStatus, nextContactTone, workflowForProject, workflowStatusMeta } from './crm';

export type WorkMode = 'manager' | 'calculator' | 'production';
export type WorkflowTone = 'good' | 'info' | 'warn' | 'danger' | 'muted';

export interface ProjectWorkflowTotal {
  client: number;
  cost: number;
  unpricedCount: number;
  marginPct: number | null;
  linesCount: number;
  modulesCount: number;
}

export interface ProjectNextStep {
  key: string;
  title: string;
  detail: string;
  actionLabel: string;
  target: 'project' | 'modules' | 'check' | 'client' | 'crm' | 'factory' | 'sketch' | 'payment';
  tone: WorkflowTone;
}

export interface ProjectActionAlert {
  id: string;
  projectId: string;
  projectName: string;
  clientName: string;
  title: string;
  detail: string;
  tone: WorkflowTone;
  target: ProjectNextStep['target'];
}

export interface DayDeskSummary {
  contactsToday: number;
  overdueContacts: number;
  noNextStep: number;
  offersWaiting: number;
  missingClient: number;
  missingPhone: number;
  missingPayment: number;
  readyForFactory: number;
  factoryNotExported: number;
  problems: number;
  tasks: ProjectActionAlert[];
}

export const WORK_MODE_LABELS: Record<WorkMode, { label: string; hint: string; primary: string }> = {
  manager: { label: 'Менеджер', hint: 'CRM, КП, договоры, оплаты и контакты', primary: 'Клиенты и задачи' },
  calculator: { label: 'Расчётчик', hint: 'модули, прайс, фасады, фурнитура, проверка', primary: 'Состав и цена' },
  production: { label: 'Производство', hint: 'Эскиз PRO, техпакет, фабрика, столешница', primary: 'Фабрика и техпакет' },
};

export function projectClient(project: Project, clients: ClientProfile[]): ClientProfile | null {
  return findClientForProject(project, clients) ?? null;
}

export function projectDocuments(project: Project, client?: ClientProfile | null): ClientProjectDocuments {
  return client?.documentsByProject?.[project.id] ?? {};
}

export function projectPayment(project: Project, client?: ClientProfile | null): ClientProjectPayment {
  return client?.paymentsByProject?.[project.id] ?? {};
}

export function calcProjectWorkflowTotal(project: Project, pricebook: Pricebook | null | undefined): ProjectWorkflowTotal {
  if (!pricebook) {
    return { client: 0, cost: 0, unpricedCount: 0, marginPct: null, linesCount: project.lines.length, modulesCount: project.modules?.length ?? 0 };
  }
  const moduleLines = (project.modules ?? []).flatMap((module) => moduleToLines(module, project.moduleDefaults ?? {}, pricebook));
  const lines = [...moduleLines, ...project.lines];
  const result = calcTotals(lines, project.settings);
  return {
    client: result.totals.client,
    cost: result.totals.cost,
    unpricedCount: result.totals.unpricedCount,
    marginPct: result.totals.marginPct,
    linesCount: lines.length,
    modulesCount: project.modules?.length ?? 0,
  };
}

function paidAmount(payment: ClientProjectPayment): number {
  return payment.paidTotal ?? payment.prepayment ?? 0;
}

function hasPhone(project: Project, client?: ClientProfile | null): boolean {
  return Boolean(client?.phones?.some((phone) => phone.trim()) || project.clientOffer?.clientPhone?.trim() || /\d{6,}/.test(project.clientOffer?.clientContacts ?? ''));
}

function hasWorktop(project: Project): boolean {
  return project.lines.some((line) => /столешниц/i.test(`${line.category} ${line.group} ${line.name}`));
}

function isFactoryDocumentReady(docs: ClientProjectDocuments): boolean {
  return docs.factoryBlank === 'created' || docs.factoryBlank === 'sent' || docs.factoryBlank === 'approved';
}

export function projectNextStep(project: Project, pricebook: Pricebook | null | undefined, client?: ClientProfile | null): ProjectNextStep {
  const workflow = workflowForProject(project);
  const workflowMeta = workflowStatusMeta(workflow.status);
  const docs = projectDocuments(project, client);
  const payment = projectPayment(project, client);
  const total = calcProjectWorkflowTotal(project, pricebook);
  const validation = pricebook ? validateProject(project, pricebook) : null;
  const hasComposition = total.modulesCount > 0 || project.lines.length > 0;
  const hasClient = Boolean(project.client?.trim() || client?.name?.trim());
  const tone = nextContactTone(workflow.nextContactAt);

  if (!hasClient) {
    return { key: 'client-missing', title: 'Укажите клиента', detail: 'Без клиента КП, договор и история не будут связаны с CRM.', actionLabel: 'Открыть данные проекта', target: 'crm', tone: 'warn' };
  }
  if (!hasComposition) {
    return { key: 'composition-empty', title: 'Добавьте состав кухни', detail: 'Начните с модулей или дополнительных позиций, чтобы появилась цена.', actionLabel: 'Добавить модули', target: 'modules', tone: 'warn' };
  }
  if ((validation?.errors.length ?? 0) > 0) {
    return { key: 'validation-errors', title: 'Исправьте ошибки расчёта', detail: `Критичных ошибок: ${validation?.errors.length ?? 0}. После этого можно собирать КП и фабрику.`, actionLabel: 'Открыть проверку', target: 'check', tone: 'danger' };
  }
  if (total.unpricedCount > 0) {
    return { key: 'unpriced', title: 'Закройте позиции без цены', detail: `Без цены: ${total.unpricedCount}. Итог для клиента может быть неполным.`, actionLabel: 'Открыть проверку', target: 'check', tone: 'danger' };
  }
  if ((workflow.status === 'offerSent' || workflow.status === 'clientThinking') && (tone === 'overdue' || tone === 'today' || tone === 'none' || !workflow.nextAction?.trim())) {
    return { key: 'contact-due', title: tone === 'overdue' ? 'Просрочен контакт с клиентом' : tone === 'today' ? 'Связаться с клиентом сегодня' : 'Назначьте следующий контакт', detail: workflow.nextAction || defaultNextAction(workflow.status), actionLabel: 'Открыть CRM', target: 'crm', tone: tone === 'overdue' ? 'danger' : 'warn' };
  }
  if (workflow.status === 'draft' || workflow.status === 'calculating') {
    return { key: 'prepare-offer', title: docs.offer === 'created' ? 'Отправьте КП клиенту' : 'Соберите КП клиенту', detail: 'Проверьте компактное КП, условия, срок и пакет документов.', actionLabel: 'Открыть КП', target: 'client', tone: 'info' };
  }
  if ((workflow.status === 'approved' || workflow.status === 'techCheck') && docs.contract !== 'created' && docs.contract !== 'sent' && docs.contract !== 'approved') {
    return { key: 'contract', title: 'Подготовьте договор', detail: 'Проект согласован — нужен договор, чек и фиксация условий.', actionLabel: 'Документы клиента', target: 'client', tone: 'warn' };
  }
  if ((workflow.status === 'approved' || workflow.status === 'techCheck') && paidAmount(payment) <= 0) {
    return { key: 'prepayment', title: 'Зафиксируйте предоплату', detail: 'Перед фабрикой лучше видеть оплачено/остаток в CRM.', actionLabel: 'Открыть оплату', target: 'payment', tone: 'warn' };
  }
  if ((workflow.status === 'approved' || workflow.status === 'techCheck') && !isFactoryDocumentReady(docs)) {
    return { key: 'factory', title: 'Передать на фабрику', detail: 'Проверьте бланк, Эскиз PRO, коммуникации и столешницу.', actionLabel: 'Бланк фабрики', target: 'factory', tone: 'info' };
  }
  if (workflow.status === 'factorySent' || workflow.status === 'production') {
    return { key: 'production-control', title: 'Контроль производства', detail: workflow.nextAction || defaultNextAction(workflow.status), actionLabel: 'Открыть CRM', target: 'crm', tone: 'info' };
  }
  if (workflow.status === 'ready') {
    return { key: 'delivery', title: 'Согласуйте выдачу / монтаж', detail: 'Зафиксируйте остаток оплаты и дату выдачи.', actionLabel: 'Открыть CRM', target: 'crm', tone: 'good' };
  }
  if (isClosedWorkflowStatus(workflow.status)) {
    return { key: 'closed', title: workflowMeta.label, detail: workflowMeta.hint, actionLabel: 'Открыть проект', target: 'project', tone: 'muted' };
  }
  return { key: 'next-action', title: workflow.nextAction || defaultNextAction(workflow.status), detail: workflowMeta.hint, actionLabel: 'Открыть проект', target: 'project', tone: 'info' };
}

export function buildProjectActionAlerts(project: Project, pricebook: Pricebook | null | undefined, client?: ClientProfile | null): ProjectActionAlert[] {
  const workflow = workflowForProject(project);
  const docs = projectDocuments(project, client);
  const payment = projectPayment(project, client);
  const validation = pricebook ? validateProject(project, pricebook) : null;
  const total = calcProjectWorkflowTotal(project, pricebook);
  const alerts: ProjectActionAlert[] = [];
  const base = { projectId: project.id, projectName: project.name, clientName: client?.name || project.client || 'Без клиента' };
  const push = (alert: Omit<ProjectActionAlert, 'projectId' | 'projectName' | 'clientName'>) => alerts.push({ ...base, ...alert });

  if (!project.client?.trim() && !client?.name?.trim()) push({ id: 'no-client', title: 'Проект без клиента', detail: 'КП и договор не будут связаны с карточкой клиента.', tone: 'warn', target: 'crm' });
  if (!hasPhone(project, client)) push({ id: 'no-phone', title: 'Нет телефона клиента', detail: 'Сложно отправить КП и назначить следующий контакт.', tone: 'warn', target: 'crm' });
  if (!workflow.nextAction?.trim() || nextContactTone(workflow.nextContactAt) === 'none') push({ id: 'no-next', title: 'Нет следующего шага или даты', detail: defaultNextAction(workflow.status), tone: 'warn', target: 'crm' });
  if (nextContactTone(workflow.nextContactAt) === 'overdue') push({ id: 'overdue', title: 'Просрочен контакт', detail: workflow.nextAction || defaultNextAction(workflow.status), tone: 'danger', target: 'crm' });
  if ((validation?.errors.length ?? 0) > 0) push({ id: 'errors', title: 'Ошибки перед документами', detail: `Критичных ошибок: ${validation?.errors.length ?? 0}.`, tone: 'danger', target: 'check' });
  if (total.unpricedCount > 0) push({ id: 'unpriced', title: 'Есть строки без цены', detail: `Без цены: ${total.unpricedCount}.`, tone: 'danger', target: 'check' });
  if (docs.offer === 'created') push({ id: 'offer-created', title: 'КП создано, но не отправлено', detail: 'Отметьте отправку и назначьте контакт через 2 дня.', tone: 'info', target: 'client' });
  if ((workflow.status === 'approved' || workflow.status === 'techCheck') && docs.contract !== 'created' && docs.contract !== 'sent' && docs.contract !== 'approved') push({ id: 'no-contract', title: 'Согласовано, но нет договора', detail: 'Подготовьте договор и товарный чек.', tone: 'warn', target: 'client' });
  if ((workflow.status === 'approved' || workflow.status === 'techCheck') && paidAmount(payment) <= 0) push({ id: 'no-payment', title: 'Нет предоплаты', detail: 'Перед фабрикой зафиксируйте сумму оплаты.', tone: 'warn', target: 'payment' });
  if ((workflow.status === 'approved' || workflow.status === 'techCheck') && !isFactoryDocumentReady(docs)) push({ id: 'no-factory', title: 'Готово к фабрике, но бланк не выгружен', detail: 'Проверьте Эскиз PRO и официальный Excel-бланк.', tone: 'info', target: 'factory' });
  if (hasWorktop(project) && (!project.worktopPlan || project.worktopPlan.length === 0)) push({ id: 'no-worktop-plan', title: 'Есть столешница, но нет схемы', detail: 'Схема столешницы нужна для листа 2 фабричного бланка.', tone: 'warn', target: 'factory' });
  if ((workflow.status === 'techCheck' || workflow.status === 'factorySent') && !(project.eskizPro?.snapshots?.length ?? 0)) push({ id: 'no-sketch', title: 'Нет Эскиз PRO для фабрики', detail: 'Добавьте snapshot или вложите отдельный эскиз в бланк.', tone: 'warn', target: 'sketch' });

  const toneRank: Record<WorkflowTone, number> = { danger: 0, warn: 1, info: 2, good: 3, muted: 4 };
  return alerts.sort((a, b) => toneRank[a.tone] - toneRank[b.tone] || a.title.localeCompare(b.title, 'ru'));
}

export function buildDayDesk(projects: Project[], pricebooks: Pricebook[], clients: ClientProfile[]): DayDeskSummary {
  const allAlerts: ProjectActionAlert[] = [];
  const summary: DayDeskSummary = {
    contactsToday: 0,
    overdueContacts: 0,
    noNextStep: 0,
    offersWaiting: 0,
    missingClient: 0,
    missingPhone: 0,
    missingPayment: 0,
    readyForFactory: 0,
    factoryNotExported: 0,
    problems: 0,
    tasks: [],
  };

  for (const project of projects) {
    const client = projectClient(project, clients);
    const pricebook = pricebooks.find((item) => item.meta.id === project.pricebookId) ?? pricebooks[0] ?? null;
    const workflow = workflowForProject(project);
    if (isClosedWorkflowStatus(workflow.status)) continue;
    const docs = projectDocuments(project, client);
    const payment = projectPayment(project, client);
    const tone = nextContactTone(workflow.nextContactAt);
    const alerts = buildProjectActionAlerts(project, pricebook, client);
    allAlerts.push(...alerts);

    if (tone === 'today') summary.contactsToday += 1;
    if (tone === 'overdue') summary.overdueContacts += 1;
    if (!workflow.nextAction?.trim() || tone === 'none') summary.noNextStep += 1;
    if (workflow.status === 'offerSent' || workflow.status === 'clientThinking') summary.offersWaiting += 1;
    if (!project.client?.trim() && !client?.name?.trim()) summary.missingClient += 1;
    if (!hasPhone(project, client)) summary.missingPhone += 1;
    if ((workflow.status === 'approved' || workflow.status === 'techCheck') && paidAmount(payment) <= 0) summary.missingPayment += 1;
    if ((workflow.status === 'approved' || workflow.status === 'techCheck') && paidAmount(payment) > 0) summary.readyForFactory += 1;
    if ((workflow.status === 'approved' || workflow.status === 'techCheck') && !isFactoryDocumentReady(docs)) summary.factoryNotExported += 1;
    if (alerts.some((alert) => alert.tone === 'danger')) summary.problems += 1;
  }

  const toneRank: Record<WorkflowTone, number> = { danger: 0, warn: 1, info: 2, good: 3, muted: 4 };
  summary.tasks = allAlerts
    .filter((alert, index, arr) => arr.findIndex((item) => item.projectId === alert.projectId && item.id === alert.id) === index)
    .sort((a, b) => toneRank[a.tone] - toneRank[b.tone] || a.clientName.localeCompare(b.clientName, 'ru'))
    .slice(0, 12);
  return summary;
}
