import type { EskizCalloutObject, EskizDimensionObject, EskizModuleObject, EskizObject, EskizProject, EskizTextObject } from '../lib/eskizPro';

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

function ModulePreview({ object: o }: { object: EskizModuleObject }) {
  const sourceLines = [o.number, ...o.description.split('\n').filter(Boolean)];
  const autoWidth = Math.max(72, ...sourceLines.map((text) => text.length * o.fontSize * .6)) + 22;
  const width = o.width ? Math.max(60, o.width) : autoWidth;
  const maxChars = Math.max(2, Math.floor((width - 22) / (o.fontSize * .6)));
  const lines = sourceLines.flatMap((line) => wrapLines(line, maxChars));
  const autoHeight = lines.length * (o.fontSize + 5) + 14;
  const height = Math.max(autoHeight, o.height ?? 0);
  const textBlockHeight = lines.length * (o.fontSize + 5) - 5;
  const textY = Math.max(8, (height - textBlockHeight) / 2);
  return (
    <g className="eskiz-preview-object eskiz-preview-label" transform={`translate(${o.x} ${o.y})`}>
      <rect x="0" y="0" width={width} height={height} rx={o.borderRadius ?? 6} fill={o.fill ?? 'white'} fillOpacity={o.fillOpacity ?? 1} stroke={o.color} strokeWidth="2" />
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

function ObjectPreview({ object }: { object: EskizObject }) {
  if (object.hidden) return null;
  if (object.type === 'dimension') return <DimensionPreview object={object} />;
  if (object.type === 'module') return <ModulePreview object={object} />;
  if (object.type === 'callout') return <CalloutPreview object={object} />;
  if (object.type === 'comment' || object.type === 'link' || object.type === 'equipment') return <TextPreview object={object} />;
  return null;
}

export default function EskizProjectPreview({ project, compact = false }: { project: EskizProject; compact?: boolean }) {
  const width = Math.max(1, project.image.width);
  const height = Math.max(1, project.image.height);
  return (
    <article className={`eskiz-preview ${compact ? 'compact' : ''}`}>
      <div className="eskiz-preview-head">
        <div><b>{project.title}</b><span>{project.image.name} · {project.objects.filter((item) => !item.hidden && item.type !== 'guide' && item.type !== 'anchor').length} объектов</span></div>
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
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Эскиз PRO: ${project.title}`}>
          <defs>
            <marker id="eskizDimArrow" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto-start-reverse">
              <path d="M 9 5 L 1 1 M 9 5 L 1 9" fill="none" stroke="context-stroke" strokeWidth="1.7" strokeLinecap="round" />
            </marker>
            <marker id="eskizDimArrowClosed" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto-start-reverse">
              <path d="M 9 5 L 1 1 L 3 5 L 1 9 Z" fill="context-stroke" />
            </marker>
          </defs>
          <image href={project.image.dataUrl} x="0" y="0" width={width} height={height} preserveAspectRatio="none" style={{ filter: imageFilter(project) }} />
          {project.objects.map((object) => <ObjectPreview key={object.id} object={object} />)}
        </svg>
      </div>
    </article>
  );
}
