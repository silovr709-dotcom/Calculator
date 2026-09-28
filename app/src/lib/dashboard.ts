import type { Pricebook, Project } from '../types';
import { moduleToLines } from './modules';
import { validateProject } from './validation';

export type DashboardStatusFilter = Project['status'] | 'all';

/** Фильтры списка проектов не меняют порядок и не мутируют исходный массив. */
export function filterDashboardProjects(
  projects: Project[],
  query: string,
  status: DashboardStatusFilter,
): Project[] {
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  return projects.filter((project) => {
    if (status !== 'all' && project.status !== status) return false;
    if (!needle) return true;
    return [project.name, project.client, project.comment]
      .some((value) => value.toLocaleLowerCase('ru-RU').includes(needle));
  });
}

export interface ProjectReadiness {
  tone: 'ready' | 'warning' | 'error';
  label: string;
  detail: string;
}

/** Короткий индикатор готовности проекта прямо в списке, без скрытого изменения расчёта. */
export function projectReadiness(project: Project, pricebook: Pricebook | null): ProjectReadiness {
  if (!pricebook) return { tone: 'error', label: 'Нет прайса', detail: 'Версия прайса проекта не найдена на этом устройстве.' };
  const moduleLines = (project.modules ?? []).flatMap((module) => moduleToLines(module, project.moduleDefaults ?? {}, pricebook));
  const result = validateProject(project, pricebook);
  const lineCount = moduleLines.length + project.lines.length;
  if (result.errors.length > 0) return { tone: 'error', label: `Ошибок: ${result.errors.length}`, detail: `Проверено строк: ${lineCount}. Откройте проект и перейдите в «Проверка».` };
  if (result.warnings.length > 0) return { tone: 'warning', label: `Проверить: ${result.warnings.length}`, detail: `Проверено строк: ${lineCount}. Есть предупреждения перед отправкой КП.` };
  return { tone: 'ready', label: 'Готово', detail: `Проверено строк: ${lineCount}. К проекту нет замечаний.` };
}
