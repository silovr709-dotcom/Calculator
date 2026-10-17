import { describe, expect, it, vi, beforeEach } from 'vitest';

const missingMock = vi.fn<(hashes: string[]) => Promise<string[]>>();
const uploadMock = vi.fn<(base64: string, mime: string) => Promise<{ id: string; size: number; reused: boolean }>>();

vi.mock('./serverApi', () => ({
  serverFilesMissing: (hashes: string[]) => missingMock(hashes),
  uploadServerFile: (base64: string, mime: string) => uploadMock(base64, mime),
  serverFileUrl: (id: string) => `api/index.php?r=files&id=${id}`,
}));

import { dehydrate, dehydrateKnown, hydrate, isFileRef, resetPhotoStoreCache } from './photoStore';

/** Картинка заведомо больше порога, чтобы её выносило в файл. */
const bigPhoto = `data:image/jpeg;base64,${btoa('A'.repeat(6000))}`;
const smallIcon = 'data:image/png;base64,AAAA';

describe('вынос фотографий в файлы на сервере', () => {
  beforeEach(() => {
    resetPhotoStoreCache();
    missingMock.mockReset();
    uploadMock.mockReset();
    missingMock.mockImplementation(async (hashes) => hashes);
    uploadMock.mockImplementation(async () => ({ id: 'x', size: 1, reused: false }));
  });

  it('заменяет большое фото ссылкой и загружает его один раз', async () => {
    const project = { id: 'p1', photos: [{ id: 'ph1', dataUrl: bigPhoto }], note: 'текст' };

    const first = await dehydrate(project);
    const ref = (first as typeof project).photos[0].dataUrl;

    expect(isFileRef(ref)).toBe(true);
    expect((first as typeof project).note).toBe('текст');
    expect(uploadMock).toHaveBeenCalledTimes(1);

    missingMock.mockImplementation(async () => []);
    const second = await dehydrate(project);
    expect((second as typeof project).photos[0].dataUrl).toBe(ref);
    expect(uploadMock).toHaveBeenCalledTimes(1);  // повторной загрузки нет
  });

  it('маленькие картинки не трогает', async () => {
    const result = await dehydrate({ icon: smallIcon });
    expect(result.icon).toBe(smallIcon);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('одинаковые фото в разных проектах дают одну ссылку', async () => {
    const result = await dehydrate([{ id: 'a', dataUrl: bigPhoto }, { id: 'b', dataUrl: bigPhoto }]);
    expect(result[0].dataUrl).toBe(result[1].dataUrl);
    expect(uploadMock).toHaveBeenCalledTimes(1);
  });

  it('разворачивает ссылку обратно в картинку', async () => {
    const packed = await dehydrate({ photos: [{ dataUrl: bigPhoto }] });
    const restored = await hydrate(packed);
    expect(restored.photos[0].dataUrl).toBe(bigPhoto);
  });

  it('без связи подставляет прямой адрес файла', async () => {
    const packed = await dehydrate({ photos: [{ dataUrl: bigPhoto }] });
    resetPhotoStoreCache();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('нет сети'); }));

    const restored = await hydrate(packed);
    expect(String(restored.photos[0].dataUrl)).toContain('r=files&id=');
    vi.unstubAllGlobals();
  });

  it('лёгкая копия для браузера использует уже известные ссылки', async () => {
    const packed = await dehydrate({ photos: [{ dataUrl: bigPhoto }] });
    const light = dehydrateKnown({ photos: [{ dataUrl: bigPhoto }] });
    expect(light.photos[0].dataUrl).toBe(packed.photos[0].dataUrl);
  });
});
