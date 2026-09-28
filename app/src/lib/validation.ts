import type { Pricebook, Project } from '../types';
import { calcTotals } from './engine';
import { checkModule, moduleToLines } from './modules';
import { checkKitchenChecklist } from './checklist';

export type ValidationSeverity = 'error' | 'warning' | 'info';
export type ValidationEntity = 'project' | 'module' | 'line';

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  group: string;
  entity: ValidationEntity;
  entityId?: string;
  title: string;
  message: string;
  impact: string;
}

export interface ProjectValidation {
  issues: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  ready: boolean;
  checkedModules: number;
  checkedLines: number;
  unpricedLines: number;
  cost: number;
  client: number;
}

export function validateProject(project: Project, pricebook: Pricebook): ProjectValidation {
  const issues: ValidationIssue[] = [];
  const modules = project.modules ?? [];
  const moduleLines = modules.flatMap((module) => moduleToLines(module, project.moduleDefaults ?? {}, pricebook));
  const lines = [...moduleLines, ...project.lines];
  const add = (issue: Omit<ValidationIssue, 'id'>) => issues.push({ ...issue, id: `${issue.entity}-${issue.entityId ?? 'project'}-${issues.length}` });

  if (!project.name.trim()) add({ severity: 'error', group: 'Проект', entity: 'project', title: 'Нет названия проекта', message: 'Назовите проект, чтобы его можно было найти в списке.', impact: 'Клиентское предложение будет трудно идентифицировать.' });
  if (!project.client.trim()) add({ severity: 'warning', group: 'Проект', entity: 'project', title: 'Не указан клиент', message: 'Клиент не заполнен в данных проекта.', impact: 'Имя заказчика не появится в коммерческом предложении.' });
  if (modules.length === 0 && project.lines.length === 0) add({ severity: 'warning', group: 'Проект', entity: 'project', title: 'Нет позиций', message: 'В проекте пока нет модулей и дополнительных строк.', impact: 'Итоговая цена будет равна нулю.' });

  const checklist = checkKitchenChecklist(lines);
  for (const item of checklist.missing) add({
    severity: 'error',
    group: 'Обязательный состав кухни',
    entity: 'project',
    title: `Не добавлена позиция «${item.label}»`,
    message: 'Добавьте конкретную позицию из прайса в чек-листе проекта.',
    impact: 'Проект нельзя считать готовым к предложению: обязательная часть кухни может быть забыта, а расчёт окажется неполным.',
  });

  for (const module of modules) {
    const checked = checkModule(module, project.moduleDefaults ?? {}, pricebook);
    for (const message of checked.errors) add({ severity: 'error', group: 'Позиции кухни', entity: 'module', entityId: module.id, title: module.name, message, impact: 'Связанные строки не попадут в расчёт — итог может быть занижен.' });
    for (const warning of checked.openWarnings) add({ severity: 'warning', group: 'Позиции кухни', entity: 'module', entityId: module.id, title: module.name, message: warning.text, impact: 'Расчёт включён, но конструкция может не соответствовать выбранному корпусу.' });
  }

  const calculated = calcTotals(lines, project.settings);
  for (const line of lines) {
    const calc = calculated.lineCalcs.get(line.id);
    if (calc?.warning) add({ severity: line.priceKind === 'unavailable' || line.priceKind === 'empty' ? 'error' : 'warning', group: line.note?.startsWith('Модуль:') ? 'Позиции кухни' : 'Дополнительные позиции', entity: 'line', entityId: line.id, title: line.name, message: calc.warning, impact: 'Строка не входит в себестоимость и цену клиента, пока проблема не исправлена.' });
  }

  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  return { issues, errors, warnings, ready: errors.length === 0 && warnings.length === 0, checkedModules: modules.length, checkedLines: lines.length, unpricedLines: calculated.totals.unpricedCount, cost: calculated.totals.cost, client: calculated.totals.client };
}

export function groupValidationIssues(issues: ValidationIssue[]): [string, ValidationIssue[]][] {
  const groups = new Map<string, ValidationIssue[]>();
  for (const issue of issues) groups.set(issue.group, [...(groups.get(issue.group) ?? []), issue]);
  return [...groups.entries()];
}
