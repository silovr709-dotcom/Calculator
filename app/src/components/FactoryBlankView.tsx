import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Pricebook, Project } from '../types';
import { checkFactoryBlank, draftFactoryBlank, FACTORY_BLANK_SPECS, factoryBlankProgress, type BlankIssue } from '../lib/factoryBlank';
import { checkDictRules, factoryDictSuggestionGroups, loadFactoryDicts, type FactoryDicts } from '../lib/factoryDicts';
import { BACK_EDGE_NOTE, checkWorktopPlan, edgeKindLabel, suggestWorktopPlan, WORKTOP_EDGE_KINDS } from '../lib/worktopPlan';
import { autoArrangeWorktopPieces, nextWorktopEdgeKind, renderWorktopPlanPng, snapWorktopPiecePosition, WORKTOP_EDGE_SHORT_LABELS, worktopDimensionPlacement, worktopEdgeLabelPlacement, worktopEdgeSymbol, worktopSketchMetrics, type WorktopEdgeSide, type WorktopSketchLayoutMode, type WorktopSketchPieceLayout } from '../lib/worktopSketch';
import { lineMatchesChecklistKey } from '../lib/checklist';
import { blankCellRefLabel, blankSketchRangeLabel, exportFactoryBlankXlsx, getBlankSheetMap, type FactoryTechPack } from '../lib/factoryBlankXls';
import { buildFactoryTechCommunicationRows, buildFactoryTechModuleRows, buildFactoryTechReadinessRows, factoryTechReadinessSummary } from '../lib/factoryTechPack';
import { uid } from '../lib/storage';
import { evaluateNumericExpression } from '../lib/numericExpression';
import type { WorktopEdgeKind, WorktopPiece } from '../types';
import { snapshotProject, type EskizProject } from '../lib/eskizPro';
import { renderEskizSketchPng, type EskizSketchModuleMarkerMode } from '../lib/eskizSketchExport';
import EskizProjectPreview from './EskizProjectPreview';

const NO_PIECES: WorktopPiece[] = [];

function fitEskizExportSize(project: EskizProject, box: { width: number; height: number }) {
  const sourceWidth = Math.max(1, project.image.width);
  const sourceHeight = Math.max(1, project.image.height);
  const scale = Math.min(box.width / sourceWidth, box.height / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

const WORKTOP_EDGE_SIDES: { id: WorktopEdgeSide; label: string }[] = [
  { id: 'front', label: 'Перед' },
  { id: 'back', label: 'Зад' },
  { id: 'left', label: 'Левый торец' },
  { id: 'right', label: 'Правый / стык' },
];

const WORKTOP_SKETCH_WIDTH = 900;
const WORKTOP_SKETCH_HEIGHT = 390;
type WorktopDimensionLabelKey = 'horizontal' | 'vertical';

function parseWorktopMm(value: string): number | null {
  const source = value.replace(/мм/giu, '').trim();
  if (!source) return null;
  const calculated = evaluateNumericExpression(source);
  const parsed = calculated ?? Number(source.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function WorktopMmInput(props: { value: number | null | undefined; onValue: (value: number | null) => void; placeholder?: string; className?: string }) {
  const externalValue = props.value == null ? '' : String(props.value);
  const [draftState, setDraftState] = useState(() => ({ externalValue, draft: externalValue }));
  const draft = draftState.externalValue === externalValue ? draftState.draft : externalValue;
  const setDraft = (nextDraft: string) => setDraftState({ externalValue, draft: nextDraft });
  const commit = (input: HTMLInputElement) => {
    const raw = input.value.trim();
    if (!raw) {
      setDraft('');
      props.onValue(null);
      return;
    }
    const parsed = parseWorktopMm(raw);
    if (parsed == null) {
      setDraft(externalValue);
      return;
    }
    setDraft(String(parsed));
    props.onValue(parsed);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      data-number-calculator="true"
      data-number-calculator-commit="blur"
      className={props.className}
      value={draft}
      placeholder={props.placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => commit(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') { event.preventDefault(); commit(event.currentTarget); event.currentTarget.blur(); }
        if (event.key === 'Escape') { event.preventDefault(); setDraft(externalValue); event.currentTarget.blur(); }
      }}
    />
  );
}

function WorktopSvgEdgeMark({ kind }: { kind: WorktopEdgeKind }) {
  if (kind === 'eurozapil') {
    return <g fill="#4f86b7" stroke="#4f86b7" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
      <path d="M -17 -7 L -7 -3 L -17 1 Z" />
      <path d="M 17 -7 L 7 -3 L 17 1 Z" />
      <line x1="-7" y1="-3" x2="7" y2="-3" />
      <path d="M -17 1 L -7 5 L -17 9 Z" />
      <path d="M 17 1 L 7 5 L 17 9 Z" />
      <line x1="-7" y1="5" x2="7" y2="5" />
    </g>;
  }
  if (kind === 'eurostyk') {
    return <g fill="none" stroke="#4f86b7" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
      <path d="M -18 0 H 18" />
      <path d="M -18 0 L -10 -6 M -18 0 L -10 6 M 18 0 L 10 -6 M 18 0 L 10 6" />
      <path d="M -3 -8 H 3 V 8 H -3 Z" fill="#fff" />
      <path d="M -3 -8 H 3 V 8 H -3 Z" />
    </g>;
  }
  return <text textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={900} fill="#184f9e">{worktopEdgeSymbol(kind)}</text>;
}

function WorktopEdgeButtonMark({ kind }: { kind: WorktopEdgeKind }) {
  if (kind === 'eurozapil' || kind === 'eurostyk') {
    return <svg className="blank-worktop-edge-icon" viewBox="-22 -13 44 28" aria-hidden="true"><WorktopSvgEdgeMark kind={kind} /></svg>;
  }
  return <>{worktopEdgeSymbol(kind)}</>;
}

function WorktopSvgEdgeLabel(props: { kind: WorktopEdgeKind; x: number; y: number; rotate?: number; onClick: () => void }) {
  const symbol = worktopEdgeSymbol(props.kind);
  const width = props.kind === 'eurozapil' || props.kind === 'eurostyk' ? 46 : Math.max(24, symbol.length * 8 + 12);
  return <g className="blank-worktop-svg-edge-label" transform={`translate(${props.x} ${props.y}) rotate(${props.rotate ?? 0})`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); props.onClick(); }}>
    <rect x={-width / 2} y={-12} width={width} height={24} rx={6} fill="#fff" stroke="#1f6feb" strokeWidth={1.4} />
    <WorktopSvgEdgeMark kind={props.kind} />
  </g>;
}



function WorktopSvgDimensionLabel(props: { value: number | null | undefined; x: number; y: number; rotate?: number; onPointerDown?: (event: ReactPointerEvent<SVGGElement>) => void }) {
  if (!props.value) return null;
  const text = `${props.value} мм`;
  const width = Math.max(48, text.length * 6.6 + 14);
  return <g
    className="blank-worktop-svg-dimension-label"
    transform={`translate(${props.x} ${props.y}) rotate(${props.rotate ?? 0})`}
    onPointerDown={(event) => { event.stopPropagation(); props.onPointerDown?.(event); }}
  >
    <rect x={-width / 2} y={-10} width={width} height={20} rx={5} fill="#fff" stroke="#c9d8ea" strokeWidth={1} />
    <text textAnchor="middle" dominantBaseline="middle" fontSize={11} fontWeight={800} fill="#111827">{text}</text>
  </g>;
}

function WorktopPlanDesigner(props: {
  pieces: WorktopPiece[];
  onPiece: (id: string, patch: Partial<WorktopPiece>) => void;
  onReplace: (pieces: WorktopPiece[]) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  const [selectedStateId, setSelectedId] = useState<string | null>(null);
  const [snapHint, setSnapHint] = useState('');
  const dragRef = useRef<{ id: string; startClientX: number; startClientY: number; originX: number; originY: number; scale: number; moved: boolean } | null>(null);
  const dimensionDragRef = useRef<{ id: string; key: WorktopDimensionLabelKey; startClientX: number; startClientY: number; originXmm: number; originYmm: number; scale: number } | null>(null);
  const metrics = useMemo(() => worktopSketchMetrics(props.pieces, WORKTOP_SKETCH_WIDTH, WORKTOP_SKETCH_HEIGHT, true), [props.pieces]);
  const selectedId = props.pieces.some((piece) => piece.id === selectedStateId) ? selectedStateId : null;
  const selectedPiece = props.pieces.find((piece) => piece.id === selectedId) ?? null;
  const selectedLayout = metrics.layouts.find((layout) => layout.piece.id === selectedId) ?? null;

  const arrange = (mode: WorktopSketchLayoutMode) => props.onReplace(autoArrangeWorktopPieces(props.pieces, mode));
  const cycleEdge = (piece: WorktopPiece, side: WorktopEdgeSide) => props.onPiece(piece.id, { [side]: nextWorktopEdgeKind(piece[side]) } as Partial<WorktopPiece>);
  const nudgeSelected = (dx: number, dy: number) => {
    if (!selectedLayout) return;
    props.onPiece(selectedLayout.piece.id, { layoutXmm: Math.max(0, Math.round((selectedLayout.x + dx) / 10) * 10), layoutYmm: Math.max(0, Math.round((selectedLayout.y + dy) / 10) * 10) });
  };
  const duplicateSelected = () => {
    if (!selectedLayout) return;
    const copy: WorktopPiece = {
      ...selectedLayout.piece,
      id: uid('wp'),
      name: `${selectedLayout.piece.name || 'Деталь'} копия`,
      layoutXmm: Math.max(0, Math.round((selectedLayout.x + selectedLayout.width + 80) / 10) * 10),
      layoutYmm: Math.max(0, Math.round(selectedLayout.y / 10) * 10),
    };
    props.onReplace([...props.pieces, copy]);
    setSelectedId(copy.id);
  };
  const selectedScreen = selectedLayout ? {
    x: metrics.offsetX + selectedLayout.x * metrics.scale,
    y: metrics.offsetY + selectedLayout.y * metrics.scale,
    width: selectedLayout.width * metrics.scale,
    height: selectedLayout.height * metrics.scale,
  } : null;
  const editorLeftPx = selectedScreen
    ? (selectedScreen.x + selectedScreen.width + 310 > WORKTOP_SKETCH_WIDTH ? selectedScreen.x - 320 : selectedScreen.x + selectedScreen.width + 14)
    : 16;
  const editorTopPx = selectedScreen ? selectedScreen.y : 18;
  const editorStyle = {
    left: `${Math.max(1, Math.min(64, editorLeftPx / WORKTOP_SKETCH_WIDTH * 100))}%`,
    top: `${Math.max(3, Math.min(58, editorTopPx / WORKTOP_SKETCH_HEIGHT * 100))}%`,
  };

  const startDrag = (event: ReactPointerEvent<SVGGElement>, layout: WorktopSketchPieceLayout) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(layout.piece.id);
    dragRef.current = {
      id: layout.piece.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: layout.x,
      originY: layout.y,
      scale: metrics.scale || 1,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const startDimensionDrag = (
    event: ReactPointerEvent<SVGGElement>,
    layout: WorktopSketchPieceLayout,
    key: WorktopDimensionLabelKey,
    placement: { x: number; y: number },
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(layout.piece.id);
    dragRef.current = null;
    dimensionDragRef.current = {
      id: layout.piece.id,
      key,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originXmm: (placement.x - metrics.offsetX) / (metrics.scale || 1),
      originYmm: (placement.y - metrics.offsetY) / (metrics.scale || 1),
      scale: metrics.scale || 1,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const resetDimensionLabels = (piece: WorktopPiece) => {
    props.onPiece(piece.id, { dimensionLabels: undefined });
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const dimensionDrag = dimensionDragRef.current;
    if (dimensionDrag) {
      event.preventDefault();
      const dx = (event.clientX - dimensionDrag.startClientX) / dimensionDrag.scale;
      const dy = (event.clientY - dimensionDrag.startClientY) / dimensionDrag.scale;
      const currentPiece = props.pieces.find((piece) => piece.id === dimensionDrag.id);
      props.onPiece(dimensionDrag.id, {
        dimensionLabels: {
          ...(currentPiece?.dimensionLabels ?? {}),
          [dimensionDrag.key]: {
            xMm: Math.round((dimensionDrag.originXmm + dx) / 5) * 5,
            yMm: Math.round((dimensionDrag.originYmm + dy) / 5) * 5,
          },
        },
      });
      setSnapHint('Размер перемещён вручную — экспорт в Excel повторит это положение');
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    const dx = (event.clientX - drag.startClientX) / drag.scale;
    const dy = (event.clientY - drag.startClientY) / drag.scale;
    if (Math.abs(event.clientX - drag.startClientX) > 2 || Math.abs(event.clientY - drag.startClientY) > 2) drag.moved = true;
    const snapped = snapWorktopPiecePosition(metrics.layouts, drag.id, drag.originX + dx, drag.originY + dy, 55);
    props.onPiece(drag.id, { layoutXmm: snapped.x, layoutYmm: snapped.y });
    setSnapHint(snapped.snapX || snapped.snapY ? `Прилипло: ${[snapped.snapX ? 'по вертикали' : '', snapped.snapY ? 'по горизонтали' : ''].filter(Boolean).join(' и ')}` : '');
  };
  const finishDrag = () => {
    if (!dragRef.current && !dimensionDragRef.current) return;
    dragRef.current = null;
    dimensionDragRef.current = null;
    window.setTimeout(() => setSnapHint(''), 900);
  };

  return <div className="blank-worktop-designer">
    <div className="blank-worktop-designer-head">
      <div>
        <b>Визуальная схема столешницы</b>
        <span>Тяните детали и сами плашки размеров мышью/пальцем. Края и центры деталей прилипают друг к другу; перенос размеров повторится в Excel-бланке.</span>
      </div>
      <div className="blank-worktop-layout-buttons">
        <button type="button" onClick={() => arrange('line')}>Прямая</button>
        <button type="button" onClick={() => arrange('corner')}>Г-угол</button>
        <button type="button" onClick={() => arrange('u')} disabled={props.pieces.length < 3}>П-форма</button>
        <button type="button" onClick={props.onAdd}>+ деталь</button>
      </div>
    </div>
    <div className="blank-worktop-sketch blank-worktop-sketch-interactive">
      <svg width={WORKTOP_SKETCH_WIDTH} height={WORKTOP_SKETCH_HEIGHT} viewBox={`0 0 ${WORKTOP_SKETCH_WIDTH} ${WORKTOP_SKETCH_HEIGHT}`} onPointerMove={onPointerMove} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
        <rect x="0" y="0" width={WORKTOP_SKETCH_WIDTH} height={WORKTOP_SKETCH_HEIGHT} fill="#ffffff" />
        <text x="14" y="22" fontSize="13" fontWeight="900" fill="#24382f">Схема столешницы — как в листе 2 бланка</text>
        {metrics.layouts.map((layout, index) => {
          const piece = layout.piece;
          const x = metrics.offsetX + layout.x * metrics.scale;
          const y = metrics.offsetY + layout.y * metrics.scale;
          const width = layout.width * metrics.scale;
          const height = layout.height * metrics.scale;
          const centerX = x + width / 2;
          const centerY = y + height / 2;
          const selected = selectedId === piece.id;
          const name = piece.name || `Деталь ${index + 1}`;
          const size = `${piece.lengthMm ?? '—'}×${piece.widthMm ?? '—'} мм${layout.rotated ? ' · повернута' : ''}`;
          const dim = worktopDimensionPlacement(layout, metrics, WORKTOP_SKETCH_WIDTH, WORKTOP_SKETCH_HEIGHT);
          const backLabel = worktopEdgeLabelPlacement(layout, metrics, 'back', WORKTOP_SKETCH_WIDTH, WORKTOP_SKETCH_HEIGHT);
          const frontLabel = worktopEdgeLabelPlacement(layout, metrics, 'front', WORKTOP_SKETCH_WIDTH, WORKTOP_SKETCH_HEIGHT);
          const leftLabel = worktopEdgeLabelPlacement(layout, metrics, 'left', WORKTOP_SKETCH_WIDTH, WORKTOP_SKETCH_HEIGHT);
          const rightLabel = worktopEdgeLabelPlacement(layout, metrics, 'right', WORKTOP_SKETCH_WIDTH, WORKTOP_SKETCH_HEIGHT);
          return <g key={piece.id} className={`blank-worktop-svg-piece ${selected ? 'selected' : ''}`} onPointerDown={(event) => startDrag(event, layout)} onClick={() => setSelectedId(piece.id)}>
            <rect x={x} y={y} width={width} height={height} rx="3" fill="#ffffff" stroke={selected ? '#ff5c35' : '#7a8380'} strokeWidth={selected ? 2.8 : 1.8} strokeDasharray={selected ? '0' : '9 6'} />
            <text x={centerX} y={centerY - 8} textAnchor="middle" fontSize="13" fontWeight="900" fill="#1f2f29">{name}</text>
            <text x={centerX} y={centerY + 10} textAnchor="middle" fontSize="11" fontWeight="700" fill="#55685d">{size}</text>
            <WorktopSvgDimensionLabel value={dim.horizontalValue} x={dim.horizontal.x} y={dim.horizontal.y} rotate={dim.horizontal.rotate} onPointerDown={(event) => startDimensionDrag(event, layout, 'horizontal', dim.horizontal)} />
            <WorktopSvgDimensionLabel value={dim.verticalValue} x={dim.vertical.x} y={dim.vertical.y} rotate={dim.vertical.rotate} onPointerDown={(event) => startDimensionDrag(event, layout, 'vertical', dim.vertical)} />
            {piece.back && <><line x1={x} y1={y} x2={x + width} y2={y} stroke="#1f6feb" strokeWidth="3.2" strokeLinecap="round" /><WorktopSvgEdgeLabel kind={piece.back} x={backLabel.x} y={backLabel.y} rotate={backLabel.rotate} onClick={() => cycleEdge(piece, 'back')} /></>}
            {piece.front && <><line x1={x} y1={y + height} x2={x + width} y2={y + height} stroke="#1f6feb" strokeWidth="3.2" strokeLinecap="round" /><WorktopSvgEdgeLabel kind={piece.front} x={frontLabel.x} y={frontLabel.y} rotate={frontLabel.rotate} onClick={() => cycleEdge(piece, 'front')} /></>}
            {piece.left && <><line x1={x} y1={y} x2={x} y2={y + height} stroke="#1f6feb" strokeWidth="3.2" strokeLinecap="round" /><WorktopSvgEdgeLabel kind={piece.left} x={leftLabel.x} y={leftLabel.y} rotate={leftLabel.rotate} onClick={() => cycleEdge(piece, 'left')} /></>}
            {piece.right && <><line x1={x + width} y1={y} x2={x + width} y2={y + height} stroke="#1f6feb" strokeWidth="3.2" strokeLinecap="round" /><WorktopSvgEdgeLabel kind={piece.right} x={rightLabel.x} y={rightLabel.y} rotate={rightLabel.rotate} onClick={() => cycleEdge(piece, 'right')} /></>}
            {selected && <>
              <rect data-worktop-edge-hotspot="true" x={x} y={y - 16} width={width} height="32" className="blank-worktop-edge-hotspot" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); cycleEdge(piece, 'back'); }}><title>Зад: переключить обработку. Если оставить пустым — ПВХ 0,4 белая по умолчанию.</title></rect>
              <rect data-worktop-edge-hotspot="true" x={x} y={y + height - 16} width={width} height="32" className="blank-worktop-edge-hotspot" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); cycleEdge(piece, 'front'); }}><title>Перед: переключить обработку</title></rect>
              <rect data-worktop-edge-hotspot="true" x={x - 16} y={y} width="32" height={height} className="blank-worktop-edge-hotspot" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); cycleEdge(piece, 'left'); }}><title>Левый торец: переключить обработку</title></rect>
              <rect data-worktop-edge-hotspot="true" x={x + width - 16} y={y} width="32" height={height} className="blank-worktop-edge-hotspot" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); cycleEdge(piece, 'right'); }}><title>Правый торец/стык: переключить обработку</title></rect>
            </>}
          </g>;
        })}
        {props.pieces.length === 0 && <text x={WORKTOP_SKETCH_WIDTH / 2} y={WORKTOP_SKETCH_HEIGHT / 2} textAnchor="middle" fontSize="14" fontWeight="800" fill="#81918a">Добавьте деталь столешницы</text>}
        <g transform={`translate(14 ${WORKTOP_SKETCH_HEIGHT - 44})`}>
          <rect x="0" y="0" width={WORKTOP_SKETCH_WIDTH - 28} height="34" rx="8" fill="#f7fbf9" stroke="#d8e5df" />
          <text x="12" y="22" fontSize="11" fontWeight="900" fill="#24382f">V — кромка в цвет</text>
          <text x="155" y="22" fontSize="11" fontWeight="900" fill="#24382f">Х — кромка ПВХ</text>
          <text x="292" y="22" fontSize="11" fontWeight="900" fill="#24382f">ПФ — постформинг</text>
          <text x="448" y="22" fontSize="11" fontWeight="900" fill="#24382f">// — еврозапил</text>
          <text x="575" y="22" fontSize="11" fontWeight="900" fill="#24382f">≈ — евростык</text>
        </g>
      </svg>
      {snapHint && <div className="blank-worktop-snap-hint">{snapHint}</div>}
      {selectedPiece && selectedLayout && <div className="blank-worktop-inline-editor" style={editorStyle} onPointerDown={(event) => event.stopPropagation()}>
        <header><b>{selectedPiece.name || 'Деталь'}</b><button type="button" onClick={() => setSelectedId(null)}>×</button></header>
        <label>Название<input value={selectedPiece.name} onChange={(event) => props.onPiece(selectedPiece.id, { name: event.target.value })} /></label>
        <div className="blank-worktop-inline-sizes">
          <label>Длина, мм<WorktopMmInput value={selectedPiece.lengthMm} onValue={(value) => props.onPiece(selectedPiece.id, { lengthMm: value })} placeholder="например 2400" /></label>
          <label>Ширина, мм<WorktopMmInput value={selectedPiece.widthMm} onValue={(value) => props.onPiece(selectedPiece.id, { widthMm: value })} placeholder="600" /></label>
        </div>
        <div className="blank-worktop-edge-buttons compact">
          {WORKTOP_EDGE_SIDES.map((side) => {
            const kind = selectedPiece[side.id];
            return <button key={side.id} type="button" className={kind ? 'active' : ''} onClick={() => cycleEdge(selectedPiece, side.id)} title={kind ? WORKTOP_EDGE_SHORT_LABELS[kind] : 'Не отмечено'}><small>{side.label}</small><b>{kind ? <WorktopEdgeButtonMark kind={kind} /> : '—'}</b></button>;
          })}
        </div>
        <div className="blank-worktop-nudge-grid">
          <button type="button" onClick={() => nudgeSelected(-10, 0)}>← 10</button>
          <button type="button" onClick={() => nudgeSelected(0, -10)}>↑ 10</button>
          <button type="button" onClick={() => nudgeSelected(0, 10)}>↓ 10</button>
          <button type="button" onClick={() => nudgeSelected(10, 0)}>→ 10</button>
        </div>
        <div className="blank-worktop-card-actions compact-actions">
          <button type="button" onClick={() => props.onPiece(selectedPiece.id, { rotated: !selectedPiece.rotated, dimensionLabels: undefined })}>{selectedPiece.rotated ? 'Горизонтально' : 'Вертикально'}</button>
          <button type="button" onClick={() => props.onPiece(selectedPiece.id, { layoutXmm: null, layoutYmm: null, dimensionLabels: undefined })}>Авто-позиция</button>
          <button type="button" onClick={() => resetDimensionLabels(selectedPiece)}>Сброс размеров</button>
          <button type="button" onClick={duplicateSelected}>Дублировать</button>
          <button type="button" className="danger" onClick={() => props.onRemove(selectedPiece.id)}>Удалить</button>
        </div>
      </div>}
    </div>
    <div className="blank-worktop-piece-grid">
      {props.pieces.length === 0 ? <div className="empty small">Добавьте деталь — схема появится здесь и уйдёт в лист 2 Excel.</div> : props.pieces.map((piece, index) => (
        <div key={piece.id} className={`blank-worktop-piece-card ${selectedId === piece.id ? 'active' : ''}`} onClick={() => setSelectedId(piece.id)}>
          <header><b>{piece.name || `Деталь ${index + 1}`}</b><span>{piece.lengthMm ?? '—'}×{piece.widthMm ?? '—'} мм</span></header>
          <div className="blank-worktop-mini-sizes" onClick={(event) => event.stopPropagation()}>
            <label>Длина<WorktopMmInput value={piece.lengthMm} onValue={(value) => props.onPiece(piece.id, { lengthMm: value })} placeholder="мм" /></label>
            <label>Ширина<WorktopMmInput value={piece.widthMm} onValue={(value) => props.onPiece(piece.id, { widthMm: value })} placeholder="мм" /></label>
          </div>
          <div className="blank-worktop-edge-buttons" onClick={(event) => event.stopPropagation()}>
            {WORKTOP_EDGE_SIDES.map((side) => {
              const kind = piece[side.id];
              return <button key={side.id} type="button" className={kind ? 'active' : ''} onClick={() => cycleEdge(piece, side.id)} title={kind ? WORKTOP_EDGE_SHORT_LABELS[kind] : 'Не отмечено'}><small>{side.label}</small><b>{kind ? <WorktopEdgeButtonMark kind={kind} /> : '—'}</b></button>;
            })}
          </div>
          <div className="blank-worktop-card-actions" onClick={(event) => event.stopPropagation()}>
            <button type="button" onClick={() => props.onPiece(piece.id, { rotated: !piece.rotated, dimensionLabels: undefined })}>{piece.rotated ? 'Повернуть горизонтально' : 'Повернуть вертикально'}</button>
            <button type="button" className="danger" onClick={() => props.onRemove(piece.id)}>Удалить</button>
          </div>
        </div>
      ))}
    </div>
  </div>;
}

function FactoryDictPicker(props: {
  fieldKey: string;
  dicts: FactoryDicts;
  query: string;
  onQuery: (value: string) => void;
  onInsert: (value: string) => void;
}) {
  const collapsedLimit = 7;
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const groups = useMemo(
    () => factoryDictSuggestionGroups(props.fieldKey, props.dicts, props.query, 10000, props.fieldKey === 'facadeColor' ? 64 : 40),
    [props.dicts, props.fieldKey, props.query],
  );
  const isExpanded = (groupKey: string) => Boolean(expandedGroups[groupKey]);
  const toggleGroup = (groupKey: string) => setExpandedGroups((current) => ({ ...current, [groupKey]: !current[groupKey] }));
  const shown = groups.reduce((sum, group) => sum + (isExpanded(`${props.fieldKey}|${group.id}|${group.title}`) ? group.items.length : Math.min(collapsedLimit, group.items.length)), 0);
  const total = groups.reduce((sum, group) => sum + group.total, 0);
  if (total === 0 && !props.query) return null;
  const hint = props.fieldKey === 'facadeColor'
    ? 'ПВХ-плёнки, пластики/HPL (ARPA, FENIX, AGT, Rexay, ABET), Rehau-кромка 1,3мм и Compact Slotex — с группировкой по производителю и коллекции.'
    : props.fieldKey === 'ldspColor' || props.fieldKey === 'corpusColor'
      ? 'ЛДСП сгруппированы по производителю и категории; текстурные позиции помечены «!». '
      : 'Справочник сгруппирован по типу материала, производителю и категории.';
  return (
    <details className="dict-smart-picker">
      <summary>
        <span>+ справочник разбивок</span>
        <small>{shown} показано{total > shown ? ` · ${total} найдено` : ''}</small>
      </summary>
      <div className="dict-search-row">
        <input
          value={props.query}
          placeholder="поиск: код, цвет, Rehau, AGT, FENIX, категория…"
          onChange={(e) => props.onQuery(e.target.value)}
        />
        {props.query && <button type="button" className="btn tiny ghost" onClick={() => props.onQuery('')}>очистить</button>}
      </div>
      <div className="dict-picker-hint">{hint}</div>
      {shown === 0 ? (
        <div className="empty small">Ничего не найдено. Попробуйте код, производителя или часть названия цвета.</div>
      ) : (
        <div className="dict-group-list">
          {groups.map((group) => {
            const groupKey = `${props.fieldKey}|${group.id}|${group.title}`;
            const expanded = isExpanded(groupKey);
            const visibleItems = expanded ? group.items : group.items.slice(0, collapsedLimit);
            const hiddenCount = Math.max(0, group.items.length - visibleItems.length);
            const canExpand = group.items.length > collapsedLimit;
            return (
              <section key={`${group.id}-${group.title}`} className={`dict-group-block ${expanded ? 'expanded' : ''}`}>
                <header>
                  <button
                    type="button"
                    className={`dict-group-title ${canExpand ? 'expandable' : 'static'}`}
                    aria-expanded={expanded}
                    title={canExpand ? 'Нажмите, чтобы раскрыть/свернуть категорию' : undefined}
                    onClick={() => canExpand && toggleGroup(groupKey)}
                  >
                    <span className="dict-group-chevron">{canExpand ? (expanded ? '▾' : '▸') : '•'}</span>
                    <span>
                      <b>{group.title}</b>
                      {group.subtitle && <span>{group.subtitle}</span>}
                    </span>
                  </button>
                  <em>{group.total}</em>
                </header>
                <div className="dict-card-grid">
                  {visibleItems.map((item) => (
                    <button
                      key={`${group.id}-${item.value}`}
                      type="button"
                      className={`dict-card status-${item.status ?? 'ok'}`}
                      title={item.value}
                      onClick={() => props.onInsert(item.value)}
                    >
                      <span className="dict-card-title">{item.title}</span>
                      {item.subtitle && <span className="dict-card-subtitle">{item.subtitle}</span>}
                      {item.badges.length > 0 && (
                        <span className="dict-badges">
                          {item.badges.slice(0, 4).map((badge) => <i key={badge}>{badge}</i>)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
                {canExpand && (
                  <button type="button" className="dict-more-note" onClick={() => toggleGroup(groupKey)}>
                    {expanded ? 'Свернуть категорию' : `Показать все ${group.items.length}${hiddenCount ? ` · ещё ${hiddenCount}` : ''}`}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}
    </details>
  );
}

/**
 * Экран «Бланк на фабрику»: Калькулятор → Автоподстановка → Ручная корректура → Проверка → Печать.
 * Поля и обязательность — из бланков и инструкций фабрики (docs прилагаются к репозиторию).
 * Автоподставленные значения не редактируют исходные данные проекта: ручные правки
 * складываются в черновик бланка (project.factoryBlankDrafts) и всегда можно вернуться к авто.
 */
export default function FactoryBlankView(props: {
  projects: Project[];
  pricebooks: Pricebook[];
  initialProjectId?: string;
  onOpenProject: (id: string) => void;
  onChangeProject: (p: Project) => void;
}) {
  const [projectId, setProjectId] = useState<string | undefined>(props.initialProjectId ?? props.projects[0]?.id);
  const [specId, setSpecId] = useState<string>(FACTORY_BLANK_SPECS[0].id);
  const [dicts, setDicts] = useState<FactoryDicts | null>(null);
  const [dictQueries, setDictQueries] = useState<Record<string, string>>({});
  const [exporting, setExporting] = useState(false);
  const [showOnlyIssues, setShowOnlyIssues] = useState(false);

  useEffect(() => {
    loadFactoryDicts(import.meta.env.BASE_URL).then(setDicts);
  }, []);

  const project = props.projects.find((p) => p.id === projectId) ?? props.projects[0];
  const spec = FACTORY_BLANK_SPECS.find((s) => s.id === specId) ?? FACTORY_BLANK_SPECS[0];
  const pricebook = project
    ? props.pricebooks.find((pb) => pb.meta.id === project.pricebookId) ?? props.pricebooks[0]
    : props.pricebooks[0];

  const draft = useMemo(
    () => (project && pricebook ? draftFactoryBlank(project, pricebook, spec) : []),
    [project, pricebook, spec],
  );
  const hasWorktopPlanSection = spec.fields.some((f) => f.autoFrom === 'worktop');
  const hasWorktopInProject = Boolean(project?.lines.some((l) => lineMatchesChecklistKey('worktop', l)));
  const pieces = project?.worktopPlan ?? NO_PIECES;
  const eskizSnapshots = useMemo(() => (project?.eskizPro?.snapshots ?? []).flatMap((snapshot) => {
    const eskizProject = snapshotProject(snapshot);
    return eskizProject ? [{ snapshot, project: eskizProject }] : [];
  }), [project]);
  const planIssues = useMemo<BlankIssue[]>(() =>
    hasWorktopPlanSection && hasWorktopInProject
      ? checkWorktopPlan(pieces, true).map((i) => ({ fieldKey: 'worktopPlan', label: 'Лист 2', level: i.level, text: i.text }))
      : []
  , [hasWorktopPlanSection, hasWorktopInProject, pieces]);

  const replacePieces = (next: WorktopPiece[]) => {
    if (!project) return;
    props.onChangeProject({ ...project, worktopPlan: next });
  };
  const updatePiece = (id: string, patch: Partial<WorktopPiece>) => {
    replacePieces(pieces.map((piece) => (piece.id === id ? { ...piece, ...patch } : piece)));
  };

  const issues = useMemo<BlankIssue[]>(() => {
    if (!project || !pricebook) return [];
    const base = checkFactoryBlank(project, pricebook, spec, draft);
    // Проверки по правилам самих разбивок (текстура «!», выведенные/снятые позиции)
    const dict = dicts ? checkDictRules(draft, dicts) : [];
    return [...base, ...dict, ...planIssues];
  }, [project, pricebook, spec, draft, dicts, planIssues]);
  const progress = useMemo(() => factoryBlankProgress(draft), [draft]);
  const removePiece = (id: string) => {
    replacePieces(pieces.filter((piece) => piece.id !== id));
  };
  const addPiece = () => {
    const arranged = autoArrangeWorktopPieces([
      ...pieces,
      { id: uid('wp'), name: `Деталь ${pieces.length + 1}`, lengthMm: null, widthMm: null, front: null, back: null, left: null, right: null },
    ], 'line');
    replacePieces(arranged);
  };
  const fillPlanFromProject = () => {
    if (!project) return;
    const suggested = suggestWorktopPlan(project);
    if (suggested.length === 0) { alert('В чек-листе проекта нет столешницы — добавьте её там или нарисуйте деталь вручную.'); return; }
    if (pieces.length > 0 && !confirm('Заменить текущую схему автоподстановкой из проекта?')) return;
    replacePieces(autoArrangeWorktopPieces(suggested, 'line'));
  };

  if (!project || !pricebook) {
    return (
      <div className="page">
        <header className="page-head"><div><h1>Бланк на фабрику</h1></div></header>
        <div className="empty">Сначала создайте проект в разделе «Проекты» — бланк заполняется из данных проекта.</div>
      </div>
    );
  }

  const setDraftValue = (key: string, value: string) => {
    const drafts = { ...(project.factoryBlankDrafts ?? {}) };
    const perSpec = { ...(drafts[spec.id] ?? {}) };
    if (value === '') delete perSpec[key];
    else perSpec[key] = value;
    if (Object.keys(perSpec).length === 0) delete drafts[spec.id];
    else drafts[spec.id] = perSpec;
    props.onChangeProject({ ...project, factoryBlankDrafts: drafts });
  };
  const clearDraftValues = () => {
    if (!confirm('Удалить все ручные правки этого бланка и вернуться к автоподстановке из проекта?')) return;
    const drafts = { ...(project.factoryBlankDrafts ?? {}) };
    delete drafts[spec.id];
    props.onChangeProject({ ...project, factoryBlankDrafts: drafts });
  };
  const updateSketchSettings = (patch: NonNullable<Project['factoryBlankSketch']>) => {
    props.onChangeProject({
      ...project,
      factoryBlankSketch: { ...(project.factoryBlankSketch ?? {}), ...patch },
    });
  };
  const updateSelectedSketchIds = (ids: string[]) => {
    const cleaned = ids.filter((id, index) => id && ids.indexOf(id) === index);
    updateSketchSettings({ snapshotId: cleaned[0] ?? null, snapshotIds: cleaned });
  };
  const scrollToField = (key: string) => {
    const el = document.getElementById(`blank-field-${key}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => el.querySelector('textarea')?.focus(), 250);
  };

  const sections = [...new Set(spec.fields.map((f) => f.section))];
  const errors = issues.filter((i) => i.level === 'error');
  const warns = issues.filter((i) => i.level === 'warn');
  const sheetMap = getBlankSheetMap(spec.id);
  const hasTemplate = Boolean(sheetMap);
  const sketchSettings = project.factoryBlankSketch ?? {};
  const defaultSketchId = project.eskizPro?.activeProjectId && eskizSnapshots.some((item) => item.project.id === project.eskizPro?.activeProjectId)
    ? project.eskizPro.activeProjectId
    : eskizSnapshots[0]?.project.id;
  const availableSketchIds = new Set(eskizSnapshots.map((item) => item.project.id));
  const hasExplicitSketchIds = Array.isArray(sketchSettings.snapshotIds);
  const explicitSketchIds = (sketchSettings.snapshotIds ?? []).filter((id) => availableSketchIds.has(id));
  const legacySketchId = sketchSettings.snapshotId && availableSketchIds.has(sketchSettings.snapshotId)
    ? sketchSettings.snapshotId
    : defaultSketchId;
  const selectedSketchIds = hasExplicitSketchIds
    ? explicitSketchIds
    : legacySketchId
      ? [legacySketchId]
      : [];
  const selectedSketches = selectedSketchIds.flatMap((id) => {
    const item = eskizSnapshots.find((snapshot) => snapshot.project.id === id);
    return item ? [item.project] : [];
  });
  const selectedSketchId = selectedSketchIds[0] ?? '';
  const selectedSketch = selectedSketches[0] ?? null;
  const sketchEnabled = sketchSettings.enabled ?? (eskizSnapshots.length > 0);
  const sketchMarkerMode: EskizSketchModuleMarkerMode = sketchSettings.moduleMarkerMode ?? project.eskizPro?.moduleMarkerMode ?? 'compact';
  const showSketchCommunications = sketchSettings.showCommunications ?? true;
  const showSketchCommunicationSizeBadges = project.eskizPro?.showCommunicationSizeBadges !== false && sketchSettings.showCommunicationSizeBadges !== false;
  const includeTechSheet = sketchSettings.includeTechSheet ?? true;
  const canInsertSketch = Boolean(sheetMap?.sketch && selectedSketches.length > 0 && sketchEnabled);
  const techModuleRows = buildFactoryTechModuleRows(project, pricebook, selectedSketch);
  const techCommunicationRows = showSketchCommunications
    ? selectedSketches.length > 1
      ? selectedSketches.flatMap((sketch) => buildFactoryTechCommunicationRows(project, sketch, showSketchCommunicationSizeBadges).map((row) => ({ ...row, name: `${sketch.title}: ${row.name}` })))
      : buildFactoryTechCommunicationRows(project, selectedSketch, showSketchCommunicationSizeBadges)
    : [];
  const techReadinessRows = buildFactoryTechReadinessRows({ project, pricebook, eskizProject: selectedSketch, blankIssues: issues, includeCommunications: showSketchCommunications });
  const techSummary = factoryTechReadinessSummary(techReadinessRows);
  const issueKeys = new Set(issues.map((i) => i.fieldKey));
  const fieldKeys = new Set(draft.map((d) => d.field.key));
  const shownSections = sections
    .map((section) => ({
      section,
      fields: draft.filter((d) => d.field.section === section && (!showOnlyIssues || issueKeys.has(d.field.key) || (d.field.required && d.value.trim() === ''))),
    }))
    .filter((section) => section.fields.length > 0);

  /** Заполняет настоящий шаблон фабрики и скачивает его. */
  const downloadXlsx = async () => {
    if (errors.length > 0 && !confirm(`В бланке ${errors.length} незаполненных обязательных пунктов. Всё равно выгрузить в Excel?`)) return;
    setExporting(true);
    try {
      const renderOptions = {
        ...(project.eskizPro?.exportView ?? {}),
        frame: 'none' as const,
        moduleMarkerMode: sketchMarkerMode,
        communications: showSketchCommunications ? (project.eskizPro?.communications ?? []) : [],
        showCommunicationSizeBadges: showSketchCommunicationSizeBadges,
      };
      const officialSketchRenders = canInsertSketch && sheetMap?.sketch
        ? await Promise.all(selectedSketches.map(async (sketch) => {
          const perSketchBox = selectedSketches.length > 1
            ? { width: selectedSketches.length === 2 ? sheetMap.sketch!.targetPx.width - 28 : Math.floor((sheetMap.sketch!.targetPx.width - 42) / 2), height: Math.floor(sheetMap.sketch!.targetPx.height / Math.ceil(selectedSketches.length / (selectedSketches.length === 2 ? 1 : 2))) - 42 }
            : sheetMap.sketch!.targetPx;
          const size = fitEskizExportSize(sketch, perSketchBox);
          return {
            title: sketch.title,
            image: await renderEskizSketchPng(sketch, { widthPx: size.width, heightPx: size.height, ...renderOptions }),
          };
        }))
        : [];
      const sketchImage = officialSketchRenders[0]?.image ?? null;
      const techSketchImages = includeTechSheet
        ? await Promise.all(selectedSketches.map(async (sketch) => {
          const techSketchSize = fitEskizExportSize(sketch, { width: 1500, height: 680 });
          return {
            title: sketch.title,
            image: await renderEskizSketchPng(sketch, {
              widthPx: techSketchSize.width,
              heightPx: techSketchSize.height,
              ...renderOptions,
            }),
          };
        }))
        : [];
      const techSketchImage = techSketchImages[0]?.image ?? null;
      const worktopSketchImage = hasWorktopPlanSection && pieces.length > 0 && sheetMap?.worktop?.sketch
        ? await renderWorktopPlanPng(pieces, {
          widthPx: sheetMap.worktop.sketch.targetPx.width,
          heightPx: sheetMap.worktop.sketch.targetPx.height,
          showLegend: false,
        })
        : null;
      const techPack: FactoryTechPack | null = includeTechSheet
        ? {
          projectName: project.name,
          client: project.client,
          generatedAt: new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(new Date()),
          sketchTitle: selectedSketches.length > 1 ? selectedSketches.map((sketch, index) => `${index + 1}. ${sketch.title}`).join('\n') : selectedSketch?.title,
          sketchImage: techSketchImage,
          sketchImages: techSketchImages,
          moduleRows: techModuleRows,
          communicationRows: techCommunicationRows,
          readinessRows: techReadinessRows,
        }
        : null;
      await exportFactoryBlankXlsx({
        baseUrl: import.meta.env.BASE_URL,
        project, spec, draft, pieces,
        sketchImage,
        sketchImages: officialSketchRenders,
        worktopSketchImage,
        techPack,
      });
    } catch (e) {
      alert(`Не получилось собрать файл бланка: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page">
      <header className="page-head no-print">
        <div>
          <h1>Бланк на фабрику</h1>
          <div className="muted">
            Фабрика → тип бланка → правила → шаблон. Поля и обязательность — из бланков и инструкций {spec.factoryName}.
          </div>
        </div>
        <div className="actions">
          <button className="btn ghost" onClick={() => props.onOpenProject(project.id)}>← К проекту</button>
          <button className="btn ghost small" onClick={() => window.print()} title={`${spec.blankName}: печать или сохранение в PDF браузером`}>🖨 Печать / PDF</button>
          <button
            className="btn primary"
            disabled={!hasTemplate || exporting}
            onClick={downloadXlsx}
            title={hasTemplate
              ? `Заполнить настоящий шаблон фабрики («${spec.blankName}») и скачать готовый файл`
              : 'Для этого бланка нет файлового шаблона'}
          >
            {exporting ? 'Собираю файл…' : '⭳ Excel — бланк заказа'}
          </button>
        </div>
      </header>

      <div className="blank-master-detail">
        <aside className="blank-side-panel no-print">
      <section className="blank-workflow-panel no-print" aria-label="Маршрут фабричного бланка">
        <div className="blank-workflow-main">
          <span className="eyebrow">Передача на фабрику</span>
          <h2>{errors.length > 0 ? 'Перед выгрузкой нужно закрыть ошибки' : warns.length > 0 ? 'Бланк можно выгрузить после проверки предупреждений' : 'Бланк готов к выгрузке'}</h2>
          <p>{spec.blankName} · {project.name}{project.client ? ` · ${project.client}` : ''}</p>
        </div>
        <div className="blank-workflow-steps">
          <button type="button" onClick={() => document.querySelector('.blank-controls')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><b>1</b><span>Проект<small>{project.name}</small></span></button>
          <button type="button" onClick={() => document.querySelector('.blank-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><b>2</b><span>Поля бланка<small>{progress.requiredEmpty > 0 ? `${progress.requiredEmpty} обяз. пусто` : 'обязательные заполнены'}</small></span></button>
          <button type="button" onClick={() => document.querySelector('.blank-sketch-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><b>3</b><span>Эскиз PRO<small>{canInsertSketch ? `${selectedSketches.length} выбрано` : 'нет поля/эскиза'}</small></span></button>
          <button type="button" onClick={() => document.querySelector('.blank-issues')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}><b>4</b><span>Проверка<small>{errors.length} ошибок · {warns.length} предупрежд.</small></span></button>
          <button type="button" disabled={!hasTemplate || exporting} onClick={downloadXlsx}><b>5</b><span>Выгрузка<small>{sheetMap ? sheetMap.template : 'нет шаблона'}</small></span></button>
        </div>
      </section>

      <div className="card blank-controls no-print">
        <label>Проект
          <select value={project.id} onChange={(e) => setProjectId(e.target.value)}>
            {props.projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.client ? ` — ${p.client}` : ''}</option>)}
          </select>
        </label>
        <label>Тип бланка
          <select value={spec.id} onChange={(e) => setSpecId(e.target.value)}>
            {FACTORY_BLANK_SPECS.map((s) => <option key={s.id} value={s.id}>{s.blankName}</option>)}
          </select>
        </label>
        <span className="muted small">
          Подставлено из проекта: <b>{progress.auto}</b> · заполнено вручную: <b>{progress.draftCount}</b> · пустых: <b>{progress.empty}</b>
          {progress.requiredEmpty > 0 && <> · <b className="blank-bad">обязательных не заполнено: {progress.requiredEmpty}</b></>}
        </span>
        <div className="blank-control-actions">
          <button className={`btn tiny ${showOnlyIssues ? 'primary' : 'ghost'}`} disabled={issues.length === 0} onClick={() => setShowOnlyIssues(!showOnlyIssues)}>
            {showOnlyIssues ? 'Показать все поля' : `Только проблемные (${issues.length})`}
          </button>
          {progress.draftCount > 0 && <button className="btn tiny ghost" onClick={clearDraftValues}>Сбросить ручные правки</button>}
        </div>
      </div>

      <div className="card blank-export-preview no-print">
        <div><b>Выгрузка в официальный шаблон</b><span>{sheetMap ? `Файл: ${sheetMap.template} · лист: ${sheetMap.sheet}` : 'Для этого бланка нет Excel-шаблона'}</span></div>
        <div><b>{errors.length}</b><span>критичных ошибок</span></div>
        <div><b>{warns.length}</b><span>предупреждений</span></div>
        <div><b>{hasWorktopPlanSection ? pieces.length : '—'}</b><span>деталей столешницы на лист 2</span></div>
        <div><b>{canInsertSketch ? selectedSketches.length : '—'}</b><span>Эскиз PRO в {sheetMap ? blankSketchRangeLabel(sheetMap) || 'нет поля' : 'нет шаблона'}</span></div>
        <div><b>{includeTechSheet ? 'да' : '—'}</b><span>отдельный лист: {techModuleRows.length} модулей · {techCommunicationRows.length} коммуникаций</span></div>
      </div>
        </aside>
        <main className="blank-detail-panel">

      {sheetMap?.sketch && (
        <div className="card blank-sketch-card no-print">
          <div className="blank-sketch-main">
            <div className="section-head">
              <div>
                <h3>Эскиз PRO в Excel-бланк фабрики</h3>
                <p className="muted small">Можно выбрать несколько snapshot Эскиз PRO. В левое поле официального шаблона <b>{blankSketchRangeLabel(sheetMap)}</b> каждый выбранный эскиз попадёт отдельной картинкой — в Excel их можно выделить, увеличить и расставить вручную. На лист «Эскиз PRO» каждый выбранный эскиз также выводится крупно.</p>
              </div>
              <label className="toggle small"><input type="checkbox" checked={sketchEnabled} onChange={(e) => updateSketchSettings({ enabled: e.target.checked })} /> вставлять в Excel</label>
            </div>
            {eskizSnapshots.length === 0 ? (
              <div className="empty small">В проекте пока нет snapshot Эскиз PRO. Откройте проект, добавьте/обновите эскиз — после этого он будет вставляться в бланк.</div>
            ) : (
              <div className="blank-sketch-controls">
                <div className="blank-sketch-multi">
                  <header>
                    <span><b>Эскизы</b><small>выбрано: {selectedSketches.length}</small></span>
                    <span className="blank-sketch-multi-actions">
                      <button type="button" className="btn tiny ghost" disabled={!sketchEnabled || selectedSketches.length === eskizSnapshots.length} onClick={() => updateSelectedSketchIds(eskizSnapshots.map((item) => item.project.id))}>все</button>
                      <button type="button" className="btn tiny ghost" disabled={!sketchEnabled || selectedSketches.length === 0} onClick={() => updateSelectedSketchIds([])}>очистить</button>
                    </span>
                  </header>
                  <div className="blank-sketch-check-list">
                    {eskizSnapshots.map((item) => {
                      const checked = selectedSketchIds.includes(item.project.id);
                      const primary = item.project.id === selectedSketchId;
                      return <div key={item.project.id} className={`blank-sketch-check ${checked ? 'active' : ''} ${primary ? 'primary' : ''}`}>
                        <label><input type="checkbox" checked={checked} disabled={!sketchEnabled} onChange={(event) => {
                          const next = event.target.checked ? [...selectedSketchIds, item.project.id] : selectedSketchIds.filter((id) => id !== item.project.id);
                          updateSelectedSketchIds(next);
                        }} /><span><b>{item.project.title}</b><small>{item.project.image.name}{primary ? ' · основной в левом поле' : ''}</small></span></label>
                        {checked && !primary && <button type="button" className="btn tiny ghost" disabled={!sketchEnabled} onClick={() => updateSelectedSketchIds([item.project.id, ...selectedSketchIds.filter((id) => id !== item.project.id)])}>сделать основным</button>}
                      </div>;
                    })}
                  </div>
                </div>
                <label>Маркеры модулей
                  <select value={sketchMarkerMode} disabled={!sketchEnabled} onChange={(e) => updateSketchSettings({ moduleMarkerMode: e.target.value as EskizSketchModuleMarkerMode })}>
                    <option value="compact">Компактные точки</option>
                    <option value="hidden">Скрыть маркеры</option>
                    <option value="full">Полные плашки</option>
                  </select>
                </label>
                <label className="toggle"><input type="checkbox" checked={showSketchCommunications} onChange={(e) => updateSketchSettings({ showCommunications: e.target.checked })} /> коммуникации и расстояния</label>
                <label className="toggle"><input type="checkbox" checked={showSketchCommunicationSizeBadges} disabled={!sketchEnabled || !showSketchCommunications || project.eskizPro?.showCommunicationSizeBadges === false} onChange={(e) => updateSketchSettings({ showCommunicationSizeBadges: e.target.checked })} /> габариты/высоты рядом с коммуникациями</label>
                <label className="toggle"><input type="checkbox" checked={includeTechSheet} onChange={(e) => updateSketchSettings({ includeTechSheet: e.target.checked })} /> отдельный лист «Эскиз PRO + расшифровка»</label>
              </div>
            )}
            {includeTechSheet && (
              <div className={`blank-tech-summary ${techSummary.errors > 0 ? 'bad' : techSummary.warnings > 0 ? 'warn' : 'ok'}`}>
                <b>{techSummary.errors > 0 ? 'Нужна проверка перед фабрикой' : techSummary.warnings > 0 ? 'Можно выгружать, но есть предупреждения' : 'Техлист готов'}</b>
                <span>{techSummary.errors} ошибок · {techSummary.warnings} предупреждений · {techModuleRows.length} строк модулей · {techCommunicationRows.length} коммуникаций</span>
              </div>
            )}
          </div>
          {selectedSketches.length > 0 && sketchEnabled ? (
            <div className="blank-sketch-preview multi">
              {selectedSketches.map((sketch) => <EskizProjectPreview
                key={sketch.id}
                project={sketch}
                compact
                moduleMarkerMode={sketchMarkerMode}
                communicationMarkers={showSketchCommunications ? (project.eskizPro?.communications ?? []) : []}
                showCommunicationSizeBadges={showSketchCommunicationSizeBadges}
                viewSettings={project.eskizPro?.exportView}
              />)}
            </div>
          ) : (
            <div className="blank-sketch-placeholder">Эскизы не будут вставлены в Excel.</div>
          )}
        </div>
      )}

      {sheetMap && !sheetMap.sketch && eskizSnapshots.length > 0 && (
        <div className="card blank-sketch-card no-print">
          <div className="blank-sketch-main">
            <b>Эскиз PRO найден, но у выбранного шаблона нет отдельного левого поля под картинку.</b>
            <span className="muted small">Для кухонного бланка Висма картинка вставляется в A14:I47. В этом шаблоне не накладываю её поверх официальных полей, зато могу добавить отдельный лист «Эскиз PRO» с крупным эскизом, модулями, коммуникациями и проверками.</span>
            <label className="toggle"><input type="checkbox" checked={includeTechSheet} onChange={(e) => updateSketchSettings({ includeTechSheet: e.target.checked })} /> добавить отдельный лист «Эскиз PRO + расшифровка»</label>
            <div className="blank-sketch-multi compact">
              <header>
                <span><b>Эскизы на техлист</b><small>выбрано: {selectedSketches.length}</small></span>
                <span className="blank-sketch-multi-actions">
                  <button type="button" className="btn tiny ghost" disabled={selectedSketches.length === eskizSnapshots.length} onClick={() => updateSelectedSketchIds(eskizSnapshots.map((item) => item.project.id))}>все</button>
                  <button type="button" className="btn tiny ghost" disabled={selectedSketches.length === 0} onClick={() => updateSelectedSketchIds([])}>очистить</button>
                </span>
              </header>
              <div className="blank-sketch-check-list">
                {eskizSnapshots.map((item) => {
                  const checked = selectedSketchIds.includes(item.project.id);
                  const primary = item.project.id === selectedSketchId;
                  return <div key={item.project.id} className={`blank-sketch-check ${checked ? 'active' : ''} ${primary ? 'primary' : ''}`}>
                    <label><input type="checkbox" checked={checked} onChange={(event) => {
                      const next = event.target.checked ? [...selectedSketchIds, item.project.id] : selectedSketchIds.filter((id) => id !== item.project.id);
                      updateSelectedSketchIds(next);
                    }} /><span><b>{item.project.title}</b><small>{item.project.image.name}{primary ? ' · основной для расшифровки' : ''}</small></span></label>
                    {checked && !primary && <button type="button" className="btn tiny ghost" onClick={() => updateSelectedSketchIds([item.project.id, ...selectedSketchIds.filter((id) => id !== item.project.id)])}>основной</button>}
                  </div>;
                })}
              </div>
            </div>
            {includeTechSheet && <div className={`blank-tech-summary ${techSummary.errors > 0 ? 'bad' : techSummary.warnings > 0 ? 'warn' : 'ok'}`}><b>{techSummary.errors > 0 ? 'Нужна проверка перед фабрикой' : techSummary.warnings > 0 ? 'Есть предупреждения' : 'Техлист готов'}</b><span>{techSummary.errors} ошибок · {techSummary.warnings} предупреждений · {techModuleRows.length} строк модулей · {techCommunicationRows.length} коммуникаций</span></div>}
          </div>
          {selectedSketches.length > 0 && includeTechSheet && <div className="blank-sketch-preview multi">{selectedSketches.map((sketch) => <EskizProjectPreview key={sketch.id} project={sketch} compact moduleMarkerMode={sketchMarkerMode} communicationMarkers={showSketchCommunications ? (project.eskizPro?.communications ?? []) : []} showCommunicationSizeBadges={showSketchCommunicationSizeBadges} viewSettings={project.eskizPro?.exportView} />)}</div>}
        </div>
      )}

      {issues.length > 0 && (
        <div className="card blank-issues no-print">
          <h3>Проверка перед отправкой на фабрику</h3>
          <div className="muted small">Мы не исправляем ваши данные молча — проверьте и поправьте сами (в проекте или в полях ниже).</div>
          <ul>
            {errors.map((i) => <li key={`${i.fieldKey}-${i.text}`} className="blank-issue err"><span>🔴 {i.text}</span>{fieldKeys.has(i.fieldKey) && <button className="btn tiny ghost" onClick={() => scrollToField(i.fieldKey)}>к полю</button>}</li>)}
            {warns.map((i) => <li key={`${i.fieldKey}-${i.text}`} className="blank-issue warn"><span>🟡 {i.text}</span>{fieldKeys.has(i.fieldKey) && <button className="btn tiny ghost" onClick={() => scrollToField(i.fieldKey)}>к полю</button>}</li>)}
          </ul>
        </div>
      )}
      {issues.length === 0 && (
        <div className="card blank-issues ok no-print">
          <span className="blank-issue ok">✅ Обязательные поля заполнены, противоречий с проектом нет. Проверьте бланк глазами перед печатью.</span>
        </div>
      )}

      {/* Редактируемый бланк: каждая секция — как на бумажном бланке фабрики */}
      {shownSections.map(({ section, fields }) => (
        <div className="card blank-section" key={section}>
          <h3>{section}</h3>
          <div className="blank-grid">
            {fields.map((d) => {
              const cellLabel = sheetMap ? blankCellRefLabel(sheetMap, d.field.key) : '';
              const hasIssue = issueKeys.has(d.field.key) || (d.field.required && d.value.trim() === '');
              return (
              <label id={`blank-field-${d.field.key}`} key={d.field.key} className={`blank-field src-${d.source}${d.field.required ? ' required' : ''}${hasIssue ? ' has-issue' : ''}`}>
                <span className="blank-label">
                  {d.field.label}
                  {d.field.required && <span className="blank-req" title="Обязательное поле по инструкции фабрики">*</span>}
                  {cellLabel && <span className="blank-cell" title="Клетка в официальном шаблоне Excel">{cellLabel}</span>}
                  <span className={`blank-src ${d.source}`} title={
                    d.source === 'project' ? 'Подставлено автоматически из проекта'
                      : d.source === 'draft' ? 'Заполнено вручную (черновик бланка)'
                        : 'Не заполнено'
                  }>
                    {d.source === 'project' ? '⚙ авто' : d.source === 'draft' ? '✍ вручную' : '—'}
                  </span>
                  {d.source === 'draft' && <button type="button" className="blank-reset" onClick={() => setDraftValue(d.field.key, '')}>вернуть авто</button>}
                </span>
                <textarea
                  rows={Math.min(3, 1 + Math.floor(d.value.length / 60))}
                  value={d.value}
                  placeholder={d.field.expected === 'dict' ? 'по разбивке/прайсу фабрики…' : 'заполнить…'}
                  onChange={(e) => setDraftValue(d.field.key, e.target.value)}
                />
                {d.field.expected === 'dict' && dicts && (
                  <FactoryDictPicker
                    fieldKey={d.field.key}
                    dicts={dicts}
                    query={dictQueries[d.field.key] ?? ''}
                    onQuery={(value) => setDictQueries((prev) => ({ ...prev, [d.field.key]: value }))}
                    onInsert={(value) => setDraftValue(d.field.key, d.value.trim() === '' ? value : `${d.value.replace(/[;\s]+$/, '')}; ${value}`)}
                  />
                )}
                {d.field.hint && <span className="muted small">{d.field.hint}</span>}
              </label>
              );
            })}
          </div>
        </div>
      ))}

      {hasWorktopPlanSection && (
        <div className="card blank-section no-print">
          <h3>Лист 2 — схема столешницы</h3>
          <div className="muted small">
            Обязателен при столешницах: отметьте обработку видимых кромок. {BACK_EDGE_NOTE}.
          </div>
          <div className="blank-plan-actions">
            <button className="btn tiny ghost" onClick={fillPlanFromProject}>⚙ Заполнить из проекта</button>
            <button className="btn tiny ghost" onClick={addPiece}>+ Деталь</button>
          </div>
          <WorktopPlanDesigner pieces={pieces} onPiece={updatePiece} onReplace={replacePieces} onAdd={addPiece} onRemove={removePiece} />
          {pieces.length === 0 ? (
            <div className="empty small">Деталей пока нет — добавьте вручную или заполните из проекта.</div>
          ) : (
            <table className="table blank-plan-table">
              <thead>
                <tr><th>Деталь</th><th>Длина, мм</th><th>Ширина, мм</th><th>Перед</th><th>Зад</th><th>Левый торец</th><th>Правый / стык</th><th /></tr>
              </thead>
              <tbody>
                {pieces.map((piece) => (
                  <tr key={piece.id}>
                    <td><input value={piece.name} onChange={(e) => updatePiece(piece.id, { name: e.target.value })} /></td>
                    <td><WorktopMmInput value={piece.lengthMm} onValue={(value) => updatePiece(piece.id, { lengthMm: value })} placeholder="мм" /></td>
                    <td><WorktopMmInput value={piece.widthMm} onValue={(value) => updatePiece(piece.id, { widthMm: value })} placeholder="мм" /></td>
                    {WORKTOP_EDGE_SIDES.map((side) => (
                      <td key={side.id}>
                        <select value={piece[side.id] ?? ''} onChange={(e) => updatePiece(piece.id, { [side.id]: (e.target.value || null) as WorktopEdgeKind | null })}>
                          <option value="">{side.id === 'back' ? '— (ПВХ 0,4 белая)' : '—'}</option>
                          {WORKTOP_EDGE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                        </select>
                      </td>
                    ))}
                    <td><button className="btn tiny danger" title="Убрать деталь" onClick={() => removePiece(piece.id)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

        </main>
      </div>

      {/* Печатная форма: компактная таблица «пункт → значение» как на бланке */}
      <div className="blank-print">
        <h2>{spec.blankName}</h2>
        <div className="muted small">Проект: {project.name}{project.client ? ` · Клиент: ${project.client}` : ''}</div>
        {sections.map((section) => (
          <table key={section} className="blank-print-table">
            <thead><tr><th colSpan={2}>{section}</th></tr></thead>
            <tbody>
              {draft.filter((d) => d.field.section === section).map((d) => (
                <tr key={d.field.key}>
                  <td className="blank-print-label">{d.field.label}{d.field.required ? ' *' : ''}</td>
                  <td>{d.value.trim() === '' ? '—' : d.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
        {hasWorktopPlanSection && pieces.length > 0 && (
          <table className="blank-print-table">
            <thead><tr><th colSpan={8}>Лист 2 — схема столешницы (виды обработки видимых частей)</th></tr>
              <tr><th>Деталь</th><th>Длина, мм</th><th>Ширина, мм</th><th>Перед</th><th>Зад</th><th>Левый торец</th><th>Правый / стык</th><th>Зад по умолчанию</th></tr></thead>
            <tbody>
              {pieces.map((piece) => (
                <tr key={piece.id}>
                  <td>{piece.name}</td>
                  <td>{piece.lengthMm ?? ''}</td>
                  <td>{piece.widthMm ?? ''}</td>
                  <td>{edgeKindLabel(piece.front)}</td>
                  <td>{edgeKindLabel(piece.back)}</td>
                  <td>{edgeKindLabel(piece.left)}</td>
                  <td>{edgeKindLabel(piece.right)}</td>
                  <td>{piece.back ? '—' : 'ПВХ 0,4 белая'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="muted small">{BACK_EDGE_NOTE}.</div>
        <div className="muted small">* — обязательные поля по инструкции фабрики. Заказ запускается только по подтверждённому бланку.</div>
      </div>
    </div>
  );
}
