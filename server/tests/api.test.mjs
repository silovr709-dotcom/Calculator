import { loadNodeRuntime, createNodeFsMountHandler } from '@php-wasm/node';
import { PHP } from '@php-wasm/universal';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SERVER_SRC = fileURLToPath(new URL('..', import.meta.url));
const WORK = '/tmp/recept-api-test';

fs.rmSync(WORK, { recursive: true, force: true });
fs.cpSync(SERVER_SRC + 'api', WORK + '/www/api', { recursive: true });
fs.mkdirSync(WORK + '/recept-data', { recursive: true });

const php = new PHP(await loadNodeRuntime('8.2', { emscriptenOptions: { processId: 1 } }));
php.mkdir('/site');
await php.mount('/site', createNodeFsMountHandler(WORK));
php.mkdir('/tmp/sessions');

let cookie = '';

async function call(route, { method = 'GET', body, query = '', gzip = false } = {}) {
  const headers = { Host: 'localhost' };
  if (body) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;
  let payload = body ? JSON.stringify(body) : undefined;
  if (payload && gzip) {
    payload = zlib.gzipSync(Buffer.from(payload, 'utf8'));
    headers['X-Recept-Encoding'] = 'gzip';
  }
  const res = await php.run({
    scriptPath: '/site/www/api/index.php',
    relativeUri: `/api/index.php?r=${route}${query}`,
    method,
    headers,
    body: payload,
    $_SERVER: {
      DOCUMENT_ROOT: '/site/www',
      REMOTE_ADDR: '127.0.0.1',
      SCRIPT_NAME: '/api/index.php',
      HTTPS: '',
    },
  });
  const setCookie = res.headers['set-cookie'];
  if (setCookie) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  const text = res.text;
  let json = null;
  try { json = JSON.parse(text); } catch { /* не JSON */ }
  return { status: res.httpStatusCode, json, raw: text, text: text.slice(0, 400) };
}

function check(name, cond, info = '') {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${info ? ' — ' + info : ''}`);
  if (!cond) process.exitCode = 1;
}

let r = await call('health');
check('health отвечает', r.status === 200 && r.json?.ok === true, r.text);
check('нужна первичная настройка', r.json?.needsSetup === true);

r = await call('check');
check(
  'страница самопроверки открывается',
  r.status === 200 && r.raw.includes('Проверка установки') && r.raw.includes('Версия PHP') && r.raw.includes('.user.ini'),
  r.text,
);

r = await call('state');
check('без входа база закрыта (401)', r.status === 401, r.text);

r = await call('setup', { method: 'POST', body: { login: 'admin', password: 'short' } });
check('короткий пароль отклонён', r.status === 400, r.text);

r = await call('setup', { method: 'POST', body: { login: 'admin', password: 'Parol12345', name: 'Владелец' } });
check('администратор создан', r.status === 200 && r.json?.user?.role === 'admin', r.text);

r = await call('session');
check('сессия активна после настройки', r.json?.user?.login === 'admin', r.text);

r = await call('state');
check('пустая база читается', r.status === 200 && r.json?.rev === 0, r.text);

r = await call('state', { method: 'PUT', body: { baseRev: 0, data: { projects: [{ id: 'p1', updatedAt: '2026-01-01T00:00:00Z' }], clients: [], templates: [], settings: {} } } });
check('база сохранена, rev=1', r.status === 200 && r.json?.rev === 1, r.text);

r = await call('state', { method: 'PUT', body: { baseRev: 0, data: { projects: [], clients: [], templates: [], settings: {} } } });
check('конфликт версий ловится (409)', r.status === 409 && r.json?.conflict === true, r.text);

r = await call('state');
check('данные не затёрты конфликтом', r.json?.data?.projects?.[0]?.id === 'p1', r.text);
check('пустой объект настроек не ломается', r.json?.data?.settings && !Array.isArray(r.json.data.settings), JSON.stringify(r.json?.data?.settings));

r = await call('state', { method: 'PUT', body: { baseRev: 1, data: { projects: [{ id: 'p1' }, { id: 'p2' }], clients: [], templates: [], settings: {} } } });
check('второе сохранение прошло, rev=2', r.status === 200 && r.json?.rev === 2, r.text);

r = await call('state', { method: 'PUT', gzip: true, body: { baseRev: 2, data: { projects: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3', note: 'сжатая отправка' }], clients: [], templates: [], settings: {} } } });
check('сжатая отправка (gzip) принимается', r.status === 200 && r.json?.rev === 3, r.text);

r = await call('state');
check('данные из сжатого запроса сохранились', r.json?.data?.projects?.length === 3, r.text);

// --- файлы проектов (фото и подложки эскизов) ---
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const pngHash = createHash('sha256').update(png).digest('hex');

r = await call('files/missing', { method: 'POST', body: { hashes: [pngHash] } });
check('сервер знает, что файла ещё нет', r.json?.missing?.[0] === pngHash, r.text);

r = await call('files', { method: 'POST', body: { mime: 'image/png', data: png.toString('base64') } });
check('файл загружен', r.status === 200 && r.json?.id === pngHash, r.text);

r = await call('files', { method: 'POST', body: { mime: 'image/png', data: png.toString('base64') } });
check('одинаковые файлы не дублируются', r.json?.reused === true, r.text);

r = await call('files/missing', { method: 'POST', body: { hashes: [pngHash] } });
check('после загрузки файл считается имеющимся', Array.isArray(r.json?.missing) && r.json.missing.length === 0, r.text);

r = await call('files', { query: `&id=${pngHash}` });
check('файл отдаётся обратно', r.status === 200 && r.raw.length > 0, String(r.status));

r = await call('files', { query: '&id=' + 'f'.repeat(64) });
check('несуществующий файл даёт 404', r.status === 404, r.text);

r = await call('state', { method: 'POST', body: { rev: -1, data: { projects: [{ id: 'pf', photos: [{ id: 'x', dataUrl: `recept-file:${pngHash}` }] }], clients: [], templates: [], settings: {} } } });
check('проект со ссылкой на файл сохранён', r.json?.ok === true, r.text);

r = await call('files/gc', { method: 'POST' });
check('нужный файл при уборке не удаляется', r.json?.ok === true && r.json?.removed === 0, r.text);

r = await call('state', { method: 'POST', body: { rev: r.json?.rev ?? -1, data: { projects: [], clients: [], templates: [], settings: {} } } });
r = await call('files/gc', { method: 'POST' });
check('ненужный файл удаляется уборкой', r.json?.removed === 1, r.text);

r = await call('users', { method: 'POST', body: { login: 'zamer', password: 'Zamer12345', name: 'Замерщик', role: 'user' } });
check('сотрудник добавлен', r.status === 200 && r.json?.user?.role === 'user', r.text);

r = await call('users');
check('список сотрудников: 2', r.json?.users?.length === 2, r.text);
check('пароли наружу не отдаются', !JSON.stringify(r.json).includes('hash'), r.text);

r = await call('share', { method: 'POST', body: { payload: { project: { id: 'p1' } } } });
const shareId = r.json?.id;
check('передача на телефон создана', r.status === 200 && typeof shareId === 'string', r.text);

const savedCookie = cookie;
cookie = '';
r = await call('share', { query: `&id=${shareId}` });
check('передача читается без входа (QR)', r.status === 200 && r.json?.payload?.project?.id === 'p1', r.text);

r = await call('state');
check('без входа база по-прежнему закрыта', r.status === 401, r.text);

r = await call('login', { method: 'POST', body: { login: 'admin', password: 'WrongPass1' } });
check('неверный пароль отклонён', r.status === 401, r.text);

r = await call('login', { method: 'POST', body: { login: 'admin', password: 'Parol12345' } });
check('вход по паролю работает', r.status === 200 && r.json?.user?.login === 'admin', r.text);

r = await call('backups');
check('список резервных копий доступен администратору', r.status === 200 && Array.isArray(r.json?.backups), r.text);

r = await call('logout', { method: 'POST' });
check('выход работает', r.status === 200, r.text);
r = await call('state');
check('после выхода доступа нет', r.status === 401, r.text);

cookie = savedCookie;
process.exitCode = process.exitCode ?? 0;
const dataDirs = fs.readdirSync(WORK, { recursive: true }).filter((f) => String(f).includes('state'));
console.log('файлы данных:', dataDirs.join(', '));
process.exit(process.exitCode ?? 0);
