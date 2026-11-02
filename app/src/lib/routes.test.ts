import { describe, it, expect } from 'vitest';
import { isSpecialHash, sameView, viewFromHash, viewToHash, type View } from './routes';

describe('маршруты приложения', () => {
  it('разбирает адрес проекта с вкладкой', () => {
    expect(viewFromHash('#/project/prj-42/sketch')).toEqual({ kind: 'project', id: 'prj-42', tab: 'sketch' });
    expect(viewFromHash('#/project/prj-42')).toEqual({ kind: 'project', id: 'prj-42', tab: undefined });
  });

  it('неизвестная вкладка не ломает проект', () => {
    expect(viewFromHash('#/project/prj-42/nonsense')).toEqual({ kind: 'project', id: 'prj-42', tab: undefined });
  });

  it('разбирает основные разделы', () => {
    expect(viewFromHash('#/projects')).toEqual({ kind: 'dashboard' });
    expect(viewFromHash('#/')).toEqual({ kind: 'dashboard' });
    expect(viewFromHash('#/reference')).toEqual({ kind: 'kb' });
    expect(viewFromHash('#/analytics')).toEqual({ kind: 'analytics' });
    expect(viewFromHash('#/audit/prj-1')).toEqual({ kind: 'audit', id: 'prj-1' });
    expect(viewFromHash('#/settings')).toEqual({ kind: 'settings' });
    expect(viewFromHash('#/sync')).toEqual({ kind: 'sync' });
    expect(viewFromHash('#/server')).toEqual({ kind: 'server' });
  });

  it('служебные ссылки не считаются маршрутом', () => {
    expect(viewFromHash('#offer=abcdef0123456789')).toBeNull();
    expect(viewFromHash('#import=%7B%7D')).toBeNull();
  });

  it('распознаёт QR-хэши, чтобы не перезаписать их адресом', () => {
    expect(isSpecialHash('#offer=abcdef0123456789')).toBe(true);
    expect(isSpecialHash('#sync=room:key')).toBe(true);
    expect(isSpecialHash('#/project/p1')).toBe(false);
    expect(isSpecialHash('')).toBe(false);
  });

  it('кодирует и декодирует id проекта', () => {
    const hash = viewToHash({ kind: 'project', id: 'проект 1', tab: 'client' });
    expect(hash).toBe('#/project/%D0%BF%D1%80%D0%BE%D0%B5%D0%BA%D1%82%201/client');
    expect(viewFromHash(hash)).toEqual({ kind: 'project', id: 'проект 1', tab: 'client' });
  });

  it('все экраны переживают путь туда и обратно', () => {
    const views: View[] = [
      { kind: 'dashboard' },
      { kind: 'project', id: 'p1', tab: 'modules' },
      { kind: 'quick' },
      { kind: 'factory' },
      { kind: 'factory', id: 'p1' },
      { kind: 'kb' },
      { kind: 'settings' },
      { kind: 'pricebook' },
      { kind: 'server' },
      { kind: 'analytics' },
      { kind: 'audit' },
      { kind: 'audit', id: 'p1' },
      { kind: 'sync' },
    ];
    for (const view of views) {
      const parsed = viewFromHash(viewToHash(view));
      expect(parsed).not.toBeNull();
      expect(sameView(parsed!, view)).toBe(true);
    }
  });
});
