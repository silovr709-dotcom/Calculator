import { useCallback, useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { EskizCommunicationDistance, EskizCommunicationKind, EskizCommunicationMarker } from '../types';
import type { EskizCalloutObject, EskizDimensionObject, EskizEquipmentType, EskizModuleObject, EskizObject, EskizProject, EskizTextObject } from '../lib/eskizPro';
import { readEskizFile } from '../lib/eskizPro';
import { COMMUNICATION_ANCHOR_LABELS, COMMUNICATION_KIND_META, communicationDistanceText, communicationSizeText } from '../lib/eskizCommunications';

type Tool = 'select' | 'free-dimension' | 'h-dimension' | 'v-dimension' | 'chain' | 'anchor' | 'h-guide' | 'v-guide' | 'module' | 'callout' | 'comment' | 'equipment' | 'link';
type Drag = { mode: 'create' | 'move' | 'handle' | 'marquee'; start: Point; id?: string; end?: 'start' | 'end' | 'offset' | 'resize'; before: EskizProject; original?: EskizObject };
type Point = { x: number; y: number };
type QuickEdit = { id: string; value: string; left: number; top: number; repeatTool: Tool };

type Props = {
  project: EskizProject | null;
  calculatorProjectName: string;
  calculatorProjectClient?: string;
  communications: EskizCommunicationMarker[];
  activeCommunicationId?: string | null;
  communicationAddKind?: EskizCommunicationKind | null;
  pickingDistancePoint?: boolean;
  onProjectChange: (project: EskizProject) => void;
  onCommunicationPoint: (projectId: string, x: number, y: number) => void;
  onCommunicationClick: (projectId: string, marker: EskizCommunicationMarker) => void;
};

const COLORS = { ink: '#20242b', accent: '#ff5c35', blue: '#2563eb' };
const EQUIPMENT_TYPES: EskizEquipmentType[] = ['Холодильник', 'Духовой шкаф', 'СВЧ', 'ПММ', 'Варочная панель', 'Вытяжка', 'Стиральная машина', 'Мойка', 'Другое'];
const TOOL_ITEMS: { id: Tool; label: string; hotkey?: string }[] = [
  { id: 'select', label: 'Курсор', hotkey: 'V' },
  { id: 'free-dimension', label: 'Свободный размер', hotkey: 'R' },
  { id: 'h-dimension', label: 'Горизонтальный', hotkey: 'H' },
  { id: 'v-dimension', label: 'Вертикальный', hotkey: 'J' },
  { id: 'chain', label: 'Цепочка', hotkey: 'C' },
  { id: 'anchor', label: 'Опорная точка', hotkey: 'A' },
  { id: 'h-guide', label: 'Гор. направляющая' },
  { id: 'v-guide', label: 'Верт. направляющая' },
  { id: 'module', label: 'Модуль', hotkey: 'M' },
  { id: 'callout', label: 'Выноска', hotkey: 'L' },
  { id: 'comment', label: 'Комментарий', hotkey: 'T' },
  { id: 'equipment', label: 'Техника', hotkey: 'E' },
  { id: 'link', label: 'Ссылка', hotkey: 'K' },
];

let embeddedClipboard: EskizObject[] = [];
let embeddedStyleClipboard: Partial<EskizObject> | null = null;

function uid(prefix = 'eskiz') {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function todayRu() {
  return new Intl.DateTimeFormat('ru-RU').format(new Date());
}

function readImage(file: File): Promise<EskizProject['image']> {
  return new Promise((resolve, reject) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      reject(new Error('Поддерживаются JPG, PNG и WEBP'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('Файл не является корректным изображением'));
      image.onload = () => resolve({ dataUrl: String(reader.result), width: image.naturalWidth, height: image.naturalHeight, name: file.name });
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function createEskizProject(image: EskizProject['image'], projectName: string, clientName?: string): EskizProject {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: uid('eskiz'),
    title: projectName ? `Эскиз ${projectName}` : `Эскиз ${todayRu()}`,
    createdAt: now,
    updatedAt: now,
    image,
    imageDisplay: { opacity: 1, brightness: 1, contrast: 1, saturation: 1, grayscale: false },
    objects: [],
    header: { enabled: true, project: clientName || projectName || '', room: 'Кухня', date: todayRu(), variant: '01' },
    integration: {},
  };
}

function pointDistance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function snapAngle(start: Point, end: Point, step = 45) {
  const distance = pointDistance(start, end);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const snapped = Math.round(angle / (step * Math.PI / 180)) * step * Math.PI / 180;
  return { x: start.x + Math.cos(snapped) * distance, y: start.y + Math.sin(snapped) * distance };
}

function dimensionOffset(dimension: EskizDimensionObject, point: Point) {
  const length = Math.max(1, Math.hypot(dimension.x2 - dimension.x, dimension.y2 - dimension.y));
  const nx = -(dimension.y2 - dimension.y) / length;
  const ny = (dimension.x2 - dimension.x) / length;
  const midX = (dimension.x + dimension.x2) / 2;
  const midY = (dimension.y + dimension.y2) / 2;
  return (point.x - midX) * nx + (point.y - midY) * ny;
}

function nextModuleNumber(objects: EskizObject[]) {
  const maxNumber = objects.filter((object) => object.type === 'module').reduce((max, object) => object.type === 'module' ? Math.max(max, Number(object.number.match(/\d+/u)?.[0] ?? 0)) : max, 0);
  return `М${String(maxNumber + 1).padStart(2, '0')}`;
}

function objectListLabel(object: EskizObject) {
  if (object.type === 'dimension') return `${object.value} мм`;
  if (object.type === 'module') return object.number;
  if (object.type === 'anchor') return `Точка ${object.label}`;
  if (object.type === 'guide') return `${object.orientation === 'horizontal' ? 'Горизонтальная' : 'Вертикальная'} направляющая`;
  if (object.type === 'link') return `Ссылка: ${object.text}`;
  if (object.type === 'callout') return `Выноска: ${object.text}`;
  return object.text;
}

function communicationAnchorPoint(distance: EskizCommunicationDistance, marker: EskizCommunicationMarker, width: number, height: number) {
  if (distance.anchor === 'left') return { x: 0, y: marker.y };
  if (distance.anchor === 'right') return { x: width, y: marker.y };
  if (distance.anchor === 'top') return { x: marker.x, y: 0 };
  if (distance.anchor === 'bottom') return { x: marker.x, y: height };
  return { x: distance.anchorX ?? marker.x + 120, y: distance.anchorY ?? marker.y };
}

function CommunicationLayer({ project, communications, activeCommunicationId, onCommunicationClick }: Pick<Props, 'project' | 'communications' | 'activeCommunicationId' | 'onCommunicationClick'> & { project: EskizProject }) {
  const projectCommunications = communications.filter((marker) => marker.eskizId === project.id);
  return <g className="embedded-eskiz-communications">
    {projectCommunications.map((marker) => {
      const meta = COMMUNICATION_KIND_META[marker.kind] ?? COMMUNICATION_KIND_META.other;
      const active = marker.id === activeCommunicationId;
      const size = communicationSizeText(marker);
      const label = marker.name || meta.label;
      const labelWidth = Math.max(96, Math.min(260, [label, size].filter(Boolean).join(' · ').length * 6 + 18));
      const labelX = marker.x + 18 > project.image.width - labelWidth ? marker.x - labelWidth - 18 : marker.x + 18;
      const labelY = Math.max(8, Math.min(project.image.height - 36, marker.y - 16));
      return <g key={marker.id} className={`embedded-eskiz-communication ${active ? 'active' : ''}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onCommunicationClick(project.id, marker); }}>
        {(marker.distances ?? []).map((distance) => {
          const anchor = communicationAnchorPoint(distance, marker, project.image.width, project.image.height);
          const text = `${distance.label || COMMUNICATION_ANCHOR_LABELS[distance.anchor]}: ${communicationDistanceText(distance.valueMm)}`;
          return <g key={distance.id} className="embedded-eskiz-communication-distance">
            <line x1={marker.x} y1={marker.y} x2={anchor.x} y2={anchor.y} stroke={meta.color} strokeWidth="2" strokeDasharray="7 5" />
            <text x={(marker.x + anchor.x) / 2} y={(marker.y + anchor.y) / 2 - 5} textAnchor="middle" fontSize="10" fontWeight="800" fill={meta.color}>{text}</text>
          </g>;
        })}
        <line x1={marker.x} y1={marker.y} x2={labelX < marker.x ? labelX + labelWidth : labelX} y2={labelY + 15} stroke={meta.color} strokeWidth="2" opacity=".72" />
        <circle cx={marker.x} cy={marker.y} r={active ? 14 : 11} fill={meta.color} stroke="#fff" strokeWidth="4" />
        <text x={marker.x} y={marker.y + 4} textAnchor="middle" fontSize="10" fontWeight="900" fill="#fff">{meta.icon}</text>
        <g transform={`translate(${labelX} ${labelY})`}>
          <rect width={labelWidth} height="32" rx="9" fill="#fff" fillOpacity=".96" stroke={meta.color} strokeWidth={active ? 2.5 : 1.7} />
          <text x="9" y="13" fontSize="11" fontWeight="900" fill={meta.color}>{label}</text>
          <text x="9" y="25" fontSize="9" fontWeight="650" fill="#40554b">{size || `${Math.round(marker.x)}×${Math.round(marker.y)}`}</text>
        </g>
      </g>;
    })}
  </g>;
}

export default function EmbeddedEskizEditor(props: Props) {
  const [project, setProject] = useState<EskizProject | null>(props.project);
  const [tool, setTool] = useState<Tool>('select');
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [showImage, setShowImage] = useState(true);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [showHelpers, setShowHelpers] = useState(true);
  const [lastDrawingTool, setLastDrawingTool] = useState<Tool>('free-dimension');
  const [saved, setSaved] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chainLast, setChainLast] = useState<Point | null>(null);
  const [chainAxis, setChainAxis] = useState<'horizontal' | 'vertical' | null>(null);
  const [chainSessionId, setChainSessionId] = useState<string | null>(null);
  const [pendingDimension, setPendingDimension] = useState<{ id: string; sourceTool: Tool } | null>(null);
  const [draftLine, setDraftLine] = useState<{ start: Point; end: Point; callout: boolean } | null>(null);
  const [selectionBox, setSelectionBox] = useState<{ start: Point; end: Point } | null>(null);
  const [snapIndicator, setSnapIndicator] = useState<Point | null>(null);
  const [quickEdit, setQuickEdit] = useState<QuickEdit | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [error, setError] = useState('');
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const past = useRef<EskizProject[]>([]);
  const future = useRef<EskizProject[]>([]);
  const communicationMode = Boolean(props.communicationAddKind || props.pickingDistancePoint);
  const chosen = project?.objects.find((object) => object.id === selected);

  useEffect(() => {
    if (!project || saved) return;
    const timer = window.setTimeout(() => {
      const next = { ...project, updatedAt: new Date().toISOString() };
      setProject(next);
      props.onProjectChange(next);
      setSaved(true);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [project, props, saved]);

  const selectOnly = useCallback((id: string | null) => {
    setSelected(id);
    setSelectedIds(id ? [id] : []);
  }, []);

  const commit = useCallback((fn: (project: EskizProject) => EskizProject) => {
    setProject((current) => {
      if (!current) return current;
      past.current.push(current);
      if (past.current.length > 80) past.current.shift();
      future.current = [];
      setSaved(false);
      return fn(current);
    });
  }, []);

  const saveNow = useCallback(() => {
    setProject((current) => {
      if (!current) return current;
      const next = { ...current, updatedAt: new Date().toISOString() };
      props.onProjectChange(next);
      setSaved(true);
      return next;
    });
  }, [props]);

  const undo = useCallback(() => setProject((current) => {
    if (!current) return current;
    const prev = past.current.pop();
    if (!prev) return current;
    future.current.push(current);
    setSaved(false);
    return prev;
  }), []);

  const redo = useCallback(() => setProject((current) => {
    if (!current) return current;
    const next = future.current.pop();
    if (!next) return current;
    past.current.push(current);
    setSaved(false);
    return next;
  }), []);

  const changeObject = useCallback((id: string, patch: Partial<EskizObject>) => commit((current) => ({ ...current, objects: current.objects.map((object) => object.id === id ? { ...object, ...patch } as EskizObject : object) })), [commit]);

  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return;
    commit((current) => ({ ...current, objects: current.objects.filter((object) => !selectedIds.includes(object.id)) }));
    selectOnly(null);
  }, [commit, selectOnly, selectedIds]);

  const duplicate = useCallback(() => {
    if (!project || !selectedIds.length) return;
    let all = [...project.objects];
    const copiedChains = new Map<string, string>();
    const copies = project.objects.filter((object) => selectedIds.includes(object.id)).map((source) => {
      const copy = { ...structuredClone(source), id: uid('obj'), x: source.x + 24, y: source.y + 24 } as EskizObject;
      if (copy.type === 'dimension') {
        copy.x2 += 24;
        copy.y2 += 24;
        if (copy.chainId) {
          if (!copiedChains.has(copy.chainId)) copiedChains.set(copy.chainId, uid('chain'));
          copy.chainId = copiedChains.get(copy.chainId);
        }
      }
      if (copy.type === 'callout') { copy.targetX += 24; copy.targetY += 24; }
      if (copy.type === 'module') copy.number = nextModuleNumber(all);
      all.push(copy);
      return copy;
    });
    commit((current) => ({ ...current, objects: [...current.objects, ...copies] }));
    setSelectedIds(copies.map((object) => object.id));
    setSelected(copies.at(-1)?.id ?? null);
  }, [commit, project, selectedIds]);

  const copySelected = useCallback(() => {
    if (!project) return;
    embeddedClipboard = project.objects.filter((object) => selectedIds.includes(object.id)).map((object) => structuredClone(object));
  }, [project, selectedIds]);

  const pasteClipboard = useCallback(() => {
    if (!project || !embeddedClipboard.length) return;
    let all = [...project.objects];
    const pastedChains = new Map<string, string>();
    const copies = embeddedClipboard.map((source) => {
      const copy = { ...structuredClone(source), id: uid('obj'), x: source.x + 32, y: source.y + 32 } as EskizObject;
      if (copy.type === 'dimension') {
        copy.x2 += 32;
        copy.y2 += 32;
        if (copy.chainId) {
          if (!pastedChains.has(copy.chainId)) pastedChains.set(copy.chainId, uid('chain'));
          copy.chainId = pastedChains.get(copy.chainId);
        }
      }
      if (copy.type === 'callout') { copy.targetX += 32; copy.targetY += 32; }
      if (copy.type === 'module') copy.number = nextModuleNumber(all);
      all.push(copy);
      return copy;
    });
    embeddedClipboard = copies.map((object) => structuredClone(object));
    commit((current) => ({ ...current, objects: [...current.objects, ...copies] }));
    setSelectedIds(copies.map((object) => object.id));
    setSelected(copies.at(-1)?.id ?? null);
  }, [commit, project]);

  const copySelectedStyle = useCallback(() => {
    if (!chosen) return;
    const source = chosen as EskizObject & Record<string, unknown>;
    const keys = ['color', 'fontSize', 'fill', 'fillOpacity', 'borderRadius', 'lineWidth', 'arrowStyle', 'textOrientation', 'textPosition'];
    embeddedStyleClipboard = Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]])) as Partial<EskizObject>;
  }, [chosen]);

  const pasteSelectedStyle = useCallback(() => {
    if (!embeddedStyleClipboard || !selectedIds.length) return;
    commit((current) => ({ ...current, objects: current.objects.map((object) => selectedIds.includes(object.id) ? { ...object, ...embeddedStyleClipboard } as EskizObject : object) }));
  }, [commit, selectedIds]);

  const nudgeSelected = useCallback((dx: number, dy: number) => {
    if (!selectedIds.length) return;
    commit((current) => ({ ...current, objects: current.objects.map((object) => {
      if (!selectedIds.includes(object.id)) return object;
      const moved = { ...object, x: object.x + dx, y: object.y + dy } as EskizObject;
      if (moved.type === 'dimension') { moved.x2 += dx; moved.y2 += dy; }
      if (moved.type === 'callout') { moved.targetX += dx; moved.targetY += dy; }
      return moved;
    }) }));
  }, [commit, selectedIds]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const input = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.code === 'Space' && !input) { event.preventDefault(); setSpaceDown(true); }
      if (input) return;
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelectedStyle(); return; }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelectedStyle(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelected(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteClipboard(); return; }
      if (event.key.toLowerCase() === 'q' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); setTool(lastDrawingTool); setPendingDimension(null); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicate(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveNow(); return; }
      if (event.key === 'Delete' || event.key === 'Backspace') deleteSelected();
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && selected) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        nudgeSelected(event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
      }
      if (event.key === 'Escape') { setTool('select'); selectOnly(null); setChainLast(null); setChainAxis(null); setChainSessionId(null); setPendingDimension(null); }
      const found = TOOL_ITEMS.find((item) => item.hotkey?.toLowerCase() === event.key.toLowerCase());
      if (found && !event.ctrlKey && !event.metaKey) {
        setTool(found.id);
        if (found.id !== 'select') setLastDrawingTool(found.id);
        if (found.id !== 'chain') setChainLast(null);
      }
    };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') setSpaceDown(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [copySelected, copySelectedStyle, deleteSelected, duplicate, lastDrawingTool, nudgeSelected, pasteClipboard, pasteSelectedStyle, redo, saveNow, selectOnly, selected, undo]);

  const point = useCallback((event: ReactPointerEvent): Point => {
    const current = project;
    const svg = svgRef.current;
    if (!current || !svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * current.image.width / rect.width, y: (event.clientY - rect.top) * current.image.height / rect.height };
  }, [project]);

  const nearestSnap = useCallback((raw: Point, excludeId?: string) => {
    if (!project) return null;
    const points: Point[] = [];
    const verticalGuides: number[] = [];
    const horizontalGuides: number[] = [];
    for (const object of project.objects) {
      if (object.id === excludeId || object.hidden || (!showHelpers && (object.type === 'anchor' || object.type === 'guide'))) continue;
      if (object.type === 'guide') {
        if (object.orientation === 'vertical') verticalGuides.push(object.x);
        else horizontalGuides.push(object.y);
        continue;
      }
      points.push({ x: object.x, y: object.y });
      if (object.type === 'dimension') points.push({ x: object.x2, y: object.y2 });
      if (object.type === 'callout') points.push({ x: object.targetX, y: object.targetY });
    }
    const threshold = 14 / zoom;
    let best: Point | null = null;
    let distance = threshold;
    for (const item of points) {
      const next = pointDistance(item, raw);
      if (next < distance) { best = item; distance = next; }
    }
    if (best) return best;
    let snapX = raw.x;
    let snapY = raw.y;
    let dx = threshold;
    let dy = threshold;
    for (const x of verticalGuides) { const next = Math.abs(x - raw.x); if (next < dx) { dx = next; snapX = x; } }
    for (const y of horizontalGuides) { const next = Math.abs(y - raw.y); if (next < dy) { dy = next; snapY = y; } }
    for (const item of points) {
      const nextX = Math.abs(item.x - raw.x);
      const nextY = Math.abs(item.y - raw.y);
      if (nextX < dx) { dx = nextX; snapX = item.x; }
      if (nextY < dy) { dy = nextY; snapY = item.y; }
    }
    return dx < threshold || dy < threshold ? { x: snapX, y: snapY } : null;
  }, [project, showHelpers, zoom]);

  const addAt = useCallback((type: Tool, target: Point) => {
    if (!project) return;
    const base = { id: uid('obj'), x: target.x, y: target.y, color: COLORS.ink, fontSize: 22 };
    let object: EskizObject;
    if (type === 'module') object = { ...base, type: 'module', number: nextModuleNumber(project.objects), description: '' };
    else if (type === 'comment') object = { ...base, type: 'comment', text: 'Новый комментарий' };
    else if (type === 'equipment') object = { ...base, type: 'equipment', text: 'ПММ 600', equipmentType: 'ПММ', color: COLORS.blue };
    else object = { ...base, type: 'link', text: 'Название ссылки', url: 'https://' };
    commit((current) => ({ ...current, objects: [...current.objects, object] }));
    selectOnly(object.id);
    setTool('select');
  }, [commit, project, selectOnly]);

  const handleCommunicationStagePoint = useCallback((event: ReactPointerEvent<SVGRectElement>) => {
    if (!project) return;
    event.preventDefault();
    event.stopPropagation();
    const target = point(event);
    props.onCommunicationPoint(project.id, Math.round(target.x), Math.round(target.y));
  }, [point, project, props]);

  const onStageDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!project) return;
    if (quickEdit) {
      setProject((current) => current ? { ...current, objects: current.objects.map((object) => object.id === quickEdit.id && object.type === 'dimension' ? { ...object, value: quickEdit.value } : object) } : current);
      setQuickEdit(null);
      setSaved(false);
    }
    if (communicationMode) return;
    if (spaceDown || event.button === 1) return;
    if (pendingDimension) {
      const dimension = project.objects.find((object) => object.id === pendingDimension.id);
      if (dimension?.type === 'dimension') setQuickEdit({ id: dimension.id, value: dimension.value, left: event.clientX, top: event.clientY, repeatTool: pendingDimension.sourceTool });
      setPendingDimension(null);
      setTool('select');
      setSnapIndicator(null);
      return;
    }
    const element = event.target as Element;
    if (event.target !== event.currentTarget && element.tagName !== 'image') return;
    let target = point(event);
    if (!event.altKey && ['free-dimension', 'h-dimension', 'v-dimension', 'chain', 'callout'].includes(tool)) {
      const snapped = nearestSnap(target);
      if (snapped) { target = snapped; setSnapIndicator(snapped); }
    }
    if (tool === 'select') {
      selectOnly(null);
      dragRef.current = { mode: 'marquee', start: target, before: project };
      setSelectionBox({ start: target, end: target });
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool === 'anchor' || tool === 'h-guide' || tool === 'v-guide') {
      const base = { id: uid('obj'), x: target.x, y: target.y, color: '#2563eb', fontSize: 18 };
      const helper: EskizObject = tool === 'anchor' ? { ...base, type: 'anchor', label: `Т${project.objects.filter((object) => object.type === 'anchor').length + 1}` } : { ...base, type: 'guide', orientation: tool === 'h-guide' ? 'horizontal' : 'vertical' };
      commit((current) => ({ ...current, objects: [...current.objects, helper] }));
      selectOnly(helper.id);
      setTool('select');
      return;
    }
    if (['module', 'comment', 'equipment', 'link'].includes(tool)) { addAt(tool, target); return; }
    if (tool === 'chain') {
      if (!chainLast) { setChainLast(target); setChainAxis(null); setChainSessionId(uid('chain')); return; }
      const axis = chainAxis ?? (Math.abs(target.x - chainLast.x) >= Math.abs(target.y - chainLast.y) ? 'horizontal' : 'vertical');
      const horizontal = axis === 'horizontal';
      const end = horizontal ? { x: target.x, y: chainLast.y } : { x: chainLast.x, y: target.y };
      const object: EskizObject = { id: uid('obj'), type: 'dimension', orientation: axis, textOrientation: 'parallel', textPosition: 'center', offset: -38, chainId: chainSessionId ?? uid('chain'), x: chainLast.x, y: chainLast.y, x2: end.x, y2: end.y, value: '600', showUnit: true, color: COLORS.ink, fontSize: 22, lineWidth: 2 };
      commit((current) => ({ ...current, objects: [...current.objects, object] }));
      selectOnly(object.id);
      setChainAxis(axis);
      setChainLast(end);
      setQuickEdit({ id: object.id, value: object.value, left: event.clientX, top: event.clientY, repeatTool: 'chain' });
      return;
    }
    dragRef.current = { mode: 'create', start: target, before: project };
    setDraftLine({ start: target, end: target, callout: tool === 'callout' });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onStageMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!project || communicationMode) return;
    const drag = dragRef.current;
    if (!drag && pendingDimension) {
      const target = point(event);
      setProject((current) => current ? { ...current, objects: current.objects.map((object) => object.id === pendingDimension.id && object.type === 'dimension' ? { ...object, offset: dimensionOffset(object, target) } : object) } : current);
      return;
    }
    if (!drag) return;
    let target = point(event);
    if (drag.mode === 'marquee') { setSelectionBox({ start: drag.start, end: target }); return; }
    if (drag.mode === 'create') {
      const snapped = !event.altKey ? nearestSnap(target) : null;
      if (snapped) { target = snapped; setSnapIndicator(snapped); } else setSnapIndicator(null);
      if (tool === 'free-dimension' && event.shiftKey) target = snapAngle(drag.start, target);
      if (tool === 'h-dimension') target.y = drag.start.y;
      if (tool === 'v-dimension') target.x = drag.start.x;
      setDraftLine({ start: drag.start, end: target, callout: tool === 'callout' });
      return;
    }
    if (drag.mode === 'handle' && drag.end !== 'offset' && drag.end !== 'resize') {
      const snapped = !event.altKey ? nearestSnap(target, drag.id) : null;
      if (snapped) { target = snapped; setSnapIndicator(snapped); } else setSnapIndicator(null);
    }
    if (drag.mode === 'handle' && drag.end !== 'offset' && drag.end !== 'resize' && drag.original?.type === 'dimension' && drag.original.orientation === 'free' && event.shiftKey) {
      const anchor = drag.end === 'start' ? { x: drag.original.x2, y: drag.original.y2 } : { x: drag.original.x, y: drag.original.y };
      target = snapAngle(anchor, target);
    }
    const dx = target.x - drag.start.x;
    const dy = target.y - drag.start.y;
    setProject((current) => current ? { ...current, objects: current.objects.map((object) => {
      if (drag.mode === 'move' && drag.id && selectedIds.includes(drag.id) && selectedIds.includes(object.id)) {
        const source = drag.before.objects.find((item) => item.id === object.id);
        if (!source || source.locked) return object;
        const moved = { ...source, x: source.x + dx, y: source.y + dy } as EskizObject;
        if (moved.type === 'dimension') { moved.x2 += dx; moved.y2 += dy; }
        if (moved.type === 'callout') { moved.targetX += dx; moved.targetY += dy; }
        return moved;
      }
      if (drag.mode === 'handle' && drag.end === 'offset' && drag.original?.type === 'dimension' && drag.original.chainId && object.type === 'dimension' && object.chainId === drag.original.chainId) return { ...object, offset: dimensionOffset(drag.original, target) };
      if (object.id !== drag.id || !drag.original) return object;
      const original = drag.original;
      if (drag.mode === 'handle') {
        if (drag.end === 'resize' && original.type !== 'dimension') return { ...original, width: Math.max(60, target.x - original.x), height: Math.max(36, target.y - original.y) };
        if (original.type === 'dimension') {
          if (drag.end === 'offset') return { ...original, offset: dimensionOffset(original, target) };
          return drag.end === 'start'
            ? { ...original, x: original.orientation === 'vertical' ? original.x : target.x, y: original.orientation === 'horizontal' ? original.y : target.y }
            : { ...original, x2: original.orientation === 'vertical' ? original.x2 : target.x, y2: original.orientation === 'horizontal' ? original.y2 : target.y };
        }
        if (original.type === 'callout') return { ...original, targetX: target.x, targetY: target.y };
      }
      const moved = { ...original, x: original.x + dx, y: original.y + dy } as EskizObject;
      if (moved.type === 'dimension') { moved.x2 += dx; moved.y2 += dy; }
      if (moved.type === 'callout') { moved.targetX += dx; moved.targetY += dy; }
      return moved;
    }) } : current);
  };

  const onStageUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!project || communicationMode) return;
    const drag = dragRef.current;
    if (!drag) return;
    let target = point(event);
    if (drag.mode === 'marquee') {
      const left = Math.min(drag.start.x, target.x);
      const right = Math.max(drag.start.x, target.x);
      const top = Math.min(drag.start.y, target.y);
      const bottom = Math.max(drag.start.y, target.y);
      const ids = project.objects.filter((object) => !object.hidden && ((object.x >= left && object.x <= right && object.y >= top && object.y <= bottom) || (object.type === 'dimension' && object.x2 >= left && object.x2 <= right && object.y2 >= top && object.y2 <= bottom))).map((object) => object.id);
      setSelectedIds(ids);
      setSelected(ids.at(-1) ?? null);
      setSelectionBox(null);
      dragRef.current = null;
      return;
    }
    if (drag.mode === 'create') {
      const horizontal = tool === 'h-dimension';
      const vertical = tool === 'v-dimension';
      const isFree = tool === 'free-dimension';
      const isCallout = tool === 'callout';
      const snapped = !event.altKey ? nearestSnap(target) : null;
      if (snapped) target = snapped;
      if (isFree && event.shiftKey) target = snapAngle(drag.start, target);
      const distance = pointDistance(target, drag.start);
      if (distance > 8) {
        let object: EskizObject;
        if (isCallout) object = { id: uid('obj'), type: 'callout', targetX: drag.start.x, targetY: drag.start.y, x: target.x, y: target.y, text: 'Текст выноски', color: COLORS.ink, fontSize: 22 };
        else object = { id: uid('obj'), type: 'dimension', orientation: isFree ? 'free' : horizontal ? 'horizontal' : 'vertical', textOrientation: 'parallel', textPosition: 'center', showUnit: true, offset: -38, x: drag.start.x, y: drag.start.y, x2: vertical ? drag.start.x : target.x, y2: horizontal ? drag.start.y : target.y, value: '600', color: COLORS.ink, fontSize: 22, lineWidth: 2 };
        past.current.push(drag.before);
        future.current = [];
        setProject((current) => current ? { ...current, objects: [...current.objects, object] } : current);
        selectOnly(object.id);
        setSaved(false);
        if (object.type === 'dimension') setPendingDimension({ id: object.id, sourceTool: tool });
        else setTool('select');
      }
    } else {
      past.current.push(drag.before);
      future.current = [];
      setSaved(false);
    }
    dragRef.current = null;
    setDraftLine(null);
    setSnapIndicator(null);
  };

  const objectDown = (event: ReactPointerEvent<SVGGElement>, object: EskizObject) => {
    if (!project || communicationMode) return;
    event.stopPropagation();
    if (tool !== 'select') return;
    if (event.shiftKey) {
      const next = selectedIds.includes(object.id) ? selectedIds.filter((id) => id !== object.id) : [...selectedIds, object.id];
      setSelectedIds(next);
      setSelected(next.at(-1) ?? null);
      return;
    }
    if (!selectedIds.includes(object.id)) selectOnly(object.id);
    if (object.locked) return;
    const target = point(event);
    dragRef.current = { mode: 'move', start: target, id: object.id, before: project, original: object };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const handleDown = (event: ReactPointerEvent<SVGCircleElement>, end: 'start' | 'end' | 'offset' | 'resize') => {
    if (!chosen || chosen.locked || communicationMode) return;
    event.stopPropagation();
    if (!project) return;
    dragRef.current = { mode: 'handle', start: point(event), id: chosen.id, before: project, original: chosen, end };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const fit = useCallback(() => {
    const current = project;
    const viewport = viewportRef.current;
    if (!current || !viewport) return;
    setZoom(Math.min((viewport.clientWidth - 90) / current.image.width, (viewport.clientHeight - 90) / current.image.height, 1.2));
  }, [project]);

  useEffect(() => {
    const timer = window.setTimeout(fit, 50);
    return () => window.clearTimeout(timer);
  }, [fit, project?.id]);

  const setActiveTool = (id: Tool) => {
    setTool(id);
    if (id !== 'select') setLastDrawingTool(id);
    setPendingDimension(null);
    if (id !== 'chain') { setChainLast(null); setChainAxis(null); setChainSessionId(null); }
  };

  const selectChain = (chainId: string) => {
    if (!project) return;
    const ids = project.objects.filter((object) => object.type === 'dimension' && object.chainId === chainId).map((object) => object.id);
    setSelectedIds(ids);
    setSelected(ids.at(-1) ?? null);
  };

  const titleUpdate = (title: string) => {
    setProject((current) => current ? { ...current, title } : current);
    setSaved(false);
  };

  const alignSelection = (mode: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom') => {
    if (!project) return;
    const items = project.objects.filter((object) => selectedIds.includes(object.id) && !object.locked);
    if (items.length < 2) return;
    const bounds = items.map((object) => ({ object, left: object.type === 'dimension' ? Math.min(object.x, object.x2) : object.x, right: object.type === 'dimension' ? Math.max(object.x, object.x2) : object.x + (object.width ?? 100), top: object.type === 'dimension' ? Math.min(object.y, object.y2) : object.y, bottom: object.type === 'dimension' ? Math.max(object.y, object.y2) : object.y + (object.height ?? 50) }));
    const target = mode === 'left' ? Math.min(...bounds.map((bound) => bound.left)) : mode === 'right' ? Math.max(...bounds.map((bound) => bound.right)) : mode === 'top' ? Math.min(...bounds.map((bound) => bound.top)) : mode === 'bottom' ? Math.max(...bounds.map((bound) => bound.bottom)) : mode === 'centerX' ? bounds.reduce((sum, bound) => sum + (bound.left + bound.right) / 2, 0) / bounds.length : bounds.reduce((sum, bound) => sum + (bound.top + bound.bottom) / 2, 0) / bounds.length;
    commit((current) => ({ ...current, objects: current.objects.map((object) => {
      const bound = bounds.find((item) => item.object.id === object.id);
      if (!bound) return object;
      const currentValue = mode === 'left' ? bound.left : mode === 'right' ? bound.right : mode === 'top' ? bound.top : mode === 'bottom' ? bound.bottom : mode === 'centerX' ? (bound.left + bound.right) / 2 : (bound.top + bound.bottom) / 2;
      const dx = ['left', 'centerX', 'right'].includes(mode) ? target - currentValue : 0;
      const dy = ['top', 'centerY', 'bottom'].includes(mode) ? target - currentValue : 0;
      const moved = { ...object, x: object.x + dx, y: object.y + dy } as EskizObject;
      if (moved.type === 'dimension') { moved.x2 += dx; moved.y2 += dy; }
      if (moved.type === 'callout') { moved.targetX += dx; moved.targetY += dy; }
      return moved;
    }) }));
  };

  const finishQuickEdit = (repeat = false) => {
    if (!quickEdit) return;
    setProject((current) => current ? { ...current, objects: current.objects.map((object) => object.id === quickEdit.id && object.type === 'dimension' ? { ...object, value: quickEdit.value } : object) } : current);
    setSaved(false);
    if (repeat && quickEdit.repeatTool !== 'chain') setTool(quickEdit.repeatTool);
    setQuickEdit(null);
  };

  const openImage = async (file?: File) => {
    if (!file) return;
    setError('');
    try {
      const next = createEskizProject(await readImage(file), props.calculatorProjectName, props.calculatorProjectClient);
      setProject(next);
      props.onProjectChange(next);
      setSaved(true);
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : 'Не удалось загрузить скрин');
    }
  };

  const importProject = async (file?: File) => {
    if (!file) return;
    setError('');
    try {
      const imported = await readEskizFile(file);
      setProject(imported);
      props.onProjectChange(imported);
      setSaved(true);
    } catch (errorValue) {
      setError(errorValue instanceof Error ? errorValue.message : 'Не удалось импортировать .eskiz');
    }
  };

  const onFileInput = (handler: (file?: File) => void) => (event: ChangeEvent<HTMLInputElement>) => {
    handler(event.target.files?.[0]);
    event.target.value = '';
  };

  if (!project) {
    return <div className="embedded-eskiz-start">
      <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onFileInput((file) => void openImage(file))} />
      <input ref={projectInputRef} type="file" accept=".eskiz,application/json" hidden onChange={onFileInput((file) => void importProject(file))} />
      <div>
        <span className="eyebrow">Встроенный Эскиз PRO</span>
        <h3>Загрузите скрин проекта — эскиз будет храниться прямо в расчёте</h3>
        <p className="muted small">Это код Эскиз PRO внутри калькулятора: размеры, модули и коммуникации ставятся на одном основном полотне без iframe и без отдельного маленького превью.</p>
      </div>
      <div className="embedded-eskiz-start-actions">
        <button className="btn primary" onClick={() => imageInputRef.current?.click()}>Загрузить скрин JPG/PNG/WEBP</button>
        <button className="btn ghost" onClick={() => projectInputRef.current?.click()}>Импорт .eskiz</button>
      </div>
      {error && <div className="note small">{error}</div>}
    </div>;
  }

  const visibleObjects = project.objects.filter((object) => !object.hidden && (showHelpers || (object.type !== 'anchor' && object.type !== 'guide')));

  return <div className={`embedded-eskiz-editor ${communicationMode ? 'communication-mode' : ''}`}>
    <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onFileInput((file) => void openImage(file))} />
    <input ref={projectInputRef} type="file" accept=".eskiz,application/json" hidden onChange={onFileInput((file) => void importProject(file))} />
    <header className="embedded-eskiz-header">
      <div className="embedded-eskiz-title"><b>Эскиз PRO</b><input value={project.title} onChange={(event) => titleUpdate(event.target.value)} /><span className={saved ? 'ok' : ''}>{saved ? 'сохранено в расчёт' : 'сохраняем…'}</span></div>
      <div className="embedded-eskiz-actions">
        <button className="btn tiny ghost" onClick={undo}>↶</button>
        <button className="btn tiny ghost" onClick={redo}>↷</button>
        <button className="btn tiny ghost" onClick={() => imageInputRef.current?.click()}>Новый скрин</button>
        <button className="btn tiny ghost" onClick={() => projectInputRef.current?.click()}>Импорт .eskiz</button>
        <button className="btn tiny primary" onClick={saveNow}>Сохранить</button>
      </div>
    </header>
    <nav className="embedded-eskiz-tools">
      {TOOL_ITEMS.map((item) => <button key={item.id} className={tool === item.id ? 'active' : ''} disabled={communicationMode} title={item.hotkey ? `${item.label} (${item.hotkey})` : item.label} onClick={() => setActiveTool(item.id)}><span>{item.label}</span>{item.hotkey && <kbd>{item.hotkey}</kbd>}</button>)}
      <button className={sidebarOpen ? 'active side-toggle' : 'side-toggle'} onClick={() => setSidebarOpen((value) => !value)}>Свойства</button>
    </nav>
    {communicationMode && <div className="embedded-eskiz-communication-banner">{props.communicationAddKind ? `Режим добавления: ${COMMUNICATION_KIND_META[props.communicationAddKind].label}. Тапните по основному эскизу.` : 'Выберите точку расстояния на основном эскизе.'}</div>}
    <div className="embedded-eskiz-workarea">
      <section
        ref={viewportRef}
        className={`embedded-eskiz-viewport ${spaceDown ? 'panning' : ''}`}
        onPointerDown={(event) => {
          if (!spaceDown && event.button !== 1) return;
          const viewport = viewportRef.current;
          if (!viewport) return;
          panRef.current = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
          viewport.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const pan = panRef.current;
          const viewport = viewportRef.current;
          if (!pan || !viewport) return;
          viewport.scrollLeft = pan.left - (event.clientX - pan.x);
          viewport.scrollTop = pan.top - (event.clientY - pan.y);
        }}
        onPointerUp={() => { panRef.current = null; }}
      >
        {project.header.enabled && <div className="embedded-eskiz-canvas-header" style={{ width: project.image.width * zoom }}><strong>РЕцепт <i>/</i> Эскиз PRO</strong><span>Проект: {project.header.project || '—'}</span><small>Помещение: {project.header.room || '—'} · Дата: {project.header.date} · Вариант: {project.header.variant}</small></div>}
        <div className="embedded-eskiz-stage" style={{ width: project.image.width * zoom, height: project.image.height * zoom }}>
          <svg ref={svgRef} viewBox={`0 0 ${project.image.width} ${project.image.height}`} width="100%" height="100%" className={`embedded-eskiz-surface tool-${tool}`} onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp}>
            <defs>
              <marker id="embeddedDimArrow" markerWidth="9" markerHeight="9" refX="4.5" refY="4.5" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M 8 1 L 1 4.5 L 8 8" fill="none" stroke="context-stroke" strokeWidth="1.5" /></marker>
              <marker id="embeddedDimArrowClosed" markerWidth="9" markerHeight="9" refX="4.5" refY="4.5" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M 8 1 L 1 4.5 L 8 8 Z" fill="context-stroke" /></marker>
            </defs>
            {showImage && <image href={project.image.dataUrl} x="0" y="0" width={project.image.width} height={project.image.height} preserveAspectRatio="none" pointerEvents="none" style={{ opacity: project.imageDisplay?.opacity ?? 1, filter: `brightness(${project.imageDisplay?.brightness ?? 1}) contrast(${project.imageDisplay?.contrast ?? 1}) saturate(${project.imageDisplay?.saturation ?? 1}) grayscale(${project.imageDisplay?.grayscale ? 1 : 0})` }} />}
            {showAnnotations && visibleObjects.map((object) => <EmbeddedObjectView key={object.id} object={object} selected={selectedIds.includes(object.id)} primary={object.id === selected} onPointerDown={objectDown} onHandleDown={handleDown} />)}
            <CommunicationLayer project={project} communications={props.communications} activeCommunicationId={props.activeCommunicationId} onCommunicationClick={props.onCommunicationClick} />
            {selectionBox && <rect pointerEvents="none" x={Math.min(selectionBox.start.x, selectionBox.end.x)} y={Math.min(selectionBox.start.y, selectionBox.end.y)} width={Math.abs(selectionBox.end.x - selectionBox.start.x)} height={Math.abs(selectionBox.end.y - selectionBox.start.y)} fill="#2563eb" fillOpacity=".1" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="7 5" />}
            {draftLine && <g pointerEvents="none" opacity=".9"><line x1={draftLine.start.x} y1={draftLine.start.y} x2={draftLine.end.x} y2={draftLine.end.y} stroke={COLORS.accent} strokeWidth="3" strokeDasharray="10 7" /><circle cx={draftLine.start.x} cy={draftLine.start.y} r="6" fill={COLORS.accent} /><circle cx={draftLine.end.x} cy={draftLine.end.y} r="6" fill={COLORS.accent} /></g>}
            {tool === 'chain' && chainLast && <g pointerEvents="none"><circle cx={chainLast.x} cy={chainLast.y} r="8" fill={COLORS.accent} /><circle cx={chainLast.x} cy={chainLast.y} r="16" fill="none" stroke={COLORS.accent} opacity=".35" /></g>}
            {snapIndicator && <g pointerEvents="none" className="embedded-eskiz-snap-marker"><circle cx={snapIndicator.x} cy={snapIndicator.y} r="11" fill="none" stroke={COLORS.blue} strokeWidth="2" /><path d={`M ${snapIndicator.x - 15} ${snapIndicator.y} H ${snapIndicator.x + 15} M ${snapIndicator.x} ${snapIndicator.y - 15} V ${snapIndicator.y + 15}`} stroke={COLORS.blue} strokeWidth="1" /></g>}
            {communicationMode && <rect className="embedded-eskiz-communication-catcher" x="0" y="0" width={project.image.width} height={project.image.height} fill="transparent" pointerEvents="all" onPointerDown={handleCommunicationStagePoint} />}
          </svg>
        </div>
        {pendingDimension ? <div className="embedded-eskiz-hint"><b>Шаг 3 из 3</b> Отведите размерную линию и кликните для фиксации</div> : tool === 'chain' && <div className="embedded-eskiz-hint"><b>Цепочка</b> Укажите следующую точку · Esc — закончить</div>}
      </section>
      {quickEdit && <div className="embedded-eskiz-quick" style={{ left: Math.min(quickEdit.left + 14, window.innerWidth - 210), top: Math.min(quickEdit.top + 14, window.innerHeight - 105) }}><span>Размер</span><div><input autoFocus inputMode="decimal" value={quickEdit.value} onChange={(event) => setQuickEdit({ ...quickEdit, value: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); finishQuickEdit(false); } if (event.key === 'Tab') { event.preventDefault(); finishQuickEdit(true); } if (event.key === 'Escape') { event.preventDefault(); setQuickEdit(null); } }} /><b>мм</b></div><small>Enter — готово · Tab — следующий</small></div>}
      {sidebarOpen && <Inspector project={project} object={chosen} selectedIds={selectedIds} onSelect={selectOnly} onSelectChain={selectChain} onAlign={alignSelection} showImage={showImage} showAnnotations={showAnnotations} showHelpers={showHelpers} onShowImage={setShowImage} onShowAnnotations={setShowAnnotations} onShowHelpers={setShowHelpers} onProject={(patch) => commit((current) => ({ ...current, ...patch }))} onObject={(patch) => chosen && changeObject(chosen.id, patch)} onPatchObject={changeObject} onDelete={deleteSelected} onDuplicate={duplicate} />}
    </div>
    <footer className="embedded-eskiz-status"><span><span className="status-dot" /> {project.image.name} · {project.image.width} × {project.image.height}px</span><span>Стрелки — точный сдвиг · Shift — привязка угла · Пробел — перемещение</span><div><button onClick={() => setZoom((value) => Math.max(.1, value - .1))}>−</button><button onClick={fit}>{Math.round(zoom * 100)}%</button><button onClick={() => setZoom((value) => Math.min(3, value + .1))}>+</button></div></footer>
  </div>;
}

function Inspector(props: {
  project: EskizProject;
  object?: EskizObject;
  selectedIds: string[];
  onSelect: (id: string | null) => void;
  onSelectChain: (chainId: string) => void;
  onAlign: (mode: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom') => void;
  showImage: boolean;
  showAnnotations: boolean;
  showHelpers: boolean;
  onShowImage: (value: boolean) => void;
  onShowAnnotations: (value: boolean) => void;
  onShowHelpers: (value: boolean) => void;
  onProject: (patch: Partial<EskizProject>) => void;
  onObject: (patch: Partial<EskizObject>) => void;
  onPatchObject: (id: string, patch: Partial<EskizObject>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const { project, object, selectedIds } = props;
  const [tab, setTab] = useState<'object' | 'objects' | 'document'>(object ? 'object' : 'document');
  const activeTab = object && tab === 'document' ? 'object' : tab;
  const reorder = (index: number, delta: number) => {
    const next = [...project.objects];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    props.onProject({ objects: next });
  };
  return <aside className="embedded-eskiz-inspector">
    <div className="embedded-eskiz-tabs"><button className={activeTab === 'object' ? 'active' : ''} onClick={() => setTab('object')}>Объект</button><button className={activeTab === 'objects' ? 'active' : ''} onClick={() => setTab('objects')}>Список</button><button className={activeTab === 'document' ? 'active' : ''} onClick={() => setTab('document')}>Документ</button></div>
    {activeTab === 'object' ? selectedIds.length > 1 ? <div className="embedded-eskiz-fields"><div className="embedded-eskiz-fields-heading"><span>Выбрано объектов: {selectedIds.length}</span></div><div className="embedded-eskiz-section-label">Выравнивание</div><div className="embedded-eskiz-align-grid"><button onClick={() => props.onAlign('left')}>По левому</button><button onClick={() => props.onAlign('centerX')}>Центр X</button><button onClick={() => props.onAlign('right')}>По правому</button><button onClick={() => props.onAlign('top')}>По верху</button><button onClick={() => props.onAlign('centerY')}>Центр Y</button><button onClick={() => props.onAlign('bottom')}>По низу</button></div></div> : object ? <ObjectFields object={object} onObject={props.onObject} onSelectChain={props.onSelectChain} /> : <div className="embedded-eskiz-empty"><strong>Ничего не выбрано</strong><span>Выберите объект на эскизе, чтобы изменить его параметры.</span></div> : activeTab === 'objects' ? <div className="embedded-eskiz-object-list">{project.objects.map((item, index) => <div key={item.id} className={selectedIds.includes(item.id) ? 'active' : ''}><button className="embedded-eskiz-object-list-main" onClick={() => props.onSelect(item.id)}><b>{objectListLabel(item)}</b><span>{index + 1} · {item.type}</span></button><button title="Выше" onClick={() => reorder(index, -1)}>↑</button><button title="Ниже" onClick={() => reorder(index, 1)}>↓</button><button title={item.hidden ? 'Показать' : 'Скрыть'} onClick={() => props.onPatchObject(item.id, { hidden: !item.hidden })}>{item.hidden ? '○' : '◉'}</button><button title={item.locked ? 'Разблокировать' : 'Заблокировать'} onClick={() => props.onPatchObject(item.id, { locked: !item.locked })}>{item.locked ? '🔒' : '🔓'}</button></div>)}</div> : <DocumentFields project={project} showImage={props.showImage} showAnnotations={props.showAnnotations} showHelpers={props.showHelpers} onShowImage={props.onShowImage} onShowAnnotations={props.onShowAnnotations} onShowHelpers={props.onShowHelpers} onProject={props.onProject} />}
    {activeTab === 'object' && selectedIds.length > 0 && <div className="embedded-eskiz-inspector-bottom"><button onClick={props.onDuplicate}>Дублировать</button><button className="danger" onClick={props.onDelete}>Удалить</button></div>}
  </aside>;
}

function ObjectFields({ object, onObject, onSelectChain }: { object: EskizObject; onObject: (patch: Partial<EskizObject>) => void; onSelectChain: (chainId: string) => void }) {
  const hasFrame = ['module', 'callout', 'comment', 'equipment', 'link'].includes(object.type);
  const title = object.type === 'dimension' ? 'Размерная линия' : object.type === 'module' ? 'Модуль' : object.type === 'callout' ? 'Выноска' : object.type === 'equipment' ? 'Техника' : object.type === 'link' ? 'Ссылка' : object.type === 'anchor' ? 'Опорная точка' : object.type === 'guide' ? 'Направляющая' : 'Комментарий';
  return <div className="embedded-eskiz-fields"><div className="embedded-eskiz-fields-heading"><span>{title}</span><small>#{object.id.slice(0, 5)}</small></div>
    {object.type !== 'anchor' && object.type !== 'guide' && <><div className="embedded-eskiz-section-label">Быстрый стиль</div><div className="embedded-eskiz-preset-row"><button onClick={() => onObject(object.type === 'dimension' ? { color: '#20242b', fontSize: 22, lineWidth: 2 } as Partial<EskizObject> : { color: '#20242b', fill: '#ffffff', fillOpacity: 1, borderRadius: 6 } as Partial<EskizObject>)}>Чертёж</button><button onClick={() => onObject(object.type === 'dimension' ? { color: '#ff5c35', fontSize: 24, lineWidth: 3 } as Partial<EskizObject> : { color: '#c83c18', fill: '#fff0eb', fillOpacity: .95, borderRadius: 8 } as Partial<EskizObject>)}>Акцент</button><button onClick={() => onObject(object.type === 'dimension' ? { color: '#2563eb', fontSize: 22, lineWidth: 2 } as Partial<EskizObject> : { color: '#35568d', fill: '#f1f5ff', fillOpacity: .92, borderRadius: 4 } as Partial<EskizObject>)}>Монтаж</button></div></>}
    {object.type === 'dimension' && <DimensionFields object={object} onObject={onObject} onSelectChain={onSelectChain} />}
    {object.type === 'anchor' && <label>Название точки<input autoFocus value={object.label} onChange={(event) => onObject({ label: event.target.value } as Partial<EskizObject>)} /></label>}
    {object.type === 'guide' && <label>Ориентация<select value={object.orientation} onChange={(event) => onObject({ orientation: event.target.value } as Partial<EskizObject>)}><option value="horizontal">Горизонтальная</option><option value="vertical">Вертикальная</option></select></label>}
    {object.type === 'module' && <><label>Номер модуля<input autoFocus value={object.number} onChange={(event) => onObject({ number: event.target.value } as Partial<EskizObject>)} /></label><label>Описание<textarea rows={4} placeholder={'600\nНиз'} value={object.description} onChange={(event) => onObject({ description: event.target.value } as Partial<EskizObject>)} /></label></>}
    {(object.type === 'comment' || object.type === 'callout') && <label>Текст<textarea autoFocus rows={5} value={object.text} onChange={(event) => onObject({ text: event.target.value } as Partial<EskizObject>)} /></label>}
    {object.type === 'equipment' && <><label>Тип техники<select value={object.equipmentType} onChange={(event) => onObject({ equipmentType: event.target.value, text: event.target.value } as Partial<EskizObject>)}>{EQUIPMENT_TYPES.map((item) => <option key={item}>{item}</option>)}</select></label><label>Подпись<input autoFocus value={object.text} onChange={(event) => onObject({ text: event.target.value } as Partial<EskizObject>)} /></label><label>Ссылка на модель<input type="url" placeholder="https://…" value={object.url || ''} onChange={(event) => onObject({ url: event.target.value } as Partial<EskizObject>)} /></label></>}
    {object.type === 'link' && <><label>Название<input autoFocus value={object.text} onChange={(event) => onObject({ text: event.target.value } as Partial<EskizObject>)} /></label><label>URL<input type="url" placeholder="https://…" value={object.url || ''} onChange={(event) => onObject({ url: event.target.value } as Partial<EskizObject>)} /></label>{object.url && <a className="embedded-eskiz-test-link" href={object.url} target="_blank" rel="noreferrer">Открыть ссылку ↗</a>}</>}
    {hasFrame && <><div className="embedded-eskiz-section-label">Оформление рамки</div><div className="embedded-eskiz-field-row"><label>Заливка<input className="embedded-eskiz-color-input" type="color" value={object.fill ?? (object.type === 'comment' ? '#fff8d8' : '#ffffff')} onChange={(event) => onObject({ fill: event.target.value } as Partial<EskizObject>)} /></label><label>Скругление<input type="number" min="0" max="40" value={object.borderRadius ?? 7} onChange={(event) => onObject({ borderRadius: +event.target.value } as Partial<EskizObject>)} /></label></div><label>Прозрачность заливки<div className="embedded-eskiz-range-row"><input type="range" min="0" max="1" step=".05" value={object.fillOpacity ?? 1} onChange={(event) => onObject({ fillOpacity: +event.target.value } as Partial<EskizObject>)} /><span>{Math.round((object.fillOpacity ?? 1) * 100)}%</span></div></label></>}
    <label className="embedded-eskiz-toggle-row">Заблокировать объект<input type="checkbox" checked={Boolean(object.locked)} onChange={(event) => onObject({ locked: event.target.checked } as Partial<EskizObject>)} /><i /></label>
    <div className="embedded-eskiz-section-label">Положение</div><div className="embedded-eskiz-field-row"><label>X<input type="number" value={Math.round(object.x)} onChange={(event) => onObject({ x: +event.target.value } as Partial<EskizObject>)} /></label><label>Y<input type="number" value={Math.round(object.y)} onChange={(event) => onObject({ y: +event.target.value } as Partial<EskizObject>)} /></label></div>
    {hasFrame && <><div className="embedded-eskiz-section-label embedded-eskiz-section-label-action"><span>Размер рамки</span><button onClick={() => onObject({ width: undefined, height: undefined } as Partial<EskizObject>)}>По тексту</button></div><div className="embedded-eskiz-field-row"><label>Ширина<input type="number" min="60" placeholder="Авто" value={object.width ? Math.round(object.width) : ''} onChange={(event) => onObject({ width: event.target.value ? +event.target.value : undefined } as Partial<EskizObject>)} /></label><label>Высота<input type="number" min="36" placeholder="Авто" value={object.height ? Math.round(object.height) : ''} onChange={(event) => onObject({ height: event.target.value ? +event.target.value : undefined } as Partial<EskizObject>)} /></label></div></>}
    {object.type === 'dimension' && <div className="embedded-eskiz-field-row"><label>Конец X<input type="number" value={Math.round(object.x2)} onChange={(event) => onObject({ x2: +event.target.value } as Partial<EskizObject>)} /></label><label>Конец Y<input type="number" value={Math.round(object.y2)} onChange={(event) => onObject({ y2: +event.target.value } as Partial<EskizObject>)} /></label></div>}
    <div className="embedded-eskiz-field-row"><label>Цвет<input className="embedded-eskiz-color-input" type="color" value={object.color} onChange={(event) => onObject({ color: event.target.value } as Partial<EskizObject>)} /></label><label>Размер текста<input type="number" min="12" max="64" value={object.fontSize} onChange={(event) => onObject({ fontSize: +event.target.value } as Partial<EskizObject>)} /></label></div>
  </div>;
}

function DimensionFields({ object, onObject, onSelectChain }: { object: EskizDimensionObject; onObject: (patch: Partial<EskizObject>) => void; onSelectChain: (chainId: string) => void }) {
  return <><label>Значение<input value={object.value} onChange={(event) => onObject({ value: event.target.value } as Partial<EskizObject>)} /></label><div className="embedded-eskiz-field-row"><label>Префикс<input placeholder="≈" value={object.prefix ?? ''} onChange={(event) => onObject({ prefix: event.target.value } as Partial<EskizObject>)} /></label><label>Допуск ±<input placeholder="2" value={object.tolerance ?? ''} onChange={(event) => onObject({ tolerance: event.target.value } as Partial<EskizObject>)} /></label></div><label>Примечание после размера<input placeholder="по факту" value={object.suffix ?? ''} onChange={(event) => onObject({ suffix: event.target.value } as Partial<EskizObject>)} /></label><label className="embedded-eskiz-toggle-row">Показывать единицы «мм»<input type="checkbox" checked={object.showUnit !== false} onChange={(event) => onObject({ showUnit: event.target.checked } as Partial<EskizObject>)} /><i /></label>{object.chainId && <div className="embedded-eskiz-chain-badge"><span>Сегмент цепочки</span><button onClick={() => onSelectChain(object.chainId!)}>Выделить цепочку</button></div>}<label>Ориентация<select value={object.orientation} onChange={(event) => { const orientation = event.target.value; onObject({ orientation, ...(orientation === 'horizontal' ? { y2: object.y } : orientation === 'vertical' ? { x2: object.x } : {}) } as Partial<EskizObject>); }}><option value="free">Свободная</option><option value="horizontal">Горизонтальная</option><option value="vertical">Вертикальная</option></select></label><label>Положение текста<select value={object.textOrientation ?? 'parallel'} onChange={(event) => onObject({ textOrientation: event.target.value } as Partial<EskizObject>)}><option value="parallel">Параллельно линии</option><option value="horizontal">Всегда горизонтально</option></select></label><label>Текст относительно линии<select value={object.textPosition ?? 'center'} onChange={(event) => onObject({ textPosition: event.target.value } as Partial<EskizObject>)}><option value="center">На линии</option><option value="above">Над линией</option><option value="below">Под линией</option></select></label><label>Отступ размерной линии, px<input type="number" value={Math.round(object.offset ?? 0)} onChange={(event) => onObject({ offset: +event.target.value } as Partial<EskizObject>)} /></label><label>Наконечники<select value={object.arrowStyle ?? 'open'} onChange={(event) => onObject({ arrowStyle: event.target.value } as Partial<EskizObject>)}><option value="open">Открытые стрелки</option><option value="closed">Закрытые стрелки</option><option value="tick">Засечки</option></select></label><label>Толщина линии<div className="embedded-eskiz-range-row"><input type="range" min="1" max="6" step=".5" value={object.lineWidth} onChange={(event) => onObject({ lineWidth: +event.target.value } as Partial<EskizObject>)} /><span>{object.lineWidth}px</span></div></label></>;
}

function DocumentFields(props: { project: EskizProject; showImage: boolean; showAnnotations: boolean; showHelpers: boolean; onShowImage: (value: boolean) => void; onShowAnnotations: (value: boolean) => void; onShowHelpers: (value: boolean) => void; onProject: (patch: Partial<EskizProject>) => void }) {
  const header = props.project.header;
  const display = props.project.imageDisplay ?? { opacity: 1, brightness: 1, contrast: 1, saturation: 1, grayscale: false };
  const helperCount = props.project.objects.filter((object) => object.type === 'anchor' || object.type === 'guide').length;
  const updateHeader = (patch: Partial<typeof header>) => props.onProject({ header: { ...header, ...patch } });
  const updateDisplay = (patch: Partial<typeof display>) => props.onProject({ imageDisplay: { ...display, ...patch } });
  return <div className="embedded-eskiz-fields"><div className="embedded-eskiz-fields-heading"><span>Документ</span></div><div className="embedded-eskiz-section-label">Слои</div><label className="embedded-eskiz-toggle-row">Изображение<input type="checkbox" checked={props.showImage} onChange={(event) => props.onShowImage(event.target.checked)} /><i /></label><label className="embedded-eskiz-toggle-row">Аннотации <small>{props.project.objects.length - helperCount}</small><input type="checkbox" checked={props.showAnnotations} onChange={(event) => props.onShowAnnotations(event.target.checked)} /><i /></label><label className="embedded-eskiz-toggle-row">Опорные точки/направляющие <small>{helperCount}</small><input type="checkbox" checked={props.showHelpers} onChange={(event) => props.onShowHelpers(event.target.checked)} /><i /></label><div className="embedded-eskiz-section-label embedded-eskiz-section-label-action"><span>Отображение изображения</span><button onClick={() => updateDisplay({ opacity: 1, brightness: 1, contrast: 1, saturation: 1, grayscale: false })}>Сбросить</button></div><label>Прозрачность<div className="embedded-eskiz-range-row"><input type="range" min=".15" max="1" step=".05" value={display.opacity} onChange={(event) => updateDisplay({ opacity: +event.target.value })} /><span>{Math.round(display.opacity * 100)}%</span></div></label><label>Яркость<div className="embedded-eskiz-range-row"><input type="range" min=".4" max="1.6" step=".05" value={display.brightness} onChange={(event) => updateDisplay({ brightness: +event.target.value })} /><span>{Math.round(display.brightness * 100)}%</span></div></label><label>Контраст<div className="embedded-eskiz-range-row"><input type="range" min=".4" max="1.8" step=".05" value={display.contrast} onChange={(event) => updateDisplay({ contrast: +event.target.value })} /><span>{Math.round(display.contrast * 100)}%</span></div></label><label>Насыщенность<div className="embedded-eskiz-range-row"><input type="range" min="0" max="1.5" step=".05" value={display.saturation} onChange={(event) => updateDisplay({ saturation: +event.target.value })} /><span>{Math.round(display.saturation * 100)}%</span></div></label><label className="embedded-eskiz-toggle-row">Чёрно-белый фон<input type="checkbox" checked={display.grayscale} onChange={(event) => updateDisplay({ grayscale: event.target.checked })} /><i /></label><div className="embedded-eskiz-section-label">Информационная шапка</div><label className="embedded-eskiz-toggle-row">Показывать шапку<input type="checkbox" checked={header.enabled} onChange={(event) => updateHeader({ enabled: event.target.checked })} /><i /></label>{header.enabled && <><label>Проект<input value={header.project} placeholder="Ивановы" onChange={(event) => updateHeader({ project: event.target.value })} /></label><label>Помещение<input value={header.room} onChange={(event) => updateHeader({ room: event.target.value })} /></label><div className="embedded-eskiz-field-row"><label>Дата<input value={header.date} onChange={(event) => updateHeader({ date: event.target.value })} /></label><label>Вариант<input value={header.variant} onChange={(event) => updateHeader({ variant: event.target.value })} /></label></div></>}</div>;
}

function wrapLines(text: string, maxChars: number) {
  return text.split('\n').flatMap((source) => {
    if (!source) return [''];
    const words = source.split(/\s+/u);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      if (word.length > maxChars) {
        if (line) { lines.push(line); line = ''; }
        for (let index = 0; index < word.length; index += maxChars) lines.push(word.slice(index, index + maxChars));
      } else if (!line) line = word;
      else if (`${line} ${word}`.length <= maxChars) line += ` ${word}`;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  });
}

function EmbeddedObjectView({ object, selected, primary = selected, onPointerDown, onHandleDown }: { object: EskizObject; selected: boolean; primary?: boolean; onPointerDown: (event: ReactPointerEvent<SVGGElement>, object: EskizObject) => void; onHandleDown: (event: ReactPointerEvent<SVGCircleElement>, end: 'start' | 'end' | 'offset' | 'resize') => void }) {
  const objectClass = `embedded-eskiz-object ${selected ? 'selected' : ''}`;
  if (object.type === 'anchor') return <g className={`${objectClass} helper-object`} transform={`translate(${object.x} ${object.y})`} onPointerDown={(event) => onPointerDown(event, object)}><circle r="9" fill="#fff" fillOpacity=".8" stroke={object.color} strokeWidth="2" /><path d="M -14 0 H 14 M 0 -14 V 14" stroke={object.color} strokeWidth="1.5" /><text x="12" y="-11" fontSize={object.fontSize} fontWeight="800" fill={object.color} stroke="white" strokeWidth="3" paintOrder="stroke">{object.label}</text></g>;
  if (object.type === 'guide') return <g className={`${objectClass} helper-object`} onPointerDown={(event) => onPointerDown(event, object)}>{object.orientation === 'horizontal' ? <line x1="-100000" y1={object.y} x2="100000" y2={object.y} stroke={object.color} strokeWidth="1.5" strokeDasharray="8 6" /> : <line x1={object.x} y1="-100000" x2={object.x} y2="100000" stroke={object.color} strokeWidth="1.5" strokeDasharray="8 6" />}</g>;
  if (object.type === 'dimension') return <DimensionObjectView object={object} selected={selected} primary={primary} onPointerDown={onPointerDown} onHandleDown={onHandleDown} />;
  if (object.type === 'module') return <ModuleObjectView object={object} selected={selected} primary={primary} onPointerDown={onPointerDown} onHandleDown={onHandleDown} />;
  if (object.type === 'callout') return <CalloutObjectView object={object} selected={selected} primary={primary} onPointerDown={onPointerDown} onHandleDown={onHandleDown} />;
  return <TextObjectView object={object} selected={selected} primary={primary} onPointerDown={onPointerDown} onHandleDown={onHandleDown} />;
}

function DimensionObjectView({ object, selected, primary, onPointerDown, onHandleDown }: { object: EskizDimensionObject; selected: boolean; primary: boolean; onPointerDown: (event: ReactPointerEvent<SVGGElement>, object: EskizObject) => void; onHandleDown: (event: ReactPointerEvent<SVGCircleElement>, end: 'start' | 'end' | 'offset' | 'resize') => void }) {
  const x1 = object.x;
  const y1 = object.y;
  const x2 = object.x2;
  const y2 = object.y2;
  const baseMidX = (x1 + x2) / 2;
  const baseMidY = (y1 + y2) / 2;
  const lineAngle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  let readableAngle = lineAngle;
  if (readableAngle > 90) readableAngle -= 180;
  if (readableAngle < -90) readableAngle += 180;
  const textAngle = (object.textOrientation ?? 'parallel') === 'horizontal' ? 0 : readableAngle;
  const tolerance = object.tolerance ? ` ±${object.tolerance.replace(/^±\s*/u, '')}` : '';
  const label = `${object.prefix ?? ''}${object.value || '—'}${object.showUnit === false ? '' : ' мм'}${tolerance}${object.suffix ? ` ${object.suffix}` : ''}`;
  const approxWidth = Math.max(68, label.length * object.fontSize * .62);
  const tick = 9;
  const length = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
  const unitNormalX = -(y2 - y1) / length;
  const unitNormalY = (x2 - x1) / length;
  const offset = object.offset ?? 0;
  const lineX1 = x1 + unitNormalX * offset;
  const lineY1 = y1 + unitNormalY * offset;
  const lineX2 = x2 + unitNormalX * offset;
  const lineY2 = y2 + unitNormalY * offset;
  const midX = baseMidX + unitNormalX * offset;
  const midY = baseMidY + unitNormalY * offset;
  const textShift = object.textPosition === 'above' ? -object.fontSize * .9 : object.textPosition === 'below' ? object.fontSize * .9 : 0;
  const textX = midX + unitNormalX * textShift;
  const textY = midY + unitNormalY * textShift;
  const normalX = unitNormalX * tick;
  const normalY = unitNormalY * tick;
  const extension = offset === 0 ? 0 : Math.sign(offset) * 7;
  return <g className={`embedded-eskiz-object ${selected ? 'selected' : ''}`} onPointerDown={(event) => onPointerDown(event, object)}>{offset !== 0 && <><line x1={x1} y1={y1} x2={lineX1 + unitNormalX * extension} y2={lineY1 + unitNormalY * extension} stroke={object.color} strokeWidth={Math.max(1, object.lineWidth * .7)} opacity=".78" /><line x1={x2} y1={y2} x2={lineX2 + unitNormalX * extension} y2={lineY2 + unitNormalY * extension} stroke={object.color} strokeWidth={Math.max(1, object.lineWidth * .7)} opacity=".78" /></>}<line x1={lineX1} y1={lineY1} x2={lineX2} y2={lineY2} stroke={object.color} strokeWidth={object.lineWidth} markerStart={object.arrowStyle === 'tick' ? undefined : `url(#${object.arrowStyle === 'closed' ? 'embeddedDimArrowClosed' : 'embeddedDimArrow'})`} markerEnd={object.arrowStyle === 'tick' ? undefined : `url(#${object.arrowStyle === 'closed' ? 'embeddedDimArrowClosed' : 'embeddedDimArrow'})`} /><line x1={lineX1 - normalX} y1={lineY1 - normalY} x2={lineX1 + normalX} y2={lineY1 + normalY} stroke={object.color} strokeWidth={object.lineWidth} /><line x1={lineX2 - normalX} y1={lineY2 - normalY} x2={lineX2 + normalX} y2={lineY2 + normalY} stroke={object.color} strokeWidth={object.lineWidth} /><g transform={`translate(${textX} ${textY}) rotate(${textAngle})`}><rect x={-approxWidth / 2} y={-object.fontSize * .72} width={approxWidth} height={object.fontSize * 1.25} rx="3" fill="white" opacity=".92" /><text textAnchor="middle" dominantBaseline="middle" fontSize={object.fontSize} fontWeight="700" fill={object.color}>{label}</text></g>{primary && <>{offset !== 0 && <line x1={baseMidX} y1={baseMidY} x2={midX} y2={midY} stroke="#2563eb" strokeWidth="1" strokeDasharray="4 4" opacity=".7" />}<circle className="embedded-eskiz-handle" cx={x1} cy={y1} r="7" onPointerDown={(event) => onHandleDown(event, 'start')} /><circle className="embedded-eskiz-handle" cx={x2} cy={y2} r="7" onPointerDown={(event) => onHandleDown(event, 'end')} /><circle className="embedded-eskiz-handle offset-handle" cx={midX} cy={midY} r="8" onPointerDown={(event) => onHandleDown(event, 'offset')} /></>}</g>;
}

function ModuleObjectView({ object, selected, primary, onPointerDown, onHandleDown }: { object: EskizModuleObject; selected: boolean; primary: boolean; onPointerDown: (event: ReactPointerEvent<SVGGElement>, object: EskizObject) => void; onHandleDown: (event: ReactPointerEvent<SVGCircleElement>, end: 'start' | 'end' | 'offset' | 'resize') => void }) {
  const sourceLines = [object.number, ...object.description.split('\n').filter(Boolean)];
  const autoWidth = Math.max(72, ...sourceLines.map((text) => text.length * object.fontSize * .6)) + 22;
  const width = object.width ? Math.max(60, object.width) : autoWidth;
  const maxChars = Math.max(2, Math.floor((width - 22) / (object.fontSize * .6)));
  const lines = sourceLines.flatMap((line) => wrapLines(line, maxChars));
  const autoHeight = lines.length * (object.fontSize + 5) + 14;
  const height = Math.max(autoHeight, object.height ?? 0);
  const textBlockHeight = lines.length * (object.fontSize + 5) - 5;
  const textY = Math.max(8, (height - textBlockHeight) / 2);
  return <g className={`embedded-eskiz-object embedded-eskiz-label-object ${selected ? 'selected' : ''}`} transform={`translate(${object.x} ${object.y})`} onPointerDown={(event) => onPointerDown(event, object)}><rect x="0" y="0" width={width} height={height} rx={object.borderRadius ?? 6} fill={object.fill ?? 'white'} fillOpacity={object.fillOpacity ?? 1} stroke={object.color} strokeWidth="2" />{lines.map((line, index) => <text key={index} x={width / 2} y={textY + index * (object.fontSize + 5)} dominantBaseline="hanging" textAnchor="middle" fontSize={object.fontSize} fontWeight={index === 0 ? 800 : 500} fill={object.color}>{line}</text>)}{primary && <circle className="embedded-eskiz-handle resize-handle" cx={width} cy={height} r="8" onPointerDown={(event) => onHandleDown(event, 'resize')} />}</g>;
}

function CalloutObjectView({ object, selected, primary, onPointerDown, onHandleDown }: { object: EskizCalloutObject; selected: boolean; primary: boolean; onPointerDown: (event: ReactPointerEvent<SVGGElement>, object: EskizObject) => void; onHandleDown: (event: ReactPointerEvent<SVGCircleElement>, end: 'start' | 'end' | 'offset' | 'resize') => void }) {
  const sourceLines = object.text.split('\n');
  const autoWidth = Math.max(120, ...sourceLines.map((text) => text.length * object.fontSize * .56)) + 24;
  const width = object.width ? Math.max(70, object.width) : autoWidth;
  const maxChars = Math.max(3, Math.floor((width - 24) / (object.fontSize * .56)));
  const lines = wrapLines(object.text, maxChars);
  const autoHeight = Math.max(48, lines.length * (object.fontSize + 5) + 18);
  const height = Math.max(autoHeight, object.height ?? 0);
  const elbowX = object.x > object.targetX ? object.x - 18 : object.x + width + 18;
  return <g className={`embedded-eskiz-object embedded-eskiz-label-object ${selected ? 'selected' : ''}`} onPointerDown={(event) => onPointerDown(event, object)}><polyline points={`${object.targetX},${object.targetY} ${elbowX},${object.y + height / 2} ${object.x > object.targetX ? object.x : object.x + width},${object.y + height / 2}`} fill="none" stroke={object.color} strokeWidth="2" /><circle cx={object.targetX} cy={object.targetY} r="5" fill={object.color} /><rect x={object.x} y={object.y} width={width} height={height} rx={object.borderRadius ?? 6} fill={object.fill ?? '#fff'} fillOpacity={object.fillOpacity ?? 1} stroke={object.color} strokeWidth="2" />{lines.map((line, index) => <text key={index} x={object.x + 12} y={object.y + 11 + index * (object.fontSize + 5)} dominantBaseline="hanging" fontSize={object.fontSize} fontWeight="600" fill={object.color}>{line}</text>)}{primary && <><circle className="embedded-eskiz-handle" cx={object.targetX} cy={object.targetY} r="7" onPointerDown={(event) => onHandleDown(event, 'start')} /><circle className="embedded-eskiz-handle resize-handle" cx={object.x + width} cy={object.y + height} r="8" onPointerDown={(event) => onHandleDown(event, 'resize')} /></>}</g>;
}

function TextObjectView({ object, selected, primary, onPointerDown, onHandleDown }: { object: EskizTextObject; selected: boolean; primary: boolean; onPointerDown: (event: ReactPointerEvent<SVGGElement>, object: EskizObject) => void; onHandleDown: (event: ReactPointerEvent<SVGCircleElement>, end: 'start' | 'end' | 'offset' | 'resize') => void }) {
  const isComment = object.type === 'comment';
  const isLink = object.type === 'link';
  const sourceLines = object.text.split('\n');
  const autoWidth = Math.max(isComment ? 160 : 100, ...sourceLines.map((text) => text.length * object.fontSize * .56)) + 28;
  const width = object.width ? Math.max(60, object.width) : autoWidth;
  const textInset = isLink ? 37 : 28;
  const maxChars = Math.max(3, Math.floor((width - textInset) / (object.fontSize * .56)));
  const lines = wrapLines(object.text, maxChars);
  const autoHeight = lines.length * (object.fontSize + 5) + 22;
  const height = Math.max(autoHeight, object.height ?? 0);
  return <g className={`embedded-eskiz-object embedded-eskiz-label-object ${selected ? 'selected' : ''}`} transform={`translate(${object.x} ${object.y})`} onPointerDown={(event) => onPointerDown(event, object)}><rect x="0" y="0" width={width} height={height} rx={object.borderRadius ?? 7} fill={object.fill ?? (isComment ? '#fff8d8' : 'white')} fillOpacity={object.fillOpacity ?? 1} stroke={object.color} strokeWidth={selected ? 3 : 1.5} />{isLink && <text x="10" y={(height + 9) / 2} fontSize="18" fontWeight="900" fill={object.color}>↗</text>}{lines.map((line, index) => <text key={index} x={isLink ? 31 : 14} y={12 + index * (object.fontSize + 5)} dominantBaseline="hanging" fontSize={object.fontSize} fontWeight={object.type === 'equipment' ? 750 : 550} fill={object.color}>{line}</text>)}{primary && <circle className="embedded-eskiz-handle resize-handle" cx={width} cy={height} r="8" onPointerDown={(event) => onHandleDown(event, 'resize')} />}</g>;
}
