import { describe, it, expect } from 'vitest';
import type { Project, ProjectSettings } from '../types';
import {
  generateSyncRoom,
  makeSyncShareUrl,
  makeProjectShareUrl,
  makeCompressedProjectShareUrl,
  makeCloudProjectShareUrl,
  makeJsonStorageProjectShareUrl,
  makeProjectShareToken,
  compactProjectForShare,
  loadCompressedProjectShare,
  parseIncomingHash,
  mergeSyncData,
} from './sync';
import { defaultSettings } from './storage';

describe('генерация и парсинг URL синхронизации', () => {
  it('генерация комнаты создаёт 4-значный PIN-код и секретный ключ', () => {
    const { roomCode, secretKey } = generateSyncRoom();
    expect(roomCode).toMatch(/^\d{4}$/);
    expect(secretKey).toContain(`recept_${roomCode}_`);
  });

  it('makeSyncShareUrl и parseIncomingHash корректно кодируют и декодируют ссылку комнаты', () => {
    const { roomCode, secretKey } = generateSyncRoom();
    const url = makeSyncShareUrl(roomCode, secretKey, 'https://example.com/app/');
    expect(url).toBe(`https://example.com/app/#sync=${roomCode}:${secretKey}`);

    const hash = `#sync=${roomCode}:${secretKey}`;
    const parsed = parseIncomingHash(hash);
    expect(parsed).toEqual({ type: 'sync', roomCode, secretKey });
  });



  it('короткая cloud-ссылка проекта для QR не содержит огромный JSON и парсится по token', () => {
    const token = makeProjectShareToken('prj_test_1');
    const url = makeCloudProjectShareUrl(token, 'https://example.com/app/');
    expect(url.length).toBeLessThan(120);
    expect(url).toBe(`https://example.com/app/#share=${encodeURIComponent(token)}`);
    expect(parseIncomingHash(`#share=${encodeURIComponent(token)}`)).toEqual({ type: 'share', token });
  });

  it('короткая резервная JSONStorage-ссылка проекта для QR парсится как безопасный URL', () => {
    const storageUrl = 'https://api.jsonstorage.net/v1/json/user-123/item-456';
    const url = makeJsonStorageProjectShareUrl(storageUrl, 'https://example.com/app/');
    expect(url.length).toBeLessThan(160);
    expect(parseIncomingHash(url.split('#')[1])).toEqual({ type: 'shareurl', url: storageUrl });
    expect(parseIncomingHash('#shareurl=https%3A%2F%2Fevil.example%2Fdata')).toBeNull();
  });

  it('сжатая self-contained ссылка проекта для QR парсится без облака', async () => {
    const dummyProject: Project = {
      id: 'prj_compressed_1',
      name: 'Сжатая кухня QR',
      client: 'Иван',
      comment: 'Проект передаётся напрямую через hash importz',
      date: '2026-09-28',
      status: 'draft',
      pricebookId: 'visma-2026',
      pricebookName: 'ВИСМА 2026',
      lines: Array.from({ length: 12 }, (_, index) => ({
        id: `line_${index}`,
        itemId: `item_${index}`,
        pricebookId: 'visma-2026',
        category: 'Фурнитура',
        group: 'Фурнитура' as const,
        name: `Петля с доводчиком Boyard 110 повтор ${index}`,
        article: null,
        unit: 'шт',
        priceKind: 'fixed' as const,
        price: 120,
        priceBasis: 'unit' as const,
        priceGroup: null,
        qty: 2,
        params: {},
      })),
      modules: [],
      settings: defaultSettings(),
      createdAt: '2026-09-28T10:00:00Z',
      updatedAt: '2026-09-28T10:00:00Z',
    };

    const compressed = await makeCompressedProjectShareUrl(dummyProject, 'https://example.com/app/');
    expect(compressed.url).toContain('#importz=');
    expect(compressed.url.length).toBeLessThan(makeProjectShareUrl(dummyProject, 'https://example.com/app/').length);
    const parsed = parseIncomingHash(compressed.url.split('#')[1]);
    expect(parsed).toEqual({ type: 'importz', data: expect.any(String) });
    if (parsed?.type === 'importz') {
      const restored = await loadCompressedProjectShare(parsed.data);
      expect(restored.name).toBe('Сжатая кухня QR');
      expect(restored.lines).toHaveLength(12);
    }
  });

  it('compactProjectForShare убирает вложенные dataUrl, чтобы QR-публикация оставалась лёгкой', () => {
    const dummyProject: Project = {
      id: 'prj_photo_1',
      name: 'Кухня с фото',
      client: 'Иван',
      comment: '',
      date: '2026-09-28',
      status: 'draft',
      pricebookId: 'visma-2026',
      pricebookName: 'ВИСМА 2026',
      lines: [],
      modules: [],
      settings: defaultSettings(),
      photos: [{ id: 'ph1', name: 'замер', dataUrl: 'data:image/jpeg;base64,AAAA', addedAt: '2026-09-28', showToClient: true }],
      measurement: {
        roomHeightMm: null,
        walls: [],
        openings: [],
        communications: [],
        photos: [{ id: 'mph1', name: 'замер 2', dataUrl: 'data:image/png;base64,BBBB', addedAt: '2026-09-28', showToClient: true }],
        notes: '',
        updatedAt: '2026-09-28T10:00:00Z',
      },
      eskizPro: {
        snapshots: [{ id: 'esk1', title: 'Эскиз', updatedAt: '2026-09-28T10:00:00Z', project: { image: { dataUrl: 'data:image/png;base64,CCCC' } } }],
      },
      createdAt: '2026-09-28T10:00:00Z',
      updatedAt: '2026-09-28T10:00:00Z',
    };
    const compact = compactProjectForShare(dummyProject) as any;
    expect(compact.photos[0].dataUrl).toBe('');
    expect(compact.measurement.photos[0].dataUrl).toBe('');
    expect(compact.eskizPro.snapshots[0].project.image.dataUrl).toBe('');
  });

  it('makeProjectShareUrl и parseIncomingHash корректно передают проект без облака', () => {
    const dummyProject: Project = {
      id: 'prj_test_1',
      name: 'Тестовая кухня',
      client: 'Иван',
      comment: '',
      date: '2026-09-28',
      status: 'draft',
      pricebookId: 'visma-2026',
      pricebookName: 'ВИСМА 2026',
      lines: [],
      modules: [],
      settings: defaultSettings(),
      createdAt: '2026-09-28T10:00:00Z',
      updatedAt: '2026-09-28T10:00:00Z',
    };

    const shareUrl = makeProjectShareUrl(dummyProject, 'https://example.com/app/');
    const hash = shareUrl.split('#')[1];
    const parsed = parseIncomingHash(`#${hash}`);
    expect(parsed).not.toBeNull();
    if (parsed && parsed.type === 'import') {
      expect(parsed.project.name).toBe('Тестовая кухня');
      expect(parsed.project.client).toBe('Иван');
    }
  });
});

describe('умное слияние данных синхронизации (Smart Merge)', () => {
  const baseSettings: ProjectSettings = defaultSettings();

  it('слияние добавляет удалённые проекты, которых нет локально', () => {
    const localProject: Project = {
      id: 'p1',
      name: 'Локальная кухня',
      client: 'Алексей',
      comment: '',
      date: '2026-09-28',
      status: 'draft',
      pricebookId: 'visma-2026',
      pricebookName: 'ВИСМА 2026',
      lines: [],
      modules: [],
      settings: baseSettings,
      createdAt: '2026-09-28T10:00:00Z',
      updatedAt: '2026-09-28T10:00:00Z',
    };

    const remoteProject: Project = {
      id: 'p2',
      name: 'Удалённая кухня с телефона',
      client: 'Ольга',
      comment: '',
      date: '2026-09-28',
      status: 'draft',
      pricebookId: 'visma-2026',
      pricebookName: 'ВИСМА 2026',
      lines: [],
      modules: [],
      settings: baseSettings,
      createdAt: '2026-09-28T11:00:00Z',
      updatedAt: '2026-09-28T11:00:00Z',
    };

    const local = { projects: [localProject], templates: [], settings: baseSettings };
    const remote = {
      version: 1 as const,
      updatedAt: '2026-09-28T11:00:00Z',
      roomCode: '1234',
      projects: [remoteProject],
      templates: [],
      settings: baseSettings,
    };

    const res = mergeSyncData(local, remote);
    expect(res.mergedProjects).toHaveLength(2);
    expect(res.mergedProjects.map((p) => p.id)).toContain('p1');
    expect(res.mergedProjects.map((p) => p.id)).toContain('p2');
    expect(res.hasLocalChangesToPush).toBe(true); // p1 надо отправить в облако
    expect(res.hasRemoteChangesToApply).toBe(true); // p2 надо сохранить локально
  });

  it('при конфликте одной и той же кухни выбирается более свежая по updatedAt', () => {
    const oldVersion: Project = {
      id: 'p1',
      name: 'Кухня (старая версия)',
      client: 'Алексей',
      comment: '',
      date: '2026-09-28',
      status: 'draft',
      pricebookId: 'visma-2026',
      pricebookName: 'ВИСМА 2026',
      lines: [],
      modules: [],
      settings: baseSettings,
      createdAt: '2026-09-28T09:00:00Z',
      updatedAt: '2026-09-28T10:00:00Z',
    };

    const newVersion: Project = {
      id: 'p1',
      name: 'Кухня (обновлённая на замере)',
      client: 'Алексей',
      comment: '',
      date: '2026-09-28',
      status: 'approved',
      pricebookId: 'visma-2026',
      pricebookName: 'ВИСМА 2026',
      lines: [],
      modules: [],
      settings: baseSettings,
      createdAt: '2026-09-28T09:00:00Z',
      updatedAt: '2026-09-28T12:00:00Z',
    };

    // Случай 1: в облаке новее
    const res1 = mergeSyncData(
      { projects: [oldVersion], templates: [], settings: baseSettings },
      { version: 1, updatedAt: '2026-09-28T12:00:00Z', roomCode: '1234', projects: [newVersion], templates: [], settings: baseSettings },
    );
    expect(res1.mergedProjects[0].name).toBe('Кухня (обновлённая на замере)');
    expect(res1.hasRemoteChangesToApply).toBe(true);

    // Случай 2: локально новее
    const res2 = mergeSyncData(
      { projects: [newVersion], templates: [], settings: baseSettings },
      { version: 1, updatedAt: '2026-09-28T10:00:00Z', roomCode: '1234', projects: [oldVersion], templates: [], settings: baseSettings },
    );
    expect(res2.mergedProjects[0].name).toBe('Кухня (обновлённая на замере)');
    expect(res2.hasLocalChangesToPush).toBe(true);
  });
});
