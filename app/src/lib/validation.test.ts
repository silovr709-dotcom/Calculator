import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pricebook, Project } from '../types';
import { defaultSettings } from './storage';
import { validateProject } from './validation';
import { newModule } from './modules';

const here = dirname(fileURLToPath(import.meta.url));
const pb: Pricebook = JSON.parse(readFileSync(join(here, '../../public/data/pricebook-visma-2026.json'), 'utf8'));
const project = (modules: Project['modules'] = []): Project => ({ id: 'p', name: 'Тест', client: 'Клиент', date: '2026-01-01', comment: '', status: 'draft', pricebookId: pb.meta.id, pricebookName: pb.meta.name, lines: [], modules, moduleDefaults: {}, settings: defaultSettings(), createdAt: '', updatedAt: '' });

describe('центр проверки проекта', () => {
  it('группирует критическую ошибку незаполненного модуля и объясняет влияние', () => {
    const result = validateProject(project([newModule('Нижний шкаф')]), pb);
    expect(result.errors.some((issue) => issue.entity === 'module')).toBe(true);
    expect(result.errors[0].impact).toMatch(/расчёт/i);
    expect(result.ready).toBe(false);
  });

  it('считает пустой проект проблемным предупреждением', () => {
    const result = validateProject(project(), pb);
    expect(result.warnings.some((issue) => issue.title === 'Нет позиций')).toBe(true);
    expect(result.errors.filter((issue) => issue.group === 'Обязательный состав кухни')).toHaveLength(4);
  });
});
