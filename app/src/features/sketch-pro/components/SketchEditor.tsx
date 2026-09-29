import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround, ArrowLeft, ChevronDown, Copy, Download, ExternalLink,
  FileDown, FilePlus2, GalleryVerticalEnd, Grip, Image as ImageIcon, Link2, Maximize2, MessageSquareText,
  MonitorUp, MousePointer2, PackagePlus, Ruler, Redo2, Save, Settings2, Trash2, Undo2, ZoomIn, ZoomOut
} from 'lucide-react'
import SketchObjectView from './SketchObjectView'
import { exportPdf, exportPng } from '../export/export'
import { downloadProjectFile } from '../export/projectFile'
import type { EquipmentType, SketchObject, SketchProject, Tool } from '../core/types'
import { uid } from '../core/types'
import type { SketchModuleOption } from '../adapters/calculatorModules'
import type { SketchLegendRow } from '../adapters/calculatorMaterials'

export type SketchEditorProps = {
  initialProject: SketchProject
  onClose: () => void
  onSave: (project: SketchProject) => Promise<void> | void
  moduleOptions?: SketchModuleOption[]
  legendForModule?: (moduleId?: string) => SketchLegendRow[]
  onOpenModule?: (moduleId: string) => void
}

const COLORS = { ink: '#20242b', accent: '#ff5c35', blue: '#2563eb' }
let sketchClipboard: SketchObject[] = []
const equipmentTypes: EquipmentType[] = ['Холодильник', 'Духовой шкаф', 'СВЧ', 'ПММ', 'Варочная панель', 'Вытяжка', 'Стиральная машина', 'Мойка', 'Другое']

const toolItems: { id: Tool; label: string; icon: typeof MousePointer2; key?: string }[] = [
  { id: 'select', label: 'Курсор', icon: MousePointer2, key: 'V' },
  { id: 'free-dimension', label: 'Свободный размер', icon: Ruler, key: 'R' },
  { id: 'h-dimension', label: 'Горизонтальный размер', icon: AlignHorizontalSpaceAround, key: 'H' },
  { id: 'v-dimension', label: 'Вертикальный размер', icon: AlignVerticalSpaceAround, key: 'J' },
  { id: 'chain', label: 'Цепочка размеров', icon: GalleryVerticalEnd, key: 'C' },
  { id: 'module', label: 'Модуль', icon: PackagePlus, key: 'M' },
  { id: 'callout', label: 'Выноска', icon: Grip, key: 'L' },
  { id: 'comment', label: 'Комментарий', icon: MessageSquareText, key: 'T' },
  { id: 'equipment', label: 'Техника', icon: MonitorUp, key: 'E' },
  { id: 'link', label: 'Ссылка', icon: Link2, key: 'K' },
]

type Drag = { mode: 'create' | 'move' | 'handle' | 'marquee'; start: { x: number; y: number }; id?: string; end?: 'start' | 'end' | 'offset' | 'resize'; before: SketchProject; original?: SketchObject }
type QuickEdit = { id: string; value: string; left: number; top: number; repeatTool: Tool }
function snapAngle(start: { x: number; y: number }, end: { x: number; y: number }, step = 45) {
  const distance = Math.hypot(end.x - start.x, end.y - start.y)
  const angle = Math.atan2(end.y - start.y, end.x - start.x)
  const snapped = Math.round(angle / (step * Math.PI / 180)) * step * Math.PI / 180
  return { x: start.x + Math.cos(snapped) * distance, y: start.y + Math.sin(snapped) * distance }
}

function dimensionOffset(dimension: Extract<SketchObject, { type: 'dimension' }>, point: { x: number; y: number }) {
  const length = Math.max(1, Math.hypot(dimension.x2 - dimension.x, dimension.y2 - dimension.y))
  const nx = -(dimension.y2 - dimension.y) / length, ny = (dimension.x2 - dimension.x) / length
  const midX = (dimension.x + dimension.x2) / 2, midY = (dimension.y + dimension.y2) / 2
  return (point.x - midX) * nx + (point.y - midY) * ny
}

function nextModuleNumber(objects: SketchObject[]) {
  const maxNumber = objects.filter(o => o.type === 'module').reduce((max, o) => o.type === 'module' ? Math.max(max, Number(o.number.match(/\d+/)?.[0] ?? 0)) : max, 0)
  return `М${String(maxNumber + 1).padStart(2, '0')}`
}

export function Editor({ initialProject, onClose, onSave, moduleOptions = [], legendForModule, onOpenModule }: SketchEditorProps) {
  const [project, setProject] = useState(initialProject)
  const [tool, setTool] = useState<Tool>('select')
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [zoom, setZoom] = useState(1)
  const [showImage, setShowImage] = useState(true)
  const [showAnnotations, setShowAnnotations] = useState(true)
  const [saved, setSaved] = useState(true)
  const [exportOpen, setExportOpen] = useState(false)
  const [printSettings, setPrintSettings] = useState<{ format: 'a4' | 'a3'; orientation: 'portrait' | 'landscape'; margin: number }>({ format: 'a4', orientation: 'landscape', margin: 8 })
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [chainLast, setChainLast] = useState<{ x: number; y: number } | null>(null)
  const [chainAxis, setChainAxis] = useState<'horizontal' | 'vertical' | null>(null)
  const [chainSessionId, setChainSessionId] = useState<string | null>(null)
  const [pendingDimension, setPendingDimension] = useState<{ id: string; sourceTool: Tool } | null>(null)
  const [draftLine, setDraftLine] = useState<{ start: { x: number; y: number }; end: { x: number; y: number }; callout: boolean } | null>(null)
  const [selectionBox, setSelectionBox] = useState<{ start: { x: number; y: number }; end: { x: number; y: number } } | null>(null)
  const [snapIndicator, setSnapIndicator] = useState<{ x: number; y: number } | null>(null)
  const [quickEdit, setQuickEdit] = useState<QuickEdit | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const past = useRef<SketchProject[]>([]), future = useRef<SketchProject[]>([])
  const chosen = project.objects.find(o => o.id === selected)
  const selectOnly = (id: string | null) => { setSelected(id); setSelectedIds(id ? [id] : []) }

  const commit = useCallback((fn: (p: SketchProject) => SketchProject) => {
    setProject(current => { past.current.push(current); if (past.current.length > 80) past.current.shift(); future.current = []; setSaved(false); return fn(current) })
  }, [])
  const changeObject = (id: string, patch: Partial<SketchObject>) => commit(p => ({ ...p, objects: p.objects.map(o => o.id === id ? { ...o, ...patch } as SketchObject : o) }))
  const undo = useCallback(() => setProject(current => { const prev = past.current.pop(); if (!prev) return current; future.current.push(current); setSaved(false); return prev }), [])
  const redo = useCallback(() => setProject(current => { const next = future.current.pop(); if (!next) return current; past.current.push(current); setSaved(false); return next }), [])
  const save = useCallback(async () => {
    const next = { ...project, updatedAt: new Date().toISOString() }; setProject(next); await onSave(next); setSaved(true)
  }, [onSave, project])

  useEffect(() => { if (saved) return; const timer = setTimeout(() => { save() }, 1600); return () => clearTimeout(timer) }, [saved, save])
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      setZoom(current => Math.max(.1, Math.min(3, current * (event.deltaY > 0 ? .9 : 1.1))))
    }
    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [])

  const deleteSelected = useCallback(() => { if (!selectedIds.length) return; commit(p => ({ ...p, objects: p.objects.filter(o => !selectedIds.includes(o.id)) })); setSelected(null); setSelectedIds([]) }, [selectedIds, commit])
  const duplicate = useCallback(() => {
    if (!selectedIds.length) return
    let all = [...project.objects]
    const copiedChains = new Map<string, string>()
    const copies = project.objects.filter(o => selectedIds.includes(o.id)).map(source => {
      const copy = { ...source, id: uid(), x: source.x + 24, y: source.y + 24 } as SketchObject
      if (copy.type === 'dimension') { copy.x2 += 24; copy.y2 += 24; if (copy.chainId) { if (!copiedChains.has(copy.chainId)) copiedChains.set(copy.chainId, uid()); copy.chainId = copiedChains.get(copy.chainId) } }
      if (copy.type === 'callout') { copy.targetX += 24; copy.targetY += 24 }
      if (copy.type === 'module') copy.number = nextModuleNumber(all)
      all.push(copy); return copy
    })
    commit(p => ({ ...p, objects: [...p.objects, ...copies] })); setSelectedIds(copies.map(o => o.id)); setSelected(copies.at(-1)?.id ?? null)
  }, [selectedIds, commit, project.objects])
  const copySelected = useCallback(() => { sketchClipboard = project.objects.filter(o => selectedIds.includes(o.id)).map(o => structuredClone(o)) }, [project.objects, selectedIds])
  const pasteClipboard = useCallback(() => {
    if (!sketchClipboard.length) return
    let all = [...project.objects]
    const pastedChains = new Map<string, string>()
    const copies = sketchClipboard.map(source => { const copy = { ...structuredClone(source), id: uid(), x: source.x + 32, y: source.y + 32 } as SketchObject; if (copy.type === 'dimension') { copy.x2 += 32; copy.y2 += 32; if (copy.chainId) { if (!pastedChains.has(copy.chainId)) pastedChains.set(copy.chainId, uid()); copy.chainId = pastedChains.get(copy.chainId) } } if (copy.type === 'callout') { copy.targetX += 32; copy.targetY += 32 } if (copy.type === 'module') copy.number = nextModuleNumber(all); all.push(copy); return copy })
    sketchClipboard = copies.map(o => structuredClone(o)); commit(p => ({ ...p, objects: [...p.objects, ...copies] })); setSelectedIds(copies.map(o => o.id)); setSelected(copies.at(-1)?.id ?? null)
  }, [commit, project.objects])
  const nudgeSelected = useCallback((dx: number, dy: number) => {
    if (!selectedIds.length) return
    commit(p => ({ ...p, objects: p.objects.map(o => {
      if (!selectedIds.includes(o.id)) return o
      const moved = { ...o, x: o.x + dx, y: o.y + dy } as SketchObject
      if (moved.type === 'dimension') { moved.x2 += dx; moved.y2 += dy }
      if (moved.type === 'callout') { moved.targetX += dx; moved.targetY += dy }
      return moved
    }) }))
  }, [selectedIds, commit])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const input = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)
      if (e.code === 'Space' && !input) { e.preventDefault(); setSpaceDown(true) }
      if (input) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelected(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteClipboard(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return }
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected()
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && selected) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        nudgeSelected(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0)
      }
      if (e.key === 'Escape') { setTool('select'); selectOnly(null); setChainLast(null); setChainAxis(null); setChainSessionId(null); setPendingDimension(null) }
      const found = toolItems.find(t => t.key?.toLowerCase() === e.key.toLowerCase())
      if (found && !e.ctrlKey && !e.metaKey) { setTool(found.id); if (found.id !== 'chain') setChainLast(null) }
    }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false) }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [copySelected, deleteSelected, duplicate, nudgeSelected, pasteClipboard, redo, save, selected, undo])

  const point = (e: ReactPointerEvent) => { const r = svgRef.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) * project.image.width / r.width, y: (e.clientY - r.top) * project.image.height / r.height } }
  const nearestSnap = (raw: { x: number; y: number }, excludeId?: string) => {
    const points: { x: number; y: number }[] = []
    for (const o of project.objects) {
      if (o.id === excludeId) continue
      points.push({ x: o.x, y: o.y })
      if (o.type === 'dimension') points.push({ x: o.x2, y: o.y2 })
      if (o.type === 'callout') points.push({ x: o.targetX, y: o.targetY })
    }
    const threshold = 14 / zoom
    let best: { x: number; y: number } | null = null, distance = threshold
    for (const p of points) { const d = Math.hypot(p.x - raw.x, p.y - raw.y); if (d < distance) { best = p; distance = d } }
    if (best) return best
    let snapX = raw.x, snapY = raw.y, dx = threshold, dy = threshold
    for (const p of points) {
      const nextX = Math.abs(p.x - raw.x), nextY = Math.abs(p.y - raw.y)
      if (nextX < dx) { dx = nextX; snapX = p.x }
      if (nextY < dy) { dy = nextY; snapY = p.y }
    }
    return dx < threshold || dy < threshold ? { x: snapX, y: snapY } : null
  }
  const moduleNumber = () => nextModuleNumber(project.objects)
  const addAt = (type: Tool, p: { x: number; y: number }) => {
    const base = { id: uid(), x: p.x, y: p.y, color: COLORS.ink, fontSize: 22 }
    let object: SketchObject
    if (type === 'module') { const option = moduleOptions[0]; object = { ...base, type: 'module', number: moduleNumber(), description: option?.description ?? '', sourceModuleId: option?.id, materialRefs: option?.materialRefs } }
    else if (type === 'comment') object = { ...base, type: 'comment', text: 'Новый комментарий' }
    else if (type === 'equipment') object = { ...base, type: 'equipment', text: 'ПММ 600', equipmentType: 'ПММ', color: COLORS.blue }
    else object = { ...base, type: 'link', text: 'Название ссылки', url: 'https://' }
    commit(old => ({ ...old, objects: [...old.objects, object] })); selectOnly(object.id); setTool('select')
  }

  const onStageDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (quickEdit) {
      setProject(current => ({ ...current, objects: current.objects.map(o => o.id === quickEdit.id && o.type === 'dimension' ? { ...o, value: quickEdit.value } : o) }))
      setQuickEdit(null); setSaved(false)
    }
    if (spaceDown || e.button === 1) return
    if (pendingDimension) {
      const dimension = project.objects.find(o => o.id === pendingDimension.id)
      if (dimension?.type === 'dimension') setQuickEdit({ id: dimension.id, value: dimension.value, left: e.clientX, top: e.clientY, repeatTool: pendingDimension.sourceTool })
      setPendingDimension(null); setTool('select'); setSnapIndicator(null); return
    }
    if (e.target !== e.currentTarget && (e.target as Element).tagName !== 'image') return
    let p = point(e)
    if (!e.altKey && ['free-dimension', 'h-dimension', 'v-dimension', 'chain', 'callout'].includes(tool)) {
      const snapped = nearestSnap(p)
      if (snapped) { p = snapped; setSnapIndicator(snapped) }
    }
    if (tool === 'select') { selectOnly(null); dragRef.current = { mode: 'marquee', start: p, before: project }; setSelectionBox({ start: p, end: p }); e.currentTarget.setPointerCapture(e.pointerId); return }
    if (['module', 'comment', 'equipment', 'link'].includes(tool)) { addAt(tool, p); return }
    if (tool === 'chain') {
      if (!chainLast) { setChainLast(p); setChainAxis(null); setChainSessionId(uid()); return }
      const axis = chainAxis ?? (Math.abs(p.x - chainLast.x) >= Math.abs(p.y - chainLast.y) ? 'horizontal' : 'vertical')
      const horizontal = axis === 'horizontal'
      const end = horizontal ? { x: p.x, y: chainLast.y } : { x: chainLast.x, y: p.y }
      const o: SketchObject = { id: uid(), type: 'dimension', orientation: axis, textOrientation: 'parallel', textPosition: 'center', offset: -38, chainId: chainSessionId ?? uid(), x: chainLast.x, y: chainLast.y, x2: end.x, y2: end.y, value: '600', showUnit: true, color: COLORS.ink, fontSize: 22, lineWidth: 2 }
      commit(old => ({ ...old, objects: [...old.objects, o] })); selectOnly(o.id); setChainAxis(axis); setChainLast(end); setQuickEdit({ id: o.id, value: o.value, left: e.clientX, top: e.clientY, repeatTool: 'chain' }); return
    }
    dragRef.current = { mode: 'create', start: p, before: project }
    setDraftLine({ start: p, end: p, callout: tool === 'callout' })
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }

  const onStageMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current
    if (!d && pendingDimension) {
      const p = point(e)
      setProject(current => ({ ...current, objects: current.objects.map(o => o.id === pendingDimension.id && o.type === 'dimension' ? { ...o, offset: dimensionOffset(o, p) } : o) }))
      return
    }
    if (!d) return
    let p = point(e)
    if (d.mode === 'marquee') { setSelectionBox({ start: d.start, end: p }); return }
    if (d.mode === 'create') {
      const snapped = !e.altKey ? nearestSnap(p) : null
      if (snapped) { p = snapped; setSnapIndicator(snapped) } else setSnapIndicator(null)
      if (tool === 'free-dimension' && e.shiftKey) p = snapAngle(d.start, p)
      if (tool === 'h-dimension') p.y = d.start.y
      if (tool === 'v-dimension') p.x = d.start.x
      setDraftLine({ start: d.start, end: p, callout: tool === 'callout' })
      return
    }
    if (d.mode === 'handle' && d.end !== 'offset' && d.end !== 'resize') {
      const snapped = !e.altKey ? nearestSnap(p, d.id) : null
      if (snapped) { p = snapped; setSnapIndicator(snapped) } else setSnapIndicator(null)
    }
    if (d.mode === 'handle' && d.end !== 'offset' && d.end !== 'resize' && d.original?.type === 'dimension' && d.original.orientation === 'free' && e.shiftKey) {
      const anchor = d.end === 'start' ? { x: d.original.x2, y: d.original.y2 } : { x: d.original.x, y: d.original.y }
      p = snapAngle(anchor, p)
    }
    const dx = p.x - d.start.x, dy = p.y - d.start.y
    setProject(current => ({ ...current, objects: current.objects.map(o => {
      if (d.mode === 'move' && d.id && selectedIds.includes(d.id) && selectedIds.includes(o.id)) {
        const source = d.before.objects.find(item => item.id === o.id)
        if (!source || source.locked) return o
        const moved = { ...source, x: source.x + dx, y: source.y + dy } as SketchObject
        if (moved.type === 'dimension') { moved.x2 += dx; moved.y2 += dy }
        if (moved.type === 'callout') { moved.targetX += dx; moved.targetY += dy }
        return moved
      }
      if (d.mode === 'handle' && d.end === 'offset' && d.original?.type === 'dimension' && d.original.chainId && o.type === 'dimension' && o.chainId === d.original.chainId) return { ...o, offset: dimensionOffset(d.original, p) }
      if (o.id !== d.id || !d.original) return o
      const orig = d.original
      if (d.mode === 'handle') {
        if (d.end === 'resize' && orig.type !== 'dimension') return { ...orig, width: Math.max(60, p.x - orig.x), height: Math.max(36, p.y - orig.y) }
        if (orig.type === 'dimension') {
          if (d.end === 'offset') return { ...orig, offset: dimensionOffset(orig, p) }
          return d.end === 'start'
            ? { ...orig, x: orig.orientation === 'vertical' ? orig.x : p.x, y: orig.orientation === 'horizontal' ? orig.y : p.y }
            : { ...orig, x2: orig.orientation === 'vertical' ? orig.x2 : p.x, y2: orig.orientation === 'horizontal' ? orig.y2 : p.y }
        }
        if (orig.type === 'callout') return { ...orig, targetX: p.x, targetY: p.y }
      }
      const moved = { ...orig, x: orig.x + dx, y: orig.y + dy } as SketchObject
      if (moved.type === 'dimension') { moved.x2 += dx; moved.y2 += dy }
      if (moved.type === 'callout') { moved.targetX += dx; moved.targetY += dy }
      return moved
    }) }))
  }

  const onStageUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current
    if (!d) return
    let p = point(e)
    if (d.mode === 'marquee') {
      const left = Math.min(d.start.x, p.x), right = Math.max(d.start.x, p.x), top = Math.min(d.start.y, p.y), bottom = Math.max(d.start.y, p.y)
      const ids = project.objects.filter(o => !o.hidden && ((o.x >= left && o.x <= right && o.y >= top && o.y <= bottom) || (o.type === 'dimension' && o.x2 >= left && o.x2 <= right && o.y2 >= top && o.y2 <= bottom))).map(o => o.id)
      setSelectedIds(ids); setSelected(ids.at(-1) ?? null); setSelectionBox(null); dragRef.current = null; return
    }
    if (d.mode === 'create') {
      const horizontal = tool === 'h-dimension'
      const vertical = tool === 'v-dimension'
      const isFree = tool === 'free-dimension'
      const isCallout = tool === 'callout'
      const snapped = !e.altKey ? nearestSnap(p) : null
      if (snapped) p = snapped
      if (isFree && e.shiftKey) p = snapAngle(d.start, p)
      const distance = Math.hypot(p.x - d.start.x, p.y - d.start.y)
      if (distance > 8) {
        let o: SketchObject
        if (isCallout) o = { id: uid(), type: 'callout', targetX: d.start.x, targetY: d.start.y, x: p.x, y: p.y, text: 'Текст выноски', color: COLORS.ink, fontSize: 22 }
        else o = { id: uid(), type: 'dimension', orientation: isFree ? 'free' : horizontal ? 'horizontal' : 'vertical', textOrientation: 'parallel', textPosition: 'center', showUnit: true, offset: -38, x: d.start.x, y: d.start.y, x2: vertical ? d.start.x : p.x, y2: horizontal ? d.start.y : p.y, value: '600', color: COLORS.ink, fontSize: 22, lineWidth: 2 }
        past.current.push(d.before); future.current = []; setProject(old => ({ ...old, objects: [...old.objects, o] })); selectOnly(o.id); setSaved(false)
        if (o.type === 'dimension') setPendingDimension({ id: o.id, sourceTool: tool }); else setTool('select')
      }
    } else { past.current.push(d.before); future.current = []; setSaved(false) }
    dragRef.current = null
    setDraftLine(null)
    setSnapIndicator(null)
  }

  const objectDown = (e: ReactPointerEvent<SVGGElement>, o: SketchObject) => {
    e.stopPropagation()
    if (tool !== 'select') return
    if (e.shiftKey) {
      const next = selectedIds.includes(o.id) ? selectedIds.filter(id => id !== o.id) : [...selectedIds, o.id]
      setSelectedIds(next); setSelected(next.at(-1) ?? null); return
    }
    if (!selectedIds.includes(o.id)) selectOnly(o.id)
    if (o.locked) return
    const p = point(e); dragRef.current = { mode: 'move', start: p, id: o.id, before: project, original: o }; svgRef.current?.setPointerCapture(e.pointerId)
  }
  const handleDown = (e: ReactPointerEvent<SVGCircleElement>, end: 'start' | 'end' | 'offset' | 'resize') => {
    e.stopPropagation(); if (!chosen || chosen.locked) return
    dragRef.current = { mode: 'handle', start: point(e), id: chosen.id, before: project, original: chosen, end }; svgRef.current?.setPointerCapture(e.pointerId)
  }

  const fit = () => { const v = viewportRef.current; if (!v) return; setZoom(Math.min((v.clientWidth - 100) / project.image.width, (v.clientHeight - 100) / project.image.height, 1.2)) }
  useEffect(() => { const t = setTimeout(fit, 50); return () => clearTimeout(t) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const setActiveTool = (id: Tool) => { setTool(id); setPendingDimension(null); if (id !== 'chain') { setChainLast(null); setChainAxis(null); setChainSessionId(null) } }
  const selectChain = (chainId: string) => { const ids = project.objects.filter(o => o.type === 'dimension' && o.chainId === chainId).map(o => o.id); setSelectedIds(ids); setSelected(ids.at(-1) ?? null) }
  const titleUpdate = (title: string) => { setProject(p => ({ ...p, title })); setSaved(false) }
  const alignSelection = (mode: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom') => {
    const items = project.objects.filter(o => selectedIds.includes(o.id) && !o.locked)
    if (items.length < 2) return
    const bounds = items.map(o => ({ o, left: o.type === 'dimension' ? Math.min(o.x, o.x2) : o.x, right: o.type === 'dimension' ? Math.max(o.x, o.x2) : o.x + (o.width ?? 100), top: o.type === 'dimension' ? Math.min(o.y, o.y2) : o.y, bottom: o.type === 'dimension' ? Math.max(o.y, o.y2) : o.y + (o.height ?? 50) }))
    const target = mode === 'left' ? Math.min(...bounds.map(b => b.left)) : mode === 'right' ? Math.max(...bounds.map(b => b.right)) : mode === 'top' ? Math.min(...bounds.map(b => b.top)) : mode === 'bottom' ? Math.max(...bounds.map(b => b.bottom)) : mode === 'centerX' ? bounds.reduce((s, b) => s + (b.left + b.right) / 2, 0) / bounds.length : bounds.reduce((s, b) => s + (b.top + b.bottom) / 2, 0) / bounds.length
    commit(p => ({ ...p, objects: p.objects.map(o => {
      const b = bounds.find(item => item.o.id === o.id); if (!b) return o
      const current = mode === 'left' ? b.left : mode === 'right' ? b.right : mode === 'top' ? b.top : mode === 'bottom' ? b.bottom : mode === 'centerX' ? (b.left + b.right) / 2 : (b.top + b.bottom) / 2
      const dx = ['left','centerX','right'].includes(mode) ? target - current : 0, dy = ['top','centerY','bottom'].includes(mode) ? target - current : 0
      const moved = { ...o, x: o.x + dx, y: o.y + dy } as SketchObject
      if (moved.type === 'dimension') { moved.x2 += dx; moved.y2 += dy } if (moved.type === 'callout') { moved.targetX += dx; moved.targetY += dy }
      return moved
    }) }))
  }
  const finishQuickEdit = (repeat = false) => {
    if (!quickEdit) return
    setProject(p => ({ ...p, objects: p.objects.map(o => o.id === quickEdit.id && o.type === 'dimension' ? { ...o, value: quickEdit.value } : o) }))
    setSaved(false)
    if (repeat && quickEdit.repeatTool !== 'chain') setTool(quickEdit.repeatTool)
    setQuickEdit(null)
  }

  return <div className="editor-shell">
    <header className="app-header">
      <div className="header-left"><button className="icon-btn" title="К проектам" onClick={async () => { await save(); onClose() }}><ArrowLeft/></button><div className="mini-brand"><div className="brand-mark small">Р</div><span>Эскиз <b>PRO</b></span></div><div className="separator"/><input className="title-input" value={project.title} onChange={e => titleUpdate(e.target.value)}/><span className={`save-state ${saved ? 'ok' : ''}`}>{saved ? 'Сохранено' : 'Сохраняем…'}</span></div>
      <div className="header-actions"><button className="icon-btn" title="Отменить (Ctrl+Z)" disabled={!past.current.length} onClick={undo}><Undo2/></button><button className="icon-btn" title="Повторить (Ctrl+Shift+Z)" disabled={!future.current.length} onClick={redo}><Redo2/></button><button className="icon-btn" title="Скачать редактируемый проект .eskiz" onClick={() => downloadProjectFile(project)}><FileDown/></button><button className="secondary-btn" onClick={save}><Save/>Сохранить</button><div className="export-wrap"><button className="primary-btn" onClick={() => setExportOpen(!exportOpen)}><Download/>Экспорт<ChevronDown size={15}/></button>{exportOpen && <div className="export-menu export-menu-wide"><div className={`page-preview ${printSettings.orientation}`}><div style={{ backgroundImage: `url(${project.image.dataUrl})`, backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}><b>{printSettings.format.toUpperCase()}</b><span>{printSettings.orientation === 'landscape' ? 'Альбомная' : 'Книжная'}</span></div></div><div className="export-settings"><label>Лист<select value={printSettings.format} onChange={e => setPrintSettings({ ...printSettings, format: e.target.value as 'a4' | 'a3' })}><option value="a4">A4</option><option value="a3">A3</option></select></label><label>Ориентация<select value={printSettings.orientation} onChange={e => setPrintSettings({ ...printSettings, orientation: e.target.value as 'portrait' | 'landscape' })}><option value="landscape">Альбомная</option><option value="portrait">Книжная</option></select></label><label>Поля, мм<input type="number" min="0" max="30" value={printSettings.margin} onChange={e => setPrintSettings({ ...printSettings, margin: +e.target.value })}/></label></div><div className="export-buttons"><button onClick={async () => { if (svgRef.current) await exportPng(project, svgRef.current); setExportOpen(false) }}><ImageIcon/>PNG</button><button className="dark" onClick={async () => { if (svgRef.current) await exportPdf(project, svgRef.current, printSettings); setExportOpen(false) }}><FilePlus2/>Экспорт PDF</button></div></div>}</div></div>
    </header>
    <nav className="tool-strip">{toolItems.map(({ id, label, icon: Icon, key }) => <button key={id} className={tool === id ? 'active' : ''} title={`${label}${key ? ` (${key})` : ''}`} onClick={() => setActiveTool(id)}><Icon/><span>{label.replace('Горизонтальный ', '').replace('Вертикальный ', '')}</span>{key && <kbd>{key}</kbd>}</button>)}<div className="toolbar-spacer"/><button className={sidebarOpen ? 'active subtle' : 'subtle'} onClick={() => setSidebarOpen(!sidebarOpen)}><Settings2/><span>Свойства</span></button></nav>
    <div className="work-area">
      <section ref={viewportRef} className={`canvas-viewport ${spaceDown ? 'panning' : ''}`} onPointerDown={e => { if (!spaceDown && e.button !== 1) return; const v = viewportRef.current!; panRef.current = { x: e.clientX, y: e.clientY, left: v.scrollLeft, top: v.scrollTop }; v.setPointerCapture(e.pointerId) }} onPointerMove={e => { const pan = panRef.current; if (!pan) return; const v = viewportRef.current!; v.scrollLeft = pan.left - (e.clientX - pan.x); v.scrollTop = pan.top - (e.clientY - pan.y) }} onPointerUp={() => { panRef.current = null }}>
        {project.header.enabled && <div className="canvas-header-preview" style={{ width: project.image.width * zoom }}><strong>РЕцепт <i>/</i> Эскиз PRO</strong><span>Проект: {project.header.project || '—'}</span><small>Помещение: {project.header.room || '—'} · Дата: {project.header.date} · Вариант: {project.header.variant}</small></div>}
        <div className="stage" style={{ width: project.image.width * zoom, height: project.image.height * zoom }}>
          <svg ref={svgRef} viewBox={`0 0 ${project.image.width} ${project.image.height}`} width="100%" height="100%" className={`drawing-surface tool-${tool}`} onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp}>
            <defs><marker id="dimArrow" markerWidth="9" markerHeight="9" refX="4.5" refY="4.5" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M 8 1 L 1 4.5 L 8 8" fill="none" stroke="context-stroke" strokeWidth="1.5"/></marker><marker id="dimArrowClosed" markerWidth="9" markerHeight="9" refX="4.5" refY="4.5" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M 8 1 L 1 4.5 L 8 8 Z" fill="context-stroke"/></marker></defs>
            {showImage && <image href={project.image.dataUrl} x="0" y="0" width={project.image.width} height={project.image.height} preserveAspectRatio="none" pointerEvents="none"/>}
            {showAnnotations && project.objects.filter(o => !o.hidden).map(o => <SketchObjectView key={o.id} object={o} selected={selectedIds.includes(o.id)} primary={o.id === selected} onPointerDown={objectDown} onHandleDown={handleDown}/>)}
            {selectionBox && <rect pointerEvents="none" x={Math.min(selectionBox.start.x, selectionBox.end.x)} y={Math.min(selectionBox.start.y, selectionBox.end.y)} width={Math.abs(selectionBox.end.x - selectionBox.start.x)} height={Math.abs(selectionBox.end.y - selectionBox.start.y)} fill="#2563eb" fillOpacity=".1" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="7 5"/>}
            {draftLine && <g pointerEvents="none" opacity=".9">
              <line x1={draftLine.start.x} y1={draftLine.start.y} x2={draftLine.end.x} y2={draftLine.end.y} stroke={COLORS.accent} strokeWidth="3" strokeDasharray="10 7"/>
              <circle cx={draftLine.start.x} cy={draftLine.start.y} r="6" fill={COLORS.accent}/><circle cx={draftLine.end.x} cy={draftLine.end.y} r="6" fill={COLORS.accent}/>
            </g>}
            {tool === 'chain' && chainLast && <g pointerEvents="none"><circle cx={chainLast.x} cy={chainLast.y} r="8" fill={COLORS.accent}/><circle cx={chainLast.x} cy={chainLast.y} r="16" fill="none" stroke={COLORS.accent} opacity=".35"/></g>}
            {snapIndicator && <g pointerEvents="none" className="snap-marker"><circle cx={snapIndicator.x} cy={snapIndicator.y} r="11" fill="none" stroke={COLORS.blue} strokeWidth="2"/><path d={`M ${snapIndicator.x - 15} ${snapIndicator.y} H ${snapIndicator.x + 15} M ${snapIndicator.x} ${snapIndicator.y - 15} V ${snapIndicator.y + 15}`} stroke={COLORS.blue} strokeWidth="1"/></g>}
          </svg>
        </div>
        {pendingDimension ? <div className="chain-hint dimension-step-hint"><b>Шаг 3 из 3</b> Отведите размерную линию и кликните для фиксации</div> : tool === 'chain' && <div className="chain-hint"><b>Цепочка</b> Укажите следующую точку · Enter/клик — значение · Esc — закончить</div>}
      </section>
      {quickEdit && <div className="quick-dimension" style={{ left: Math.min(quickEdit.left + 14, window.innerWidth - 210), top: Math.min(quickEdit.top + 14, window.innerHeight - 105) }}>
        <span>Размер</span><div><input autoFocus inputMode="decimal" value={quickEdit.value} onChange={e => setQuickEdit({ ...quickEdit, value: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); finishQuickEdit(false) } if (e.key === 'Tab') { e.preventDefault(); finishQuickEdit(true) } if (e.key === 'Escape') { e.preventDefault(); setQuickEdit(null) } }}/><b>мм</b></div><small>Enter — готово · Tab — следующий</small>
      </div>}
      {sidebarOpen && <Inspector project={project} object={chosen} selectedIds={selectedIds} onSelect={selectOnly} onSelectChain={selectChain} onAlign={alignSelection} showImage={showImage} showAnnotations={showAnnotations} onShowImage={setShowImage} onShowAnnotations={setShowAnnotations} onProject={patch => commit(p => ({ ...p, ...patch }))} onObject={(patch) => chosen && changeObject(chosen.id, patch)} onPatchObject={changeObject} onDelete={deleteSelected} onDuplicate={duplicate} moduleOptions={moduleOptions} legendForModule={legendForModule} onOpenModule={onOpenModule}/>}
    </div>
    <footer className="status-bar"><span><span className="status-dot"/> {project.image.name} · {project.image.width} × {project.image.height}px</span><span className="status-tip">Стрелки — точный сдвиг · Shift — привязка угла · Пробел — перемещение</span><div className="zoom-control"><button onClick={() => setZoom(z => Math.max(.1, z - .1))}><ZoomOut/></button><button className="zoom-value" onClick={fit}>{Math.round(zoom * 100)}%</button><button onClick={() => setZoom(z => Math.min(3, z + .1))}><ZoomIn/></button><button title="По размеру экрана" onClick={fit}><Maximize2/></button></div></footer>
  </div>
}

function Inspector({ project, object, selectedIds, onSelect, onSelectChain, onAlign, showImage, showAnnotations, onShowImage, onShowAnnotations, onProject, onObject, onPatchObject, onDelete, onDuplicate, moduleOptions, legendForModule, onOpenModule }: { project: SketchProject; object?: SketchObject; selectedIds: string[]; onSelect: (id: string | null) => void; onSelectChain: (chainId: string) => void; onAlign: (mode: 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom') => void; showImage: boolean; showAnnotations: boolean; onShowImage: (v: boolean) => void; onShowAnnotations: (v: boolean) => void; onProject: (p: Partial<SketchProject>) => void; onObject: (p: Partial<SketchObject>) => void; onPatchObject: (id: string, p: Partial<SketchObject>) => void; onDelete: () => void; onDuplicate: () => void; moduleOptions: SketchModuleOption[]; legendForModule?: (moduleId?: string) => SketchLegendRow[]; onOpenModule?: (moduleId: string) => void }) {
  const [tab, setTab] = useState<'object' | 'objects' | 'document'>(object ? 'object' : 'document')
  useEffect(() => { if (object) setTab('object') }, [object?.id])
  const reorder = (index: number, delta: number) => { const next = [...project.objects]; const target = index + delta; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; onProject({ objects: next }) }
  return <aside className="inspector">
    <div className="inspector-tabs"><button className={tab === 'object' ? 'active' : ''} onClick={() => setTab('object')}>Объект</button><button className={tab === 'objects' ? 'active' : ''} onClick={() => setTab('objects')}>Список</button><button className={tab === 'document' ? 'active' : ''} onClick={() => setTab('document')}>Документ</button></div>
    {tab === 'object' ? selectedIds.length > 1 ? <div className="fields"><div className="fields-heading"><span>Выбрано объектов: {selectedIds.length}</span></div><div className="section-label">Выравнивание</div><div className="align-grid"><button onClick={() => onAlign('left')}>По левому</button><button onClick={() => onAlign('centerX')}>Центр X</button><button onClick={() => onAlign('right')}>По правому</button><button onClick={() => onAlign('top')}>По верху</button><button onClick={() => onAlign('centerY')}>Центр Y</button><button onClick={() => onAlign('bottom')}>По низу</button></div><div className="helper-card"><b>Групповое выделение</b><span>Shift + клик добавляет или убирает объект. Перетаскивание двигает всю выбранную группу.</span></div></div> : object ? <ObjectFields object={object} onObject={onObject} onSelectChain={onSelectChain} moduleOptions={moduleOptions} legendForModule={legendForModule} onOpenModule={onOpenModule}/> : <div className="empty-inspector"><MousePointer2/><strong>Ничего не выбрано</strong><span>Выберите объект на эскизе, чтобы изменить его параметры.</span></div> : tab === 'objects' ? <div className="object-list">{project.objects.map((o, index) => <div key={o.id} className={selectedIds.includes(o.id) ? 'active' : ''}><button className="object-list-main" onClick={() => onSelect(o.id)}><b>{o.type === 'dimension' ? `${o.value} мм` : o.type === 'module' ? o.number : o.type === 'equipment' ? o.text : o.type === 'link' ? `Ссылка: ${o.text}` : o.type === 'callout' ? `Выноска: ${o.text}` : o.text}</b><span>{index + 1} · {o.type}</span></button><button title="Ниже" onClick={() => reorder(index, -1)}>↓</button><button title="Выше" onClick={() => reorder(index, 1)}>↑</button><button title={o.hidden ? 'Показать' : 'Скрыть'} onClick={() => onPatchObject(o.id, { hidden: !o.hidden })}>{o.hidden ? '○' : '◉'}</button><button title={o.locked ? 'Разблокировать' : 'Заблокировать'} onClick={() => onPatchObject(o.id, { locked: !o.locked })}>{o.locked ? '🔒' : '🔓'}</button></div>)}</div> : <DocumentFields project={project} showImage={showImage} showAnnotations={showAnnotations} onShowImage={onShowImage} onShowAnnotations={onShowAnnotations} onProject={onProject}/>}
    {tab === 'object' && selectedIds.length > 0 && <div className="inspector-bottom"><button onClick={onDuplicate}><Copy/>Дублировать <kbd>⌘D</kbd></button><button className="danger" onClick={onDelete}><Trash2/>Удалить</button></div>}
  </aside>
}

function ObjectFields({ object: o, onObject, onSelectChain, moduleOptions, legendForModule, onOpenModule }: { object: SketchObject; onObject: (p: Partial<SketchObject>) => void; onSelectChain: (chainId: string) => void; moduleOptions: SketchModuleOption[]; legendForModule?: (moduleId?: string) => SketchLegendRow[]; onOpenModule?: (moduleId: string) => void }) {
  const title = o.type === 'dimension' ? 'Размерная линия' : o.type === 'module' ? 'Модуль' : o.type === 'callout' ? 'Выноска' : o.type === 'equipment' ? 'Техника' : o.type === 'link' ? 'Ссылка' : 'Комментарий'
  return <div className="fields"><div className="fields-heading"><span>{title}</span><small>#{o.id.slice(0, 5)}</small></div><div className="section-label">Быстрый стиль</div><div className="preset-row"><button onClick={() => onObject(o.type === 'dimension' ? { color: '#20242b', fontSize: 22, lineWidth: 2 } as Partial<SketchObject> : { color: '#20242b', fill: '#ffffff', fillOpacity: 1, borderRadius: 6 } as Partial<SketchObject>)}>Чертёж</button><button onClick={() => onObject(o.type === 'dimension' ? { color: '#ff5c35', fontSize: 24, lineWidth: 3 } as Partial<SketchObject> : { color: '#c83c18', fill: '#fff0eb', fillOpacity: .95, borderRadius: 8 } as Partial<SketchObject>)}>Акцент</button><button onClick={() => onObject(o.type === 'dimension' ? { color: '#2563eb', fontSize: 22, lineWidth: 2 } as Partial<SketchObject> : { color: '#35568d', fill: '#f1f5ff', fillOpacity: .92, borderRadius: 4 } as Partial<SketchObject>)}>Монтаж</button></div>
    {o.type === 'dimension' && <><label>Значение<input value={o.value} onChange={e => onObject({ value: e.target.value } as Partial<SketchObject>)}/></label><div className="field-row"><label>Префикс<input placeholder="≈" value={o.prefix ?? ''} onChange={e => onObject({ prefix: e.target.value } as Partial<SketchObject>)}/></label><label>Допуск ±<input placeholder="2" value={o.tolerance ?? ''} onChange={e => onObject({ tolerance: e.target.value } as Partial<SketchObject>)}/></label></div><label>Примечание после размера<input placeholder="по факту" value={o.suffix ?? ''} onChange={e => onObject({ suffix: e.target.value } as Partial<SketchObject>)}/></label><label className="toggle-row">Показывать единицы «мм»<input type="checkbox" checked={o.showUnit !== false} onChange={e => onObject({ showUnit: e.target.checked } as Partial<SketchObject>)}/><i/></label>{o.chainId && <div className="chain-badge"><span>Сегмент цепочки · общий отступ</span><button onClick={() => onSelectChain(o.chainId!)}>Выделить цепочку</button></div>}<label>Ориентация<select value={o.orientation} onChange={e => { const orientation = e.target.value; onObject({ orientation, ...(orientation === 'horizontal' ? { y2: o.y } : orientation === 'vertical' ? { x2: o.x } : {}) } as Partial<SketchObject>) }}><option value="free">Свободная</option><option value="horizontal">Горизонтальная</option><option value="vertical">Вертикальная</option></select></label><label>Положение текста<select value={o.textOrientation ?? 'parallel'} onChange={e => onObject({ textOrientation: e.target.value } as Partial<SketchObject>)}><option value="parallel">Параллельно линии</option><option value="horizontal">Всегда горизонтально</option></select></label><label>Текст относительно линии<select value={o.textPosition ?? 'center'} onChange={e => onObject({ textPosition: e.target.value } as Partial<SketchObject>)}><option value="center">На линии</option><option value="above">Над линией</option><option value="below">Под линией</option></select></label><label>Отступ размерной линии, px<input type="number" value={Math.round(o.offset ?? 0)} onChange={e => onObject({ offset: +e.target.value } as Partial<SketchObject>)}/></label><label>Наконечники<select value={o.arrowStyle ?? 'open'} onChange={e => onObject({ arrowStyle: e.target.value } as Partial<SketchObject>)}><option value="open">Открытые стрелки</option><option value="closed">Закрытые стрелки</option><option value="tick">Засечки</option></select></label><label>Толщина линии<div className="range-row"><input type="range" min="1" max="6" step=".5" value={o.lineWidth} onChange={e => onObject({ lineWidth: +e.target.value } as Partial<SketchObject>)}/><span>{o.lineWidth}px</span></div></label></>}
    {o.type === 'module' && <>
      <label>Модуль из расчёта<select value={o.sourceModuleId ?? ''} onChange={e => { const option = moduleOptions.find(item => item.id === e.target.value); onObject({ sourceModuleId: option?.id, description: option?.description ?? o.description, materialRefs: option?.materialRefs } as Partial<SketchObject>) }}><option value="">Не связан</option>{moduleOptions.map(option => <option key={option.id} value={option.id}>{option.label} · {option.dimensions} мм</option>)}</select></label>
      {o.sourceModuleId && moduleOptions.find(option => option.id === o.sourceModuleId) && <div className="module-source-card"><b>{moduleOptions.find(option => option.id === o.sourceModuleId)?.label}</b><span>{moduleOptions.find(option => option.id === o.sourceModuleId)?.dimensions} мм</span>{onOpenModule && <button onClick={() => onOpenModule(o.sourceModuleId!)}>Открыть модуль в расчёте</button>}{legendForModule && <div className="material-legend"><strong>Материалы</strong>{legendForModule(o.sourceModuleId).map(row => <span key={row.code}><b>{row.code}</b> {row.name}</span>)}</div>}</div>}
      <label>Номер модуля<input autoFocus value={o.number} onChange={e => onObject({ number: e.target.value } as Partial<SketchObject>)}/></label><label>Описание<textarea rows={4} placeholder={'600\nНиз'} value={o.description} onChange={e => onObject({ description: e.target.value } as Partial<SketchObject>)}/></label></>}
    {(o.type === 'comment' || o.type === 'callout') && <label>Текст<textarea autoFocus rows={5} value={o.text} onChange={e => onObject({ text: e.target.value } as Partial<SketchObject>)}/></label>}
    {o.type === 'equipment' && <><label>Тип техники<select value={o.equipmentType} onChange={e => onObject({ equipmentType: e.target.value, text: e.target.value } as Partial<SketchObject>)}>{equipmentTypes.map(t => <option key={t}>{t}</option>)}</select></label><label>Подпись<input autoFocus value={o.text} onChange={e => onObject({ text: e.target.value } as Partial<SketchObject>)}/></label><label>Ссылка на модель<input type="url" placeholder="https://…" value={o.url || ''} onChange={e => onObject({ url: e.target.value } as Partial<SketchObject>)}/></label></>}
    {o.type === 'link' && <><label>Название<input autoFocus value={o.text} onChange={e => onObject({ text: e.target.value } as Partial<SketchObject>)}/></label><label>URL<input type="url" placeholder="https://…" value={o.url || ''} onChange={e => onObject({ url: e.target.value } as Partial<SketchObject>)}/></label>{o.url && <a className="test-link" href={o.url} target="_blank" rel="noreferrer"><ExternalLink/>Открыть ссылку</a>}</>}
    {o.type !== 'dimension' && <><div className="section-label">Оформление рамки</div><div className="field-row"><label>Заливка<input className="color-input" type="color" value={o.fill ?? (o.type === 'comment' ? '#fff8d8' : '#ffffff')} onChange={e => onObject({ fill: e.target.value } as Partial<SketchObject>)}/></label><label>Скругление<input type="number" min="0" max="40" value={o.borderRadius ?? 7} onChange={e => onObject({ borderRadius: +e.target.value } as Partial<SketchObject>)}/></label></div><label>Прозрачность заливки<div className="range-row"><input type="range" min="0" max="1" step=".05" value={o.fillOpacity ?? 1} onChange={e => onObject({ fillOpacity: +e.target.value } as Partial<SketchObject>)}/><span>{Math.round((o.fillOpacity ?? 1) * 100)}%</span></div></label></>}
    <label className="toggle-row">Заблокировать объект<input type="checkbox" checked={!!o.locked} onChange={e => onObject({ locked: e.target.checked } as Partial<SketchObject>)}/><i/></label>
    <div className="section-label">Положение</div><div className="field-row"><label>X<input type="number" value={Math.round(o.x)} onChange={e => onObject({ x: +e.target.value } as Partial<SketchObject>)}/></label><label>Y<input type="number" value={Math.round(o.y)} onChange={e => onObject({ y: +e.target.value } as Partial<SketchObject>)}/></label></div>
    {o.type !== 'dimension' && <><div className="section-label section-label-action"><span>Размер рамки</span><button onClick={() => onObject({ width: undefined, height: undefined } as Partial<SketchObject>)}>По тексту</button></div><div className="field-row"><label>Ширина<input type="number" min="60" placeholder="Авто" value={o.width ? Math.round(o.width) : ''} onChange={e => onObject({ width: e.target.value ? +e.target.value : undefined } as Partial<SketchObject>)}/></label><label>Высота<input type="number" min="36" placeholder="Авто" value={o.height ? Math.round(o.height) : ''} onChange={e => onObject({ height: e.target.value ? +e.target.value : undefined } as Partial<SketchObject>)}/></label></div></>}
    {o.type === 'dimension' && <div className="field-row"><label>Конец X<input type="number" value={Math.round(o.x2)} onChange={e => onObject({ x2: +e.target.value } as Partial<SketchObject>)}/></label><label>Конец Y<input type="number" value={Math.round(o.y2)} onChange={e => onObject({ y2: +e.target.value } as Partial<SketchObject>)}/></label></div>}
    <div className="field-row"><label>Цвет<input className="color-input" type="color" value={o.color} onChange={e => onObject({ color: e.target.value } as Partial<SketchObject>)}/></label><label>Размер текста<input type="number" min="12" max="64" value={o.fontSize} onChange={e => onObject({ fontSize: +e.target.value } as Partial<SketchObject>)}/></label></div>
    <div className="helper-card"><b>Быстрое редактирование</b><span>{o.type === 'dimension' ? 'Крайние маркеры меняют точки измерения, центральный — отступ размерной линии. Alt временно отключает привязку.' : 'Перетаскивайте объект за рамку. Синий маркер в правом нижнем углу изменяет ширину и высоту.'}</span></div>
  </div>
}

function DocumentFields({ project, showImage, showAnnotations, onShowImage, onShowAnnotations, onProject }: { project: SketchProject; showImage: boolean; showAnnotations: boolean; onShowImage: (v: boolean) => void; onShowAnnotations: (v: boolean) => void; onProject: (p: Partial<SketchProject>) => void }) {
  const h = project.header
  const updateHeader = (patch: Partial<typeof h>) => onProject({ header: { ...h, ...patch } })
  return <div className="fields"><div className="fields-heading"><span>Документ</span></div><div className="section-label">Слои</div><label className="toggle-row"><ImageIcon/>Изображение<input type="checkbox" checked={showImage} onChange={e => onShowImage(e.target.checked)}/><i/></label><label className="toggle-row"><MessageSquareText/>Аннотации <small>{project.objects.length}</small><input type="checkbox" checked={showAnnotations} onChange={e => onShowAnnotations(e.target.checked)}/><i/></label><div className="section-label">Информационная шапка</div><label className="toggle-row">Показывать шапку<input type="checkbox" checked={h.enabled} onChange={e => updateHeader({ enabled: e.target.checked })}/><i/></label>{h.enabled && <><label>Проект<input value={h.project} placeholder="Ивановы" onChange={e => updateHeader({ project: e.target.value })}/></label><label>Помещение<input value={h.room} onChange={e => updateHeader({ room: e.target.value })}/></label><div className="field-row"><label>Дата<input value={h.date} onChange={e => updateHeader({ date: e.target.value })}/></label><label>Вариант<input value={h.variant} onChange={e => updateHeader({ variant: e.target.value })}/></label></div></>}</div>
}

export default Editor
