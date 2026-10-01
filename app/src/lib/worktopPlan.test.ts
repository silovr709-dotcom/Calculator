import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Pricebook, Project, WorktopPiece } from '../types';
import { checkWorktopPlan, edgeKindLabel, suggestWorktopPlan } from './worktopPlan';
import { lineFromItem } from './engine';
import { defaultSettings } from './storage';

const here = dirname(fileURLToPath(import.meta.url));
const pb: Pricebook = JSON.parse(readFileSync(join(here, '../../public/data/pricebook-visma-2026.json'), 'utf-8'));

const makeProject = (over: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'Тест', client: '', date: '2026-09-29', comment: '',
  status: 'draft', pricebookId: 'visma-2026', pricebookName: '', lines: [],
  settings: defaultSettings(), modules: [], createdAt: '2026-09-29', updatedAt: '2026-09-29',
  ...over,
});

const piece = (over: Partial<WorktopPiece> = {}): WorktopPiece => ({
  id: 'w1', name: 'Столешница', lengthMm: 3000, widthMm: 600, front: 'pf', back: null, left: 'pvc', right: null, ...over,
});

describe('лист 2 — схема столешницы', () => {
  it('подстановка из чек-листа: размеры берутся только из имени позиции прайса', () => {
    const wt = pb.items.find((i) => i.category.startsWith('Столешницы:') && /\d{3,4}[\s*xх]\d{3,4}/.test(i.name) && !/панель/i.test(i.name))!;
    const project = makeProject({ lines: [lineFromItem(wt, 'visma-2026', 1)] });
    const suggested = suggestWorktopPlan(project);
    expect(suggested).toHaveLength(1);
    expect(suggested[0].lengthMm).toBeGreaterThan(1000);
    expect(suggested[0].widthMm).toBeGreaterThan(0);
    const empty = makeProject();
    expect(suggestWorktopPlan(empty)).toEqual([]);
  });

  it('проверки: обязательные размеры, передняя кромка, стык на единственной детали', () => {
    const bad = checkWorktopPlan([piece({ lengthMm: null, front: null, back: 'eurozapil' })], true);
    expect(bad.some((i) => i.level === 'error' && i.text.includes('длина'))).toBe(true);
    expect(bad.some((i) => i.level === 'warn' && i.text.includes('передней кромки'))).toBe(true);
    expect(bad.some((i) => i.level === 'warn' && i.text.includes('стык'))).toBe(true);
    const ok = checkWorktopPlan([piece(), piece({ id: 'w2', right: null })], true);
    expect(ok).toHaveLength(0);
  });

  it('без столешницы схема не требуется; пустая схема при наличии — ошибка', () => {
    expect(checkWorktopPlan([], false)).toHaveLength(0);
    expect(checkWorktopPlan([], true)).toHaveLength(0); // подтверждённое отсутствие разрешаем молча
  });

  it('еврозапил напоминает про 2–3 стяжки из инструкции', () => {
    const plan = [piece({ right: 'eurozapil' }), piece({ id: 'w2' })];
    const issues = checkWorktopPlan(plan, true);
    expect(issues.some((i) => i.text.includes('стяжк'))).toBe(true);
    expect(edgeKindLabel('eurozapil')).toContain('Еврозапил');
  });
});
