import { describe, expect, it } from 'vitest';
import {
  calibratedPhotoLengthMm,
  createPlanWallsFromMeasurements,
  createRectangularPlanWalls,
  emptyMeasurement,
  nearestPlanWallProjection,
  photoDistancePx,
  planBounds,
  wallPlanLengthMm,
  wallPointAtOffset,
} from './measurement';
import { defaultSettings } from './storage';
import type { MeasurementWall, Project } from '../types';

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

  it('строит прямоугольный план помещения с размерами стен', () => {
    const walls = createRectangularPlanWalls(4200, 2800);
    expect(walls).toHaveLength(4);
    expect(walls.map((wall) => wall.lengthMm)).toEqual([4200, 2800, 4200, 2800]);
    expect(wallPlanLengthMm(walls[0])).toBe(4200);
    expect(wallPointAtOffset(walls[0], 2100)).toEqual({ xMm: 2100, yMm: 0 });
    const bounds = planBounds(walls, 0);
    expect(bounds.width).toBe(4200);
    expect(bounds.height).toBe(2800);
  });

  it('создаёт черновую геометрию плана из списка стен замера', () => {
    const source: MeasurementWall[] = [
      { id: 'a', name: 'A', lengthMm: 3000 },
      { id: 'b', name: 'B', lengthMm: 2000 },
      { id: 'c', name: 'C', lengthMm: 1500 },
    ];
    const walls = createPlanWallsFromMeasurements(source);
    expect(walls[0]).toMatchObject({ id: 'a', x1Mm: 0, y1Mm: 0, x2Mm: 3000, y2Mm: 0 });
    expect(walls[1]).toMatchObject({ id: 'b', x1Mm: 3000, y1Mm: 0, x2Mm: 3000, y2Mm: 2000 });
    expect(walls[2]).toMatchObject({ id: 'c', x1Mm: 3000, y1Mm: 2000, x2Mm: 1500, y2Mm: 2000 });
  });

  it('находит ближайшую стену и отступ для окна/двери/коммуникации', () => {
    const walls = createRectangularPlanWalls(4000, 2500);
    const projection = nearestPlanWallProjection(walls, { xMm: 1600, yMm: 180 });
    expect(projection?.wall.id).toBe(walls[0].id);
    expect(projection?.offsetMm).toBe(1600);
    expect(projection?.distanceMm).toBe(180);
  });
});
