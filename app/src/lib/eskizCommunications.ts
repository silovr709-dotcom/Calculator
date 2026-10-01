import type { EskizCommunicationAnchorKind, EskizCommunicationKind, EskizCommunicationMarker } from '../types';

export const COMMUNICATION_KIND_META: Record<EskizCommunicationKind, { label: string; icon: string; color: string; defaultName: string }> = {
  socket: { label: 'Розетка', icon: '⌁', color: '#2563eb', defaultName: 'Розетка' },
  switch: { label: 'Выключатель', icon: '⏻', color: '#4f46e5', defaultName: 'Выключатель' },
  electricOutput: { label: 'Электровывод', icon: '⚡', color: '#ca8a04', defaultName: 'Электровывод' },
  waterCold: { label: 'Холодная вода', icon: 'Х', color: '#0284c7', defaultName: 'Вывод ХВС' },
  waterHot: { label: 'Горячая вода', icon: 'Г', color: '#dc2626', defaultName: 'Вывод ГВС' },
  sewer: { label: 'Канализация', icon: '⌀', color: '#475569', defaultName: 'Канализация' },
  gas: { label: 'Газ', icon: 'G', color: '#ea580c', defaultName: 'Газ' },
  ventilation: { label: 'Вентиляция', icon: '⇧', color: '#0f766e', defaultName: 'Вентиляция' },
  hood: { label: 'Вывод вытяжки', icon: '⬆', color: '#059669', defaultName: 'Вывод вытяжки' },
  other: { label: 'Другое', icon: '•', color: '#7c3aed', defaultName: 'Коммуникация' },
};

export const COMMUNICATION_ANCHOR_LABELS: Record<EskizCommunicationAnchorKind, string> = {
  left: 'до левого края / стены',
  right: 'до правого края / стены',
  top: 'до верха / потолка',
  bottom: 'до низа / пола',
  custom: 'до выбранной точки',
};

export const COMMUNICATION_KINDS = Object.keys(COMMUNICATION_KIND_META) as EskizCommunicationKind[];

export function communicationSizeText(marker: EskizCommunicationMarker) {
  const parts = [
    marker.widthMm && marker.heightMm ? `${marker.widthMm}×${marker.heightMm} мм` : marker.widthMm ? `шир. ${marker.widthMm} мм` : marker.heightMm ? `выс. ${marker.heightMm} мм` : null,
    marker.diameterMm ? `Ø ${marker.diameterMm} мм` : null,
    marker.depthMm ? `гл. ${marker.depthMm} мм` : null,
    marker.elevationMm ? `h=${marker.elevationMm} мм` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

export function communicationDistanceText(value: number | null | undefined) {
  return value == null ? 'размер не задан' : `${value} мм`;
}
