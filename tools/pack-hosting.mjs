#!/usr/bin/env node
// Собирает готовый к загрузке на хостинг пакет: приложение + серверная часть.
// Запуск: npm run build:hosting (из папки app) или node tools/pack-hosting.mjs
//
// Результат:
//   release/site/        — содержимое корня сайта (можно залить по FTP как есть)
//   release/recept-site.zip — то же одним файлом для файлового менеджера хостинга

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
void require;

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = path.join(root, 'app', 'dist');
const server = path.join(root, 'server');
const releaseDir = path.join(root, 'release');
const siteDir = path.join(releaseDir, 'site');

if (!fs.existsSync(dist)) {
  console.error('Сначала соберите приложение: cd app && npm run build');
  process.exit(1);
}

fs.rmSync(siteDir, { recursive: true, force: true });
fs.mkdirSync(siteDir, { recursive: true });

// 1. Само приложение
fs.cpSync(dist, siteDir, { recursive: true });

// 2. Серверная часть и настройки Apache/PHP
fs.cpSync(path.join(server, 'api'), path.join(siteDir, 'api'), { recursive: true });
for (const file of ['.htaccess', '.user.ini']) {
  fs.copyFileSync(path.join(server, file), path.join(siteDir, file));
}

// 3. Короткая памятка внутрь пакета
fs.writeFileSync(path.join(siteDir, 'КАК-ЗАГРУЗИТЬ.txt'), [
  'Пакет калькулятора РЕцепт для виртуального хостинга',
  '',
  '1. Загрузите ВСЁ содержимое этой папки в корень сайта на хостинге',
  '   (на reg.ru это обычно /domains/ваш-домен/public_html или /www/ваш-домен).',
  '2. Проверьте установку: откройте https://ваш-адрес/api/index.php?r=check',
  '   — страница покажет, все ли файлы на месте (включая скрытые .htaccess и .user.ini).',
  '3. Откройте сайт в браузере — появится экран «Первый запуск».',
  '4. Придумайте логин и пароль владельца: это первая учётная запись.',
  '5. Сотрудников добавьте в разделе «Сервер» внутри приложения.',
  '',
  'Требования: PHP 8.0 и выше, модуль mod_rewrite (включён на reg.ru по умолчанию).',
  'Данные хранятся в папке recept-data рядом с папкой сайта и недоступны из браузера.',
  '',
].join('\n'), 'utf8');

/* ------------------------- минимальный упаковщик zip ------------------------- */

function collect(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...collect(full, rel));
    else out.push({ rel, full });
  }
  return out;
}

function dosTime(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const { time, day } = dosTime(new Date());

  for (const file of files) {
    const data = fs.readFileSync(file.full);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const name = Buffer.from(file.rel, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // имена файлов в UTF-8
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, payload);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(useDeflate ? 8 : 0, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(day, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(payload.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + payload.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuffer, end]);
}

const files = collect(siteDir);
const zip = makeZip(files);
const zipPath = path.join(releaseDir, 'recept-site.zip');
fs.writeFileSync(zipPath, zip);

const totalMb = (files.reduce((sum, file) => sum + fs.statSync(file.full).size, 0) / 1048576).toFixed(1);
console.log(`Готово: ${files.length} файлов, ${totalMb} МБ`);
console.log(`  папка:  ${path.relative(process.cwd(), siteDir)}`);
console.log(`  архив:  ${path.relative(process.cwd(), zipPath)} (${(zip.length / 1048576).toFixed(1)} МБ)`);
console.log('Залейте содержимое папки (или распакуйте архив) в корень сайта на хостинге.');
