import type { EskizCommunicationAnchorKind, EskizCommunicationKind, EskizCommunicationMarker } from '../types';

type CommunicationKindMeta = {
  label: string;
  icon: string;
  color: string;
  defaultName: string;
  shortLabel: string;
  group: 'electric' | 'water' | 'vent' | 'gas' | 'other';
};

export const COMMUNICATION_KIND_META: Record<EskizCommunicationKind, CommunicationKindMeta> = {
  socket: { label: 'Розетка', icon: '◉', color: '#2563eb', defaultName: 'Розетка', shortLabel: '1×', group: 'electric' },
  socketDouble: { label: 'Розетка двойная', icon: '◉◉', color: '#2563eb', defaultName: 'Розетка двойная', shortLabel: '2×', group: 'electric' },
  socketTriple: { label: 'Розетка тройная', icon: '◉◉◉', color: '#2563eb', defaultName: 'Розетка тройная', shortLabel: '3×', group: 'electric' },
  switch: { label: 'Выключатель', icon: '⎋', color: '#4f46e5', defaultName: 'Выключатель', shortLabel: 'ВКЛ', group: 'electric' },
  switchDouble: { label: 'Выключатель двойной', icon: '⎋⎋', color: '#4f46e5', defaultName: 'Выключатель двойной', shortLabel: '2ВКЛ', group: 'electric' },
  electricOutput: { label: 'Электровывод', icon: '⚡', color: '#ca8a04', defaultName: 'Электровывод', shortLabel: '220', group: 'electric' },
  waterCold: { label: 'Холодная вода', icon: 'Х', color: '#0284c7', defaultName: 'Вывод ХВС', shortLabel: 'ХВС', group: 'water' },
  waterHot: { label: 'Горячая вода', icon: 'Г', color: '#dc2626', defaultName: 'Вывод ГВС', shortLabel: 'ГВС', group: 'water' },
  sewer: { label: 'Канализация', icon: '⌀', color: '#475569', defaultName: 'Канализация', shortLabel: 'КАН', group: 'water' },
  gas: { label: 'Газ', icon: 'G', color: '#ea580c', defaultName: 'Газ', shortLabel: 'ГАЗ', group: 'gas' },
  ventilation: { label: 'Вентиляция', icon: '⇧', color: '#0f766e', defaultName: 'Вентиляция', shortLabel: 'ВЕНТ', group: 'vent' },
  hood: { label: 'Вывод вытяжки', icon: '⬆', color: '#059669', defaultName: 'Вывод вытяжки', shortLabel: 'ВЫТ', group: 'vent' },
  other: { label: 'Другое', icon: '•', color: '#7c3aed', defaultName: 'Коммуникация', shortLabel: 'КОМ', group: 'other' },
};

export const COMMUNICATION_ANCHOR_LABELS: Record<EskizCommunicationAnchorKind, string> = {
  left: 'до левого края / стены',
  right: 'до правого края / стены',
  top: 'до верха / потолка',
  bottom: 'до низа / пола',
  custom: 'до выбранной точки',
};

export const COMMUNICATION_KINDS = Object.keys(COMMUNICATION_KIND_META) as EskizCommunicationKind[];

export function communicationSocketCount(kind: EskizCommunicationKind) {
  if (kind === 'socket' || kind === 'socketDouble' || kind === 'socketTriple') return kind === 'socketTriple' ? 3 : kind === 'socketDouble' ? 2 : 1;
  return 0;
}

export function communicationSwitchCount(kind: EskizCommunicationKind) {
  if (kind === 'switch' || kind === 'switchDouble') return kind === 'switchDouble' ? 2 : 1;
  return 0;
}

export function communicationIsElectricalPoint(kind: EskizCommunicationKind) {
  return communicationSocketCount(kind) > 0 || communicationSwitchCount(kind) > 0 || kind === 'electricOutput';
}

export function defaultCommunicationDimensions(kind: EskizCommunicationKind): Pick<EskizCommunicationMarker, 'widthMm' | 'heightMm' | 'diameterMm'> {
  if (kind === 'socketTriple') return { widthMm: 220, heightMm: 80, diameterMm: null };
  if (kind === 'socketDouble') return { widthMm: 150, heightMm: 80, diameterMm: null };
  if (kind === 'socket' || kind === 'switch' || kind === 'switchDouble' || kind === 'electricOutput') return { widthMm: 80, heightMm: 80, diameterMm: null };
  if (kind === 'sewer' || kind === 'ventilation' || kind === 'hood') return { widthMm: null, heightMm: null, diameterMm: 110 };
  return { widthMm: null, heightMm: null, diameterMm: null };
}

export function communicationSizeText(marker: EskizCommunicationMarker) {
  const parts = [
    marker.widthMm && marker.heightMm ? `${marker.widthMm}×${marker.heightMm} мм` : marker.widthMm ? `шир. ${marker.widthMm} мм` : marker.heightMm ? `выс. ${marker.heightMm} мм` : null,
    marker.diameterMm ? `Ø ${marker.diameterMm} мм` : null,
    marker.depthMm ? `гл. ${marker.depthMm} мм` : null,
    marker.elevationMm ? `h=${marker.elevationMm} мм` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

export function communicationCompactSizeText(marker: EskizCommunicationMarker) {
  const parts = [
    marker.widthMm && marker.heightMm ? `${marker.widthMm}×${marker.heightMm}` : marker.widthMm ? `W ${marker.widthMm}` : marker.heightMm ? `H ${marker.heightMm}` : null,
    marker.diameterMm ? `Ø${marker.diameterMm}` : null,
    marker.depthMm ? `гл.${marker.depthMm}` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

export function communicationElevationText(marker: EskizCommunicationMarker) {
  return marker.elevationMm ? `h=${marker.elevationMm}` : '';
}

export function communicationDistanceText(value: number | null | undefined) {
  return value == null ? 'размер не задан' : `${value} мм`;
}
