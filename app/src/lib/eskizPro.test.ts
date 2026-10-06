import { describe, expect, it } from 'vitest';
import type { EskizCommunicationMarker } from '../types';
import type { EskizObject, EskizProject } from './eskizPro';
import { eskizFileName, eskizFilePayload, eskizImageReplaceScale, replaceEskizProjectImage, scaleEskizCommunication } from './eskizPro';

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

describe('замена фото эскиза', () => {
  const dimension: EskizObject = {
    id: 'dim-1',
    type: 'dimension',
    orientation: 'horizontal',
    x: 100,
    y: 200,
    x2: 300,
    y2: 200,
    value: '820',
    lineWidth: 2,
    color: '#20242b',
    fontSize: 14,
  };
  const callout: EskizObject = {
    id: 'call-1',
    type: 'callout',
    x: 400,
    y: 100,
    targetX: 420,
    targetY: 150,
    text: 'Вывод воды',
    color: '#20242b',
    fontSize: 14,
    width: 120,
    height: 40,
  };
  const withObjects: EskizProject = { ...project, objects: [dimension, callout] };
  const nextImage = { dataUrl: 'data:image/png;base64,BBB=', width: 1600, height: 1000, name: 'plan-v2.png' };

  it('считает коэффициенты пересчёта разметки', () => {
    expect(eskizImageReplaceScale({ width: 800, height: 500 }, { width: 1600, height: 1000 })).toEqual({ x: 2, y: 2 });
    expect(eskizImageReplaceScale({ width: 800, height: 500 }, { width: 1600, height: 1000 }, 'keep')).toEqual({ x: 1, y: 1 });
  });

  it('меняет фото, сохраняя все объекты и пересчитывая координаты', () => {
    const next = replaceEskizProjectImage(withObjects, nextImage, 'scale', '2026-10-06T10:00:00.000Z');
    expect(next.id).toBe(withObjects.id);
    expect(next.title).toBe(withObjects.title);
    expect(next.header).toEqual(withObjects.header);
    expect(next.image).toEqual(nextImage);
    expect(next.updatedAt).toBe('2026-10-06T10:00:00.000Z');
    expect(next.objects).toHaveLength(2);
    const movedDimension = next.objects[0] as typeof dimension;
    expect(movedDimension).toMatchObject({ id: 'dim-1', x: 200, y: 400, x2: 600, y2: 400, value: '820' });
    const movedCallout = next.objects[1] as typeof callout;
    expect(movedCallout).toMatchObject({ id: 'call-1', x: 800, y: 200, targetX: 840, targetY: 300, width: 240, height: 80 });
  });

  it('сохраняет координаты разметки в режиме keep', () => {
    const next = replaceEskizProjectImage(withObjects, nextImage, 'keep');
    expect(next.image).toEqual(nextImage);
    expect(next.objects).toEqual(withObjects.objects);
  });

  it('пересчитывает коммуникации и их линии расстояний', () => {
    const marker: EskizCommunicationMarker = {
      ...communication,
      distances: [{ id: 'd1', label: 'от стены', anchor: 'custom', valueMm: 600, anchorX: 300, anchorY: 150, labelX: 200, labelY: 140 }],
    };
    const scaled = scaleEskizCommunication(marker, { x: 2, y: 2 });
    expect(scaled).toMatchObject({ id: 'com-1', x: 200, y: 240 });
    expect(scaled.distances?.[0]).toMatchObject({ valueMm: 600, anchorX: 600, anchorY: 300, labelX: 400, labelY: 280 });
  });
});
