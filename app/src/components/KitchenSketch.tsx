import { useMemo, useRef, useState } from 'react';
import type { KitchenModule, KitchenSketchSettings, KitchenSketchStyleId } from '../types';
import { downloadFile } from '../lib/storage';
import {
  buildKitchenLayout, getSketchStyle, hasHob, isOpenModule, isOvenModule, isSinkModule,
  SKETCH_STYLES, type KitchenLayout, type SketchPlacedModule, type SketchStyle,
} from '../lib/kitchenSketch';

type Projection = '2d' | '3d';
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

interface Scene {
  width: number;
  height: number;
  scale: number;
  originX: number;
  floorY: number;
  counterY: number;
  upperBottomY: number;
  upperTopY: number;
}

function makeScene(layout: KitchenLayout): Scene {
  const scale = Math.min(0.36, Math.max(0.15, 940 / layout.totalWidth));
  return {
    width: Math.max(1020, layout.totalWidth * scale + 170),
    height: Math.max(700, layout.totalHeight * scale + 230),
    scale,
    originX: 72,
    floorY: Math.max(700, layout.totalHeight * scale + 230) - 84,
    counterY: Math.max(700, layout.totalHeight * scale + 230) - 84 - (100 + 720 + 38) * scale,
    upperBottomY: Math.max(700, layout.totalHeight * scale + 230) - 84 - (100 + 720 + 38 + 600) * scale,
    upperTopY: Math.max(700, layout.totalHeight * scale + 230) - 84 - (100 + 720 + 38 + 600 + 720) * scale,
  };
}

function escName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'эскиз-кухни';
}

function moduleTitle(placed: SketchPlacedModule): string {
  const { module } = placed;
  const ordinal = module.qty > 1 ? ` · экземпляр ${placed.instance + 1}` : '';
  return `${module.name || module.type}${ordinal} · ${placed.width}×${placed.height}×${placed.depth} мм`;
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

function DimensionChain(props: { layout: KitchenLayout; scene: Scene; color: string }) {
  const { layout, scene, color } = props;
  const yTop = 57;
  const yUpper = 79;
  const yBottom = scene.floorY + 47;
  const x0 = scene.originX;
  const totalX = x0 + layout.totalWidth * scene.scale;
  const drawChain = (items: SketchPlacedModule[], y: number, label: string) => {
    if (!items.length) return null;
    return <g key={label}>
      <text x={x0 - 9} y={y + 4} textAnchor="end" fontSize="9">{label}</text>
      {items.map((placed) => {
        const x = x0 + placed.x * scene.scale;
        const end = x + placed.width * scene.scale;
        return <g key={`${label}-${placed.sourceId}-${placed.instance}`}>
          <line x1={x} y1={y} x2={end} y2={y} strokeWidth={0.75} />
          <line x1={x} y1={y - 5} x2={x} y2={y + 5} strokeWidth={0.75} />
          <line x1={end} y1={y - 5} x2={end} y2={y + 5} strokeWidth={0.75} />
          <text x={(x + end) / 2} y={y - 7} textAnchor="middle" fontSize="11">{Math.round(placed.width)}</text>
        </g>;
      })}
    </g>;
  };
  return (
    <g fill={color} stroke={color} fontFamily="Segoe UI, Arial, sans-serif">
      <line x1={x0} y1={yTop} x2={totalX} y2={yTop} strokeWidth={0.85} />
      <line x1={x0} y1={yTop - 5} x2={x0} y2={yTop + 5} strokeWidth={0.85} />
      <line x1={totalX} y1={yTop - 5} x2={totalX} y2={yTop + 5} strokeWidth={0.85} />
      <text x={(x0 + totalX) / 2} y={yTop - 8} textAnchor="middle" fontSize="13" fontWeight="700">Общая ширина {Math.round(layout.totalWidth)} мм</text>
      {drawChain(layout.upper.length ? layout.upper : layout.floor, yUpper, layout.upper.length ? 'верх' : 'низ')}
      {drawChain(layout.floor, yBottom, 'низ')}
      <line x1={totalX + 42} y1={scene.floorY} x2={totalX + 42} y2={scene.floorY - scene.scale * layout.totalHeight} strokeWidth={0.85} />
      <line x1={totalX + 37} y1={scene.floorY} x2={totalX + 47} y2={scene.floorY} strokeWidth={0.85} />
      <line x1={totalX + 37} y1={scene.floorY - scene.scale * layout.totalHeight} x2={totalX + 47} y2={scene.floorY - scene.scale * layout.totalHeight} strokeWidth={0.85} />
      <text x={totalX + 60} y={scene.floorY - scene.scale * layout.totalHeight / 2} fontSize="11" transform={`rotate(-90 ${totalX + 60} ${scene.floorY - scene.scale * layout.totalHeight / 2})`} textAnchor="middle">Общая высота {Math.round(layout.totalHeight)} мм</text>
      <text x={totalX + 27} y={scene.floorY - 2} textAnchor="end" fontSize="10">0</text>
      <text x={totalX + 27} y={scene.floorY - 100 * scene.scale + 3} textAnchor="end" fontSize="10">цоколь 100</text>
      <text x={totalX + 27} y={scene.counterY - 4} textAnchor="end" fontSize="10">столешница</text>
      <text x={totalX + 27} y={scene.upperBottomY - 4} textAnchor="end" fontSize="10">фартук 600</text>
    </g>
  );
}

function Sketch2D(props: { layout: KitchenLayout; style: SketchStyle; selectedId: string | null; onSelect: (id: string) => void; compact?: boolean }) {
  const { layout, style } = props;
  const scene = makeScene(layout);
  const lowerHeight = Math.max(720, ...layout.floor.filter((item) => item.tier === 'base').map((item) => item.height));
  const counterWidth = layout.floor.filter((item) => item.tier === 'base').reduce((width, item) => Math.max(width, item.x + item.width), 0);
  const selectedStroke = '#f1a208';
  const x = (mm: number) => scene.originX + mm * scene.scale;
  const upperY = (placed: SketchPlacedModule) => scene.upperBottomY - placed.height * scene.scale;
  const floorY = (placed: SketchPlacedModule) => placed.tier === 'tall'
    ? scene.floorY - placed.height * scene.scale
    : scene.floorY - (100 + placed.height) * scene.scale;

  const renderedCabinet = (placed: SketchPlacedModule, y: number) => {
    const px = x(placed.x); const width = placed.width * scene.scale; const height = placed.height * scene.scale;
    const selected = props.selectedId === placed.sourceId;
    return (
      <g key={`${placed.sourceId}-${placed.instance}-${placed.tier}`} onClick={() => props.onSelect(placed.sourceId)} role="button" tabIndex={0} aria-label={`Выбрать ${moduleTitle(placed)}`} style={{ cursor: 'pointer' }}>
        <title>{moduleTitle(placed)}</title>
        <rect x={px - 2} y={y - 2} width={width + 4} height={height + 4} rx={3} fill={selected ? '#fff3c8' : 'transparent'} stroke={selected ? selectedStroke : 'transparent'} strokeWidth={selected ? 3 : 0} />
        <CabinetDetails placed={placed} x={px} y={y} w={width} h={height} style={style} compact={props.compact} />
        {!props.compact && width > 78 && <text x={px + width / 2} y={y + height - 8} textAnchor="middle" fontSize="10" fill={style.line} pointerEvents="none">{placed.module.name.slice(0, Math.max(10, Math.floor(width / 6)))}</text>}
      </g>
    );
  };

  return (
    <svg viewBox={`0 0 ${scene.width} ${scene.height}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Фасадная развёртка кухни" fontFamily="Segoe UI, Arial, sans-serif">
      <rect width={scene.width} height={scene.height} fill="#fff" />
      <rect x={scene.originX} y={scene.upperBottomY} width={Math.max(layout.upperRunWidth, counterWidth) * scene.scale} height={(scene.counterY - scene.upperBottomY)} fill={style.backsplash} opacity="0.75" />
      {!props.compact && <DimensionChain layout={layout} scene={scene} color={style.line} />}
      <line x1={scene.originX - 12} x2={scene.originX + layout.totalWidth * scene.scale + 12} y1={scene.floorY} y2={scene.floorY} stroke={style.line} strokeWidth={1.5} />
      {layout.floor.filter((item) => item.tier === 'base').map((placed) => {
        const px = x(placed.x); const w = placed.width * scene.scale;
        return <rect key={`plinth-${placed.sourceId}-${placed.instance}`} x={px} y={scene.floorY - 100 * scene.scale} width={w} height={100 * scene.scale} fill={style.facadeDark} stroke={style.line} strokeWidth={1} />;
      })}
      {counterWidth > 0 && (
        <g>
          <rect x={scene.originX} y={scene.floorY - (100 + lowerHeight + 38) * scene.scale} width={counterWidth * scene.scale} height={38 * scene.scale} fill={style.counter} stroke={style.counterEdge} strokeWidth={1.2} />
          <rect x={scene.originX} y={scene.floorY - (100 + lowerHeight) * scene.scale} width={counterWidth * scene.scale} height={5} fill={style.counterEdge} opacity={0.85} />
        </g>
      )}
      {layout.floor.map((placed) => renderedCabinet(placed, floorY(placed)))}
      {layout.upper.map((placed) => renderedCabinet(placed, upperY(placed)))}
      {layout.floor.filter((placed) => placed.tier === 'base' && isSinkModule(placed.module)).map((placed) => {
        const px = x(placed.x); const w = placed.width * scene.scale; const cy = scene.counterY + 4;
        return <g key={`sink-${placed.sourceId}-${placed.instance}`} pointerEvents="none"><ellipse cx={px + w * .5} cy={cy + 4} rx={Math.min(28, w * .23)} ry={6} fill="#9ab6bc" stroke={style.line} strokeWidth={1} /><path d={`M ${px + w * .64} ${cy + 3} v-17 q0-10 9-10 q9 0 9 10 v6`} fill="none" stroke={style.handle} strokeWidth={2.5} strokeLinecap="round" /></g>;
      })}
      {layout.floor.filter((placed) => placed.tier === 'base' && hasHob(placed.module)).map((placed) => {
        const px = x(placed.x); const w = placed.width * scene.scale;
        return <g key={`hob-${placed.sourceId}-${placed.instance}`} pointerEvents="none"><rect x={px + w * .25} y={scene.counterY + 3} width={w * .5} height={8} rx={1} fill="#24272c" /><circle cx={px + w * .37} cy={scene.counterY + 7} r={Math.max(1.5, w * .055)} fill="none" stroke="#c5d0cf" /><circle cx={px + w * .63} cy={scene.counterY + 7} r={Math.max(1.5, w * .055)} fill="none" stroke="#c5d0cf" /></g>;
      })}
      <text x={scene.originX} y={scene.height - 14} fill={style.line} fontSize="11">Фасадная развёртка · цоколь 100 · столешница 38 · фартук 600 мм</text>
    </svg>
  );
}

function Sketch3D(props: { layout: KitchenLayout; style: SketchStyle; selectedId: string | null; onSelect: (id: string) => void }) {
  const { layout, style } = props;
  const scale = Math.min(0.3, Math.max(0.13, 850 / layout.totalWidth));
  const width = Math.max(1040, layout.totalWidth * scale + 270);
  const height = 710;
  const originX = 105;
  const floorY = 618;
  const upperBottom = floorY - (100 + 720 + 38 + 600) * scale;
  const selectedStroke = '#f1a208';
  const cabinet = (placed: SketchPlacedModule, y: number) => {
    const x = originX + placed.x * scale;
    const w = placed.width * scale;
    const h = placed.height * scale;
    const depthX = Math.max(18, placed.depth * scale * .22);
    const depthY = Math.max(11, placed.depth * scale * .12);
    const selected = props.selectedId === placed.sourceId;
    return (
      <g key={`iso-${placed.sourceId}-${placed.instance}-${placed.tier}`} onClick={() => props.onSelect(placed.sourceId)} role="button" tabIndex={0} style={{ cursor: 'pointer' }}>
        <title>{moduleTitle(placed)}</title>
        <polygon points={`${x},${y} ${x + depthX},${y - depthY} ${x + w + depthX},${y - depthY} ${x + w},${y}`} fill={style.body} stroke={selected ? selectedStroke : style.line} strokeWidth={selected ? 3 : 1} />
        <polygon points={`${x + w},${y} ${x + w + depthX},${y - depthY} ${x + w + depthX},${y + h - depthY} ${x + w},${y + h}`} fill={style.facadeDark} stroke={selected ? selectedStroke : style.line} strokeWidth={selected ? 3 : 1} />
        <rect x={x} y={y} width={w} height={h} fill={style.facade} stroke={selected ? selectedStroke : style.line} strokeWidth={selected ? 3 : 1.2} />
        <CabinetDetails placed={placed} x={x} y={y} w={w} h={h} style={style} compact />
      </g>
    );
  };
  const baseHeight = Math.max(720, ...layout.floor.filter((item) => item.tier === 'base').map((item) => item.height));
  const counterY = floorY - (100 + baseHeight + 38) * scale;
  const counterWidth = layout.floor.filter((item) => item.tier === 'base').reduce((value, item) => Math.max(value, item.x + item.width), 0);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Изометрический объём кухни" fontFamily="Segoe UI, Arial, sans-serif">
      <rect width={width} height={height} fill="#fff" />
      <polygon points={`${originX - 35},${floorY + 2} ${originX + layout.totalWidth * scale + 170},${floorY + 2} ${originX + layout.totalWidth * scale + 130},${floorY + 70} ${originX - 70},${floorY + 70}`} fill={style.floor} opacity={0.52} />
      {counterWidth > 0 && <g><polygon points={`${originX},${counterY} ${originX + 22},${counterY - 13} ${originX + counterWidth * scale + 22},${counterY - 13} ${originX + counterWidth * scale},${counterY}`} fill={style.counter} stroke={style.counterEdge} /><polygon points={`${originX + counterWidth * scale},${counterY} ${originX + counterWidth * scale + 22},${counterY - 13} ${originX + counterWidth * scale + 22},${counterY - 2} ${originX + counterWidth * scale},${counterY + 11}`} fill={style.counterEdge} /></g>}
      {layout.floor.map((placed) => cabinet(placed, placed.tier === 'tall' ? floorY - placed.height * scale : floorY - (100 + placed.height) * scale))}
      {layout.upper.map((placed) => cabinet(placed, upperBottom - placed.height * scale))}
      <text x={originX} y={floorY + 98} fontSize="12" fill={style.line}>Изометрия · глубина нижних корпусов 560 мм, верхних — 320 мм</text>
    </svg>
  );
}

export default function KitchenSketch(props: KitchenSketchProps) {
  const { modules, mode = 'full' } = props;
  const [projection, setProjection] = useState<Projection>('2d');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const svgWrapRef = useRef<HTMLDivElement>(null);
  const style = getSketchStyle(props.settings?.styleId);
  const layout = useMemo(() => buildKitchenLayout(modules), [modules]);
  const canControl = mode !== 'client';
  const fullControls = mode === 'full';

  const select = (id: string) => {
    setSelectedId(id);
    props.onSelectModule?.(id);
  };
  const chooseStyle = (styleId: KitchenSketchStyleId) => props.onSettingsChange?.({ ...props.settings, styleId });
  const sourceIndex = selectedId ? modules.findIndex((module) => module.id === selectedId) : -1;

  const serializedSvg = () => {
    const svg = svgWrapRef.current?.querySelector('svg');
    if (!svg) return null;
    const copy = svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return new XMLSerializer().serializeToString(copy);
  };
  const exportSvg = () => {
    const text = serializedSvg();
    if (!text) return;
    downloadFile(`${escName('эскиз кухни')}.svg`, text, 'image/svg+xml;charset=utf-8');
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
      downloadFile('эскиз кухни.png', blob, 'image/png');
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

  return (
    <section className={`kitchen-sketch kitchen-sketch--${mode} ${props.className ?? ''}`}>
      {mode !== 'client' && (
        <header className="sketch-head">
          <div>
            <h3>{mode === 'compact' ? '🎨 Предпросмотр эскиза' : '🎨 Эскиз кухни'}</h3>
            {mode === 'full' && <p>Развёртка строится по размерам и конструкции модулей. Нажмите на шкаф, чтобы открыть его параметры.</p>}
          </div>
          {canControl && <div className="sketch-segmented" aria-label="Вид эскиза"><button className={projection === '2d' ? 'active' : ''} onClick={() => setProjection('2d')}>2D · Чертёж</button><button className={projection === '3d' ? 'active' : ''} onClick={() => setProjection('3d')}>3D · Объём</button></div>}
        </header>
      )}
      {mode === 'client' && <div className="client-sketch-title">Эскиз кухонного гарнитура</div>}
      {fullControls && (
        <div className="sketch-controls no-print">
          <div className="sketch-style-picker"><span>Стиль:</span>{SKETCH_STYLES.map((item) => <button key={item.id} title={item.name} onClick={() => chooseStyle(item.id)} className={style.id === item.id ? 'style-swatch active' : 'style-swatch'}><i style={{ background: item.facade }} /><i style={{ background: item.counter }} /><b>{item.name}</b></button>)}</div>
          <div className="sketch-export"><button className="btn tiny ghost" onClick={exportPng}>📥 Скачать PNG</button><button className="btn tiny ghost" onClick={exportSvg}>SVG</button><button className="btn tiny ghost" onClick={copySketch}>📋 Скопировать</button></div>
        </div>
      )}
      {mode === 'compact' && <div className="sketch-compact-switch no-print"><button className={projection === '2d' ? 'active' : ''} onClick={() => setProjection('2d')}>2D</button><button className={projection === '3d' ? 'active' : ''} onClick={() => setProjection('3d')}>3D</button></div>}
      <div ref={svgWrapRef} className="sketch-canvas">
        {projection === '2d'
          ? <Sketch2D layout={layout} style={style} selectedId={selectedId} onSelect={select} compact={mode === 'compact'} />
          : <Sketch3D layout={layout} style={style} selectedId={selectedId} onSelect={select} />}
      </div>
      {fullControls && <footer className="sketch-foot no-print"><div>{selectedId ? <>Выбран модуль: <b>{modules.find((module) => module.id === selectedId)?.name}</b></> : 'Нажмите на модуль, чтобы выделить его и открыть параметры.'}</div>{selectedId && props.onReorder && <div className="sketch-move"><span>Порядок:</span><button className="btn tiny ghost" disabled={sourceIndex <= 0} onClick={() => props.onReorder?.(selectedId, -1)}>◀</button><button className="btn tiny ghost" disabled={sourceIndex < 0 || sourceIndex >= modules.length - 1} onClick={() => props.onReorder?.(selectedId, 1)}>▶</button></div>}{notice && <span className="sketch-notice">{notice}</span>}</footer>}
    </section>
  );
}
