import { describe, expect, it } from 'vitest';
import type { EskizCommunicationMarker } from '../types';
import type { EskizProject } from './eskizPro';
import { eskizFileName, eskizFilePayload } from './eskizPro';

const project: EskizProject = {
  version: 1,
  id: 'eskiz-1',
  title: 'Кухня / Иванов',
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:10:00.000Z',
  image: { dataUrl: 'data:image/png;base64,AAA=', width: 800, height: 500, name: 'plan.png' },
  objects: [],
  header: { enabled: true, project: 'Кухня', room: 'Кухня', date: '01.10.2026', variant: 'A' },
  integration: {},
};

const communication: EskizCommunicationMarker = {
  id: 'com-1',
  eskizId: 'eskiz-1',
  kind: 'socket',
  name: 'Розетка',
  x: 100,
  y: 120,
  widthMm: 70,
  heightMm: 70,
  showSizeBadge: false,
  distances: [],
  createdAt: '2026-10-01T08:12:00.000Z',
};

describe('eskiz file export payload', () => {
  it('собирает .eskiz в формате, который принимает импорт, и сохраняет скрытие габарита коммуникации', () => {
    const payload = eskizFilePayload(project, [communication, { ...communication, id: 'foreign', eskizId: 'other' }]);
    expect(payload.format).toBe('recept-eskiz');
    expect(payload.project).toBe(project);
    expect(payload.communications).toHaveLength(1);
    expect(payload.communications?.[0]).toMatchObject({ id: 'com-1', eskizId: 'eskiz-1', showSizeBadge: false });
  });

  it('делает безопасное имя файла .eskiz', () => {
    expect(eskizFileName(project)).toBe('Кухня - Иванов.eskiz');
  });
});
