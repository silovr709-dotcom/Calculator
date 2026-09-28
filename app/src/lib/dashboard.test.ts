import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { filterDashboardProjects, projectReadiness } from './dashboard';

const project = (overrides: Partial<Project>): Project => ({
  id: 'id', name: 'Проект', client: '', date: '2026-09-28', comment: '', status: 'draft',
  pricebookId: 'pb', pricebookName: 'Прайс', lines: [], settings: {} as Project['settings'],
  createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z', ...overrides,
});

describe('фильтры списка проектов', () => {
  const projects = [
    project({ id: '1', name: 'Кухня Ивановых', client: 'Анна Иванова', status: 'draft' }),
    project({ id: '2', name: 'Гостиная', client: 'Пётр', comment: 'проект после замера', status: 'sent' }),
    project({ id: '3', name: 'Кухня в Софии', client: 'Мария', status: 'approved' }),
  ];

  it('ищет по названию, клиенту и комментарию без учёта регистра', () => {
    expect(filterDashboardProjects(projects, 'ИВАНОВ', 'all').map((item) => item.id)).toEqual(['1']);
    expect(filterDashboardProjects(projects, 'ЗАМЕРА', 'all').map((item) => item.id)).toEqual(['2']);
  });

  it('ограничивает список выбранным статусом', () => {
    expect(filterDashboardProjects(projects, '', 'sent').map((item) => item.id)).toEqual(['2']);
    expect(filterDashboardProjects(projects, 'кухня', 'approved').map((item) => item.id)).toEqual(['3']);
  });

  it('сохраняет исходный порядок и не меняет исходный массив', () => {
    const result = filterDashboardProjects(projects, '  ', 'all');
    expect(result.map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(result).not.toBe(projects);
    expect(projects.map((item) => item.id)).toEqual(['1', '2', '3']);
  });

  it('показывает отсутствие версии прайса отдельным состоянием', () => {
    const result = projectReadiness(projects[0], null);
    expect(result.tone).toBe('error');
    expect(result.label).toBe('Нет прайса');
  });
});
