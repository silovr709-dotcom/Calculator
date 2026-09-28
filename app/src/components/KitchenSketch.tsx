import { useMemo, useRef, useState } from 'react';
import type {
  KitchenLayoutShape, KitchenModule, KitchenSketchSettings, KitchenSketchStyleId, KitchenSketchView,
} from '../types';
import { downloadFile } from '../lib/storage';
import {
  BACKSPLASH_MM, COUNTER_MM, LAYOUT_SHAPES, PLINTH_MM, SKETCH_STYLES, SKETCH_VIEWS, WALL_LABELS,
  baseHeightMm, baseSpanMm, buildKitchenLayout, getSketchStyle, hasHob, isOpenModule, isOvenModule, isSinkModule,
  normalizeLayoutShape, placedBottomMm, planRect, roomBox, upperBottomMm,
  type KitchenLayout, type KitchenWallRun, type SketchPlacedModule, type SketchStyle,
} from '../lib/kitchenSketch';

type SketchMode = 'full' | 'compact' | 'client';

interface KitchenSketchProps {
  modules: KitchenModule[];
  settings?: KitchenSketchSettings;
  /** Сохраняет только оформление/видимость КП, а не меняет расчёт модулей. */
  onSettingsChange?: (settings: KitchenSketchSettings) => void;
  /** Открывает исходный модуль в «Позициях кухни». */
  onSelectModule?: (moduleId: string) => void;
  /** Переставляет модуль в исходном списке; недоступно в клиентском КП. */
  onReorder?: (moduleId: string, direction: -1 | 1) => void;
  mode?: SketchMode;
  className?: string;
}

const SELECTED_STROKE = '#f1a208';

function escName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'эскиз-кухни';
}

function moduleTitle(placed: SketchPlacedModule): string {
  const { module } = placed;
  const ordinal = module.qty > 1 ? ` · экземпляр ${placed.instance + 1}` : '';
  return `${module.name || module.type}${ordinal} · ${placed.width}×${placed.height}×${placed.depth} мм · ${WALL_LABELS[placed.wall].toLocaleLowerCase('ru')}`;
}

function CabinetDetails(props: {
  placed: SketchPlacedModule;
  x: number;
  y: number;
  w: number;
  h: number;
  style: SketchStyle;
  compact?: boolean;
}) {
  const { placed, x, y, w, h, style } = props;
  const { module } = placed;
  const stroke = style.line;
  const inset = Math.max(3, Math.min(8, w * 0.025));
  const isOpen = isOpenModule(module);
  const isOven = isOvenModule(module);
  const panels = Math.max(1, Math.min(module.facades || 1, 4));

  if (isOven) {
    const glassY = y + h * 0.31;
    return (
      <>
        <rect x={x + inset} y={y + inset} width={w - inset * 2} height={h - inset * 2} rx={2} fill={style.facadeDark} stroke={stroke} strokeWidth={1.2} />
        <rect x={x + w * 0.14} y={glassY} width={w * 0.72} height={h * 0.48} rx={2} fill="#1b2c34" stroke="#c4d1d4" strokeWidth={1.2} />
        <rect x={x + w * 0.2} y={glassY + 5} width={w * 0.6} height={h * 0.08} rx={1} fill="#9cb4bb" opacity={0.55} />
        <circle cx={x + w * 0.25} cy={y + h * 0.16} r={Math.max(2, w * 0.027)} fill="#d7dfdc" />
        <circle cx={x + w * 0.75} cy={y + h * 0.16} r={Math.max(2, w * 0.027)} fill="#d7dfdc" />
        <line x1={x + w * 0.28} y1={y + h * 0.255} x2={x + w * 0.72} y2={y + h * 0.255} stroke="#d7dfdc" strokeWidth={2} />
      </>
    );
  }

  if (module.drawers > 0) {
    const count = Math.min(module.drawers, 4);
    const drawerH = (h - inset * 2) / count;
    return (
      <>
        {Array.from({ length: count }, (_, index) => {
          const dy = y + inset + index * drawerH;
          return (
            <g key={index}>
              <rect x={x + inset} y={dy} width={w - inset * 2} height={drawerH} fill={style.facade} stroke={stroke} strokeWidth={1} />
              <line x1={x + w * 0.27} y1={dy + drawerH * 0.54} x2={x + w * 0.73} y2={dy + drawerH * 0.54} stroke={style.handle} strokeWidth={Math.max(1.5, drawerH * 0.055)} strokeLinecap="round" />
            </g>
          );
        })}
      </>
    );
  }

  if (isOpen) {
    const shelves = Math.max(1, Math.min(module.shelves || 2, 4));
    return (
      <>
        <rect x={x + inset} y={y + inset} width={w - inset * 2} height={h - inset * 2} fill={style.body} stroke={stroke} strokeWidth={1.2} />
        {Array.from({ length: shelves }, (_, index) => {
          const sy = y + ((index + 1) * h) / (shelves + 1);
          return <line key={index} x1={x + inset} x2={x + w - inset} y1={sy} y2={sy} stroke={style.counterEdge} strokeWidth={Math.max(2, h * 0.02)} />;
        })}
      </>
    );
  }

  return (
    <>
      {Array.from({ length: panels }, (_, index) => {
        const panelW = (w - inset * 2) / panels;
        const px = x + inset + index * panelW;
        const handleX = panels === 1 ? x + w * 0.88 : (index === 0 ? px + panelW * 0.86 : px + panelW * 0.14);
        return (
          <g key={index}>
            <rect x={px} y={y + inset} width={panelW} height={h - inset * 2} fill={style.facade} stroke={stroke} strokeWidth={1} />
            {!props.compact && <line x1={px + 3} y1={y + h - 5} x2={px + panelW - 3} y2={y + 5} stroke={style.line} strokeWidth={0.8} strokeDasharray="4 3" opacity={0.65} />}
            {(module.handles > 0 || module.facades > 0) && <line x1={handleX} y1={y + h * 0.46} x2={handleX} y2={y + h * 0.57} stroke={style.handle} strokeWidth={Math.max(1.6, w * 0.018)} strokeLinecap="round" />}
          </g>
        );
      })}
      {module.lifts > 0 && (
        <g stroke={style.accent} fill="none" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
          <path d={`M ${x + w * 0.38} ${y + h * 0.45} L ${x + w * 0.38} ${y + h * 0.2} M ${x + w * 0.3} ${y + h * 0.29} L ${x + w * 0.38} ${y + h * 0.2} L ${x + w * 0.46} ${y + h * 0.29}`} />
          <path d={`M ${x + w * 0.62} ${y + h * 0.45} L ${x + w * 0.62} ${y + h * 0.2} M ${x + w * 0.54} ${y + h * 0.29} L ${x + w * 0.62} ${y + h * 0.2} L ${x + w * 0.70} ${y + h * 0.29}`} />
        </g>
      )}
    </>
  );
}

// ---------- Фасадные развёртки стен ----------

interface WallScene {
  run: KitchenWallRun;
  top: number;
  floorY: number;
  counterY: number;
  upperBottomY: number;
  blockHeight: number;
}

function WallDimensions(props: { scene: WallScene; scale: number; originX: number; color: string }) {
  const { scene, scale, originX, color } = props;
  const { run } = props.scene;
  const totalX = originX + run.runWidth * scale;
  const yTop = scene.top + 26;
  const yUpper = scene.top + 50;
  const yBottom = scene.floorY + 42;
  const chain = (items: SketchPlacedModule[], y: number, label: string) => {
    if (!items.length) return null;
    return (
      <g>
        <text x={originX - 9} y={y + 4} textAnchor="end" fontSize="9">{label}</text>
        {items.map((placed) => {
          const x = originX + placed.x * scale;
          const end = x + placed.width * scale;
          return (
            <g key={`${label}-${placed.sourceId}-${placed.instance}`}>
              <line x1={x} y1={y} x2={end} y2={y} strokeWidth={0.75} />
              <line x1={x} y1={y - 5} x2={x} y2={y + 5} strokeWidth={0.75} />
              <line x1={end} y1={y - 5} x2={end} y2={y + 5} strokeWidth={0.75} />
              <text x={(x + end) / 2} y={y - 7} textAnchor="middle" fontSize="11">{Math.round(placed.width)}</text>
            </g>
          );
        })}
      </g>
    );
  };
  return (
    <g fill={color} stroke={color} fontFamily="Segoe UI, Arial, sans-serif">
      <line x1={originX} y1={yTop} x2={totalX} y2={yTop} strokeWidth={0.85} />
      <line x1={originX} y1={yTop - 5} x2={originX} y2={yTop + 5} strokeWidth={0.85} />
      <line x1={totalX} y1={yTop - 5} x2={totalX} y2={yTop + 5} strokeWidth={0.85} />
      <text x={(originX + totalX) / 2} y={yTop - 8} textAnchor="middle" fontSize="13" fontWeight="700">
        {run.label} · длина {Math.round(run.runWidth)} мм
      </text>
      {chain(run.upper, yUpper, 'верх')}
      {chain(run.floor, yBottom, 'низ')}
      <line x1={totalX + 24} y1={scene.floorY} x2={totalX + 24} y2={scene.floorY - run.totalHeight * scale} strokeWidth={0.85} />
      <line x1={totalX + 19} y1={scene.floorY} x2={totalX + 29} y2={scene.floorY} strokeWidth={0.85} />
      <line x1={totalX + 19} y1={scene.floorY - run.totalHeight * scale} x2={totalX + 29} y2={scene.floorY - run.totalHeight * scale} strokeWidth={0.85} />
      <text x={totalX + 40} y={scene.floorY - (run.totalHeight * scale) / 2} fontSize="11" textAnchor="middle"
        transform={`rotate(-90 ${totalX + 40} ${scene.floorY - (run.totalHeight * scale) / 2})`}>
        Высота {Math.round(run.totalHeight)} мм
      </text>
      <text x={totalX + 52} y={scene.counterY + 3} fontSize="10">столешница {PLINTH_MM + baseHeightMm(run) + COUNTER_MM}</text>
      {run.upper.length > 0 && <text x={totalX + 52} y={scene.upperBottomY + 3} fontSize="10">фартук {BACKSPLASH_MM}</text>}
    </g>
  );
}

function ElevationView(props: {
  layout: KitchenLayout; style: SketchStyle; selectedId: string | null; onSelect: (id: string) => void; compact?: boolean;
}) {
  const { layout, style, compact } = props;
  const runs = layout.walls;
  const maxRun = Math.max(1, ...runs.map((run) => run.runWidth));
  const scale = Math.min(compact ? 0.28 : 0.36, Math.max(0.08, (compact ? 700 : 900) / maxRun));
  const originX = compact ? 54 : 78;
  const topPad = compact ? 34 : 74;
  const bottomPad = compact ? 34 : 74;
  const scenes: WallScene[] = runs.reduce<WallScene[]>((acc, run) => {
    const previous = acc[acc.length - 1];
    const top = previous ? previous.top + previous.blockHeight : (compact ? 6 : 12);
    const floorY = top + topPad + run.totalHeight * scale;
    acc.push({
      run,
      top,
      floorY,
      counterY: floorY - (PLINTH_MM + baseHeightMm(run) + COUNTER_MM) * scale,
      upperBottomY: floorY - upperBottomMm(run) * scale,
      blockHeight: topPad + run.totalHeight * scale + bottomPad,
    });
    return acc;
  }, []);
  const width = Math.max(compact ? 760 : 1020, maxRun * scale + originX + (compact ? 90 : 170));
  const contentBottom = scenes.length ? scenes[scenes.length - 1].top + scenes[scenes.length - 1].blockHeight : 0;
  const height = Math.max(compact ? 300 : 460, contentBottom + 26);
  const x = (mm: number) => originX + mm * scale;

  const cabinetY = (placed: SketchPlacedModule, scene: WallScene) => {
    if (placed.tier === 'upper') return scene.upperBottomY - placed.height * scale;
    if (placed.tier === 'tall') return scene.floorY - placed.height * scale;
    return scene.floorY - (PLINTH_MM + placed.height) * scale;
  };

  const cabinet = (placed: SketchPlacedModule, y: number) => {
    const px = x(placed.x);
    const w = placed.width * scale;
    const h = placed.height * scale;
    const selected = props.selectedId === placed.sourceId;
    return (
      <g key={`${placed.wall}-${placed.sourceId}-${placed.instance}-${placed.tier}`} onClick={() => props.onSelect(placed.sourceId)}
        role="button" tabIndex={0} aria-label={`Выбрать ${moduleTitle(placed)}`} style={{ cursor: 'pointer' }}>
        <title>{moduleTitle(placed)}</title>
        <rect x={px - 2} y={y - 2} width={w + 4} height={h + 4} rx={3} fill={selected ? '#fff3c8' : 'transparent'} stroke={selected ? SELECTED_STROKE : 'transparent'} strokeWidth={selected ? 3 : 0} />
        <CabinetDetails placed={placed} x={px} y={y} w={w} h={h} style={style} compact={compact} />
        {!compact && w > 78 && (
          <text x={px + w / 2} y={y + h - 8} textAnchor="middle" fontSize="10" fill={style.line} pointerEvents="none">
            {placed.module.name.slice(0, Math.max(10, Math.floor(w / 6)))}
          </text>
        )}
      </g>
    );
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Фасадные развёртки стен кухни" fontFamily="Segoe UI, Arial, sans-serif">
      <rect width={width} height={height} fill="#fff" />
      {scenes.map((scene) => {
        const { run } = scene;
        const span = baseSpanMm(run);
        const counterWidth = span.end - span.start;
        const lowerHeight = baseHeightMm(run);
        return (
          <g key={run.wall}>
            {run.upper.length > 0 && (
              <rect x={x(Math.min(span.start, 0))} y={scene.upperBottomY} width={Math.max(run.upperWidth, span.end) * scale}
                height={Math.max(0, scene.counterY - scene.upperBottomY)} fill={style.backsplash} opacity="0.75" />
            )}
            {!compact && <WallDimensions scene={scene} scale={scale} originX={originX} color={style.line} />}
            {compact && <text x={originX} y={scene.top + 18} fontSize="12" fontWeight="700" fill={style.line}>{run.label} · {Math.round(run.runWidth)} мм</text>}
            <line x1={originX - 12} x2={originX + run.runWidth * scale + 12} y1={scene.floorY} y2={scene.floorY} stroke={style.line} strokeWidth={1.5} />
            {run.floor.filter((item) => item.tier === 'base').map((placed) => (
              <rect key={`plinth-${placed.sourceId}-${placed.instance}`} x={x(placed.x)} y={scene.floorY - PLINTH_MM * scale}
                width={placed.width * scale} height={PLINTH_MM * scale} fill={style.facadeDark} stroke={style.line} strokeWidth={1} />
            ))}
            {counterWidth > 0 && (
              <g>
                <rect x={x(span.start)} y={scene.floorY - (PLINTH_MM + lowerHeight + COUNTER_MM) * scale} width={counterWidth * scale}
                  height={COUNTER_MM * scale} fill={style.counter} stroke={style.counterEdge} strokeWidth={1.2} />
                <rect x={x(span.start)} y={scene.floorY - (PLINTH_MM + lowerHeight) * scale} width={counterWidth * scale} height={4} fill={style.counterEdge} opacity={0.85} />
              </g>
            )}
            {run.floor.map((placed) => cabinet(placed, cabinetY(placed, scene)))}
            {run.upper.map((placed) => cabinet(placed, cabinetY(placed, scene)))}
            {run.floor.filter((placed) => placed.tier === 'base' && isSinkModule(placed.module)).map((placed) => {
              const px = x(placed.x); const w = placed.width * scale; const cy = scene.counterY + 4;
              return (
                <g key={`sink-${placed.sourceId}-${placed.instance}`} pointerEvents="none">
                  <ellipse cx={px + w * 0.5} cy={cy + 4} rx={Math.min(28, w * 0.23)} ry={6} fill="#9ab6bc" stroke={style.line} strokeWidth={1} />
                  <path d={`M ${px + w * 0.64} ${cy + 3} v-17 q0-10 9-10 q9 0 9 10 v6`} fill="none" stroke={style.handle} strokeWidth={2.5} strokeLinecap="round" />
                </g>
              );
            })}
            {run.floor.filter((placed) => placed.tier === 'base' && hasHob(placed.module)).map((placed) => {
              const px = x(placed.x); const w = placed.width * scale;
              return (
                <g key={`hob-${placed.sourceId}-${placed.instance}`} pointerEvents="none">
                  <rect x={px + w * 0.25} y={scene.counterY + 3} width={w * 0.5} height={8} rx={1} fill="#24272c" />
                  <circle cx={px + w * 0.37} cy={scene.counterY + 7} r={Math.max(1.5, w * 0.055)} fill="none" stroke="#c5d0cf" />
                  <circle cx={px + w * 0.63} cy={scene.counterY + 7} r={Math.max(1.5, w * 0.055)} fill="none" stroke="#c5d0cf" />
                </g>
              );
            })}
          </g>
        );
      })}
      <text x={originX} y={height - 10} fill={style.line} fontSize="11">
        Фасадные развёртки · цоколь {PLINTH_MM} · столешница {COUNTER_MM} · фартук {BACKSPLASH_MM} мм
      </text>
    </svg>
  );
}

// ---------- План сверху ----------

function PlanView(props: {
  layout: KitchenLayout; style: SketchStyle; selectedId: string | null; onSelect: (id: string) => void; compact?: boolean;
}) {
  const { layout, style, compact } = props;
  const room = roomBox(layout);
  const width = compact ? 780 : 1020;
  const pad = compact ? 52 : 92;
  const scale = Math.max(0.03, Math.min(0.22, (width - pad * 2) / room.width, ((compact ? 420 : 560) - pad * 2) / room.depth));
  const height = Math.max(compact ? 280 : 420, room.depth * scale + pad * 2 + 24);
  const ox = (width - room.width * scale) / 2;
  const oy = pad;
  const px = (mm: number) => ox + mm * scale;
  const py = (mm: number) => oy + mm * scale;
  const wallSet = new Set(layout.walls.map((run) => run.wall));

  const cabinet = (placed: SketchPlacedModule, upper: boolean) => {
    const rect = planRect(placed, layout);
    const x = px(rect.x0); const y = py(rect.y0);
    const w = (rect.x1 - rect.x0) * scale; const h = (rect.y1 - rect.y0) * scale;
    const selected = props.selectedId === placed.sourceId;
    // Фасад смотрит внутрь помещения: у задней стены — вниз, у левой — вправо, у правой — влево.
    const facade = placed.wall === 'back'
      ? { x1: x, y1: y + h, x2: x + w, y2: y + h }
      : placed.wall === 'left'
        ? { x1: x + w, y1: y, x2: x + w, y2: y + h }
        : { x1: x, y1: y, x2: x, y2: y + h };
    return (
      <g key={`plan-${upper ? 'u' : 'f'}-${placed.sourceId}-${placed.instance}`} onClick={() => props.onSelect(placed.sourceId)}
        role="button" tabIndex={0} aria-label={`Выбрать ${moduleTitle(placed)}`} style={{ cursor: 'pointer' }}>
        <title>{moduleTitle(placed)}</title>
        <rect x={x} y={y} width={w} height={h} fill={upper ? 'none' : (selected ? '#fff3c8' : style.body)}
          stroke={selected ? SELECTED_STROKE : style.line} strokeWidth={selected ? 2.4 : 1}
          strokeDasharray={upper ? '6 4' : undefined} opacity={upper ? 0.9 : 1} />
        {!upper && <line x1={facade.x1} y1={facade.y1} x2={facade.x2} y2={facade.y2} stroke={style.counterEdge} strokeWidth={3} />}
        {!upper && isSinkModule(placed.module) && <ellipse cx={x + w / 2} cy={y + h / 2} rx={Math.min(w, h) * 0.3} ry={Math.min(w, h) * 0.22} fill="#9ab6bc" stroke={style.line} strokeWidth={0.8} />}
        {!upper && hasHob(placed.module) && (
          <g stroke="#24272c" fill="none" strokeWidth={0.9}>
            <circle cx={x + w * 0.35} cy={y + h * 0.35} r={Math.min(w, h) * 0.12} />
            <circle cx={x + w * 0.65} cy={y + h * 0.35} r={Math.min(w, h) * 0.12} />
            <circle cx={x + w * 0.35} cy={y + h * 0.68} r={Math.min(w, h) * 0.12} />
            <circle cx={x + w * 0.65} cy={y + h * 0.68} r={Math.min(w, h) * 0.12} />
          </g>
        )}
        {!compact && Math.min(w, h) > 16 && Math.max(w, h) > 40 && (() => {
          const cx = x + w / 2;
          const cy = y + h / 2 + (upper ? -9 : 11);
          return (
            <text x={cx} y={cy} textAnchor="middle" fontSize="10" fill={upper ? style.accent : style.line} pointerEvents="none"
              transform={placed.wall === 'back' ? undefined : `rotate(-90 ${cx} ${cy})`}>
              {upper ? `⌐ ${Math.round(placed.width)}` : Math.round(placed.width)}
            </text>
          );
        })()}
      </g>
    );
  };

  const wallThickness = Math.max(5, 100 * scale);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="План кухни сверху" fontFamily="Segoe UI, Arial, sans-serif">
      <rect width={width} height={height} fill="#fff" />
      <rect x={px(0)} y={py(0)} width={room.width * scale} height={room.depth * scale} fill={style.floor} opacity={0.22} stroke={style.line} strokeWidth={0.6} strokeDasharray="5 5" />
      <rect x={px(0) - wallThickness} y={py(0) - wallThickness} width={room.width * scale + wallThickness * 2} height={wallThickness} fill={style.line} opacity={0.75} />
      {wallSet.has('left') && <rect x={px(0) - wallThickness} y={py(0) - wallThickness} width={wallThickness} height={room.depth * scale + wallThickness} fill={style.line} opacity={0.75} />}
      {wallSet.has('right') && <rect x={px(room.width)} y={py(0) - wallThickness} width={wallThickness} height={room.depth * scale + wallThickness} fill={style.line} opacity={0.75} />}
      {layout.walls.flatMap((run) => run.floor).map((placed) => cabinet(placed, false))}
      {layout.walls.flatMap((run) => run.upper).map((placed) => cabinet(placed, true))}
      {!compact && (
        <g fill={style.line} stroke={style.line} fontSize="11">
          <line x1={px(0)} y1={oy - wallThickness - 22} x2={px(room.width)} y2={oy - wallThickness - 22} strokeWidth={0.8} />
          <text x={px(room.width / 2)} y={oy - wallThickness - 27} textAnchor="middle" fontSize="12" fontWeight="700" stroke="none">
            Задняя стена {Math.round(room.width)} мм
          </text>
          <line x1={px(0) - wallThickness - 20} y1={py(0)} x2={px(0) - wallThickness - 20} y2={py(room.depth)} strokeWidth={0.8} />
          <text x={px(0) - wallThickness - 26} y={py(room.depth / 2)} textAnchor="middle" stroke="none"
            transform={`rotate(-90 ${px(0) - wallThickness - 26} ${py(room.depth / 2)})`}>
            Глубина помещения {Math.round(room.depth)} мм
          </text>
        </g>
      )}
      <text x={12} y={height - 10} fill={style.line} fontSize="11">
        План сверху · сплошные — нижние модули, пунктир — верхние; жирная грань — фасад
      </text>
    </svg>
  );
}

// ---------- Объёмный 3D-вид ----------

interface Box3 { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

function Sketch3D(props: {
  layout: KitchenLayout; style: SketchStyle; selectedId: string | null; onSelect: (id: string) => void; compact?: boolean;
}) {
  const { layout, style, compact } = props;
  const room = roomBox(layout);
  const width = compact ? 780 : 1040;
  const height = compact ? 400 : 660;
  const margin = compact ? 20 : 34;
  const ceiling = layout.totalHeight + 400;
  const eyeX = room.width / 2;
  const eyeZ = Math.min(1750, Math.max(1400, layout.totalHeight * 0.72));
  const camDist = Math.max(room.width, room.depth) * 0.9 + 1900;
  // Ортогональные к картинке координаты камеры: u/v умножаются на общий масштаб f.
  const u = (x: number, y: number) => (x - eyeX) / (camDist + room.depth - y);
  const v = (y: number, z: number) => -(z - eyeZ) / (camDist + room.depth - y);
  const corners: [number, number][] = [];
  for (const x of [0, room.width]) {
    for (const y of [0, room.depth]) {
      for (const z of [0, ceiling]) corners.push([u(x, y), v(y, z)]);
    }
  }
  const minU = Math.min(...corners.map((c) => c[0]));
  const maxU = Math.max(...corners.map((c) => c[0]));
  const minV = Math.min(...corners.map((c) => c[1]));
  const maxV = Math.max(...corners.map((c) => c[1]));
  const f = Math.min((width - margin * 2) / Math.max(maxU - minU, 1e-6), (height - margin * 2 - 24) / Math.max(maxV - minV, 1e-6));
  const ox = margin - minU * f + Math.max(0, (width - margin * 2 - (maxU - minU) * f) / 2);
  const oy = margin - minV * f;
  const p = (x: number, y: number, z: number): [number, number] => [ox + u(x, y) * f, oy + v(y, z) * f];
  const poly = (points: [number, number][]) => points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  const boxFaces = (b: Box3, colors: { front: string; side: string; top: string }, stroke: string, strokeWidth: number) => {
    const faces: { key: string; points: string; fill: string }[] = [];
    if (eyeZ > b.z1) faces.push({ key: 'top', fill: colors.top, points: poly([p(b.x0, b.y0, b.z1), p(b.x1, b.y0, b.z1), p(b.x1, b.y1, b.z1), p(b.x0, b.y1, b.z1)]) });
    if (eyeZ < b.z0) faces.push({ key: 'bottom', fill: colors.top, points: poly([p(b.x0, b.y0, b.z0), p(b.x1, b.y0, b.z0), p(b.x1, b.y1, b.z0), p(b.x0, b.y1, b.z0)]) });
    if (eyeX < b.x0) faces.push({ key: 'left', fill: colors.side, points: poly([p(b.x0, b.y0, b.z0), p(b.x0, b.y0, b.z1), p(b.x0, b.y1, b.z1), p(b.x0, b.y1, b.z0)]) });
    if (eyeX > b.x1) faces.push({ key: 'right', fill: colors.side, points: poly([p(b.x1, b.y0, b.z0), p(b.x1, b.y0, b.z1), p(b.x1, b.y1, b.z1), p(b.x1, b.y1, b.z0)]) });
    faces.push({ key: 'front', fill: colors.front, points: poly([p(b.x0, b.y1, b.z0), p(b.x0, b.y1, b.z1), p(b.x1, b.y1, b.z1), p(b.x1, b.y1, b.z0)]) });
    return faces.map((face) => <polygon key={face.key} points={face.points} fill={face.fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />);
  };

  /** Членение фасада бокового шкафа: панели рисуются прямо на плоскости стены. */
  const sideFacade = (placed: SketchPlacedModule, b: Box3, plane: number) => {
    const panels = Math.max(1, Math.min(placed.module.drawers || placed.module.facades || 1, 4));
    const horizontal = placed.module.drawers > 0;
    const items = [];
    for (let i = 0; i < panels; i += 1) {
      const a = i / panels;
      const c = (i + 1) / panels;
      const [ya, yc] = horizontal ? [b.y0, b.y1] : [b.y0 + (b.y1 - b.y0) * a, b.y0 + (b.y1 - b.y0) * c];
      const [za, zc] = horizontal ? [b.z0 + (b.z1 - b.z0) * a, b.z0 + (b.z1 - b.z0) * c] : [b.z0, b.z1];
      items.push(
        <polygon key={`panel-${i}`} points={poly([p(plane, ya, za), p(plane, ya, zc), p(plane, yc, zc), p(plane, yc, za)])}
          fill={i % 2 ? style.facade : style.facadeDark} opacity={0.96} stroke={style.line} strokeWidth={0.8} />,
      );
      const hy = horizontal ? (b.y0 + b.y1) / 2 : yc - (yc - ya) * 0.12;
      const hz = horizontal ? za + (zc - za) * 0.5 : b.z0 + (b.z1 - b.z0) * 0.52;
      const h1 = horizontal ? p(plane, b.y0 + (b.y1 - b.y0) * 0.3, hz) : p(plane, hy, hz - (b.z1 - b.z0) * 0.06);
      const h2 = horizontal ? p(plane, b.y0 + (b.y1 - b.y0) * 0.7, hz) : p(plane, hy, hz + (b.z1 - b.z0) * 0.06);
      items.push(<line key={`handle-${i}`} x1={h1[0]} y1={h1[1]} x2={h2[0]} y2={h2[1]} stroke={style.handle} strokeWidth={2} strokeLinecap="round" />);
    }
    return items;
  };

  const moduleBox = (placed: SketchPlacedModule, run: KitchenWallRun): Box3 => {
    const rect = planRect(placed, layout);
    const z0 = placedBottomMm(placed, run);
    return { x0: rect.x0, x1: rect.x1, y0: rect.y0, y1: rect.y1, z0, z1: z0 + placed.height };
  };

  interface Piece { key: string; depth: number; node: React.ReactNode }
  const pieces: Piece[] = [];

  for (const run of layout.walls) {
    for (const placed of [...run.floor, ...run.upper]) {
      const b = moduleBox(placed, run);
      const selected = props.selectedId === placed.sourceId;
      const stroke = selected ? SELECTED_STROKE : style.line;
      const sw = selected ? 2.4 : 0.9;
      const colors = { front: placed.wall === 'back' ? style.facade : style.body, side: style.facadeDark, top: style.body };
      const frontTopLeft = p(b.x0, b.y1, b.z1);
      const frontBottomRight = p(b.x1, b.y1, b.z0);
      pieces.push({
        key: `box-${placed.wall}-${placed.sourceId}-${placed.instance}-${placed.tier}`,
        depth: (b.y0 + b.y1) / 2,
        node: (
          <g onClick={() => props.onSelect(placed.sourceId)} role="button" tabIndex={0} aria-label={`Выбрать ${moduleTitle(placed)}`} style={{ cursor: 'pointer' }}>
            <title>{moduleTitle(placed)}</title>
            {boxFaces(b, colors, stroke, sw)}
            {placed.wall === 'back' && (
              <CabinetDetails placed={placed} x={frontTopLeft[0]} y={frontTopLeft[1]}
                w={Math.max(1, frontBottomRight[0] - frontTopLeft[0])} h={Math.max(1, frontBottomRight[1] - frontTopLeft[1])} style={style} compact />
            )}
            {placed.wall === 'left' && sideFacade(placed, b, b.x1)}
            {placed.wall === 'right' && sideFacade(placed, b, b.x0)}
          </g>
        ),
      });
    }
    const span = baseSpanMm(run);
    if (span.end > span.start) {
      const base = baseHeightMm(run);
      const z0 = PLINTH_MM + base;
      const slab: Box3 = run.wall === 'back'
        ? { x0: span.start, x1: span.end, y0: 0, y1: run.depth, z0, z1: z0 + COUNTER_MM }
        : run.wall === 'left'
          ? { x0: 0, x1: run.depth, y0: room.backDepth + span.start, y1: room.backDepth + span.end, z0, z1: z0 + COUNTER_MM }
          : { x0: room.width - run.depth, x1: room.width, y0: room.backDepth + span.start, y1: room.backDepth + span.end, z0, z1: z0 + COUNTER_MM };
      pieces.push({
        key: `counter-${run.wall}`,
        depth: (slab.y0 + slab.y1) / 2 + 1,
        node: <g pointerEvents="none">{boxFaces(slab, { front: style.counterEdge, side: style.counterEdge, top: style.counter }, style.counterEdge, 0.8)}</g>,
      });
    }
  }
  pieces.sort((a, b) => a.depth - b.depth);

  const wallSet = new Set(layout.walls.map((run) => run.wall));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Объёмный вид кухни" fontFamily="Segoe UI, Arial, sans-serif">
      <rect width={width} height={height} fill="#fff" />
      <polygon points={poly([p(0, 0, 0), p(room.width, 0, 0), p(room.width, room.depth, 0), p(0, room.depth, 0)])} fill={style.floor} opacity={0.5} stroke={style.line} strokeWidth={0.6} />
      <polygon points={poly([p(0, 0, 0), p(0, 0, ceiling), p(room.width, 0, ceiling), p(room.width, 0, 0)])} fill={style.backsplash} opacity={0.55} stroke={style.line} strokeWidth={0.6} />
      {wallSet.has('left') && <polygon points={poly([p(0, 0, 0), p(0, 0, ceiling), p(0, room.depth, ceiling), p(0, room.depth, 0)])} fill={style.backsplash} opacity={0.32} stroke={style.line} strokeWidth={0.5} />}
      {wallSet.has('right') && <polygon points={poly([p(room.width, 0, 0), p(room.width, 0, ceiling), p(room.width, room.depth, ceiling), p(room.width, room.depth, 0)])} fill={style.backsplash} opacity={0.32} stroke={style.line} strokeWidth={0.5} />}
      {pieces.map((piece) => <g key={piece.key}>{piece.node}</g>)}
      <text x={margin} y={height - 10} fontSize="11" fill={style.line}>
        Объёмный вид · {LAYOUT_SHAPES.find((item) => item.id === layout.shape)?.name.toLocaleLowerCase('ru')} планировка · помещение {Math.round(room.width)}×{Math.round(room.depth)} мм
      </text>
    </svg>
  );
}

export default function KitchenSketch(props: KitchenSketchProps) {
  const { modules, mode = 'full' } = props;
  const shape = normalizeLayoutShape(props.settings?.shape);
  const [view, setView] = useState<KitchenSketchView>(props.settings?.view ?? 'elevation');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const svgWrapRef = useRef<HTMLDivElement>(null);
  const style = getSketchStyle(props.settings?.styleId);
  const layout = useMemo(() => buildKitchenLayout(modules, shape), [modules, shape]);
  const canControl = mode !== 'client';
  const fullControls = mode === 'full';
  const compact = mode === 'compact';

  const select = (id: string) => {
    setSelectedId(id);
    props.onSelectModule?.(id);
  };
  const chooseStyle = (styleId: KitchenSketchStyleId) => props.onSettingsChange?.({ ...props.settings, styleId });
  const chooseShape = (nextShape: KitchenLayoutShape) => props.onSettingsChange?.({ ...props.settings, shape: nextShape });
  const chooseView = (nextView: KitchenSketchView) => {
    setView(nextView);
    if (fullControls) props.onSettingsChange?.({ ...props.settings, view: nextView });
  };
  const sourceIndex = selectedId ? modules.findIndex((module) => module.id === selectedId) : -1;

  const serializedSvg = () => {
    const svg = svgWrapRef.current?.querySelector('svg');
    if (!svg) return null;
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return new XMLSerializer().serializeToString(copy);
  };
  const viewName = SKETCH_VIEWS.find((item) => item.id === view)?.short.toLocaleLowerCase('ru') ?? 'эскиз';
  const exportSvg = () => {
    const text = serializedSvg();
    if (!text) return;
    downloadFile(`${escName(`эскиз кухни ${viewName}`)}.svg`, text, 'image/svg+xml;charset=utf-8');
    setNotice('SVG скачан');
  };
  const makePng = async (): Promise<Blob | null> => {
    const text = serializedSvg();
    const svg = svgWrapRef.current?.querySelector('svg');
    if (!text || !svg) return null;
    const viewBox = svg.viewBox.baseVal;
    const blob = new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const loaded = new Image();
        loaded.onload = () => resolve(loaded);
        loaded.onerror = () => reject(new Error('Не удалось подготовить изображение'));
        loaded.src = url;
      });
      const canvas = document.createElement('canvas');
      const factor = Math.min(2, 2200 / Math.max(viewBox.width, viewBox.height));
      canvas.width = Math.round(viewBox.width * factor);
      canvas.height = Math.round(viewBox.height * factor);
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  const exportPng = async () => {
    try {
      const blob = await makePng();
      if (!blob) throw new Error();
      downloadFile(`${escName(`эскиз кухни ${viewName}`)}.png`, blob, 'image/png');
      setNotice('PNG скачан');
    } catch {
      setNotice('Не удалось подготовить PNG');
    }
  };
  const copySketch = async () => {
    try {
      const blob = await makePng();
      if (blob && navigator.clipboard && 'ClipboardItem' in window) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        setNotice('PNG скопирован в буфер');
      } else {
        const text = serializedSvg();
        if (!text || !navigator.clipboard) throw new Error();
        await navigator.clipboard.writeText(text);
        setNotice('SVG скопирован в буфер');
      }
    } catch {
      setNotice('Браузер не разрешил копирование');
    }
  };

  if (modules.length === 0) {
    return <div className={`kitchen-sketch ${props.className ?? ''}`}><div className="sketch-empty">Добавьте модули в «Позиции кухни» — здесь автоматически появится эскиз.</div></div>;
  }

  const canvas = view === 'plan'
    ? <PlanView layout={layout} style={style} selectedId={selectedId} onSelect={select} compact={compact} />
    : view === '3d'
      ? <Sketch3D layout={layout} style={style} selectedId={selectedId} onSelect={select} compact={compact} />
      : <ElevationView layout={layout} style={style} selectedId={selectedId} onSelect={select} compact={compact} />;
  const tallCanvas = view === 'elevation' && layout.walls.length > 1;

  return (
    <section className={`kitchen-sketch kitchen-sketch--${mode} ${props.className ?? ''}`}>
      {mode !== 'client' && (
        <header className="sketch-head">
          <div>
            <h3>{compact ? '🎨 Предпросмотр эскиза' : '🎨 Эскиз кухни'}</h3>
            {fullControls && <p>Развёртка строится по размерам, планировке и стенам модулей. Нажмите на шкаф, чтобы открыть его параметры.</p>}
          </div>
          {canControl && (
            <div className="sketch-segmented" aria-label="Вид эскиза">
              {SKETCH_VIEWS.map((item) => (
                <button key={item.id} title={item.hint} className={view === item.id ? 'active' : ''} onClick={() => chooseView(item.id)}>
                  {compact ? item.short : item.label}
                </button>
              ))}
            </div>
          )}
        </header>
      )}
      {mode === 'client' && <div className="client-sketch-title">Эскиз кухонного гарнитура</div>}
      {canControl && props.onSettingsChange && (
        <div className="sketch-controls no-print">
          <div className="sketch-shape-picker">
            <span>Планировка:</span>
            {LAYOUT_SHAPES.map((item) => (
              <button key={item.id} title={item.hint} className={shape === item.id ? 'shape-btn active' : 'shape-btn'} onClick={() => chooseShape(item.id)}>
                {item.name}
              </button>
            ))}
          </div>
          {fullControls && (
            <div className="sketch-style-picker">
              <span>Стиль:</span>
              {SKETCH_STYLES.map((item) => (
                <button key={item.id} title={item.name} onClick={() => chooseStyle(item.id)} className={style.id === item.id ? 'style-swatch active' : 'style-swatch'}>
                  <i style={{ background: item.facade }} /><i style={{ background: item.counter }} /><b>{item.name}</b>
                </button>
              ))}
            </div>
          )}
          {fullControls && (
            <div className="sketch-export">
              <button className="btn tiny ghost" onClick={exportPng}>📥 Скачать PNG</button>
              <button className="btn tiny ghost" onClick={exportSvg}>SVG</button>
              <button className="btn tiny ghost" onClick={copySketch}>📋 Скопировать</button>
            </div>
          )}
        </div>
      )}
      <div ref={svgWrapRef} className={`sketch-canvas${tallCanvas ? ' sketch-canvas--tall' : ''}`}>{canvas}</div>
      {fullControls && (
        <footer className="sketch-foot no-print">
          <div>{selectedId
            ? <>Выбран модуль: <b>{modules.find((module) => module.id === selectedId)?.name}</b></>
            : 'Нажмите на модуль, чтобы выделить его и открыть параметры.'}</div>
          {selectedId && props.onReorder && (
            <div className="sketch-move">
              <span>Порядок:</span>
              <button className="btn tiny ghost" disabled={sourceIndex <= 0} onClick={() => props.onReorder?.(selectedId, -1)}>◀</button>
              <button className="btn tiny ghost" disabled={sourceIndex < 0 || sourceIndex >= modules.length - 1} onClick={() => props.onReorder?.(selectedId, 1)}>▶</button>
            </div>
          )}
          {notice && <span className="sketch-notice">{notice}</span>}
        </footer>
      )}
    </section>
  );
}
