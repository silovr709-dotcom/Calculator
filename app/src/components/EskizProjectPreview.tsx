import type { MouseEvent } from 'react';
import type { EskizCommunicationDistance, EskizCommunicationMarker } from '../types';
import type { EskizCalloutObject, EskizDimensionObject, EskizModuleObject, EskizObject, EskizProject, EskizTextObject } from '../lib/eskizPro';
import { COMMUNICATION_ANCHOR_LABELS, COMMUNICATION_KIND_META, communicationDistanceText, communicationSizeText } from '../lib/eskizCommunications';

export type EskizModulePreviewStatus = { level: 'new' | 'error' | 'warn' | 'ok'; label: string; summary?: string };

const STATUS_COLORS: Record<EskizModulePreviewStatus['level'], string> = {
  new: '#8b5cf6',
  error: '#dc2626',
  warn: '#d97706',
  ok: '#16a34a',
};

function wrapLines(text: string, maxChars: number) {
  return text.split('\n').flatMap((source) => {
    if (!source) return [''];
    const words = source.split(/\s+/);
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

function imageFilter(project: EskizProject) {
  const display = project.imageDisplay;
  if (!display) return undefined;
  return `opacity(${display.opacity}) brightness(${display.brightness}) contrast(${display.contrast}) saturate(${display.saturation}) grayscale(${display.grayscale ? 1 : 0})`;
}

function dimensionLabel(object: EskizDimensionObject) {
  const tolerance = object.tolerance ? ` ±${object.tolerance.replace(/^±\s*/, '')}` : '';
  return `${object.prefix ?? ''}${object.value || '—'}${object.showUnit === false ? '' : ' мм'}${tolerance}${object.suffix ? ` ${object.suffix}` : ''}`;
}

function DimensionPreview({ object: o }: { object: EskizDimensionObject }) {
  const x1 = o.x;
  const y1 = o.y;
  const x2 = o.x2;
  const y2 = o.y2;
  const baseMidX = (x1 + x2) / 2;
  const baseMidY = (y1 + y2) / 2;
  const lineAngle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  let readableAngle = lineAngle;
  if (readableAngle > 90) readableAngle -= 180;
  if (readableAngle < -90) readableAngle += 180;
  const textAngle = (o.textOrientation ?? 'parallel') === 'horizontal' ? 0 : readableAngle;
  const label = dimensionLabel(o);
  const approxWidth = Math.max(68, label.length * o.fontSize * .62);
  const tick = 9;
  const length = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
  const unitNormalX = -(y2 - y1) / length;
  const unitNormalY = (x2 - x1) / length;
  const offset = o.offset ?? 0;
  const lineX1 = x1 + unitNormalX * offset;
  const lineY1 = y1 + unitNormalY * offset;
  const lineX2 = x2 + unitNormalX * offset;
  const lineY2 = y2 + unitNormalY * offset;
  const midX = baseMidX + unitNormalX * offset;
  const midY = baseMidY + unitNormalY * offset;
  const textShift = o.textPosition === 'above' ? -o.fontSize * .9 : o.textPosition === 'below' ? o.fontSize * .9 : 0;
  const textX = midX + unitNormalX * textShift;
  const textY = midY + unitNormalY * textShift;
  const normalX = unitNormalX * tick;
  const normalY = unitNormalY * tick;
  const extension = offset === 0 ? 0 : Math.sign(offset) * 7;
  const marker = o.arrowStyle === 'tick' ? undefined : `url(#${o.arrowStyle === 'closed' ? 'eskizDimArrowClosed' : 'eskizDimArrow'})`;
  return (
    <g className="eskiz-preview-object eskiz-preview-dimension">
      {offset !== 0 && <>
        <line x1={x1} y1={y1} x2={lineX1 + unitNormalX * extension} y2={lineY1 + unitNormalY * extension} stroke={o.color} strokeWidth={Math.max(1, o.lineWidth * .7)} opacity=".78" />
        <line x1={x2} y1={y2} x2={lineX2 + unitNormalX * extension} y2={lineY2 + unitNormalY * extension} stroke={o.color} strokeWidth={Math.max(1, o.lineWidth * .7)} opacity=".78" />
      </>}
      <line x1={lineX1} y1={lineY1} x2={lineX2} y2={lineY2} stroke={o.color} strokeWidth={o.lineWidth} markerStart={marker} markerEnd={marker} />
      <line x1={lineX1 - normalX} y1={lineY1 - normalY} x2={lineX1 + normalX} y2={lineY1 + normalY} stroke={o.color} strokeWidth={o.lineWidth} />
      <line x1={lineX2 - normalX} y1={lineY2 - normalY} x2={lineX2 + normalX} y2={lineY2 + normalY} stroke={o.color} strokeWidth={o.lineWidth} />
      <g transform={`translate(${textX} ${textY}) rotate(${textAngle})`}>
        <rect x={-approxWidth / 2} y={-o.fontSize * .72} width={approxWidth} height={o.fontSize * 1.25} rx="3" fill="white" opacity=".92" />
        <text textAnchor="middle" dominantBaseline="middle" fontSize={o.fontSize} fontWeight="700" fill={o.color}>{label}</text>
      </g>
    </g>
  );
}

function ModulePreview({ object: o, projectId, active = false, linked = false, status, onModuleClick }: { object: EskizModuleObject; projectId: string; active?: boolean; linked?: boolean; status?: EskizModulePreviewStatus; onModuleClick?: (projectId: string, object: EskizModuleObject) => void }) {
  const sourceLines = [o.number, ...o.description.split('\n').filter(Boolean)];
  const autoWidth = Math.max(72, ...sourceLines.map((text) => text.length * o.fontSize * .6)) + 22;
  const width = o.width ? Math.max(60, o.width) : autoWidth;
  const maxChars = Math.max(2, Math.floor((width - 22) / (o.fontSize * .6)));
  const lines = sourceLines.flatMap((line) => wrapLines(line, maxChars));
  const autoHeight = lines.length * (o.fontSize + 5) + 14;
  const height = Math.max(autoHeight, o.height ?? 0);
  const textBlockHeight = lines.length * (o.fontSize + 5) - 5;
  const textY = Math.max(8, (height - textBlockHeight) / 2);
  const statusColor = status ? STATUS_COLORS[status.level] : o.color;
  const badgeWidth = status ? Math.max(48, status.label.length * 6 + 16) : 0;
  return (
    <g
      className={`eskiz-preview-object eskiz-preview-label eskiz-preview-module ${onModuleClick ? 'clickable' : ''} ${active ? 'active' : ''} ${linked ? 'linked' : ''} ${status ? `status-${status.level}` : ''}`}
      transform={`translate(${o.x} ${o.y})`}
      role={onModuleClick ? 'button' : undefined}
      tabIndex={onModuleClick ? 0 : undefined}
      aria-label={status ? `${o.number}: ${status.label}. ${status.summary ?? ''}` : undefined}
      onClick={(event) => { event.stopPropagation(); onModuleClick?.(projectId, o); }}
      onKeyDown={(event) => {
        if (!onModuleClick || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        onModuleClick(projectId, o);
      }}
    >
      <rect x="0" y="0" width={width} height={height} rx={o.borderRadius ?? 6} fill={o.fill ?? 'white'} fillOpacity={o.fillOpacity ?? 1} stroke={statusColor} strokeWidth={status ? 3 : 2} />
      <circle className="eskiz-preview-module-point" cx="0" cy="0" r="7" fill={statusColor} stroke="#fff" strokeWidth="3" />
      {status && <g className="eskiz-preview-module-status" transform={`translate(${Math.max(5, width - badgeWidth - 6)} ${-10})`}><rect width={badgeWidth} height="19" rx="9.5" fill={statusColor} /><text x={badgeWidth / 2} y="10" dominantBaseline="middle" textAnchor="middle" fontSize="10" fontWeight="900" fill="#fff">{status.label}</text></g>}
      {status?.summary && <title>{status.summary}</title>}
      {lines.map((line, index) => <text key={index} x={width / 2} y={textY + index * (o.fontSize + 5)} dominantBaseline="hanging" textAnchor="middle" fontSize={o.fontSize} fontWeight={index === 0 ? 800 : 500} fill={o.color}>{line}</text>)}
    </g>
  );
}

function CalloutPreview({ object: o }: { object: EskizCalloutObject }) {
  const sourceLines = o.text.split('\n');
  const autoWidth = Math.max(120, ...sourceLines.map((text) => text.length * o.fontSize * .56)) + 24;
  const width = o.width ? Math.max(70, o.width) : autoWidth;
  const maxChars = Math.max(3, Math.floor((width - 24) / (o.fontSize * .56)));
  const lines = wrapLines(o.text, maxChars);
  const autoHeight = Math.max(48, lines.length * (o.fontSize + 5) + 18);
  const height = Math.max(autoHeight, o.height ?? 0);
  const elbowX = o.x > o.targetX ? o.x - 18 : o.x + width + 18;
  return (
    <g className="eskiz-preview-object eskiz-preview-label">
      <polyline points={`${o.targetX},${o.targetY} ${elbowX},${o.y + height / 2} ${o.x > o.targetX ? o.x : o.x + width},${o.y + height / 2}`} fill="none" stroke={o.color} strokeWidth="2" />
      <circle cx={o.targetX} cy={o.targetY} r="5" fill={o.color} />
      <rect x={o.x} y={o.y} width={width} height={height} rx={o.borderRadius ?? 6} fill={o.fill ?? '#fff'} fillOpacity={o.fillOpacity ?? 1} stroke={o.color} strokeWidth="2" />
      {lines.map((line, index) => <text key={index} x={o.x + 12} y={o.y + 11 + index * (o.fontSize + 5)} dominantBaseline="hanging" fontSize={o.fontSize} fontWeight="600" fill={o.color}>{line}</text>)}
    </g>
  );
}

function TextPreview({ object: o }: { object: EskizTextObject }) {
  const isComment = o.type === 'comment';
  const isLink = o.type === 'link';
  const sourceLines = o.text.split('\n');
  const autoWidth = Math.max(isComment ? 160 : 100, ...sourceLines.map((text) => text.length * o.fontSize * .56)) + 28;
  const width = o.width ? Math.max(60, o.width) : autoWidth;
  const textInset = isLink ? 37 : 28;
  const maxChars = Math.max(3, Math.floor((width - textInset) / (o.fontSize * .56)));
  const lines = wrapLines(o.text, maxChars);
  const autoHeight = lines.length * (o.fontSize + 5) + 22;
  const height = Math.max(autoHeight, o.height ?? 0);
  return (
    <g className="eskiz-preview-object eskiz-preview-label" transform={`translate(${o.x} ${o.y})`}>
      <rect x="0" y="0" width={width} height={height} rx={o.borderRadius ?? 7} fill={o.fill ?? (isComment ? '#fff8d8' : 'white')} fillOpacity={o.fillOpacity ?? 1} stroke={o.color} strokeWidth="1.5" />
      {isLink && <text x="13" y={(height / 2) + 5} textAnchor="middle" fontSize={o.fontSize} fontWeight="900" fill={o.color}>↗</text>}
      {lines.map((line, index) => <text key={index} x={isLink ? 31 : 14} y={12 + index * (o.fontSize + 5)} dominantBaseline="hanging" fontSize={o.fontSize} fontWeight={o.type === 'equipment' ? 750 : 550} fill={o.color}>{line}</text>)}
    </g>
  );
}

function distanceAnchorPoint(distance: EskizCommunicationDistance, marker: EskizCommunicationMarker, width: number, height: number) {
  if (distance.anchor === 'left') return { x: 0, y: marker.y };
  if (distance.anchor === 'right') return { x: width, y: marker.y };
  if (distance.anchor === 'top') return { x: marker.x, y: 0 };
  if (distance.anchor === 'bottom') return { x: marker.x, y: height };
  return { x: distance.anchorX ?? marker.x + 120, y: distance.anchorY ?? marker.y };
}

function CommunicationPreview(props: { marker: EskizCommunicationMarker; width: number; height: number; active?: boolean; onCommunicationClick?: (marker: EskizCommunicationMarker) => void }) {
  const { marker, width, height, active = false, onCommunicationClick } = props;
  const meta = COMMUNICATION_KIND_META[marker.kind] ?? COMMUNICATION_KIND_META.other;
  const size = communicationSizeText(marker);
  const distances = marker.distances ?? [];
  const label = [marker.name || meta.label, size].filter(Boolean).join(' · ');
  const labelWidth = Math.max(90, Math.min(280, label.length * 6.1 + 18));
  const labelX = marker.x + 18 > width - labelWidth ? marker.x - labelWidth - 18 : marker.x + 18;
  const labelY = Math.max(8, Math.min(height - 38, marker.y - 18));
  return (
    <g
      className={`eskiz-preview-communication ${active ? 'active' : ''} ${onCommunicationClick ? 'clickable' : ''}`}
      role={onCommunicationClick ? 'button' : undefined}
      tabIndex={onCommunicationClick ? 0 : undefined}
      onClick={(event) => { event.stopPropagation(); onCommunicationClick?.(marker); }}
      onKeyDown={(event) => {
        if (!onCommunicationClick || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        onCommunicationClick(marker);
      }}
    >
      {distances.map((distance) => {
        const anchor = distanceAnchorPoint(distance, marker, width, height);
        const midX = (marker.x + anchor.x) / 2;
        const midY = (marker.y + anchor.y) / 2;
        const text = `${distance.label || COMMUNICATION_ANCHOR_LABELS[distance.anchor]}: ${communicationDistanceText(distance.valueMm)}`;
        const textWidth = Math.max(74, Math.min(250, text.length * 5.6 + 14));
        return <g className="eskiz-preview-communication-distance" key={distance.id}>
          <line x1={marker.x} y1={marker.y} x2={anchor.x} y2={anchor.y} stroke={meta.color} strokeWidth="2" strokeDasharray="7 5" opacity=".82" />
          {distance.anchor === 'custom' && <g><line x1={anchor.x - 8} y1={anchor.y} x2={anchor.x + 8} y2={anchor.y} stroke={meta.color} strokeWidth="2" /><line x1={anchor.x} y1={anchor.y - 8} x2={anchor.x} y2={anchor.y + 8} stroke={meta.color} strokeWidth="2" /></g>}
          <g transform={`translate(${midX} ${midY})`}>
            <rect x={-textWidth / 2} y="-10" width={textWidth} height="20" rx="10" fill="#fff" stroke={meta.color} strokeWidth="1" opacity=".96" />
            <text textAnchor="middle" dominantBaseline="middle" fontSize="10" fontWeight="800" fill={meta.color}>{text}</text>
          </g>
        </g>;
      })}
      <line x1={marker.x} y1={marker.y} x2={labelX < marker.x ? labelX + labelWidth : labelX} y2={labelY + 17} stroke={meta.color} strokeWidth="2" opacity=".72" />
      <circle cx={marker.x} cy={marker.y} r={active ? 13 : 10} fill={meta.color} stroke="#fff" strokeWidth="4" />
      <text x={marker.x} y={marker.y + 4} textAnchor="middle" fontSize="10" fontWeight="900" fill="#fff">{meta.icon}</text>
      <g className="eskiz-preview-communication-label" transform={`translate(${labelX} ${labelY})`}>
        <rect width={labelWidth} height="34" rx="9" fill="#fff" fillOpacity=".96" stroke={meta.color} strokeWidth={active ? 2.5 : 1.7} />
        <text x="9" y="13" fontSize="11" fontWeight="900" fill={meta.color}>{marker.name || meta.label}</text>
        <text x="9" y="26" fontSize="9.5" fontWeight="650" fill="#40554b">{size || (marker.note ? marker.note.slice(0, 34) : meta.label)}</text>
      </g>
      {marker.note && <title>{marker.note}</title>}
    </g>
  );
}

function ObjectPreview({ object, projectId, activeModuleKey, moduleBindings, moduleStatuses, onModuleClick }: { object: EskizObject; projectId: string; activeModuleKey?: string | null; moduleBindings?: Record<string, string>; moduleStatuses?: Record<string, EskizModulePreviewStatus>; onModuleClick?: (projectId: string, object: EskizModuleObject) => void }) {
  if (object.hidden) return null;
  if (object.type === 'dimension') return <DimensionPreview object={object} />;
  if (object.type === 'module') {
    const key = `${projectId}:${object.id}`;
    return <ModulePreview object={object} projectId={projectId} active={activeModuleKey === key} linked={Boolean(moduleBindings?.[key])} status={moduleStatuses?.[key]} onModuleClick={onModuleClick} />;
  }
  if (object.type === 'callout') return <CalloutPreview object={object} />;
  if (object.type === 'comment' || object.type === 'link' || object.type === 'equipment') return <TextPreview object={object} />;
  return null;
}

type EskizProjectPreviewProps = {
  project: EskizProject;
  compact?: boolean;
  activeModuleKey?: string | null;
  moduleBindings?: Record<string, string>;
  moduleStatuses?: Record<string, EskizModulePreviewStatus>;
  communicationMarkers?: EskizCommunicationMarker[];
  activeCommunicationId?: string | null;
  communicationAddMode?: boolean;
  onModuleClick?: (projectId: string, object: EskizModuleObject) => void;
  onCommunicationClick?: (projectId: string, marker: EskizCommunicationMarker) => void;
  onStagePointClick?: (projectId: string, x: number, y: number) => void;
};

export default function EskizProjectPreview({ project, compact = false, activeModuleKey = null, moduleBindings, moduleStatuses, communicationMarkers = [], activeCommunicationId = null, communicationAddMode = false, onModuleClick, onCommunicationClick, onStagePointClick }: EskizProjectPreviewProps) {
  const width = Math.max(1, project.image.width);
  const height = Math.max(1, project.image.height);
  const projectCommunications = communicationMarkers.filter((marker) => marker.eskizId === project.id);
  const handleSvgClick = (event: MouseEvent<SVGSVGElement>) => {
    if (!onStagePointClick) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(width, (event.clientX - rect.left) / rect.width * width));
    const y = Math.max(0, Math.min(height, (event.clientY - rect.top) / rect.height * height));
    onStagePointClick(project.id, Math.round(x), Math.round(y));
  };
  return (
    <article className={`eskiz-preview ${compact ? 'compact' : ''}`}>
      <div className="eskiz-preview-head">
        <div><b>{project.title}</b><span>{project.image.name} · {project.objects.filter((item) => !item.hidden && item.type !== 'guide' && item.type !== 'anchor').length} объектов · коммуникаций: {projectCommunications.length}</span></div>
        <em>{new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(project.updatedAt))}</em>
      </div>
      {project.header?.enabled && (
        <div className="eskiz-preview-meta">
          <span><b>Проект:</b> {project.header.project || project.title}</span>
          <span><b>Помещение:</b> {project.header.room || '—'}</span>
          <span><b>Вариант:</b> {project.header.variant || '—'}</span>
          <span><b>Дата:</b> {project.header.date || '—'}</span>
        </div>
      )}
      <div className="eskiz-preview-stage">
        <svg className={communicationAddMode ? 'adding-communication' : ''} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Эскиз PRO: ${project.title}`} onClick={handleSvgClick}>
          <defs>
            <marker id="eskizDimArrow" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto-start-reverse">
              <path d="M 9 5 L 1 1 M 9 5 L 1 9" fill="none" stroke="context-stroke" strokeWidth="1.7" strokeLinecap="round" />
            </marker>
            <marker id="eskizDimArrowClosed" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto-start-reverse">
              <path d="M 9 5 L 1 1 L 3 5 L 1 9 Z" fill="context-stroke" />
            </marker>
          </defs>
          <image href={project.image.dataUrl} x="0" y="0" width={width} height={height} preserveAspectRatio="none" style={{ filter: imageFilter(project) }} />
          {project.objects.map((object) => <ObjectPreview key={object.id} object={object} projectId={project.id} activeModuleKey={activeModuleKey} moduleBindings={moduleBindings} moduleStatuses={moduleStatuses} onModuleClick={onModuleClick} />)}
          {projectCommunications.map((marker) => <CommunicationPreview key={marker.id} marker={marker} width={width} height={height} active={marker.id === activeCommunicationId} onCommunicationClick={(item) => onCommunicationClick?.(project.id, item)} />)}
        </svg>
      </div>
    </article>
  );
}
