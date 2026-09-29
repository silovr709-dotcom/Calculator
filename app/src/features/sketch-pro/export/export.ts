import { jsPDF } from 'jspdf'
import type { SketchProject } from '../core/types'

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = reject
  image.src = src
})

async function makeCanvas(project: SketchProject, svg: SVGSVGElement) {
  const headerH = project.header.enabled ? 120 : 0
  const canvas = document.createElement('canvas')
  canvas.width = project.image.width
  canvas.height = project.image.height + headerH
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  if (project.header.enabled) {
    ctx.fillStyle = '#171a1f'
    ctx.fillRect(0, 0, canvas.width, headerH)
    ctx.fillStyle = '#fff'
    ctx.font = '700 32px Arial, sans-serif'
    ctx.fillText('РЕцепт  /  Эскиз PRO', 32, 46)
    ctx.font = '600 20px Arial, sans-serif'
    ctx.fillText(`Проект: ${project.header.project || '—'}`, 32, 86)
    ctx.font = '500 18px Arial, sans-serif'
    const details = `Помещение: ${project.header.room || '—'}     Дата: ${project.header.date || '—'}     Вариант: ${project.header.variant || '—'}`
    ctx.fillText(details, Math.min(430, canvas.width * .42), 85)
  }

  const base = await loadImage(project.image.dataUrl)
  ctx.drawImage(base, 0, headerH, project.image.width, project.image.height)

  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.querySelector('image')?.remove()
  clone.querySelectorAll('.object-handle').forEach(n => n.remove())
  clone.setAttribute('width', String(project.image.width))
  clone.setAttribute('height', String(project.image.height))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const xml = new XMLSerializer().serializeToString(clone)
  const overlay = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`)
  ctx.drawImage(overlay, 0, headerH)
  return { canvas, headerH }
}

export async function exportPng(project: SketchProject, svg: SVGSVGElement) {
  const { canvas } = await makeCanvas(project, svg)
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Не удалось создать PNG')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${project.title.replace(/[^а-яa-z0-9-_ ]/gi, '') || 'Эскиз'}.png`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export async function exportPdf(project: SketchProject, svg: SVGSVGElement, options: { format?: 'a4' | 'a3'; orientation?: 'portrait' | 'landscape'; margin?: number } = {}) {
  const { canvas, headerH } = await makeCanvas(project, svg)
  const orientation = options.orientation ?? (canvas.width > canvas.height ? 'landscape' : 'portrait')
  const pdf = new jsPDF({ orientation, unit: 'mm', format: options.format ?? 'a4', compress: true })
  const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight()
  const margin = options.margin ?? 8
  const scale = Math.min((pageW - margin * 2) / canvas.width, (pageH - margin * 2) / canvas.height)
  const w = canvas.width * scale, h = canvas.height * scale
  const ox = (pageW - w) / 2, oy = (pageH - h) / 2
  pdf.addImage(canvas.toDataURL('image/jpeg', .94), 'JPEG', ox, oy, w, h, undefined, 'FAST')
  for (const o of project.objects) {
    if (!('url' in o) || !o.url) continue
    const linkW = 60 * scale, linkH = Math.max(24, o.fontSize + 12) * scale
    pdf.link(ox + o.x * scale, oy + (o.y + headerH) * scale, linkW, linkH, { url: o.url })
  }
  pdf.save(`${project.title.replace(/[^а-яa-z0-9-_ ]/gi, '') || 'Эскиз'}.pdf`)
}
