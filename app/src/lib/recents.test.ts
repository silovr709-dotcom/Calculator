import { describe, it, expect } from 'vitest';
import { pushRecent, loadRecentItems, recordRecentItem, RECENTS_LIMIT } from './recents';

describe('недавно использованные позиции каталога', () => {
  it('новая позиция поднимается наверх без дублей', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
    expect(pushRecent([], 'x')).toEqual(['x']);
  });

  it('список ограничен лимитом', () => {
    const start = Array.from({ length: RECENTS_LIMIT }, (_, i) => `i${i}`);
    const next = pushRecent(start, 'new');
    expect(next).toHaveLength(RECENTS_LIMIT);
    expect(next[0]).toBe('new');
    expect(next).not.toContain(`i${RECENTS_LIMIT - 1}`);
  });

  it('без localStorage (тестовая среда) загрузка пустая, запись не падает', () => {
    expect(loadRecentItems()).toEqual([]);
    expect(recordRecentItem('z')).toEqual(['z']);
  });
});
