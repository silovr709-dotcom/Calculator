import { describe, expect, it } from 'vitest';
import { mergeEskizExportImage, mergeEskizExportLayers } from './eskizExportOptions';

describe('слои при выгрузке Эскиз PRO', () => {
  it('выключатель выгрузки убирает сноски, не трогая остальное', () => {
    const layers = mergeEskizExportLayers({}, { layerVisibility: { callouts: false } });
    expect(layers.callouts).toBe(false);
    expect(layers.dimensions).toBeUndefined();
  });

  it('скрытый в редакторе слой нельзя вернуть галочкой выгрузки', () => {
    const layers = mergeEskizExportLayers({ layerVisibility: { dimensions: false } }, { layerVisibility: { dimensions: true } });
    expect(layers.dimensions).toBe(false);
  });

  it('разовое переопределение сильнее состояния редактора', () => {
    const layers = mergeEskizExportLayers({ layerVisibility: { modules: false } }, {}, { layerVisibility: { modules: true } });
    expect(layers.modules).toBe(true);
  });

  it('фон можно выключить только для файла', () => {
    expect(mergeEskizExportImage({ showImage: true }, { showImage: false })).toBe(false);
    expect(mergeEskizExportImage({ showImage: true }, {})).toBe(true);
    expect(mergeEskizExportImage({}, {}, { showImage: false })).toBe(false);
  });
});
