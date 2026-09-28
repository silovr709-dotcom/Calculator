import type { KitchenSketchSettings, KitchenWall, MeasurementData, MeasurementPhotoCalibration, Project, ProjectPhoto } from '../types';
import { layoutWalls, WALL_LABELS } from './kitchenSketch';
import { uid } from './storage';

export interface PhotoPoint {
  x: number;
  y: number;
}

/** Расстояние между двумя точками с учётом реального соотношения сторон этапа фотографии. */
export function photoDistancePx(a: PhotoPoint, b: PhotoPoint, stageWidth: number, stageHeight: number): number {
  return Math.hypot(((b.x - a.x) / 100) * stageWidth, ((b.y - a.y) / 100) * stageHeight);
}

/** Переводит размер отрезка на откалиброванном фото в миллиметры. */
export function calibratedPhotoLengthMm(
  calibration: MeasurementPhotoCalibration,
  from: PhotoPoint,
  to: PhotoPoint,
  stageWidth: number,
  stageHeight: number,
): number | null {
  if (!Number.isFinite(calibration.lengthMm) || calibration.lengthMm <= 0) return null;
  const reference = photoDistancePx(
    { x: calibration.x1, y: calibration.y1 },
    { x: calibration.x2, y: calibration.y2 },
    stageWidth,
    stageHeight,
  );
  const measured = photoDistancePx(from, to, stageWidth, stageHeight);
  if (reference <= 0 || measured <= 0) return null;
  return Math.max(1, Math.round((measured / reference) * calibration.lengthMm));
}

export function emptyMeasurement(project: Project): MeasurementData {
  const walls = layoutWalls(project.sketch?.shape).map((wall) => ({ id: uid('wall'), name: WALL_LABELS[wall], lengthMm: project.sketch?.wallLengthsMm?.[wall] ?? null }));
  return { roomHeightMm: project.sketch?.roomHeightMm ?? null, walls, openings: [], communications: [], photos: [], notes: '', updatedAt: new Date().toISOString() };
}

/** Готовит явное перенесение замеренных стен в планировку, не меняя модули и строки расчёта. */
export function sketchFromMeasurement(data: MeasurementData, current?: KitchenSketchSettings): KitchenSketchSettings {
  const walls = layoutWalls(current?.shape);
  const wallLengthsMm = Object.fromEntries(walls.map((wall: KitchenWall, index) => [wall, data.walls[index]?.lengthMm ?? null])) as Partial<Record<KitchenWall, number | null>>;
  return { ...current, wallLengthsMm, roomHeightMm: data.roomHeightMm };
}

/** Нормализует старые фотографии, у которых раньше не было поля разметки. */
export function photoWithAnnotations(photo: ProjectPhoto): ProjectPhoto {
  return { ...photo, measurementAnnotations: photo.measurementAnnotations ?? [] };
}
