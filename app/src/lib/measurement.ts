import type { MeasurementData, MeasurementWall, Project } from '../types';
import { layoutWalls, WALL_LABELS } from './kitchenSketch';
import { uid } from './storage';

export function emptyMeasurement(project: Project): MeasurementData {
  const walls: MeasurementWall[] = layoutWalls(project.sketch?.shape).map((wall) => ({ id: uid('wall'), name: WALL_LABELS[wall], lengthMm: project.sketch?.wallLengthsMm?.[wall] ?? null }));
  return { roomHeightMm: project.sketch?.roomHeightMm ?? null, walls, openings: [], communications: [], photos: [], notes: '', updatedAt: new Date().toISOString() };
}
