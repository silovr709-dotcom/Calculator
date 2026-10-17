import { describe, expect, it, vi, beforeEach } from 'vitest';

/** Простейшая имитация localStorage с жёстким лимитом по объёму. */
function makeStorage(limitBytes: number) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => { data.delete(key); },
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() { return data.size; },
    setItem: (key: string, value: string) => {
      let used = 0;
      for (const [k, v] of data) if (k !== key) used += k.length + v.length;
      if (used + key.length + value.length > limitBytes) {
        throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      }
      data.set(key, value);
    },
  };
}

const bigProjects = Array.from({ length: 5 }, (_, i) => ({
  id: `p${i}`,
  name: `Проект ${i}`,
  photos: [{ id: 'ph', name: 'фото', dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(4000), addedAt: '', showToClient: true }],
}));

async function freshStorageModule(limit: number) {
  vi.resetModules();
  const fake = makeStorage(limit);
  vi.stubGlobal('localStorage', fake);
  const mod = await import('./storage');
  return { mod, fake };
}

describe('локальный кэш при переполнении браузера', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it('на своём сервере не показывает тревожный alert и чистит неполную копию', async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal('alert', alertSpy);
    const { mod, fake } = await freshStorageModule(2000);
    mod.setStorageServerBacked(true);

    const ok = mod.saveProjects(bigProjects as never);

    expect(ok).toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(fake.data.has('recept.projects.v1')).toBe(false);
    expect(mod.getStorageNote()).toContain('сервере');
  });

  it('без сервера предупреждает пользователя один раз', async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal('alert', alertSpy);
    const { mod } = await freshStorageModule(2000);
    mod.setStorageServerBacked(false);

    expect(mod.saveProjects(bigProjects as never)).toBe(false);
    expect(mod.saveProjects(bigProjects as never)).toBe(false);
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('небольшие данные сохраняются как обычно', async () => {
    const { mod, fake } = await freshStorageModule(200000);
    mod.setStorageServerBacked(true);
    expect(mod.saveProjects([{ id: 'p1', name: 'Кухня' }] as never)).toBe(true);
    expect(fake.data.has('recept.projects.v1')).toBe(true);
    expect(mod.loadProjects()).toHaveLength(1);
  });
});
