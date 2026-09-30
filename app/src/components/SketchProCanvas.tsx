import type { CSSProperties } from 'react';
import type { KitchenModule, KitchenSketchSettings } from '../types';
import {
  baseHeightMm,
  baseSpanMm,
  buildKitchenLayout,
  getSketchStyle,
  placedBottomMm,
  planRect,
  roomBox,
  WALL_LABELS,
} from '../lib/kitchenSketch';
import type { KitchenLayout, KitchenWallRun, SketchPlacedModule, SketchStyle } from '../lib/kitchenSketch';

interface SketchProCanvasProps {
  modules: KitchenModule[];
  settings?: KitchenSketchSettings;
  selectedModuleId?: string | null;
  onSelectModule?: (id: string) => void;
  showDimensions?: boolean;
  variant?: 'editor' | 'client';
  className?: string;
}

type SketchCssVars = CSSProperties & Record<'--sketch-accent' | '--sketch-line' | '--sketch-facade' | '--sketch-facade-dark' | '--sketch-body' | '--sketch-counter' | '--sketch-floor' | '--sketch-backsplash', string>;

const fmtMm = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} мм`;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function sketchVars(style: SketchStyle): SketchCssVars {
  return {
    '--sketch-accent': style.accent,
    '--sketch-line': style.line,
    '--sketch-facade': style.facade,
    '--sketch-facade-dark': style.facadeDark,
    '--sketch-body': style.body,
    '--sketch-counter': style.counter,
    '--sketch-floor': style.floor,
    '--sketch-backsplash': style.backsplash,
  };
}

function shortName(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, Math.max(1, limit - 1))}…` : value;
}

function moduleLabel(placed: SketchPlacedModule): string {
  const number = placed.sourceIndex + 1;
  return placed.module.qty > 1 ? `${number}.${placed.instance + 1}` : `${number}`;
}

function moduleTitle(placed: SketchPlacedModule): string {
  const instance = placed.module.qty > 1 ? `, экземпляр ${placed.instance + 1} из ${placed.module.qty}` : '';
  return `${placed.sourceIndex + 1}. ${placed.module.name}${instance} — ${fmtMm(placed.width)} × ${fmtMm(placed.height)} × ${fmtMm(placed.depth)}`;
}

function dimensionLine(x1: number, x2: number, y: number, label: string, className = '') {
  const safeX1 = Math.min(x1, x2);
  const safeX2 = Math.max(x1, x2);
  const mid = (safeX1 + safeX2) / 2;
  return (
    <g className={`sketch-pro-dim ${className}`.trim()}>
      <line x1={safeX1} y1={y} x2={safeX2} y2={y} />
      <line x1={safeX1} y1={y - 4} x2={safeX1} y2={y + 4} />
      <line x1={safeX2} y1={y - 4} x2={safeX2} y2={y + 4} />
      <text x={mid} y={y - 6} textAnchor="middle">{label}</text>
    </g>
  );
}

function verticalDimensionLine(x: number, y1: number, y2: number, label: string) {
  const safeY1 = Math.min(y1, y2);
  const safeY2 = Math.max(y1, y2);
  const mid = (safeY1 + safeY2) / 2;
  return (
    <g className="sketch-pro-dim sketch-pro-dim-vertical">
      <line x1={x} y1={safeY1} x2={x} y2={safeY2} />
      <line x1={x - 4} y1={safeY1} x2={x + 4} y2={safeY1} />
      <line x1={x - 4} y1={safeY2} x2={x + 4} y2={safeY2} />
      <text x={x - 7} y={mid} textAnchor="middle" transform={`rotate(-90 ${x - 7} ${mid})`}>{label}</text>
    </g>
  );
}

function ModuleFace(props: {
  placed: SketchPlacedModule;
  run: KitchenWallRun;
  xScale: number;
  yScale: number;
  left: number;
  floorY: number;
  selected: boolean;
  interactive: boolean;
  onSelect?: (id: string) => void;
}) {
  const { placed, run, xScale, yScale, left, floorY, selected, interactive, onSelect } = props;
  const bottom = placedBottomMm(placed, run);
  const x = left + placed.x * xScale;
  const y = floorY - (bottom + placed.height) * yScale;
  const width = Math.max(24, placed.width * xScale);
  const height = Math.max(18, placed.height * yScale);
  const facades = clamp(Math.round(placed.module.facades || 0), 0, 6);
  const drawers = clamp(Math.round(placed.module.drawers || 0), 0, 6);
  const shelves = clamp(Math.round(placed.module.shelves || 0), 0, 5);
  const select = () => onSelect?.(placed.sourceId);

  return (
    <g
      className={`sketch-pro-module sketch-pro-module-${placed.tier} ${selected ? 'selected' : ''} ${interactive ? 'interactive' : ''}`}
      onClick={interactive ? select : undefined}
    >
      <title>{moduleTitle(placed)}</title>
      <rect x={x} y={y} width={width} height={height} rx={5} />
      {drawers > 1 && Array.from({ length: drawers - 1 }, (_, index) => {
        const lineY = y + ((index + 1) * height) / drawers;
        return <line className="sketch-pro-module-split" key={`drawer-${index}`} x1={x + 4} y1={lineY} x2={x + width - 4} y2={lineY} />;
      })}
      {drawers === 0 && facades > 1 && Array.from({ length: facades - 1 }, (_, index) => {
        const lineX = x + ((index + 1) * width) / facades;
        return <line className="sketch-pro-module-split" key={`facade-${index}`} x1={lineX} y1={y + 4} x2={lineX} y2={y + height - 4} />;
      })}
      {drawers === 0 && facades === 0 && shelves > 0 && Array.from({ length: shelves }, (_, index) => {
        const lineY = y + ((index + 1) * height) / (shelves + 1);
        return <line className="sketch-pro-module-shelf" key={`shelf-${index}`} x1={x + 5} y1={lineY} x2={x + width - 5} y2={lineY} />;
      })}
      <circle className="sketch-pro-module-marker" cx={x + 13} cy={y + 13} r={9} />
      <text className="sketch-pro-module-number" x={x + 13} y={y + 16} textAnchor="middle">{moduleLabel(placed)}</text>
      {width > 54 && <text className="sketch-pro-module-name" x={x + width / 2} y={y + height / 2 + 4} textAnchor="middle">{shortName(placed.module.name, Math.floor(width / 8))}</text>}
      {width > 42 && <text className="sketch-pro-module-size" x={x + width / 2} y={y + height - 7} textAnchor="middle">{Math.round(placed.width)}</text>}
    </g>
  );
}

function ElevationWall(props: {
  run: KitchenWallRun;
  settings?: KitchenSketchSettings;
  selectedModuleId?: string | null;
  showDimensions: boolean;
  onSelectModule?: (id: string) => void;
}) {
  const { run, settings, selectedModuleId, showDimensions, onSelectModule } = props;
  const style = getSketchStyle(settings?.styleId);
  const wallLength = settings?.wallLengthsMm?.[run.wall] ?? null;
  const drawingWidthMm = Math.max(run.runWidth, wallLength ?? 0, 1200);
  const roomHeight = Math.max(settings?.roomHeightMm ?? 0, run.totalHeight, 2200);
  const canvasWidth = clamp(drawingWidthMm * 0.16 + 84, 680, 1080);
  const canvasHeight = clamp(roomHeight * 0.105 + 74, 285, 360);
  const left = 48;
  const right = 24;
  const top = 28;
  const bottom = 44;
  const floorY = canvasHeight - bottom;
  const xScale = (canvasWidth - left - right) / drawingWidthMm;
  const yScale = (floorY - top) / roomHeight;
  const modules = [...run.floor, ...run.upper];
  const span = baseSpanMm(run);
  const free = wallLength == null ? null : wallLength - run.runWidth;
  const baseTop = floorY - (100 + baseHeightMm(run) + 38) * yScale;

  return (
    <article className="sketch-pro-wall-drawing" style={sketchVars(style)}>
      <div className="sketch-pro-wall-drawing-head">
        <div><b>{WALL_LABELS[run.wall]}</b><span>{modules.length} мод. · занято {fmtMm(run.runWidth)}</span></div>
        <em className={free != null && free < 0 ? 'over' : ''}>{free == null ? 'длина стены не задана' : free >= 0 ? `остаток ${fmtMm(free)}` : `переполнение ${fmtMm(Math.abs(free))}`}</em>
      </div>
      <svg viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} role="img" aria-label={`Эскиз PRO: ${WALL_LABELS[run.wall]}`}>
        <rect className="sketch-pro-wall-bg" x={left} y={top} width={canvasWidth - left - right} height={floorY - top} rx={8} />
        <rect className="sketch-pro-floor" x={left} y={floorY} width={canvasWidth - left - right} height={7} rx={3} />
        <line className="sketch-pro-zero" x1={left} y1={floorY} x2={canvasWidth - right} y2={floorY} />
        {span.end > span.start && <rect className="sketch-pro-counter" x={left + span.start * xScale} y={baseTop - 5} width={Math.max(18, (span.end - span.start) * xScale)} height={8} rx={3} />}
        {modules.map((placed) => (
          <ModuleFace
            key={`${placed.sourceId}-${placed.instance}-${placed.tier}`}
            placed={placed}
            run={run}
            xScale={xScale}
            yScale={yScale}
            left={left}
            floorY={floorY}
            selected={placed.sourceId === selectedModuleId}
            interactive={Boolean(onSelectModule)}
            onSelect={onSelectModule}
          />
        ))}
        {showDimensions && dimensionLine(left, left + run.runWidth * xScale, 18, `ряд ${fmtMm(run.runWidth)}`)}
        {showDimensions && wallLength != null && dimensionLine(left, left + wallLength * xScale, canvasHeight - 13, `стена ${fmtMm(wallLength)}`, free != null && free < 0 ? 'over' : '')}
        {showDimensions && verticalDimensionLine(22, floorY - roomHeight * yScale, floorY, `высота ${fmtMm(roomHeight)}`)}
      </svg>
    </article>
  );
}

function PlanView(props: {
  layout: KitchenLayout;
  settings?: KitchenSketchSettings;
  selectedModuleId?: string | null;
  showDimensions: boolean;
  onSelectModule?: (id: string) => void;
}) {
  const { layout, settings, selectedModuleId, showDimensions, onSelectModule } = props;
  const room = roomBox(layout);
  const style = getSketchStyle(settings?.styleId);
  const canvasWidth = 920;
  const canvasHeight = 430;
  const scale = Math.min((canvasWidth - 88) / room.width, (canvasHeight - 82) / room.depth);
  const originX = (canvasWidth - room.width * scale) / 2;
  const originY = 38;
  const placedModules = [...layout.floor, ...layout.upper];

  return (
    <article className="sketch-pro-plan" style={sketchVars(style)}>
      <div className="sketch-pro-wall-drawing-head"><div><b>План сверху</b><span>раскладка по стенам и глубинам</span></div><em>{fmtMm(room.width)} × {fmtMm(room.depth)}</em></div>
      <svg viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} role="img" aria-label="Эскиз PRO: план сверху">
        <rect className="sketch-pro-plan-room" x={originX} y={originY} width={room.width * scale} height={room.depth * scale} rx={10} />
        <line className="sketch-pro-plan-wall" x1={originX} y1={originY} x2={originX + room.width * scale} y2={originY} />
        <line className="sketch-pro-plan-wall" x1={originX} y1={originY} x2={originX} y2={originY + room.depth * scale} />
        <line className="sketch-pro-plan-wall" x1={originX + room.width * scale} y1={originY} x2={originX + room.width * scale} y2={originY + room.depth * scale} />
        {placedModules.map((placed) => {
          const rect = planRect(placed, layout);
          const x = originX + rect.x0 * scale;
          const y = originY + rect.y0 * scale;
          const width = Math.max(14, (rect.x1 - rect.x0) * scale);
          const height = Math.max(14, (rect.y1 - rect.y0) * scale);
          const select = () => onSelectModule?.(placed.sourceId);
          return (
            <g
              className={`sketch-pro-plan-module sketch-pro-plan-module-${placed.tier} ${placed.sourceId === selectedModuleId ? 'selected' : ''} ${onSelectModule ? 'interactive' : ''}`}
              key={`${placed.sourceId}-${placed.instance}-${placed.tier}`}
              onClick={onSelectModule ? select : undefined}
            >
              <title>{moduleTitle(placed)}</title>
              <rect x={x} y={y} width={width} height={height} rx={5} />
              <text x={x + width / 2} y={y + height / 2 + 4} textAnchor="middle">{moduleLabel(placed)}</text>
            </g>
          );
        })}
        <text className="sketch-pro-plan-wall-label" x={originX + (room.width * scale) / 2} y={originY - 12} textAnchor="middle">Задняя стена</text>
        <text className="sketch-pro-plan-wall-label" x={originX - 12} y={originY + (room.depth * scale) / 2} textAnchor="middle" transform={`rotate(-90 ${originX - 12} ${originY + (room.depth * scale) / 2})`}>Левая</text>
        <text className="sketch-pro-plan-wall-label" x={originX + room.width * scale + 12} y={originY + (room.depth * scale) / 2} textAnchor="middle" transform={`rotate(90 ${originX + room.width * scale + 12} ${originY + (room.depth * scale) / 2})`}>Правая</text>
        {showDimensions && dimensionLine(originX, originX + room.width * scale, canvasHeight - 20, fmtMm(room.width))}
        {showDimensions && verticalDimensionLine(28, originY, originY + room.depth * scale, fmtMm(room.depth))}
      </svg>
    </article>
  );
}

interface IsoPoint { x: number; y: number }
const polygonPoints = (items: IsoPoint[]) => items.map((item) => `${item.x.toFixed(1)},${item.y.toFixed(1)}`).join(' ');

function ThreeDView(props: {
  layout: KitchenLayout;
  settings?: KitchenSketchSettings;
  selectedModuleId?: string | null;
  showDimensions: boolean;
  onSelectModule?: (id: string) => void;
}) {
  const { layout, settings, selectedModuleId, showDimensions, onSelectModule } = props;
  const room = roomBox(layout);
  const style = getSketchStyle(settings?.styleId);
  const roomHeight = Math.max(settings?.roomHeightMm ?? 0, layout.totalHeight, 2200);
  const canvasWidth = 980;
  const canvasHeight = 520;
  const footprintWidth = room.width + room.depth * 0.58;
  const footprintHeight = room.width * 0.18 + room.depth * 0.32;
  const scale = Math.min((canvasWidth - 170) / footprintWidth, (canvasHeight - 120) / (footprintHeight + roomHeight * 0.45));
  const zScale = scale * 0.45;
  const originX = 70 + room.depth * 0.58 * scale;
  const originY = 54 + roomHeight * zScale;
  const runByWall = new Map(layout.walls.map((run) => [run.wall, run]));
  const project = (x: number, y: number, z: number): IsoPoint => ({
    x: originX + (x - y * 0.58) * scale,
    y: originY + (x * 0.18 + y * 0.32) * scale - z * zScale,
  });
  const roomFloor = [project(0, 0, 0), project(room.width, 0, 0), project(room.width, room.depth, 0), project(0, room.depth, 0)];
  const backWall = [project(0, 0, 0), project(room.width, 0, 0), project(room.width, 0, roomHeight), project(0, 0, roomHeight)];
  const leftWall = [project(0, 0, 0), project(0, room.depth, 0), project(0, room.depth, roomHeight), project(0, 0, roomHeight)];
  const rightWall = [project(room.width, 0, 0), project(room.width, room.depth, 0), project(room.width, room.depth, roomHeight), project(room.width, 0, roomHeight)];
  const placedModules = [...layout.floor, ...layout.upper]
    .map((placed) => ({ placed, rect: planRect(placed, layout) }))
    .sort((a, b) => (a.rect.y1 + a.rect.x1 * 0.2) - (b.rect.y1 + b.rect.x1 * 0.2));

  return (
    <article className="sketch-pro-3d" style={sketchVars(style)}>
      <div className="sketch-pro-wall-drawing-head"><div><b>3D · Объём</b><span>быстрая проверка массы, глубин и углов</span></div><em>{fmtMm(room.width)} × {fmtMm(room.depth)} · высота {fmtMm(roomHeight)}</em></div>
      <svg viewBox={`0 0 ${canvasWidth} ${canvasHeight}`} role="img" aria-label="Эскиз PRO: 3D объём кухни">
        <polygon className="sketch-pro-3d-wall sketch-pro-3d-wall-back" points={polygonPoints(backWall)} />
        <polygon className="sketch-pro-3d-wall sketch-pro-3d-wall-left" points={polygonPoints(leftWall)} />
        <polygon className="sketch-pro-3d-wall sketch-pro-3d-wall-right" points={polygonPoints(rightWall)} />
        <polygon className="sketch-pro-3d-floor" points={polygonPoints(roomFloor)} />
        {placedModules.map(({ placed, rect }) => {
          const run = runByWall.get(placed.wall);
          const z0 = placed.tier === 'upper' && run ? placedBottomMm(placed, run) : 0;
          const z1 = z0 + (placed.tier === 'base' ? placed.height + 100 : placed.height);
          const p100 = project(rect.x1, rect.y0, z0);
          const p010 = project(rect.x0, rect.y1, z0);
          const p110 = project(rect.x1, rect.y1, z0);
          const p001 = project(rect.x0, rect.y0, z1);
          const p101 = project(rect.x1, rect.y0, z1);
          const p011 = project(rect.x0, rect.y1, z1);
          const p111 = project(rect.x1, rect.y1, z1);
          const label = project((rect.x0 + rect.x1) / 2, rect.y1, z1 + 65);
          const selected = placed.sourceId === selectedModuleId;
          const select = () => onSelectModule?.(placed.sourceId);
          return (
            <g
              className={`sketch-pro-3d-box sketch-pro-3d-box-${placed.tier} ${selected ? 'selected' : ''} ${onSelectModule ? 'interactive' : ''}`}
              key={`${placed.sourceId}-${placed.instance}-${placed.tier}`}
              onClick={onSelectModule ? select : undefined}
            >
              <title>{moduleTitle(placed)}</title>
              <polygon className="sketch-pro-3d-face sketch-pro-3d-face-side" points={polygonPoints([p100, p110, p111, p101])} />
              <polygon className="sketch-pro-3d-face sketch-pro-3d-face-front" points={polygonPoints([p010, p110, p111, p011])} />
              <polygon className="sketch-pro-3d-face sketch-pro-3d-face-top" points={polygonPoints([p001, p101, p111, p011])} />
              <text className="sketch-pro-3d-label" x={label.x} y={label.y} textAnchor="middle">{moduleLabel(placed)}</text>
            </g>
          );
        })}
        {showDimensions && <text className="sketch-pro-3d-dim" x={project(room.width / 2, room.depth + 90, 0).x} y={project(room.width / 2, room.depth + 90, 0).y} textAnchor="middle">глубина помещения {fmtMm(room.depth)}</text>}
        {showDimensions && <text className="sketch-pro-3d-dim" x={project(room.width / 2, -110, 0).x} y={project(room.width / 2, -110, 0).y} textAnchor="middle">ширина {fmtMm(room.width)}</text>}
      </svg>
    </article>
  );
}

export default function SketchProCanvas(props: SketchProCanvasProps) {
  const { modules, settings, selectedModuleId, onSelectModule, className } = props;
  const layout = buildKitchenLayout(modules, settings?.shape);
  const showDimensions = props.showDimensions ?? true;
  const view = settings?.view === 'plan' || settings?.view === '3d' ? settings.view : 'elevation';
  const classes = ['sketch-pro-canvas', `sketch-pro-canvas-${props.variant ?? 'editor'}`, className].filter(Boolean).join(' ');

  if (layout.walls.length === 0) {
    return <div className={`${classes} sketch-pro-canvas-empty`}><b>Эскиз PRO пока пуст</b><span>Добавьте первый модуль — он сразу появится здесь, в расчёте и КП.</span></div>;
  }

  if (view === 'plan') {
    return (
      <div className={classes}>
        <PlanView layout={layout} settings={settings} selectedModuleId={selectedModuleId} showDimensions={showDimensions} onSelectModule={onSelectModule} />
      </div>
    );
  }

  if (view === '3d') {
    return (
      <div className={classes}>
        <ThreeDView layout={layout} settings={settings} selectedModuleId={selectedModuleId} showDimensions={showDimensions} onSelectModule={onSelectModule} />
      </div>
    );
  }

  return (
    <div className={classes}>
      {layout.walls.map((run) => (
        <ElevationWall key={run.wall} run={run} settings={settings} selectedModuleId={selectedModuleId} showDimensions={showDimensions} onSelectModule={onSelectModule} />
      ))}
    </div>
  );
}
