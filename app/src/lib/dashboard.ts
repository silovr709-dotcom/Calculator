import type { Project } from '../types';

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
