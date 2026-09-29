import type { PointerEvent as ReactPointerEvent } from 'react'
import { ExternalLink } from 'lucide-react'
import type { SketchObject } from '../core/types'

function wrapLines(text: string, maxChars: number) {
  return text.split('\n').flatMap(source => {
    if (!source) return ['']
    const words = source.split(/\s+/)
    const lines: string[] = []
    let line = ''
    for (const word of words) {
      if (word.length > maxChars) {
        if (line) { lines.push(line); line = '' }
        for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars))
      } else if (!line) line = word
      else if (`${line} ${word}`.length <= maxChars) line += ` ${word}`
      else { lines.push(line); line = word }
    }
    if (line) lines.push(line)
    return lines.length ? lines : ['']
  })
}

type Props = {
  object: SketchObject
  selected: boolean
  primary?: boolean
  onPointerDown: (e: ReactPointerEvent<SVGGElement>, object: SketchObject) => void
  onHandleDown: (e: ReactPointerEvent<SVGCircleElement>, end: 'start' | 'end' | 'offset' | 'resize') => void
}

export default function SketchObjectView({ object: o, selected, primary = selected, onPointerDown, onHandleDown }: Props) {
  if (o.type === 'dimension') {
    const x1 = o.x, y1 = o.y, x2 = o.x2, y2 = o.y2
    const baseMidX = (x1 + x2) / 2, baseMidY = (y1 + y2) / 2
    const lineAngle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI
    let readableAngle = lineAngle
    if (readableAngle > 90) readableAngle -= 180
    if (readableAngle < -90) readableAngle += 180
    const textAngle = (o.textOrientation ?? 'parallel') === 'horizontal' ? 0 : readableAngle
    const tolerance = o.tolerance ? ` ±${o.tolerance.replace(/^±\s*/, '')}` : ''
    const label = `${o.prefix ?? ''}${o.value || '—'}${o.showUnit === false ? '' : ' мм'}${tolerance}${o.suffix ? ` ${o.suffix}` : ''}`
    const approxWidth = Math.max(68, label.length * o.fontSize * .62)
    const tick = 9
    const length = Math.max(1, Math.hypot(x2 - x1, y2 - y1))
    const unitNormalX = -(y2 - y1) / length
    const unitNormalY = (x2 - x1) / length
    const offset = o.offset ?? 0
    const lineX1 = x1 + unitNormalX * offset, lineY1 = y1 + unitNormalY * offset
    const lineX2 = x2 + unitNormalX * offset, lineY2 = y2 + unitNormalY * offset
    const midX = baseMidX + unitNormalX * offset, midY = baseMidY + unitNormalY * offset
    const textShift = o.textPosition === 'above' ? -o.fontSize * .9 : o.textPosition === 'below' ? o.fontSize * .9 : 0
    const textX = midX + unitNormalX * textShift, textY = midY + unitNormalY * textShift
    const normalX = unitNormalX * tick, normalY = unitNormalY * tick
    const extension = offset === 0 ? 0 : Math.sign(offset) * 7
    return <g className={`sketch-object ${selected ? 'selected' : ''}`} onPointerDown={e => onPointerDown(e, o)}>
      {offset !== 0 && <>
        <line x1={x1} y1={y1} x2={lineX1 + unitNormalX * extension} y2={lineY1 + unitNormalY * extension} stroke={o.color} strokeWidth={Math.max(1, o.lineWidth * .7)} opacity=".78"/>
        <line x1={x2} y1={y2} x2={lineX2 + unitNormalX * extension} y2={lineY2 + unitNormalY * extension} stroke={o.color} strokeWidth={Math.max(1, o.lineWidth * .7)} opacity=".78"/>
      </>}
      <line x1={lineX1} y1={lineY1} x2={lineX2} y2={lineY2} stroke={o.color} strokeWidth={o.lineWidth} markerStart={o.arrowStyle === 'tick' ? undefined : `url(#${o.arrowStyle === 'closed' ? 'dimArrowClosed' : 'dimArrow'})`} markerEnd={o.arrowStyle === 'tick' ? undefined : `url(#${o.arrowStyle === 'closed' ? 'dimArrowClosed' : 'dimArrow'})`} />
      <line x1={lineX1 - normalX} y1={lineY1 - normalY} x2={lineX1 + normalX} y2={lineY1 + normalY} stroke={o.color} strokeWidth={o.lineWidth}/>
      <line x1={lineX2 - normalX} y1={lineY2 - normalY} x2={lineX2 + normalX} y2={lineY2 + normalY} stroke={o.color} strokeWidth={o.lineWidth}/>
      <g transform={`translate(${textX} ${textY}) rotate(${textAngle})`}>
        <rect x={-approxWidth / 2} y={-o.fontSize * .72} width={approxWidth} height={o.fontSize * 1.25} rx="3" fill="white" opacity=".92"/>
        <text textAnchor="middle" dominantBaseline="middle" fontSize={o.fontSize} fontWeight="700" fill={o.color}>{label}</text>
      </g>
      {primary && <>
        {offset !== 0 && <line x1={baseMidX} y1={baseMidY} x2={midX} y2={midY} stroke="#2563eb" strokeWidth="1" strokeDasharray="4 4" opacity=".7"/>}
        <circle className="object-handle" cx={x1} cy={y1} r="7" onPointerDown={e => onHandleDown(e, 'start')}/>
        <circle className="object-handle" cx={x2} cy={y2} r="7" onPointerDown={e => onHandleDown(e, 'end')}/>
        <circle className="object-handle offset-handle" cx={midX} cy={midY} r="8" onPointerDown={e => onHandleDown(e, 'offset')}/>
      </>}
    </g>
  }

  if (o.type === 'module') {
    const sourceLines = [o.number, ...o.description.split('\n').filter(Boolean)]
    const autoWidth = Math.max(72, ...sourceLines.map(t => t.length * o.fontSize * .6)) + 22
    const width = o.width ? Math.max(60, o.width) : autoWidth
    const maxChars = Math.max(2, Math.floor((width - 22) / (o.fontSize * .6)))
    const lines = sourceLines.flatMap(line => wrapLines(line, maxChars))
    const autoHeight = lines.length * (o.fontSize + 5) + 14
    const height = Math.max(autoHeight, o.height ?? 0)
    const textBlockHeight = lines.length * (o.fontSize + 5) - 5
    const textY = Math.max(8, (height - textBlockHeight) / 2)
    return <g className={`sketch-object label-object ${selected ? 'selected' : ''}`} transform={`translate(${o.x} ${o.y})`} onPointerDown={e => onPointerDown(e, o)}>
      <rect x="0" y="0" width={width} height={height} rx={o.borderRadius ?? 6} fill={o.fill ?? 'white'} fillOpacity={o.fillOpacity ?? 1} stroke={o.color} strokeWidth="2"/>
      {lines.map((line, i) => <text key={i} x={width / 2} y={textY + i * (o.fontSize + 5)} dominantBaseline="hanging" textAnchor="middle" fontSize={o.fontSize} fontWeight={i === 0 ? 800 : 500} fill={o.color}>{line}</text>)}
      {primary && <circle className="object-handle resize-handle" cx={width} cy={height} r="8" onPointerDown={e => onHandleDown(e, 'resize')}/>}
    </g>
  }

  if (o.type === 'callout') {
    const sourceLines = o.text.split('\n')
    const autoWidth = Math.max(120, ...sourceLines.map(t => t.length * o.fontSize * .56)) + 24
    const width = o.width ? Math.max(70, o.width) : autoWidth
    const maxChars = Math.max(3, Math.floor((width - 24) / (o.fontSize * .56)))
    const lines = wrapLines(o.text, maxChars)
    const autoHeight = Math.max(48, lines.length * (o.fontSize + 5) + 18)
    const height = Math.max(autoHeight, o.height ?? 0)
    const elbowX = o.x > o.targetX ? o.x - 18 : o.x + width + 18
    return <g className={`sketch-object label-object ${selected ? 'selected' : ''}`} onPointerDown={e => onPointerDown(e, o)}>
      <polyline points={`${o.targetX},${o.targetY} ${elbowX},${o.y + height / 2} ${o.x > o.targetX ? o.x : o.x + width},${o.y + height / 2}`} fill="none" stroke={o.color} strokeWidth="2"/>
      <circle cx={o.targetX} cy={o.targetY} r="5" fill={o.color}/>
      <rect x={o.x} y={o.y} width={width} height={height} rx={o.borderRadius ?? 6} fill={o.fill ?? '#fff'} fillOpacity={o.fillOpacity ?? 1} stroke={o.color} strokeWidth="2"/>
      {lines.map((line, i) => <text key={i} x={o.x + 12} y={o.y + 11 + i * (o.fontSize + 5)} dominantBaseline="hanging" fontSize={o.fontSize} fontWeight="600" fill={o.color}>{line}</text>)}
      {primary && <><circle className="object-handle" cx={o.targetX} cy={o.targetY} r="7" onPointerDown={e => onHandleDown(e, 'start')}/><circle className="object-handle resize-handle" cx={o.x + width} cy={o.y + height} r="8" onPointerDown={e => onHandleDown(e, 'resize')}/></>}
    </g>
  }

  const isComment = o.type === 'comment'
  const isLink = o.type === 'link'
  const sourceLines = o.text.split('\n')
  const autoWidth = Math.max(isComment ? 160 : 100, ...sourceLines.map(t => t.length * o.fontSize * .56)) + 28
  const width = o.width ? Math.max(60, o.width) : autoWidth
  const textInset = isLink ? 37 : 28
  const maxChars = Math.max(3, Math.floor((width - textInset) / (o.fontSize * .56)))
  const lines = wrapLines(o.text, maxChars)
  const autoHeight = lines.length * (o.fontSize + 5) + 22
  const height = Math.max(autoHeight, o.height ?? 0)
  return <g className={`sketch-object label-object ${selected ? 'selected' : ''}`} transform={`translate(${o.x} ${o.y})`} onPointerDown={e => onPointerDown(e, o)}>
    <rect x="0" y="0" width={width} height={height} rx={o.borderRadius ?? 7} fill={o.fill ?? (isComment ? '#fff8d8' : 'white')} fillOpacity={o.fillOpacity ?? 1} stroke={o.color} strokeWidth={selected ? 3 : 1.5}/>
    {isLink && <foreignObject x="9" y={(height - 16) / 2} width="16" height="16"><ExternalLink size={16} color={o.color}/></foreignObject>}
    {lines.map((line, i) => <text key={i} x={isLink ? 31 : 14} y={12 + i * (o.fontSize + 5)} dominantBaseline="hanging" fontSize={o.fontSize} fontWeight={o.type === 'equipment' ? 750 : 550} fill={o.color}>{line}</text>)}
    {primary && <circle className="object-handle resize-handle" cx={width} cy={height} r="8" onPointerDown={e => onHandleDown(e, 'resize')}/>}
  </g>
}
