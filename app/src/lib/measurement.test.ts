import { describe, expect, it } from 'vitest';
import { calibratedPhotoLengthMm, emptyMeasurement, photoDistancePx } from './measurement';
import { defaultSettings } from './storage';
import type { Project } from '../types';

describe('мобильный режим замера', () => {
  it('создаёт стены по форме кухни и не меняет расчётные строки', () => {
    const project: Project = { id: 'p', name: 'Кухня', client: '', date: '2026-01-01', comment: '', status: 'draft', pricebookId: 'pb', pricebookName: 'pb', lines: [], settings: defaultSettings(), sketch: { shape: 'l' }, createdAt: '', updatedAt: '' };
    const measurement = emptyMeasurement(project);
    expect(measurement.walls).toHaveLength(2);
    expect(measurement.openings).toEqual([]);
    expect(measurement.communications).toEqual([]);
    expect(project.lines).toEqual([]);
  });

  it('пересчитывает размер по масштабу фотографии с учётом соотношения сторон', () => {
    expect(photoDistancePx({ x: 0, y: 0 }, { x: 50, y: 0 }, 1000, 500)).toBe(500);
    expect(calibratedPhotoLengthMm({ x1: 0, y1: 0, x2: 25, y2: 0, lengthMm: 600 }, { x: 0, y: 0 }, { x: 50, y: 0 }, 1000, 500)).toBe(1200);
    expect(calibratedPhotoLengthMm({ x1: 0, y1: 0, x2: 0, y2: 0, lengthMm: 600 }, { x: 0, y: 0 }, { x: 50, y: 0 }, 1000, 500)).toBeNull();
  });
});
