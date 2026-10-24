import type { ClientProfile, ClientProjectDocuments, ClientProjectPayment, Pricebook, Project } from '../types';
import { calcTotals } from './engine';
import { moduleToLines } from './modules';
import { validateProject } from './validation';
import { findClientForProject } from './clientProfiles';

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
  target: 'project' | 'modules' | 'check' | 'client' | 'factory' | 'sketch' | 'payment';
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

export const WORK_MODE_LABELS: Record<WorkMode, { label: string; hint: string; primary: string }> = {
  manager: { label: 'Менеджер', hint: 'проекты, КП, договоры, оплаты и клиенты', primary: 'Проекты и КП' },
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

function hasPhone(project: Project, client?: ClientProfile | null): boolean {
  return Boolean(client?.phones?.some((phone) => phone.trim()) || project.clientOffer?.clientPhone?.trim() || /\d{6,}/.test(project.clientOffer?.clientContacts ?? ''));
}

function hasWorktop(project: Project): boolean {
  return project.lines.some((line) => /столешниц/i.test(`${line.category} ${line.group} ${line.name}`));
}

export function projectNextStep(project: Project, pricebook: Pricebook | null | undefined, client?: ClientProfile | null): ProjectNextStep {
  const docs = projectDocuments(project, client);
  const total = calcProjectWorkflowTotal(project, pricebook);
  const validation = pricebook ? validateProject(project, pricebook) : null;
  const hasComposition = total.modulesCount > 0 || project.lines.length > 0;
  const hasClient = Boolean(project.client?.trim() || client?.name?.trim());

  if (!hasClient) {
    return { key: 'client-missing', title: 'Укажите клиента', detail: 'Без клиента КП, договор и история не будут связаны с карточкой клиента.', actionLabel: 'Открыть данные клиента', target: 'project', tone: 'warn' };
  }
  if (!hasComposition) {
    return { key: 'composition-empty', title: 'Добавьте состав кухни', detail: 'Начните с модулей или дополнительных позиций, чтобы появилась цена.', actionLabel: 'Открыть модули', target: 'modules', tone: 'info' };
  }
  if ((validation?.errors.length ?? 0) > 0) {
    return { key: 'validation-errors', title: 'Исправьте ошибки расчёта', detail: `Критичных ошибок: ${validation?.errors.length ?? 0}. После этого можно собирать КП.`, actionLabel: 'Открыть проверку', target: 'check', tone: 'danger' };
  }
  if (total.unpricedCount > 0) {
    return { key: 'unpriced', title: 'Закройте позиции без цены', detail: `Без цены: ${total.unpricedCount}. Итог для клиента может быть неполным.`, actionLabel: 'Открыть проверку', target: 'check', tone: 'warn' };
  }
  if (docs.offer !== 'created' && docs.offer !== 'sent' && docs.offer !== 'approved') {
    return { key: 'prepare-offer', title: 'Соберите КП клиенту', detail: 'Проверьте компактное КП, условия и эскиз перед отправкой.', actionLabel: 'Открыть КП', target: 'client', tone: 'info' };
  }
  return { key: 'ready', title: 'Проект готов к работе', detail: 'Расчёт без ошибок, КП собрано. Дальше — эскиз, документы или фабрика.', actionLabel: 'Открыть проект', target: 'project', tone: 'good' };
}

export function buildProjectActionAlerts(project: Project, pricebook: Pricebook | null | undefined, client?: ClientProfile | null): ProjectActionAlert[] {
  const docs = projectDocuments(project, client);
  const validation = pricebook ? validateProject(project, pricebook) : null;
  const total = calcProjectWorkflowTotal(project, pricebook);
  const alerts: ProjectActionAlert[] = [];
  const base = { projectId: project.id, projectName: project.name, clientName: client?.name || project.client || 'Без клиента' };
  const push = (alert: Omit<ProjectActionAlert, 'projectId' | 'projectName' | 'clientName'>) => alerts.push({ ...base, ...alert });

  if (!project.client?.trim() && !client?.name?.trim()) push({ id: 'no-client', title: 'Проект без клиента', detail: 'КП и договор не будут связаны с карточкой клиента.', tone: 'warn', target: 'project' });
  if (!hasPhone(project, client)) push({ id: 'no-phone', title: 'Нет телефона клиента', detail: 'Сложно отправить КП и уточнить детали.', tone: 'warn', target: 'client' });
  if ((validation?.errors.length ?? 0) > 0) push({ id: 'errors', title: 'Ошибки перед документами', detail: `Критичных ошибок: ${validation?.errors.length ?? 0}.`, tone: 'danger', target: 'check' });
  if (total.unpricedCount > 0) push({ id: 'unpriced', title: 'Есть строки без цены', detail: `Без цены: ${total.unpricedCount}.`, tone: 'danger', target: 'check' });
  if (docs.offer === 'created') push({ id: 'offer-created', title: 'КП создано, но не отправлено', detail: 'Отправьте КП клиенту и отметьте отправку.', tone: 'info', target: 'client' });
  if (hasWorktop(project) && (!project.worktopPlan || project.worktopPlan.length === 0)) push({ id: 'no-worktop-plan', title: 'Есть столешница, но нет схемы', detail: 'Схема столешницы нужна фабрике.', tone: 'warn', target: 'sketch' });
  if (!(project.eskizPro?.snapshots?.length ?? 0)) push({ id: 'no-sketch', title: 'Нет Эскиз PRO для фабрики', detail: 'Добавьте снимок эскиза перед передачей на фабрику.', tone: 'info', target: 'sketch' });

  const toneRank: Record<WorkflowTone, number> = { danger: 0, warn: 1, info: 2, good: 3, muted: 4 };
  return alerts.sort((a, b) => toneRank[a.tone] - toneRank[b.tone] || a.title.localeCompare(b.title, 'ru'));
}
