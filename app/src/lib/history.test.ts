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
    const history = new ProjectHistory({ throttleMs: 0 });
    history.push(project('Первое'));
    history.push(project('Второе'));
    expect(history.canUndo('p')).toBe(true);
    expect(history.undo('p')?.name).toBe('Второе');
    expect(history.undo('p')?.name).toBe('Первое');
    expect(history.canUndo('p')).toBe(false);
  });

  it('не отдаёт наружу изменяемую ссылку состояния', () => {
    const history = new ProjectHistory({ throttleMs: 0 });
    const source = project('До');
    history.push(source);
    source.name = 'Изменено снаружи';
    const restored = history.undo('p')!;
    expect(restored.name).toBe('До');
    restored.name = 'Изменено после undo';
    expect(history.undo('p')).toBeNull();
  });

  it('ограничивает историю двадцатью состояниями', () => {
    const history = new ProjectHistory({ throttleMs: 0 });
    for (let i = 0; i < 25; i += 1) history.push(project(String(i)));
    const names: string[] = [];
    while (history.canUndo('p')) names.push(history.undo('p')!.name);
    expect(names).toHaveLength(20);
    expect(names[0]).toBe('24');
    expect(names.at(-1)).toBe('5');
  });

  it('снимки серии правок троттлятся: одно непрерывное набирание — один undo', () => {
    let now = 0;
    const history = new ProjectHistory({ throttleMs: 1200, now: () => now });
    history.push(project('до серии'));
    now = 200;
    history.push(project('символ 1'));
    now = 400;
    history.push(project('символ 2'));
    now = 600;
    history.push(project('символ 3'));
    expect(history.undo('p')?.name).toBe('до серии');
    expect(history.canUndo('p')).toBe(false);

    // после паузы новая серия снова получает свой снимок
    now = 5000;
    history.push(project('до второй серии'));
    expect(history.undo('p')?.name).toBe('до второй серии');
  });

  it('проекты троттлятся независимо друг от друга', () => {
    let now = 0;
    const history = new ProjectHistory({ throttleMs: 1200, now: () => now });
    history.push({ ...project('a'), id: 'a' });
    history.push({ ...project('b'), id: 'b' });
    expect(history.undo('a')?.name).toBe('a');
    expect(history.undo('b')?.name).toBe('b');
  });
});
