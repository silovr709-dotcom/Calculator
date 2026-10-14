// Слои при выгрузке Эскиз PRO: что реально попадёт в PNG/PDF.
//
// Складываем три источника: состояние слоёв в редакторе, разовое переопределение
// (например, выгрузка конкретного эскиза из списка) и постоянные выключатели выгрузки.
// Правило одно: выключатель выгрузки может только убрать элемент, но не вернуть скрытый.

import type { EskizExportOverrides, EskizExportViewSettings, EskizLayerKey, EskizLayerVisibility } from '../types';

export function mergeEskizExportLayers(
  view: EskizExportViewSettings,
  overrides: EskizExportOverrides,
  viewOverride?: EskizExportViewSettings,
): Partial<EskizLayerVisibility> {
  const layers: Partial<EskizLayerVisibility> = {
    ...(view.layerVisibility ?? {}),
    ...(viewOverride?.layerVisibility ?? {}),
  };
  for (const [key, visible] of Object.entries(overrides.layerVisibility ?? {})) {
    if (visible === false) layers[key as EskizLayerKey] = false;
  }
  return layers;
}

export function mergeEskizExportImage(
  view: EskizExportViewSettings,
  overrides: EskizExportOverrides,
  viewOverride?: EskizExportViewSettings,
): boolean | undefined {
  if (overrides.showImage === false) return false;
  return viewOverride?.showImage ?? view.showImage;
}
