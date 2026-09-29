#!/usr/bin/env python3
"""Превью фрезеровок: страницы каталога → маленькие картинки для приложения.

Каталог фрезеровок — PDF на 24 МБ, его нельзя тянуть в браузер. Скрипт
рендерит область с изображением фасада каждой страницы каталога и кладёт
результат в `app/public/img/millings/<slug>.jpg` (~40 КБ на позицию).

Зависимости (не нужны для сборки приложения, только для обновления данных):
    python3 -m pip install pymupdf pillow

Запуск:  python3 tools/render_milling_images.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_millings import CATALOG, load_millings  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "app" / "public" / "img" / "millings"

DPI = 150
# Область страницы с изображением фасада (доли от размера страницы).
# Ниже неё идёт сноска «Изображение фрезеровок ... может отличаться» и блок с размерами.
CROP = (0.155, 0.115, 0.885, 0.702)
TARGET_WIDTH = 440
JPEG_QUALITY = 78


def main() -> int:
    try:
        import pymupdf
        from PIL import Image
    except ImportError:
        return int(bool(sys.stderr.write(
            'Нужны pymupdf и pillow:  python3 -m pip install pymupdf pillow\n')))

    pdf_path = ROOT / CATALOG
    if not pdf_path.exists():
        return int(bool(sys.stderr.write(f'Нет файла каталога: {CATALOG}\n')))

    items, _ = load_millings()
    doc = pymupdf.open(pdf_path)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    total = 0

    for item in items:
        page = doc[item['source']['pdfPage'] - 1]
        pix = page.get_pixmap(dpi=DPI)
        img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
        box = (int(CROP[0] * pix.width), int(CROP[1] * pix.height),
               int(CROP[2] * pix.width), int(CROP[3] * pix.height))
        img = img.crop(box)
        height = round(img.height * TARGET_WIDTH / img.width)
        img = img.resize((TARGET_WIDTH, height), Image.LANCZOS)
        out = OUT_DIR / f"{item['slug']}.jpg"
        img.save(out, 'JPEG', quality=JPEG_QUALITY, optimize=True, progressive=True)
        total += out.stat().st_size

    print(f'{len(items)} превью → {OUT_DIR.relative_to(ROOT)} '
          f'({total // 1024} КБ, в среднем {total // max(len(items), 1) // 1024} КБ)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
