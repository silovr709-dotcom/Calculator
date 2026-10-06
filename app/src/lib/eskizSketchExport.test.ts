import { describe, expect, it } from 'vitest';
import type { EskizProject } from './eskizPro';
import { buildEskizSketchSvg, buildSingleImagePdf, collectEskizSketchLinks, eskizSketchFileName, eskizSketchPdfLinks, normalizeEskizLinkUrl } from './eskizSketchExport';
import type { EskizCommunicationMarker } from '../types';

const project: EskizProject = {
  version: 1,
  id: 'eskiz-1',
  title: 'Кухня Иванов',
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:10:00.000Z',
  image: { dataUrl: 'data:image/png;base64,AAA=', width: 800, height: 500, name: 'plan.png' },
  objects: [
    { id: 'd1', type: 'dimension', x: 10, y: 20, x2: 210, y2: 20, orientation: 'horizontal', value: '2000', color: '#111827', fontSize: 14, lineWidth: 2 },
    { id: 'm1', type: 'module', x: 120, y: 160, number: 'М1', description: 'Низ 600', color: '#7c3aed', fontSize: 12 },
    { id: 'c1', type: 'comment', x: 40, y: 80, text: 'Важно', color: '#b45309', fontSize: 12 },
    { id: 'a1', type: 'anchor', x: 70, y: 90, label: 'Точка А', color: '#0f766e', fontSize: 12 },
    { id: 'g1', type: 'guide', x: 180, y: 140, orientation: 'vertical', color: '#64748b', fontSize: 12 },
  ],
  header: { enabled: true, project: 'Кухня Иванов', room: 'Кухня', date: '01.10.2026', variant: 'A' },
  integration: {},
};

const communication: EskizCommunicationMarker = {
  id: 'com-1',
  eskizId: 'eskiz-1',
  kind: 'socket',
  name: 'Розетка ПММ',
  x: 300,
  y: 220,
  widthMm: 70,
  heightMm: 70,
  distances: [{ id: 'dist-1', label: 'от угла', anchor: 'left', valueMm: 300 }],
  createdAt: '2026-10-01T08:12:00.000Z',
};

describe('buildEskizSketchSvg', () => {
  it('собирает SVG с размерами, комментариями и компактными маркерами модулей', () => {
    const svg = buildEskizSketchSvg(project, { moduleMarkerMode: 'compact', communications: [communication] });
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 800 500"');
    expect(svg).toContain('2000 мм');
    expect(svg).toContain('Важно');
    expect(svg).toContain('Розетка ПММ');
    expect(svg).toContain('М1');
  });

  it('умеет скрывать маркеры модулей для выгрузки в фабричный бланк', () => {
    const svg = buildEskizSketchSvg(project, { moduleMarkerMode: 'hidden' });
    expect(svg).not.toContain('Низ 600');
    expect(svg).toContain('2000 мм');
  });

  it('рендерит петли отдельным слоем и скрывает их при отключении слоя', () => {
    const withHinge: EskizProject = {
      ...project,
      objects: [...project.objects, { id: 'h1', type: 'hinge', x: 260, y: 190, label: 'П1', side: 'auto', color: '#1d4ed8', fontSize: 20 }],
    };
    const svg = buildEskizSketchSvg(withHinge);
    expect(svg).toContain('class="hinge"');
    expect(svg).toContain('<title>П1</title>');
    expect(svg).not.toContain('>П1</text>');
    const hidden = buildEskizSketchSvg(withHinge, { layerVisibility: { hinges: false } });
    expect(hidden).not.toContain('П1');
  });

  it('уважает скрытие отдельных слоёв редактора при SVG/PNG/PDF-рендеринге', () => {
    const svg = buildEskizSketchSvg(project, {
      communications: [communication],
      layerVisibility: { dimensions: false, modules: false, comments: false, communications: false },
    });
    expect(svg).not.toContain('2000 мм');
    expect(svg).not.toContain('Низ 600');
    expect(svg).not.toContain('Важно');
    expect(svg).not.toContain('Розетка ПММ');
    expect(svg).toContain('Точка А');
  });

  it('уважает скрытие всех пометок, вспомогательных объектов и фонового изображения', () => {
    const svg = buildEskizSketchSvg(project, {
      communications: [communication],
      showImage: false,
      showAnnotations: false,
      showHelpers: false,
    });
    expect(svg).not.toContain('data:image/png;base64,AAA=');
    expect(svg).not.toContain('2000 мм');
    expect(svg).not.toContain('Низ 600');
    expect(svg).not.toContain('Важно');
    expect(svg).not.toContain('Розетка ПММ');
    expect(svg).not.toContain('Точка А');
    expect(svg).not.toContain('stroke-dasharray="8 6"');
  });

  it('оставляет объект скрытым персональным переключателем даже при включённом слое', () => {
    const svg = buildEskizSketchSvg({ ...project, objects: project.objects.map((object) => object.id === 'd1' ? { ...object, hidden: true } : object) }, { layerVisibility: { dimensions: true } });
    expect(svg).not.toContain('2000 мм');
    expect(svg).toContain('Низ 600');
  });

  it('не выводит рядом с коммуникацией плашку габарита, если она скрыта у маркера', () => {
    const svg = buildEskizSketchSvg(project, { communications: [{ ...communication, showSizeBadge: false }] });
    expect(svg).not.toContain('70×70 мм');
    expect(svg).not.toMatch(/<text[^>]*>70×70<\/text>/);
    expect(svg).toContain('от угла: 300 мм');
    expect(svg).toContain('Розетка ПММ');
  });

  it('не выводит плашки габаритов коммуникаций при глобальном отключении для экспорта', () => {
    const svg = buildEskizSketchSvg(project, { communications: [communication], showCommunicationSizeBadges: false });
    expect(svg).not.toContain('70×70 мм');
    expect(svg).not.toMatch(/<text[^>]*>70×70<\/text>/);
    expect(svg).toContain('от угла: 300 мм');
  });

  it('сохраняет ручное положение плашки расстояния коммуникации в экспорте', () => {
    const svg = buildEskizSketchSvg(project, { communications: [{ ...communication, distances: [{ ...communication.distances![0], labelX: 420, labelY: 180 }] }] });
    expect(svg).toContain('translate(420 180)');
    expect(svg).toContain('от угла: 300 мм');
  });

  it('использует пользовательский цвет коммуникации в SVG-экспорте', () => {
    const svg = buildEskizSketchSvg(project, { communications: [{ ...communication, color: '#12abef' }] });
    expect(svg).toContain('stroke="#12abef"');
    expect(svg).toContain('fill="#12abef"');
  });

  it('делает безопасное имя файла картинки', () => {
    expect(eskizSketchFileName({ ...project, title: 'Кухня / тест' }, 'png')).toBe('Кухня - тест.png');
  });

  it('собирает PDF-контейнер с JPEG-изображением', async () => {
    const blob = buildSingleImagePdf(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 10, 10, 595.28, 841.89);
    const text = new TextDecoder().decode(await blob.arrayBuffer());
    expect(text).toContain('%PDF-1.4');
    expect(text).toContain('/Subtype /Image');
    expect(text).toContain('/DCTDecode');
    expect(text).toContain('xref');
  });
});


describe('кликабельные ссылки на технику в выгрузке', () => {
  const withLinks: EskizProject = {
    ...project,
    objects: [
      ...project.objects,
      { id: 'eq1', type: 'equipment', x: 200, y: 100, text: 'Духовой шкаф', equipmentType: 'Духовой шкаф', url: 'https://shop.ru/oven-900', color: '#1d3f72', fontSize: 12 },
      { id: 'lk1', type: 'link', x: 400, y: 300, text: 'Мойка', url: 'www.shop.ru/sink', color: '#1d3f72', fontSize: 12 },
      { id: 'eq2', type: 'equipment', x: 60, y: 300, text: 'ПММ', equipmentType: 'ПММ', url: 'https://', color: '#1d3f72', fontSize: 12 },
    ],
  };

  it('нормализует адрес без схемы и отбрасывает пустой', () => {
    expect(normalizeEskizLinkUrl('https://shop.ru/a')).toBe('https://shop.ru/a');
    expect(normalizeEskizLinkUrl('www.shop.ru/sink')).toBe('https://www.shop.ru/sink');
    expect(normalizeEskizLinkUrl('shop.ru/sink')).toBe('https://shop.ru/sink');
    expect(normalizeEskizLinkUrl('https://')).toBeNull();
    expect(normalizeEskizLinkUrl('  ')).toBeNull();
  });

  it('собирает рамки объектов со ссылками и пропускает пустые', () => {
    const links = collectEskizSketchLinks(withLinks);
    expect(links.map((link) => link.objectId)).toEqual(['eq1', 'lk1']);
    expect(links[0]).toMatchObject({ url: 'https://shop.ru/oven-900', x: 200, y: 100 });
    expect(links[0].width).toBeGreaterThan(0);
    expect(links[0].height).toBeGreaterThan(0);
    expect(links[1].url).toBe('https://www.shop.ru/sink');
  });

  it('не отдаёт ссылки скрытых объектов и выключенных слоёв', () => {
    const hiddenObject = collectEskizSketchLinks({ ...withLinks, objects: withLinks.objects.map((object) => object.id === 'eq1' ? { ...object, hidden: true } : object) });
    expect(hiddenObject.map((link) => link.objectId)).toEqual(['lk1']);
    const hiddenLayer = collectEskizSketchLinks(withLinks, { layerVisibility: { equipment: false } });
    expect(hiddenLayer.map((link) => link.objectId)).toEqual(['lk1']);
    expect(collectEskizSketchLinks(withLinks, { showAnnotations: false })).toHaveLength(0);
  });

  it('оборачивает технику со ссылкой в SVG-ссылку', () => {
    const svg = buildEskizSketchSvg(withLinks);
    expect(svg).toContain('<a href="https://shop.ru/oven-900" target="_blank"');
    expect(svg).toContain('<a href="https://www.shop.ru/sink"');
    expect(svg).not.toContain('href="https://"');
  });

  it('переводит ссылки в координаты страницы PDF', () => {
    const annotations = eskizSketchPdfLinks(withLinks, { widthPx: 1786, heightPx: 2526, title: 'Кухня Иванов' }, 595.28, 841.89);
    expect(annotations).toHaveLength(2);
    annotations.forEach((annotation) => {
      const [x1, y1, x2, y2] = annotation.rect;
      expect(x2).toBeGreaterThan(x1);
      expect(y2).toBeGreaterThan(y1);
      expect(x1).toBeGreaterThanOrEqual(0);
      expect(x2).toBeLessThanOrEqual(595.28);
      expect(y1).toBeGreaterThanOrEqual(0);
      expect(y2).toBeLessThanOrEqual(841.89);
    });
  });

  it('кладёт ссылки в PDF как настоящие аннотации', async () => {
    const blob = buildSingleImagePdf(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 10, 10, 595.28, 841.89, [
      { url: 'https://shop.ru/oven-900', rect: [10, 20, 120, 60] },
    ]);
    const text = new TextDecoder().decode(await blob.arrayBuffer());
    expect(text).toContain('/Annots [6 0 R]');
    expect(text).toContain('/Subtype /Link');
    expect(text).toContain('/URI (https://shop.ru/oven-900)');
    expect(text).toContain('xref\n0 7');
    expect(text).toContain('/Size 7');
  });
});
