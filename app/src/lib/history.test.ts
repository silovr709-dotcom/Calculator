import { describe, expect, it } from 'vitest';
import type { Project } from '../types';
import { defaultSettings } from './storage';
import { ProjectHistory } from './history';

const project = (name: string): Project => ({
  id: 'p', name, client: '', date: '', comment: '', status: 'draft', pricebookId: 'pb', pricebookName: 'Прайс',
  lines: [], modules: [], moduleDefaults: {}, settings: defaultSettings(), createdAt: '', updatedAt: '',
});

describe('история изменений проекта', () => {
  it('возвращает последние состояния в обратном порядке', () => {
    const history = new ProjectHistory();
    history.push(project('Первое'));
    history.push(project('Второе'));
    expect(history.canUndo('p')).toBe(true);
    expect(history.undo('p')?.name).toBe('Второе');
    expect(history.undo('p')?.name).toBe('Первое');
    expect(history.canUndo('p')).toBe(false);
  });

  it('не отдаёт наружу изменяемую ссылку состояния', () => {
    const history = new ProjectHistory();
    const source = project('До');
    history.push(source);
    source.name = 'Изменено снаружи';
    const restored = history.undo('p')!;
    expect(restored.name).toBe('До');
    restored.name = 'Изменено после undo';
    expect(history.undo('p')).toBeNull();
  });

  it('ограничивает историю двадцатью состояниями', () => {
    const history = new ProjectHistory();
    for (let i = 0; i < 25; i += 1) history.push(project(String(i)));
    const names: string[] = [];
    while (history.canUndo('p')) names.push(history.undo('p')!.name);
    expect(names).toHaveLength(20);
    expect(names[0]).toBe('24');
    expect(names.at(-1)).toBe('5');
  });
});
