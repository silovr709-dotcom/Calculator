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

type PlanToolMeta = {
  id: PlanTool;
  label: string;
  hint: string;
};

const PLAN_TOOLS: PlanToolMeta[] = [
  { id: 'select', label: 'Выбор', hint: 'Выбрать стену на плане' },
  { id: 'wall', label: '+ Стена', hint: 'Нажмите начало и конец стены' },
  { id: 'window', label: '+ Окно', hint: 'Нажмите место на стене' },
  { id: 'door', label: '+ Дверь', hint: 'Нажмите место на стене' },
  { id: 'opening', label: '+ Проём', hint: 'Нажмите место на стене' },
  { id: 'water', label: '+ Вода', hint: 'Нажмите точку на стене' },
  { id: 'electricity', label: '+ Розетка', hint: 'Нажмите точку на стене' },
  { id: 'gas', label: '+ Газ', hint: 'Нажмите точку на стене' },
  { id: 'ventilation', label: '+ Вент.', hint: 'Нажмите точку на стене' },
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

function promptNumber(label: string, fallback: number): number | null {
  const value = window.prompt(label, String(Math.round(fallback)));
  if (value === null) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
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

function openingSegment(opening: MeasurementOpening, walls: MeasurementWall[]) {
  const wall = walls.find((item) => item.id === opening.wallId);
  if (!wall || !hasPlanWallGeometry(wall)) return null;
  const length = wallPlanLengthMm(wall) ?? 1;
  const width = Math.max(120, Math.min(opening.widthMm ?? 700, length));
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

export default function RoomPlanEditor(props: { project: Project; data: MeasurementData; update: (patch: Partial<MeasurementData>) => void }) {
  const { data, update } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<PlanTool>('select');
  const [draftPoint, setDraftPoint] = useState<MeasurementPlanPoint | null>(null);
  const [selectedWallId, setSelectedWallId] = useState<string | null>(data.walls.find(hasPlanWallGeometry)?.id ?? null);
  const bounds = useMemo(() => planBounds(data.walls), [data.walls]);
  const planWalls = useMemo(() => data.walls.filter(hasPlanWallGeometry), [data.walls]);
  const selectedWall = selectedWallId ? data.walls.find((wall) => wall.id === selectedWallId) ?? null : null;
  const selectedWallOpenings = selectedWall ? data.openings.filter((opening) => opening.wallId === selectedWall.id) : [];
  const selectedWallCommunications = selectedWall ? data.communications.filter((item) => item.wallId === selectedWall.id) : [];
  const gridStep = bounds.width > 9000 || bounds.height > 9000 ? 1000 : 500;
  const minorGridStep = gridStep / 2;
  const labelSize = Math.max(120, Math.min(220, Math.min(bounds.width, bounds.height) / 18));
  const hitDistance = Math.max(260, Math.min(bounds.width, bounds.height) / 28);
  const gridLines = useMemo(() => {
    const vertical: number[] = [];
    const horizontal: number[] = [];
    const firstX = Math.ceil(bounds.minX / minorGridStep) * minorGridStep;
    const firstY = Math.ceil(bounds.minY / minorGridStep) * minorGridStep;
    for (let x = firstX; x <= bounds.maxX && vertical.length < 80; x += minorGridStep) vertical.push(x);
    for (let y = firstY; y <= bounds.maxY && horizontal.length < 80; y += minorGridStep) horizontal.push(y);
    return { vertical, horizontal };
  }, [bounds.maxX, bounds.maxY, bounds.minX, bounds.minY, minorGridStep]);

  const screenToPlan = (event: PointerEvent<SVGSVGElement>): MeasurementPlanPoint | null => {
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
    if (selectedWallId === id) setSelectedWallId(null);
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

  const addWall = (start: MeasurementPlanPoint, end: MeasurementPlanPoint) => {
    const defaultLength = Math.max(100, Math.round(Math.hypot(end.xMm - start.xMm, end.yMm - start.yMm) / 10) * 10);
    const exactLength = promptNumber('Точная длина стены, мм:', defaultLength);
    if (!exactLength) return;
    const angle = Math.atan2(end.yMm - start.yMm, end.xMm - start.xMm);
    const x2 = Math.round(start.xMm + Math.cos(angle) * exactLength);
    const y2 = Math.round(start.yMm + Math.sin(angle) * exactLength);
    const wall: MeasurementWall = {
      id: uid('wall'),
      name: `Стена ${data.walls.length + 1}`,
      lengthMm: exactLength,
      x1Mm: start.xMm,
      y1Mm: start.yMm,
      x2Mm: x2,
      y2Mm: y2,
      thicknessMm: 120,
    };
    update({ walls: [...data.walls, wall] });
    setSelectedWallId(wall.id);
  };

  const addOpeningAt = (kind: MeasurementOpening['kind'], projection: NonNullable<ReturnType<typeof nearestPlanWallProjection>>) => {
    const defaultWidth = kind === 'door' ? 900 : kind === 'window' ? 1200 : 1000;
    const widthMm = promptNumber(`${OPENING_LABELS[kind]}: ширина, мм`, defaultWidth);
    if (!widthMm) return;
    const opening: MeasurementOpening = {
      id: uid('opening'),
      kind,
      name: `${OPENING_LABELS[kind]} ${data.openings.length + 1}`,
      wallId: projection.wall.id,
      offsetMm: projection.offsetMm,
      widthMm,
      heightMm: kind === 'door' ? 2100 : kind === 'window' ? 1200 : null,
      sillHeightMm: kind === 'window' ? 900 : undefined,
      swing: kind === 'door' ? 'left-in' : undefined,
    };
    update({ openings: [...data.openings, opening] });
    setSelectedWallId(projection.wall.id);
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
    setSelectedWallId(projection.wall.id);
  };

  const handlePlanPointer = (event: PointerEvent<SVGSVGElement>) => {
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

    const projection = nearestPlanWallProjection(data.walls, point);
    if (!projection || projection.distanceMm > hitDistance) {
      if (tool === 'select') setSelectedWallId(null);
      else window.alert('Нажмите ближе к стене на плане. Если стен ещё нет — сначала нарисуйте стену или создайте прямоугольник.');
      return;
    }

    if (tool === 'select') {
      setSelectedWallId(projection.wall.id);
      return;
    }
    if (tool === 'window' || tool === 'door' || tool === 'opening') {
      addOpeningAt(tool === 'opening' ? 'other' : tool, projection);
      return;
    }
    addCommunicationAt(tool, projection);
  };

  const createRectangle = () => {
    if (data.walls.some(hasPlanWallGeometry) && !window.confirm('Заменить текущую геометрию плана прямоугольным помещением? Список проёмов и коммуникаций останется, но привязки к старым стенам будут очищены.')) return;
    const width = promptNumber('Ширина помещения по верхней стене, мм:', data.walls[0]?.lengthMm ?? 3600);
    if (!width) return;
    const depth = promptNumber('Глубина помещения, мм:', data.walls[1]?.lengthMm ?? 2600);
    if (!depth) return;
    const walls = createRectangularPlanWalls(width, depth);
    update({
      walls,
      openings: data.openings.map((opening) => ({ ...opening, wallId: undefined, offsetMm: null })),
      communications: data.communications.map((item) => ({ ...item, wallId: undefined, offsetMm: null })),
    });
    setSelectedWallId(walls[0]?.id ?? null);
    setDraftPoint(null);
    setTool('select');
  };

  const buildFromWallList = () => {
    if (data.walls.length === 0) {
      const walls = createRectangularPlanWalls(3600, 2600);
      update({ walls });
      setSelectedWallId(walls[0]?.id ?? null);
      return;
    }
    const walls = createPlanWallsFromMeasurements(data.walls);
    update({ walls });
    setSelectedWallId(walls[0]?.id ?? null);
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
    setSelectedWallId(wall.id);
  };

  const clearPlan = () => {
    if (!window.confirm('Очистить геометрию плана? Список стен, окон, дверей и коммуникаций останется.')) return;
    update({
      walls: data.walls.map((wall) => ({ ...wall, x1Mm: null, y1Mm: null, x2Mm: null, y2Mm: null })),
    });
    setSelectedWallId(null);
    setDraftPoint(null);
  };

  const addOpeningToSelectedWall = (kind: MeasurementOpening['kind']) => {
    if (!selectedWall || !hasPlanWallGeometry(selectedWall)) return;
    const length = wallPlanLengthMm(selectedWall) ?? 1000;
    const projection = { wall: selectedWall, point: wallPointAtOffset(selectedWall, length / 2) ?? { xMm: 0, yMm: 0 }, offsetMm: Math.round(length / 2), ratio: 0.5, distanceMm: 0 };
    addOpeningAt(kind, projection);
  };

  const addCommunicationToSelectedWall = (kind: MeasurementCommunication['kind']) => {
    if (!selectedWall || !hasPlanWallGeometry(selectedWall)) return;
    const length = wallPlanLengthMm(selectedWall) ?? 1000;
    const projection = { wall: selectedWall, point: wallPointAtOffset(selectedWall, length / 2) ?? { xMm: 0, yMm: 0 }, offsetMm: Math.round(length / 2), ratio: 0.5, distanceMm: 0 };
    addCommunicationAt(kind, projection);
  };

  const setOpeningPatch = (id: string, patch: Partial<MeasurementOpening>) => update({ openings: data.openings.map((opening) => opening.id === id ? { ...opening, ...patch } : opening) });
  const setCommunicationPatch = (id: string, patch: Partial<MeasurementCommunication>) => update({ communications: data.communications.map((item) => item.id === id ? { ...item, ...patch } : item) });

  return (
    <section className="card measurement-plan-card">
      <div className="section-head measurement-plan-head">
        <div>
          <h3>План помещения сверху</h3>
          <p className="muted small">Рисуйте стены, ставьте окна, двери, проёмы и коммуникации. Все элементы привязаны к тем же данным замера ниже.</p>
        </div>
        <div className="measurement-plan-presets">
          <button className="btn tiny ghost" type="button" onClick={createRectangle}>Прямоугольник</button>
          <button className="btn tiny ghost" type="button" onClick={buildFromWallList}>По списку стен</button>
          <button className="btn tiny ghost" type="button" disabled={planWalls.length < 2} onClick={closeContour}>Замкнуть</button>
          <button className="btn tiny danger" type="button" disabled={planWalls.length === 0} onClick={clearPlan}>Очистить план</button>
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
          <svg
            ref={svgRef}
            className={`measurement-plan-stage tool-${tool}`}
            viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
            role="img"
            aria-label="План помещения сверху"
            onPointerDown={handlePlanPointer}
          >
            <rect className="measurement-plan-bg" x={bounds.minX} y={bounds.minY} width={bounds.width} height={bounds.height} />
            {gridLines.vertical.map((x) => <line key={`vx-${x}`} className={x % gridStep === 0 ? 'plan-grid major' : 'plan-grid'} x1={x} y1={bounds.minY} x2={x} y2={bounds.maxY} />)}
            {gridLines.horizontal.map((y) => <line key={`hy-${y}`} className={y % gridStep === 0 ? 'plan-grid major' : 'plan-grid'} x1={bounds.minX} y1={y} x2={bounds.maxX} y2={y} />)}

            {planWalls.map((wall) => {
              const length = wallPlanLengthMm(wall);
              const normal = wallUnitNormal(wall) ?? { xMm: 0, yMm: -1 };
              const midX = ((wall.x1Mm ?? 0) + (wall.x2Mm ?? 0)) / 2;
              const midY = ((wall.y1Mm ?? 0) + (wall.y2Mm ?? 0)) / 2;
              return (
                <g key={wall.id} className={`measurement-plan-wall ${selectedWallId === wall.id ? 'selected' : ''}`}>
                  <line x1={wall.x1Mm ?? 0} y1={wall.y1Mm ?? 0} x2={wall.x2Mm ?? 0} y2={wall.y2Mm ?? 0} strokeWidth={wall.thicknessMm ?? 120} />
                  <circle cx={wall.x1Mm ?? 0} cy={wall.y1Mm ?? 0} r="70" />
                  <circle cx={wall.x2Mm ?? 0} cy={wall.y2Mm ?? 0} r="70" />
                  <text x={midX + normal.xMm * 230} y={midY + normal.yMm * 230} fontSize={labelSize} transform={`rotate(${wallAngleDeg(wall)} ${midX + normal.xMm * 230} ${midY + normal.yMm * 230})`}>{wall.name} · {fmtMm(length)}</text>
                </g>
              );
            })}

            {data.openings.map((opening) => {
              const segment = openingSegment(opening, data.walls);
              if (!segment) return null;
              const labelX = (segment.p1.xMm + segment.p2.xMm) / 2 + segment.normal.xMm * 360;
              const labelY = (segment.p1.yMm + segment.p2.yMm) / 2 + segment.normal.yMm * 360;
              return (
                <g key={opening.id} className={`measurement-plan-opening ${opening.kind}`}>
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
              return (
                <g key={item.id} className={`measurement-plan-communication ${item.kind}`}>
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
            <b>{PLAN_TOOLS.find((item) => item.id === tool)?.label}</b>
            <span>{tool === 'wall' ? (draftPoint ? 'Нажмите конец стены' : 'Нажмите начало стены') : PLAN_TOOLS.find((item) => item.id === tool)?.hint}</span>
          </div>
          <div className="measurement-plan-stats">
            <span><b>{planWalls.length}</b> стен на плане</span>
            <span><b>{data.openings.length}</b> окон/дверей/проёмов</span>
            <span><b>{data.communications.length}</b> точек коммуникаций</span>
          </div>

          {selectedWall && hasPlanWallGeometry(selectedWall) ? (
            <div className="measurement-plan-selected">
              <h4>Выбрана стена</h4>
              <label>Название<input value={selectedWall.name} onChange={(event) => patchWall(selectedWall.id, { name: event.target.value })} /></label>
              <label>Длина, мм<input type="number" min={100} value={Math.round(wallPlanLengthMm(selectedWall) ?? selectedWall.lengthMm ?? 0)} onChange={(event) => setSelectedWallLength(Number(event.target.value) || 100)} /></label>
              <div className="grid2 compact-grid">
                <label>X1<input type="number" value={selectedWall.x1Mm ?? 0} onChange={(event) => patchWall(selectedWall.id, { x1Mm: Number(event.target.value) })} /></label>
                <label>Y1<input type="number" value={selectedWall.y1Mm ?? 0} onChange={(event) => patchWall(selectedWall.id, { y1Mm: Number(event.target.value) })} /></label>
                <label>X2<input type="number" value={selectedWall.x2Mm ?? 0} onChange={(event) => patchWall(selectedWall.id, { x2Mm: Number(event.target.value) })} /></label>
                <label>Y2<input type="number" value={selectedWall.y2Mm ?? 0} onChange={(event) => patchWall(selectedWall.id, { y2Mm: Number(event.target.value) })} /></label>
              </div>
              <label>Заметка<input value={selectedWall.note ?? ''} onChange={(event) => patchWall(selectedWall.id, { note: event.target.value })} /></label>
              <div className="measurement-plan-quick-add">
                <button className="btn tiny ghost" type="button" onClick={() => addOpeningToSelectedWall('window')}>+ окно</button>
                <button className="btn tiny ghost" type="button" onClick={() => addOpeningToSelectedWall('door')}>+ дверь</button>
                <button className="btn tiny ghost" type="button" onClick={() => addOpeningToSelectedWall('other')}>+ проём</button>
                <button className="btn tiny ghost" type="button" onClick={() => addCommunicationToSelectedWall('electricity')}>+ розетка</button>
                <button className="btn tiny ghost" type="button" onClick={() => addCommunicationToSelectedWall('water')}>+ вода</button>
                <button className="btn tiny danger" type="button" onClick={() => removeWall(selectedWall.id)}>Удалить стену</button>
              </div>

              {(selectedWallOpenings.length > 0 || selectedWallCommunications.length > 0) && (
                <div className="measurement-plan-linked-list">
                  {selectedWallOpenings.map((opening) => (
                    <div key={opening.id}>
                      <b>{OPENING_LABELS[opening.kind]}</b>
                      <input type="number" value={opening.offsetMm ?? ''} placeholder="отступ" onChange={(event) => setOpeningPatch(opening.id, { offsetMm: event.target.value ? Number(event.target.value) : null })} />
                      <input type="number" value={opening.widthMm ?? ''} placeholder="ширина" onChange={(event) => setOpeningPatch(opening.id, { widthMm: event.target.value ? Number(event.target.value) : null })} />
                    </div>
                  ))}
                  {selectedWallCommunications.map((item) => (
                    <div key={item.id}>
                      <b>{COMMUNICATION_LABELS[item.kind]}</b>
                      <input type="number" value={item.offsetMm ?? ''} placeholder="отступ" onChange={(event) => setCommunicationPatch(item.id, { offsetMm: event.target.value ? Number(event.target.value) : null })} />
                      <input type="number" value={item.heightMm ?? ''} placeholder="высота" onChange={(event) => setCommunicationPatch(item.id, { heightMm: event.target.value ? Number(event.target.value) : null })} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="empty small">Выберите стену на плане или нажмите «+ Стена». Для быстрого старта можно создать прямоугольник помещения.</div>
          )}
        </aside>
      </div>
    </section>
  );
}
