import { describe, expect, it } from 'vitest';
import { emptyMeasurement } from './measurement';
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
});
