import type { MeasurementData, MeasurementPhotoCalibration, MeasurementWall, Project, ProjectPhoto } from '../types';
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

export interface MeasurementPlanPoint {
  xMm: number;
  yMm: number;
}

export interface MeasurementPlanBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface MeasurementWallProjection {
  wall: MeasurementWall;
  point: MeasurementPlanPoint;
  offsetMm: number;
  ratio: number;
  distanceMm: number;
}

export function hasPlanWallGeometry(wall: MeasurementWall): boolean {
  return [wall.x1Mm, wall.y1Mm, wall.x2Mm, wall.y2Mm].every((value) => typeof value === 'number' && Number.isFinite(value));
}

export function wallPlanLengthMm(wall: MeasurementWall): number | null {
  if (!hasPlanWallGeometry(wall)) return wall.lengthMm ?? null;
  const x1 = wall.x1Mm ?? 0;
  const y1 = wall.y1Mm ?? 0;
  const x2 = wall.x2Mm ?? 0;
  const y2 = wall.y2Mm ?? 0;
  const length = Math.hypot(x2 - x1, y2 - y1);
  return Number.isFinite(length) && length > 0 ? Math.round(length) : wall.lengthMm ?? null;
}

export function wallPointAtOffset(wall: MeasurementWall, offsetMm: number): MeasurementPlanPoint | null {
  if (!hasPlanWallGeometry(wall)) return null;
  const x1 = wall.x1Mm ?? 0;
  const y1 = wall.y1Mm ?? 0;
  const x2 = wall.x2Mm ?? 0;
  const y2 = wall.y2Mm ?? 0;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length <= 0) return null;
  const ratio = Math.max(0, Math.min(1, offsetMm / length));
  return { xMm: x1 + dx * ratio, yMm: y1 + dy * ratio };
}

export function wallUnitNormal(wall: MeasurementWall): MeasurementPlanPoint | null {
  if (!hasPlanWallGeometry(wall)) return null;
  const dx = (wall.x2Mm ?? 0) - (wall.x1Mm ?? 0);
  const dy = (wall.y2Mm ?? 0) - (wall.y1Mm ?? 0);
  const length = Math.hypot(dx, dy);
  if (length <= 0) return null;
  return { xMm: -dy / length, yMm: dx / length };
}

export function planBounds(walls: MeasurementWall[], paddingMm = 700): MeasurementPlanBounds {
  const points = walls.filter(hasPlanWallGeometry).flatMap((wall) => [
    { x: wall.x1Mm ?? 0, y: wall.y1Mm ?? 0 },
    { x: wall.x2Mm ?? 0, y: wall.y2Mm ?? 0 },
  ]);
  if (points.length === 0) {
    return { minX: -paddingMm, minY: -paddingMm, maxX: 5200 + paddingMm, maxY: 3600 + paddingMm, width: 5200 + paddingMm * 2, height: 3600 + paddingMm * 2 };
  }
  const minX = Math.min(...points.map((point) => point.x)) - paddingMm;
  const maxX = Math.max(...points.map((point) => point.x)) + paddingMm;
  const minY = Math.min(...points.map((point) => point.y)) - paddingMm;
  const maxY = Math.max(...points.map((point) => point.y)) + paddingMm;
  return { minX, minY, maxX, maxY, width: Math.max(1200, maxX - minX), height: Math.max(1200, maxY - minY) };
}

export function createRectangularPlanWalls(widthMm: number, depthMm: number): MeasurementWall[] {
  const width = Math.max(100, Math.round(widthMm));
  const depth = Math.max(100, Math.round(depthMm));
  return [
    { id: uid('wall'), name: 'Стена A', lengthMm: width, x1Mm: 0, y1Mm: 0, x2Mm: width, y2Mm: 0, thicknessMm: 120 },
    { id: uid('wall'), name: 'Стена B', lengthMm: depth, x1Mm: width, y1Mm: 0, x2Mm: width, y2Mm: depth, thicknessMm: 120 },
    { id: uid('wall'), name: 'Стена C', lengthMm: width, x1Mm: width, y1Mm: depth, x2Mm: 0, y2Mm: depth, thicknessMm: 120 },
    { id: uid('wall'), name: 'Стена D', lengthMm: depth, x1Mm: 0, y1Mm: depth, x2Mm: 0, y2Mm: 0, thicknessMm: 120 },
  ];
}

export function createPlanWallsFromMeasurements(walls: MeasurementWall[]): MeasurementWall[] {
  const directions = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ];
  let x = 0;
  let y = 0;
  return walls.map((wall, index) => {
    const direction = directions[index % directions.length];
    const length = Math.max(100, Math.round(wall.lengthMm ?? 3000));
    const nextX = x + direction.x * length;
    const nextY = y + direction.y * length;
    const nextWall: MeasurementWall = { ...wall, lengthMm: length, x1Mm: x, y1Mm: y, x2Mm: nextX, y2Mm: nextY, thicknessMm: wall.thicknessMm ?? 120 };
    x = nextX;
    y = nextY;
    return nextWall;
  });
}

export function nearestPlanWallProjection(walls: MeasurementWall[], point: MeasurementPlanPoint): MeasurementWallProjection | null {
  let best: MeasurementWallProjection | null = null;
  for (const wall of walls) {
    if (!hasPlanWallGeometry(wall)) continue;
    const x1 = wall.x1Mm ?? 0;
    const y1 = wall.y1Mm ?? 0;
    const dx = (wall.x2Mm ?? 0) - x1;
    const dy = (wall.y2Mm ?? 0) - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 0) continue;
    const ratio = Math.max(0, Math.min(1, (((point.xMm - x1) * dx) + ((point.yMm - y1) * dy)) / lenSq));
    const projected = { xMm: x1 + dx * ratio, yMm: y1 + dy * ratio };
    const distance = Math.hypot(point.xMm - projected.xMm, point.yMm - projected.yMm);
    const length = Math.sqrt(lenSq);
    const projection: MeasurementWallProjection = { wall, point: projected, offsetMm: Math.round(length * ratio), ratio, distanceMm: Math.round(distance) };
    if (!best || projection.distanceMm < best.distanceMm) best = projection;
  }
  return best;
}

/** Нормализует старые фотографии, у которых раньше не было поля разметки. */
export function photoWithAnnotations(photo: ProjectPhoto): ProjectPhoto {
  return { ...photo, measurementAnnotations: photo.measurementAnnotations ?? [] };
}
