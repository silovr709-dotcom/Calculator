import { useMemo, useRef, useState, type PointerEvent } from 'react';
import type { MeasurementCommunication, MeasurementData, MeasurementOpening, MeasurementWall, Project } from '../types';
import {
  createPlanWallsFromMeasurements,
  createRectangularPlanWalls,
  hasPlanWallGeometry,
  nearestPlanWallProjection,
  planBounds,
  wallPlanLengthMm,
  wallPointAtOffset,
  wallUnitNormal,
  type MeasurementPlanPoint,
} from '../lib/measurement';
import { uid } from '../lib/storage';

type PlanTool = 'select' | 'wall' | 'window' | 'door' | 'opening' | 'water' | 'electricity' | 'gas' | 'ventilation';
type SelectedPlanItem = { kind: 'wall' | 'opening' | 'communication'; id: string } | null;
type WallDragSnapshot = { x1Mm: number; y1Mm: number; x2Mm: number; y2Mm: number };
type DragState =
  | { kind: 'wall'; id: string; pointerId: number; start: MeasurementPlanPoint; original: WallDragSnapshot }
  | { kind: 'wall-start' | 'wall-end'; id: string; pointerId: number }
  | { kind: 'opening'; id: string; pointerId: number }
  | { kind: 'communication'; id: string; pointerId: number };

type PlanToolMeta = { id: PlanTool; label: string; hint: string };

const PLAN_TOOLS: PlanToolMeta[] = [
  { id: 'select', label: 'Выбор / двигать', hint: 'Выберите элемент. Стены, окна и точки можно перетаскивать мышью.' },
  { id: 'wall', label: '+ Стена', hint: 'Нажмите начало и конец стены. Точную длину задайте справа.' },
  { id: 'window', label: '+ Окно', hint: 'Нажмите на стену — окно появится там и сразу откроется карточка.' },
  { id: 'door', label: '+ Дверь', hint: 'Нажмите на стену — дверь появится там и сразу откроется карточка.' },
  { id: 'opening', label: '+ Проём', hint: 'Нажмите на стену — проём появится там и сразу откроется карточка.' },
  { id: 'water', label: '+ Вода', hint: 'Нажмите точку на стене.' },
  { id: 'electricity', label: '+ Розетка', hint: 'Нажмите точку на стене.' },
  { id: 'gas', label: '+ Газ', hint: 'Нажмите точку на стене.' },
  { id: 'ventilation', label: '+ Вент.', hint: 'Нажмите точку вентиляции на стене.' },
];

const COMMUNICATION_LABELS: Record<MeasurementCommunication['kind'], string> = {
  water: 'Вода / слив',
  gas: 'Газ',
  electricity: 'Электрика',
  ventilation: 'Вентиляция',
  other: 'Точка',
};

const OPENING_LABELS: Record<MeasurementOpening['kind'], string> = {
  window: 'Окно',
  door: 'Дверь',
  other: 'Проём',
};

function fmtMm(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)} мм`;
}

function inputNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInputNumber(value: string, fallback = 0): number {
  const parsed = inputNumber(value);
  return parsed != null && parsed > 0 ? Math.round(parsed) : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function snapPoint(point: MeasurementPlanPoint, gridMm: number): MeasurementPlanPoint {
  return {
    xMm: Math.round(point.xMm / gridMm) * gridMm,
    yMm: Math.round(point.yMm / gridMm) * gridMm,
  };
}

function wallEndpoint(wall: MeasurementWall, end: 'start' | 'finish'): MeasurementPlanPoint {
  return end === 'start'
    ? { xMm: wall.x1Mm ?? 0, yMm: wall.y1Mm ?? 0 }
    : { xMm: wall.x2Mm ?? 0, yMm: wall.y2Mm ?? 0 };
}

function wallAngleDeg(wall: MeasurementWall): number {
  return Math.atan2((wall.y2Mm ?? 0) - (wall.y1Mm ?? 0), (wall.x2Mm ?? 0) - (wall.x1Mm ?? 0)) * 180 / Math.PI;
}

function defaultOpeningWidth(kind: MeasurementOpening['kind']): number {
  return kind === 'door' ? 900 : kind === 'window' ? 1200 : 1000;
}

function openingSegment(opening: MeasurementOpening, walls: MeasurementWall[]) {
  const wall = walls.find((item) => item.id === opening.wallId);
  if (!wall || !hasPlanWallGeometry(wall)) return null;
  const length = wallPlanLengthMm(wall) ?? 1;
  const width = Math.max(120, Math.min(opening.widthMm ?? defaultOpeningWidth(opening.kind), length));
  const startOffset = Math.max(0, Math.min(opening.offsetMm ?? 0, Math.max(0, length - width)));
  const p1 = wallPointAtOffset(wall, startOffset);
  const p2 = wallPointAtOffset(wall, startOffset + width);
  const normal = wallUnitNormal(wall);
  if (!p1 || !p2 || !normal) return null;
  return { wall, p1, p2, normal, width, startOffset };
}

function communicationPoint(item: MeasurementCommunication, walls: MeasurementWall[]) {
  const wall = walls.find((candidate) => candidate.id === item.wallId);
  if (!wall || !hasPlanWallGeometry(wall)) return null;
  const base = wallPointAtOffset(wall, item.offsetMm ?? 0);
  const normal = wallUnitNormal(wall);
  if (!base || !normal) return null;
  return { wall, point: { xMm: base.xMm + normal.xMm * 170, yMm: base.yMm + normal.yMm * 170 }, normal };
}

function openingOffsetForProjection(openingKind: MeasurementOpening['kind'], projection: NonNullable<ReturnType<typeof nearestPlanWallProjection>>, widthMm = defaultOpeningWidth(openingKind)): number {
  const length = wallPlanLengthMm(projection.wall) ?? widthMm;
  return Math.round(clamp(projection.offsetMm - widthMm / 2, 0, Math.max(0, length - widthMm)));
}

export default function RoomPlanEditor(props: { project: Project; data: MeasurementData; update: (patch: Partial<MeasurementData>) => void }) {
  const { data, update } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<PlanTool>('select');
  const [draftPoint, setDraftPoint] = useState<MeasurementPlanPoint | null>(null);
  const [selection, setSelection] = useState<SelectedPlanItem>(() => {
    const firstWall = data.walls.find(hasPlanWallGeometry);
    return firstWall ? { kind: 'wall', id: firstWall.id } : null;
  });
  const [drag, setDrag] = useState<DragState | null>(null);
  const [rectWidthMm, setRectWidthMm] = useState<number>(() => data.walls[0]?.lengthMm ?? 3600);
  const [rectDepthMm, setRectDepthMm] = useState<number>(() => data.walls[1]?.lengthMm ?? 2600);

  const bounds = useMemo(() => planBounds(data.walls), [data.walls]);
  const planWalls = useMemo(() => data.walls.filter(hasPlanWallGeometry), [data.walls]);
  const selectedWall = selection?.kind === 'wall' ? data.walls.find((wall) => wall.id === selection.id) ?? null : null;
  const selectedOpening = selection?.kind === 'opening' ? data.openings.find((opening) => opening.id === selection.id) ?? null : null;
  const selectedCommunication = selection?.kind === 'communication' ? data.communications.find((item) => item.id === selection.id) ?? null : null;
  const activeWallId = selectedWall?.id ?? selectedOpening?.wallId ?? selectedCommunication?.wallId ?? null;
  const activeWall = activeWallId ? data.walls.find((wall) => wall.id === activeWallId) ?? null : null;
  const selectedWallOpenings = activeWall ? data.openings.filter((opening) => opening.wallId === activeWall.id) : [];
  const selectedWallCommunications = activeWall ? data.communications.filter((item) => item.wallId === activeWall.id) : [];
  const activeTool = PLAN_TOOLS.find((item) => item.id === tool) ?? PLAN_TOOLS[0];
  const gridStep = bounds.width > 9000 || bounds.height > 9000 ? 1000 : 500;
  const minorGridStep = gridStep / 2;
  const labelSize = Math.max(120, Math.min(220, Math.min(bounds.width, bounds.height) / 18));
  const hitDistance = Math.max(260, Math.min(bounds.width, bounds.height) / 28);
  const readiness = [
    { label: 'Высота', ok: data.roomHeightMm != null, value: data.roomHeightMm ? `${data.roomHeightMm} мм` : 'не указана' },
    { label: 'План', ok: planWalls.length >= 2, value: `${planWalls.length} стен` },
    { label: 'Проёмы', ok: data.openings.length > 0, value: `${data.openings.length}` },
    { label: 'Коммуникации', ok: data.communications.length > 0, value: `${data.communications.length}` },
    { label: 'Фото', ok: data.photos.length > 0, value: `${data.photos.length}` },
  ];
  const gridLines = useMemo(() => {
    const vertical: number[] = [];
    const horizontal: number[] = [];
    const firstX = Math.ceil(bounds.minX / minorGridStep) * minorGridStep;
    const firstY = Math.ceil(bounds.minY / minorGridStep) * minorGridStep;
    for (let x = firstX; x <= bounds.maxX && vertical.length < 80; x += minorGridStep) vertical.push(x);
    for (let y = firstY; y <= bounds.maxY && horizontal.length < 80; y += minorGridStep) horizontal.push(y);
    return { vertical, horizontal };
  }, [bounds.maxX, bounds.maxY, bounds.minX, bounds.minY, minorGridStep]);

  const screenToPlan = (event: PointerEvent<SVGSVGElement | SVGGElement | SVGCircleElement>): MeasurementPlanPoint | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(matrix.inverse());
    return snapPoint({ xMm: transformed.x, yMm: transformed.y }, 50);
  };

  const patchWall = (id: string, patch: Partial<MeasurementWall>) => {
    update({
      walls: data.walls.map((wall) => {
        if (wall.id !== id) return wall;
        const next = { ...wall, ...patch };
        return { ...next, lengthMm: wallPlanLengthMm(next) ?? next.lengthMm ?? null };
      }),
    });
  };

  const removeWall = (id: string) => {
    update({
      walls: data.walls.filter((wall) => wall.id !== id),
      openings: data.openings.map((opening) => opening.wallId === id ? { ...opening, wallId: undefined, offsetMm: null } : opening),
      communications: data.communications.map((item) => item.wallId === id ? { ...item, wallId: undefined, offsetMm: null } : item),
    });
    if (selection?.id === id) setSelection(null);
  };

  const setSelectedWallLength = (lengthMm: number) => {
    if (!selectedWall || !hasPlanWallGeometry(selectedWall)) return;
    const start = wallEndpoint(selectedWall, 'start');
    const finish = wallEndpoint(selectedWall, 'finish');
    const dx = finish.xMm - start.xMm;
    const dy = finish.yMm - start.yMm;
    const currentLength = Math.hypot(dx, dy) || 1;
    patchWall(selectedWall.id, {
      lengthMm,
      x2Mm: Math.round(start.xMm + (dx / currentLength) * lengthMm),
      y2Mm: Math.round(start.yMm + (dy / currentLength) * lengthMm),
    });
  };

  const setOpeningPatch = (id: string, patch: Partial<MeasurementOpening>) => update({ openings: data.openings.map((opening) => opening.id === id ? { ...opening, ...patch } : opening) });
  const setCommunicationPatch = (id: string, patch: Partial<MeasurementCommunication>) => update({ communications: data.communications.map((item) => item.id === id ? { ...item, ...patch } : item) });

  const removeOpening = (id: string) => {
    update({ openings: data.openings.filter((opening) => opening.id !== id) });
    if (selection?.kind === 'opening' && selection.id === id) setSelection(activeWall ? { kind: 'wall', id: activeWall.id } : null);
  };

  const removeCommunication = (id: string) => {
    update({ communications: data.communications.filter((item) => item.id !== id) });
    if (selection?.kind === 'communication' && selection.id === id) setSelection(activeWall ? { kind: 'wall', id: activeWall.id } : null);
  };

  const addWall = (start: MeasurementPlanPoint, end: MeasurementPlanPoint) => {
    const length = Math.max(100, Math.round(Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm) / 10) * 10);
    const wall: MeasurementWall = {
      id: uid('wall'),
      name: `Стена ${data.walls.length + 1}`,
      lengthMm: length,
      x1Mm: start.xMm,
      y1Mm: start.yMm,
      x2Mm: end.xMm,
      y2Mm: end.yMm,
      thicknessMm: 120,
    };
    update({ walls: [...data.walls, wall] });
    setSelection({ kind: 'wall', id: wall.id });
    setTool('select');
  };

  const addOpeningAt = (kind: MeasurementOpening['kind'], projection: NonNullable<ReturnType<typeof nearestPlanWallProjection>>) => {
    const widthMm = defaultOpeningWidth(kind);
    const opening: MeasurementOpening = {
      id: uid('opening'),
      kind,
      name: `${OPENING_LABELS[kind]} ${data.openings.length + 1}`,
      wallId: projection.wall.id,
      offsetMm: openingOffsetForProjection(kind, projection, widthMm),
      widthMm,
      heightMm: kind === 'door' ? 2100 : kind === 'window' ? 1200 : null,
      sillHeightMm: kind === 'window' ? 900 : undefined,
      swing: kind === 'door' ? 'left-in' : undefined,
    };
    update({ openings: [...data.openings, opening] });
    setSelection({ kind: 'opening', id: opening.id });
    setTool('select');
  };

  const addCommunicationAt = (kind: MeasurementCommunication['kind'], projection: NonNullable<ReturnType<typeof nearestPlanWallProjection>>) => {
    const defaults: Record<MeasurementCommunication['kind'], number | null> = { water: 560, gas: 720, electricity: 1050, ventilation: 2200, other: null };
    const item: MeasurementCommunication = {
      id: uid('communication'),
      kind,
      name: `${COMMUNICATION_LABELS[kind]} ${data.communications.length + 1}`,
      wallId: projection.wall.id,
      offsetMm: projection.offsetMm,
      heightMm: defaults[kind],
    };
    update({ communications: [...data.communications, item] });
    setSelection({ kind: 'communication', id: item.id });
    setTool('select');
  };

  const selectNearestWallOrAddItem = (point: MeasurementPlanPoint) => {
    const projection = nearestPlanWallProjection(data.walls, point);
    if (!projection || projection.distanceMm > hitDistance) {
      if (tool === 'select') setSelection(null);
      return;
    }
    if (tool === 'select') {
      setSelection({ kind: 'wall', id: projection.wall.id });
      return;
    }
    if (tool === 'window' || tool === 'door' || tool === 'opening') {
      addOpeningAt(tool === 'opening' ? 'other' : tool, projection);
      return;
    }
    if (tool === 'water' || tool === 'electricity' || tool === 'gas' || tool === 'ventilation') {
      addCommunicationAt(tool, projection);
    }
  };

  const handlePlanPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    const point = screenToPlan(event);
    if (!point) return;
    if (tool === 'wall') {
      if (!draftPoint) {
        setDraftPoint(point);
        return;
      }
      if (Math.hypot(point.xMm - draftPoint.xMm, point.yMm - draftPoint.yMm) < 80) return;
      addWall(draftPoint, point);
      setDraftPoint(null);
      return;
    }
    selectNearestWallOrAddItem(point);
  };

  const updateOpeningByPlanPoint = (id: string, point: MeasurementPlanPoint) => {
    const opening = data.openings.find((item) => item.id === id);
    const projection = nearestPlanWallProjection(data.walls, point);
    if (!opening || !projection) return;
    setOpeningPatch(id, { wallId: projection.wall.id, offsetMm: openingOffsetForProjection(opening.kind, projection, opening.widthMm ?? defaultOpeningWidth(opening.kind)) });
  };

  const updateCommunicationByPlanPoint = (id: string, point: MeasurementPlanPoint) => {
    const projection = nearestPlanWallProjection(data.walls, point);
    if (!projection) return;
    setCommunicationPatch(id, { wallId: projection.wall.id, offsetMm: projection.offsetMm });
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const point = screenToPlan(event);
    if (!point) return;
    if (drag.kind === 'wall') {
      const dx = point.xMm - drag.start.xMm;
      const dy = point.yMm - drag.start.yMm;
      patchWall(drag.id, {
        x1Mm: drag.original.x1Mm + dx,
        y1Mm: drag.original.y1Mm + dy,
        x2Mm: drag.original.x2Mm + dx,
        y2Mm: drag.original.y2Mm + dy,
      });
      return;
    }
    if (drag.kind === 'wall-start') {
      patchWall(drag.id, { x1Mm: point.xMm, y1Mm: point.yMm });
      return;
    }
    if (drag.kind === 'wall-end') {
      patchWall(drag.id, { x2Mm: point.xMm, y2Mm: point.yMm });
      return;
    }
    if (drag.kind === 'opening') {
      updateOpeningByPlanPoint(drag.id, point);
      return;
    }
    updateCommunicationByPlanPoint(drag.id, point);
  };

  const finishDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (drag) {
      svgRef.current?.releasePointerCapture(drag.pointerId);
      setDrag(null);
    }
    if (event.pointerId) return;
  };

  const startWallDrag = (event: PointerEvent<SVGGElement>, wall: MeasurementWall) => {
    if (tool !== 'select' || !hasPlanWallGeometry(wall)) return;
    event.stopPropagation();
    event.preventDefault();
    const point = screenToPlan(event);
    if (!point) return;
    svgRef.current?.setPointerCapture(event.pointerId);
    setSelection({ kind: 'wall', id: wall.id });
    setDrag({
      kind: 'wall',
      id: wall.id,
      pointerId: event.pointerId,
      start: point,
      original: { x1Mm: wall.x1Mm ?? 0, y1Mm: wall.y1Mm ?? 0, x2Mm: wall.x2Mm ?? 0, y2Mm: wall.y2Mm ?? 0 },
    });
  };

  const startWallEndpointDrag = (event: PointerEvent<SVGCircleElement>, wall: MeasurementWall, end: 'start' | 'finish') => {
    if (tool !== 'select') return;
    event.stopPropagation();
    event.preventDefault();
    svgRef.current?.setPointerCapture(event.pointerId);
    setSelection({ kind: 'wall', id: wall.id });
    setDrag({ kind: end === 'start' ? 'wall-start' : 'wall-end', id: wall.id, pointerId: event.pointerId });
  };

  const startOpeningDrag = (event: PointerEvent<SVGGElement>, id: string) => {
    if (tool !== 'select') return;
    event.stopPropagation();
    event.preventDefault();
    svgRef.current?.setPointerCapture(event.pointerId);
    setSelection({ kind: 'opening', id });
    setDrag({ kind: 'opening', id, pointerId: event.pointerId });
  };

  const startCommunicationDrag = (event: PointerEvent<SVGGElement>, id: string) => {
    if (tool !== 'select') return;
    event.stopPropagation();
    event.preventDefault();
    svgRef.current?.setPointerCapture(event.pointerId);
    setSelection({ kind: 'communication', id });
    setDrag({ kind: 'communication', id, pointerId: event.pointerId });
  };

  const createRectangle = () => {
    const walls = createRectangularPlanWalls(Math.max(100, rectWidthMm), Math.max(100, rectDepthMm));
    update({
      walls,
      openings: data.openings.map((opening) => ({ ...opening, wallId: undefined, offsetMm: null })),
      communications: data.communications.map((item) => ({ ...item, wallId: undefined, offsetMm: null })),
    });
    setSelection(walls[0] ? { kind: 'wall', id: walls[0].id } : null);
    setDraftPoint(null);
    setTool('select');
  };

  const buildFromWallList = () => {
    if (data.walls.length === 0) {
      const walls = createRectangularPlanWalls(3600, 2600);
      update({ walls });
      setSelection(walls[0] ? { kind: 'wall', id: walls[0].id } : null);
      return;
    }
    const walls = createPlanWallsFromMeasurements(data.walls);
    update({ walls });
    setSelection(walls[0] ? { kind: 'wall', id: walls[0].id } : null);
    setDraftPoint(null);
    setTool('select');
  };

  const closeContour = () => {
    if (planWalls.length < 2) return;
    const first = wallEndpoint(planWalls[0], 'start');
    const last = wallEndpoint(planWalls[planWalls.length - 1], 'finish');
    const distance = Math.round(Math.hypot(first.xMm - last.xMm, first.yMm - last.yMm));
    if (distance < 80) return;
    const wall: MeasurementWall = {
      id: uid('wall'),
      name: `Замыкающая стена ${data.walls.length + 1}`,
      lengthMm: distance,
      x1Mm: last.xMm,
      y1Mm: last.yMm,
      x2Mm: first.xMm,
      y2Mm: first.yMm,
      thicknessMm: 120,
    };
    update({ walls: [...data.walls, wall] });
    setSelection({ kind: 'wall', id: wall.id });
  };

  const clearPlan = () => {
    update({ walls: data.walls.map((wall) => ({ ...wall, x1Mm: null, y1Mm: null, x2Mm: null, y2Mm: null })) });
    setSelection(null);
    setDraftPoint(null);
  };

  const addOpeningToActiveWall = (kind: MeasurementOpening['kind']) => {
    if (!activeWall || !hasPlanWallGeometry(activeWall)) return;
    const length = wallPlanLengthMm(activeWall) ?? 1000;
    const projection = { wall: activeWall, point: wallPointAtOffset(activeWall, length / 2) ?? { xMm: 0, yMm: 0 }, offsetMm: Math.round(length / 2), ratio: 0.5, distanceMm: 0 };
    addOpeningAt(kind, projection);
  };

  const addCommunicationToActiveWall = (kind: MeasurementCommunication['kind']) => {
    if (!activeWall || !hasPlanWallGeometry(activeWall)) return;
    const length = wallPlanLengthMm(activeWall) ?? 1000;
    const projection = { wall: activeWall, point: wallPointAtOffset(activeWall, length / 2) ?? { xMm: 0, yMm: 0 }, offsetMm: Math.round(length / 2), ratio: 0.5, distanceMm: 0 };
    addCommunicationAt(kind, projection);
  };

  const selectedKindTitle = selectedWall
    ? 'Стена'
    : selectedOpening
      ? OPENING_LABELS[selectedOpening.kind]
      : selectedCommunication
        ? COMMUNICATION_LABELS[selectedCommunication.kind]
        : 'Ничего не выбрано';

  return (
    <section className="card measurement-plan-card">
      <div className="section-head measurement-plan-head">
        <div>
          <h3>План помещения сверху</h3>
          <p className="muted small">Основное рабочее место замера: выберите инструмент, поставьте элемент на стену, дальше редактируйте его в карточке справа. В режиме выбора элементы можно перетаскивать мышью.</p>
        </div>
        <div className="measurement-plan-presets">
          <label>Ширина<input type="number" min={100} value={rectWidthMm} onChange={(event) => setRectWidthMm(positiveInputNumber(event.target.value, rectWidthMm))} /></label>
          <label>Глубина<input type="number" min={100} value={rectDepthMm} onChange={(event) => setRectDepthMm(positiveInputNumber(event.target.value, rectDepthMm))} /></label>
          <button className="btn tiny ghost" type="button" onClick={createRectangle}>Создать прямоугольник</button>
          <button className="btn tiny ghost" type="button" onClick={buildFromWallList}>По списку стен</button>
          <button className="btn tiny ghost" type="button" disabled={planWalls.length < 2} onClick={closeContour}>Замкнуть</button>
          <button className="btn tiny danger" type="button" disabled={planWalls.length === 0} onClick={clearPlan}>Очистить геометрию</button>
        </div>
      </div>

      <div className="measurement-plan-workbench">
        <div className="measurement-plan-tools" aria-label="Инструменты плана помещения">
          {PLAN_TOOLS.map((item) => (
            <button key={item.id} className={`btn tiny ${tool === item.id ? 'primary' : 'ghost'}`} type="button" title={item.hint} onClick={() => { setTool(item.id); setDraftPoint(null); }}>
              {item.label}
            </button>
          ))}
        </div>

        <div className="measurement-plan-stage-wrap">
          <div className="measurement-plan-live-hint"><b>{activeTool.label}</b><span>{tool === 'wall' ? (draftPoint ? 'Нажмите конец стены. После создания точную длину можно задать справа.' : 'Нажмите начало стены на плане.') : activeTool.hint}</span></div>
          <svg
            ref={svgRef}
            className={`measurement-plan-stage tool-${tool} ${drag ? 'is-dragging' : ''}`}
            viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
            role="img"
            aria-label="План помещения сверху"
            onPointerDown={handlePlanPointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
          >
            <rect className="measurement-plan-bg" x={bounds.minX} y={bounds.minY} width={bounds.width} height={bounds.height} />
            {gridLines.vertical.map((x) => <line key={`vx-${x}`} className={x % gridStep === 0 ? 'plan-grid major' : 'plan-grid'} x1={x} y1={bounds.minY} x2={x} y2={bounds.maxY} />)}
            {gridLines.horizontal.map((y) => <line key={`hy-${y}`} className={y % gridStep === 0 ? 'plan-grid major' : 'plan-grid'} x1={bounds.minX} y1={y} x2={bounds.maxX} y2={y} />)}

            {planWalls.map((wall) => {
              const length = wallPlanLengthMm(wall);
              const normal = wallUnitNormal(wall) ?? { xMm: 0, yMm: -1 };
              const midX = ((wall.x1Mm ?? 0) + (wall.x2Mm ?? 0)) / 2;
              const midY = ((wall.y1Mm ?? 0) + (wall.y2Mm ?? 0)) / 2;
              const selected = selection?.kind === 'wall' && selection.id === wall.id;
              return (
                <g key={wall.id} className={`measurement-plan-wall ${selected ? 'selected' : ''}`} onPointerDown={(event) => startWallDrag(event, wall)}>
                  <line x1={wall.x1Mm ?? 0} y1={wall.y1Mm ?? 0} x2={wall.x2Mm ?? 0} y2={wall.y2Mm ?? 0} strokeWidth={wall.thicknessMm ?? 120} />
                  <circle className="wall-handle" cx={wall.x1Mm ?? 0} cy={wall.y1Mm ?? 0} r="82" onPointerDown={(event) => startWallEndpointDrag(event, wall, 'start')} />
                  <circle className="wall-handle" cx={wall.x2Mm ?? 0} cy={wall.y2Mm ?? 0} r="82" onPointerDown={(event) => startWallEndpointDrag(event, wall, 'finish')} />
                  <text x={midX + normal.xMm * 230} y={midY + normal.yMm * 230} fontSize={labelSize} transform={`rotate(${wallAngleDeg(wall)} ${midX + normal.xMm * 230} ${midY + normal.yMm * 230})`}>{wall.name} · {fmtMm(length)}</text>
                </g>
              );
            })}

            {data.openings.map((opening) => {
              const segment = openingSegment(opening, data.walls);
              if (!segment) return null;
              const selected = selection?.kind === 'opening' && selection.id === opening.id;
              const labelX = (segment.p1.xMm + segment.p2.xMm) / 2 + segment.normal.xMm * 360;
              const labelY = (segment.p1.yMm + segment.p2.yMm) / 2 + segment.normal.yMm * 360;
              return (
                <g key={opening.id} className={`measurement-plan-opening ${opening.kind} ${selected ? 'selected' : ''}`} onPointerDown={(event) => startOpeningDrag(event, opening.id)}>
                  <line className="opening-cut" x1={segment.p1.xMm} y1={segment.p1.yMm} x2={segment.p2.xMm} y2={segment.p2.yMm} />
                  <line className="opening-mark" x1={segment.p1.xMm} y1={segment.p1.yMm} x2={segment.p2.xMm} y2={segment.p2.yMm} />
                  {opening.kind === 'door' && <path className="door-swing" d={`M ${segment.p1.xMm} ${segment.p1.yMm} L ${segment.p1.xMm + segment.normal.xMm * segment.width} ${segment.p1.yMm + segment.normal.yMm * segment.width} A ${segment.width} ${segment.width} 0 0 1 ${segment.p2.xMm} ${segment.p2.yMm}`} />}
                  <text x={labelX} y={labelY} fontSize={labelSize}>{OPENING_LABELS[opening.kind]} · {fmtMm(opening.widthMm)}</text>
                </g>
              );
            })}

            {data.communications.map((item) => {
              const located = communicationPoint(item, data.walls);
              if (!located) return null;
              const selected = selection?.kind === 'communication' && selection.id === item.id;
              return (
                <g key={item.id} className={`measurement-plan-communication ${item.kind} ${selected ? 'selected' : ''}`} onPointerDown={(event) => startCommunicationDrag(event, item.id)}>
                  <line x1={located.point.xMm - located.normal.xMm * 170} y1={located.point.yMm - located.normal.yMm * 170} x2={located.point.xMm} y2={located.point.yMm} />
                  <circle cx={located.point.xMm} cy={located.point.yMm} r="120" />
                  <text x={located.point.xMm + 160} y={located.point.yMm - 120} fontSize={labelSize}>{COMMUNICATION_LABELS[item.kind]}{item.heightMm ? ` · h ${item.heightMm}` : ''}</text>
                </g>
              );
            })}

            {draftPoint && <g className="measurement-plan-draft"><circle cx={draftPoint.xMm} cy={draftPoint.yMm} r="110" /><text x={draftPoint.xMm + 150} y={draftPoint.yMm - 150} fontSize={labelSize}>начало стены</text></g>}
          </svg>
        </div>

        <aside className="measurement-plan-inspector">
          <div className="measurement-plan-status">
            <b>{selectedKindTitle}</b>
            <span>{drag ? 'Перетаскивание… отпустите мышь, чтобы зафиксировать.' : activeTool.hint}</span>
          </div>

          <div className="measurement-plan-readiness">
            {readiness.map((item) => <span key={item.label} className={item.ok ? 'ok' : 'todo'}><b>{item.label}</b><em>{item.value}</em></span>)}
          </div>

          {selectedWall && hasPlanWallGeometry(selectedWall) && (
            <div className="measurement-plan-selected">
              <h4>Стена</h4>
              <label>Название<input value={selectedWall.name} onChange={(event) => patchWall(selectedWall.id, { name: event.target.value })} /></label>
              <label>Длина стены, мм<input type="number" min={100} value={Math.round(wallPlanLengthMm(selectedWall) ?? selectedWall.lengthMm ?? 0)} onChange={(event) => setSelectedWallLength(Number(event.target.value) || 100)} /></label>
              <label>Заметка<input value={selectedWall.note ?? ''} onChange={(event) => patchWall(selectedWall.id, { note: event.target.value })} placeholder="например: стена с окном, завал, плитка" /></label>
              <div className="measurement-plan-quick-add">
                <button className="btn tiny ghost" type="button" onClick={() => addOpeningToActiveWall('window')}>+ окно</button>
                <button className="btn tiny ghost" type="button" onClick={() => addOpeningToActiveWall('door')}>+ дверь</button>
                <button className="btn tiny ghost" type="button" onClick={() => addOpeningToActiveWall('other')}>+ проём</button>
                <button className="btn tiny ghost" type="button" onClick={() => addCommunicationToActiveWall('electricity')}>+ розетка</button>
                <button className="btn tiny ghost" type="button" onClick={() => addCommunicationToActiveWall('water')}>+ вода</button>
              </div>
              <details className="measurement-plan-advanced"><summary>Точные координаты</summary><div className="grid2 compact-grid">
                <label>X1<input type="number" value={selectedWall.x1Mm ?? 0} onChange={(event) => patchWall(selectedWall.id, { x1Mm: Number(event.target.value) })} /></label>
                <label>Y1<input type="number" value={selectedWall.y1Mm ?? 0} onChange={(event) => patchWall(selectedWall.id, { y1Mm: Number(event.target.value) })} /></label>
                <label>X2<input type="number" value={selectedWall.x2Mm ?? 0} onChange={(event) => patchWall(selectedWall.id, { x2Mm: Number(event.target.value) })} /></label>
                <label>Y2<input type="number" value={selectedWall.y2Mm ?? 0} onChange={(event) => patchWall(selectedWall.id, { y2Mm: Number(event.target.value) })} /></label>
              </div></details>
              <button className="btn tiny danger" type="button" onClick={() => removeWall(selectedWall.id)}>Удалить стену</button>
            </div>
          )}

          {selectedOpening && (
            <div className="measurement-plan-selected">
              <h4>{OPENING_LABELS[selectedOpening.kind]}</h4>
              <label>Тип<select value={selectedOpening.kind} onChange={(event) => setOpeningPatch(selectedOpening.id, { kind: event.target.value as MeasurementOpening['kind'] })}><option value="window">Окно</option><option value="door">Дверь</option><option value="other">Проём</option></select></label>
              <label>Название<input value={selectedOpening.name} onChange={(event) => setOpeningPatch(selectedOpening.id, { name: event.target.value })} /></label>
              <label>Стена<select value={selectedOpening.wallId ?? ''} onChange={(event) => setOpeningPatch(selectedOpening.id, { wallId: event.target.value || undefined })}><option value="">не указана</option>{data.walls.map((wall) => <option key={wall.id} value={wall.id}>{wall.name}</option>)}</select></label>
              <div className="grid2 compact-grid">
                <label>Отступ от начала стены, мм<input type="number" value={selectedOpening.offsetMm ?? ''} onChange={(event) => setOpeningPatch(selectedOpening.id, { offsetMm: inputNumber(event.target.value) })} /></label>
                <label>Ширина, мм<input type="number" value={selectedOpening.widthMm ?? ''} onChange={(event) => setOpeningPatch(selectedOpening.id, { widthMm: inputNumber(event.target.value) })} /></label>
                <label>Высота, мм<input type="number" value={selectedOpening.heightMm ?? ''} onChange={(event) => setOpeningPatch(selectedOpening.id, { heightMm: inputNumber(event.target.value) })} /></label>
                <label>Подоконник / низ, мм<input type="number" value={selectedOpening.sillHeightMm ?? ''} onChange={(event) => setOpeningPatch(selectedOpening.id, { sillHeightMm: inputNumber(event.target.value) })} /></label>
              </div>
              {selectedOpening.kind === 'door' && <label>Открывание<select value={selectedOpening.swing ?? 'left-in'} onChange={(event) => setOpeningPatch(selectedOpening.id, { swing: event.target.value as MeasurementOpening['swing'] })}><option value="left-in">левое внутрь</option><option value="right-in">правое внутрь</option><option value="left-out">левое наружу</option><option value="right-out">правое наружу</option><option value="none">не учитывать</option></select></label>}
              <label>Примечание<input value={selectedOpening.note ?? ''} onChange={(event) => setOpeningPatch(selectedOpening.id, { note: event.target.value })} /></label>
              <button className="btn tiny danger" type="button" onClick={() => removeOpening(selectedOpening.id)}>Удалить</button>
            </div>
          )}

          {selectedCommunication && (
            <div className="measurement-plan-selected">
              <h4>{COMMUNICATION_LABELS[selectedCommunication.kind]}</h4>
              <label>Тип<select value={selectedCommunication.kind} onChange={(event) => setCommunicationPatch(selectedCommunication.id, { kind: event.target.value as MeasurementCommunication['kind'] })}><option value="water">Вода / слив</option><option value="gas">Газ</option><option value="electricity">Электричество</option><option value="ventilation">Вентиляция</option><option value="other">Другое</option></select></label>
              <label>Название<input value={selectedCommunication.name} onChange={(event) => setCommunicationPatch(selectedCommunication.id, { name: event.target.value })} /></label>
              <label>Стена<select value={selectedCommunication.wallId ?? ''} onChange={(event) => setCommunicationPatch(selectedCommunication.id, { wallId: event.target.value || undefined })}><option value="">не указана</option>{data.walls.map((wall) => <option key={wall.id} value={wall.id}>{wall.name}</option>)}</select></label>
              <div className="grid2 compact-grid">
                <label>Отступ от начала стены, мм<input type="number" value={selectedCommunication.offsetMm ?? ''} onChange={(event) => setCommunicationPatch(selectedCommunication.id, { offsetMm: inputNumber(event.target.value) })} /></label>
                <label>Высота от пола, мм<input type="number" value={selectedCommunication.heightMm ?? ''} onChange={(event) => setCommunicationPatch(selectedCommunication.id, { heightMm: inputNumber(event.target.value) })} /></label>
              </div>
              <label>Примечание<input value={selectedCommunication.note ?? ''} onChange={(event) => setCommunicationPatch(selectedCommunication.id, { note: event.target.value })} /></label>
              <button className="btn tiny danger" type="button" onClick={() => removeCommunication(selectedCommunication.id)}>Удалить</button>
            </div>
          )}

          {!selectedWall && !selectedOpening && !selectedCommunication && (
            <div className="empty small">Выберите стену, окно, дверь или коммуникацию на плане. В режиме «Выбор / двигать» стены перетаскиваются целиком, а круглые ручки двигают начало/конец стены.</div>
          )}

          {activeWall && (selectedWallOpenings.length > 0 || selectedWallCommunications.length > 0) && (
            <div className="measurement-plan-linked-list">
              <b className="linked-title">На стене «{activeWall.name}»</b>
              {selectedWallOpenings.map((opening) => (
                <button type="button" key={opening.id} className={selection?.kind === 'opening' && selection.id === opening.id ? 'active' : ''} onClick={() => setSelection({ kind: 'opening', id: opening.id })}>
                  <span>{OPENING_LABELS[opening.kind]} · {opening.name}</span><em>{fmtMm(opening.offsetMm)} от начала · {fmtMm(opening.widthMm)}</em>
                </button>
              ))}
              {selectedWallCommunications.map((item) => (
                <button type="button" key={item.id} className={selection?.kind === 'communication' && selection.id === item.id ? 'active' : ''} onClick={() => setSelection({ kind: 'communication', id: item.id })}>
                  <span>{COMMUNICATION_LABELS[item.kind]} · {item.name}</span><em>{fmtMm(item.offsetMm)} от начала · h {fmtMm(item.heightMm)}</em>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
