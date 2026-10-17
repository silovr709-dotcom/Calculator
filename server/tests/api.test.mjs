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

// --- история версий проекта ---
r = await call('state');
let histRev = r.json?.rev ?? 0;
r = await call('state', { method: 'POST', body: { rev: histRev, data: { projects: [{ id: 'hist1', name: 'Кухня версия 1' }], clients: [], templates: [], settings: {} } } });
histRev = r.json?.rev ?? histRev;
r = await call('state', { method: 'POST', body: { rev: histRev, data: { projects: [{ id: 'hist1', name: 'Кухня версия 2' }], clients: [], templates: [], settings: {} } } });
histRev = r.json?.rev ?? histRev;
r = await call('state', { method: 'POST', body: { rev: histRev, data: { projects: [{ id: 'hist1', name: 'Кухня версия 2' }], clients: [], templates: [], settings: {} } } });
histRev = r.json?.rev ?? histRev;

r = await call('history', { query: '&projectId=hist1' });
const versions = r.json?.versions ?? [];
check('история проекта пишется на каждое изменение', versions.length === 2, `${versions.length}: ${r.text}`);
check('в истории видно автора и название', versions[0]?.by === 'admin' && versions[0]?.name === 'Кухня версия 2', r.text);

r = await call('history/item', { query: `&projectId=hist1&file=${versions[1]?.file}` });
check('старую версию можно прочитать', r.json?.project?.name === 'Кухня версия 1', r.text);

r = await call('history/item', { query: '&projectId=hist1&file=v000001-aaaaaaaa.json.gz' });
check('несуществующая версия даёт 404', r.status === 404, r.text);

r = await call('history', { query: '&projectId=hist1' });
check('повтор без изменений новую версию не плодит', (r.json?.versions ?? []).length === 2, r.text);

// --- документы проекта ---
const docx = Buffer.from('PK\u0003\u0004 фиктивный договор');
r = await call('docs', { method: 'POST', body: { projectId: 'p1', kind: 'contract', name: 'Кухня — договор.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: docx.toString('base64') } });
const docId = r.json?.document?.id ?? '';
check('договор сохранён у проекта', r.status === 200 && r.json?.document?.kind === 'contract' && r.json?.document?.status === 'created', r.text);

r = await call('docs', { method: 'POST', body: { projectId: 'p1', kind: 'contract', name: 'Кухня — договор.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', data: docx.toString('base64') } });
check('повторная выгрузка обновляет карточку, а не плодит копии', r.json?.document?.id === docId, r.text);

r = await call('docs', { query: '&projectId=p1' });
check('список документов проекта виден', (r.json?.documents ?? []).length === 1, r.text);

r = await call('docs/status', { method: 'POST', body: { projectId: 'p1', id: docId, status: 'signed' } });
check('статус документа меняется', r.json?.document?.status === 'signed', r.text);

r = await call('docs/status', { method: 'POST', body: { projectId: 'p1', id: docId, status: 'что-то' } });
check('чужие статусы не принимаются', r.status === 400, r.text);

r = await call('files/gc', { method: 'POST' });
check('файл договора уборка не удаляет', r.json?.ok === true && r.json?.removed === 0, r.text);

r = await call('docs', { method: 'DELETE', query: `&projectId=p1&id=${docId}` });
check('документ можно удалить', r.json?.ok === true, r.text);

r = await call('files/gc', { method: 'POST' });
check('после удаления карточки файл документа убирается', r.json?.removed === 1, r.text);

// --- уведомления в Telegram ---
r = await call('notify/settings');
check('настройки уведомлений пустые по умолчанию', r.json?.settings?.tokenSet === false, r.text);

r = await call('notify/settings', { method: 'POST', body: { enabled: true, token: '123456:TESTTOKEN', chats: [{ name: 'Пётр', chatId: '555' }, { name: '', chatId: '' }], leadMinutes: 90, timezoneOffset: 3 } });
const cronKey = r.json?.cronKey ?? '';
check('настройки сохранены и выдан ключ планировщика', r.json?.ok === true && cronKey.length >= 16, r.text);

r = await call('notify/settings');
check('токен наружу не отдаётся целиком', r.json?.settings?.tokenSet === true && r.json?.settings?.tokenHint === '…TTOKEN', r.text);
check('пустые получатели отфильтрованы', (r.json?.settings?.chats ?? []).length === 1, r.text);

const cronCookie = cookie;
cookie = '';
r = await call('cron/notify', { query: '&key=неверный' });
check('планировщик без ключа не пускает', r.status === 403, r.text);

r = await call('cron/notify', { query: `&key=${cronKey}` });
check('планировщик с ключом отрабатывает', r.json?.ok === true && typeof r.json?.sent === 'number', r.text);
cookie = cronCookie;

r = await call('notify/test', { method: 'POST', body: { chatId: '' } });
check('тест без получателя отклонён', r.status === 400, r.text);

r = await call('notify/contacts');
check('поиск собеседников бота отвечает понятной ошибкой на неверный токен', r.status === 400 && String(r.json?.error).includes('токен'), r.text);

// --- подписка календаря (ICS) ---
r = await call('state', { method: 'POST', body: { rev: -1, data: { projects: [{ id: 'ics1', name: 'Кухня ICS', client: 'Ирина', schedule: { installAt: '2026-11-05', team: 'Бригада 1', address: 'ул. Мира, 5' } }], clients: [], templates: [], settings: {}, events: [{ id: 'ev1', title: 'Замер у Ирины', kind: 'measure', date: '2026-11-03', timeStart: '10:00', assignees: ['Пётр'], address: 'пр. Ленина, 10', status: 'planned', createdAt: '', updatedAt: '' }] } } });
check('база с делами сохранена для ICS', r.json?.ok === true, r.text);

cookie = '';
r = await call('ics', { query: '&key=неверный' });
check('подписка без ключа закрыта', r.status === 403, r.text);

r = await call('ics', { query: `&key=${cronKey}` });
check('ICS отдаётся и содержит оба события', r.status === 200 && r.raw.includes('BEGIN:VCALENDAR') && r.raw.includes('Замер у Ирины') && r.raw.includes('Монтаж: Ирина'), String(r.status));
check('в ICS есть адрес и завершение', r.raw.includes('LOCATION:ул. Мира') && r.raw.includes('END:VCALENDAR'), String(r.status));

r = await call('ics', { query: `&key=${cronKey}&who=Пётр` });
check('подписка «только мои» фильтрует по исполнителю', r.raw.includes('Замер у Ирины') && !r.raw.includes('Монтаж: Ирина'), String(r.status));
cookie = cronCookie;

// --- наряд на монтаж ---
r = await call('workorder', { method: 'POST', body: { projectId: 'p1', payload: { client: 'Ирина', address: 'ул. Мира, 5', date: '2026-10-21', time: '10:00', team: 'Бригада 1' } } });
const orderId = r.json?.id ?? '';
check('наряд создан', r.status === 200 && /^[a-f0-9]{16}$/.test(orderId), r.text);

const managerCookie2 = cookie;
cookie = '';
r = await call('workorder', { query: `&id=${orderId}` });
check('мастер открывает наряд без входа', r.status === 200 && r.json?.payload?.address === 'ул. Мира, 5', r.text);

r = await call('workorder/mark', { method: 'POST', query: `&id=${orderId}`, body: { status: 'onway', who: 'Пётр' } });
check('мастер отметил «выехал»', r.json?.status === 'onway', r.text);

r = await call('workorder/mark', { method: 'POST', query: `&id=${orderId}`, body: { status: 'problem', comment: 'Нет лифта, нужен помощник', who: 'Пётр' } });
check('мастер сообщил о проблеме с комментарием', r.json?.status === 'problem' && r.json?.log?.length === 2, r.text);

r = await call('workorder/mark', { method: 'POST', query: `&id=${orderId}`, body: { status: 'что-то', who: 'Пётр' } });
check('чужие отметки не принимаются', r.status === 400, r.text);

// Отдельное содержимое, чтобы не пересекаться с проверками хранилища файлов ниже.
const shot = Buffer.from('фото с объекта: стена кривая', 'utf8');
r = await call('workorder/photo', { method: 'POST', query: `&id=${orderId}`, body: { mime: 'image/png', data: shot.toString('base64'), who: 'Пётр', comment: 'Стена кривая' } });
check('мастер приложил фото с объекта', r.json?.ok === true && r.json?.photos?.length === 1, r.text);

r = await call('workorder', { query: `&id=${orderId}` });
check('фото видно в наряде', (r.json?.photos ?? []).length === 1 && r.json.photos[0].comment === 'Стена кривая', r.text);

cookie = managerCookie2;
r = await call('workorder/list');
const order = (r.json?.orders ?? []).find((item) => item.id === orderId);
check('менеджер видит отметки мастера', order?.status === 'problem' && order?.lastComment.includes('лифта'), r.text);

r = await call('workorder', { method: 'DELETE', query: `&id=${orderId}` });
check('наряд можно отозвать', r.json?.ok === true, r.text);

r = await call('files/gc', { method: 'POST' });
check('фото удалённого наряда убирается уборкой', r.json?.removed === 1, r.text);

// --- КП по ссылке для клиента ---
r = await call('offers', { method: 'POST', body: { projectId: 'p1', title: 'Кухня Ирина', client: 'Ирина', total: 238016, payload: { project: { id: 'p1', name: 'Кухня Ирина' } } } });
const offerId = r.json?.id ?? '';
check('КП опубликовано по ссылке', r.status === 200 && /^[a-f0-9]{16}$/.test(offerId), r.text);

const managerCookie = cookie;
cookie = '';  // дальше смотрим глазами клиента, без входа
r = await call('offers', { query: `&id=${offerId}` });
check('клиент открывает КП без входа', r.status === 200 && r.json?.payload?.project?.name === 'Кухня Ирина', r.text);

r = await call('offers/approve', { method: 'POST', query: `&id=${offerId}`, body: { name: 'Ирина Петрова', comment: 'Согласовано, начинайте' } });
check('клиент согласовал КП', r.json?.ok === true && typeof r.json?.approvedAt === 'string', r.text);

r = await call('offers', { query: `&id=${offerId}` });
check('согласование видно в КП', r.json?.approvedBy === 'Ирина Петрова', r.text);

r = await call('offers/list');
check('список КП закрыт от посторонних', r.status === 401, r.text);

cookie = managerCookie;
r = await call('offers/list');
const published = (r.json?.offers ?? [])[0];
check('менеджер видит просмотры и согласование', published?.id === offerId && published?.views >= 2 && published?.approvedBy === 'Ирина Петрова', r.text);

r = await call('offers', { method: 'DELETE', query: `&id=${offerId}` });
check('ссылку можно отозвать', r.json?.ok === true, r.text);

cookie = '';
r = await call('offers', { query: `&id=${offerId}` });
check('отозванная ссылка больше не открывается', r.status === 404, r.text);
cookie = managerCookie;

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
// История проекта хранит прежние версии, поэтому фото остаётся доступным для отката.
check('файл из истории проекта уборка сохраняет', r.json?.removed === 0 && r.json?.files === 1, r.text);

r = await call('users', { method: 'POST', body: { login: 'zamer', password: 'Zamer12345', name: 'Замерщик', role: 'measurer' } });
check('роль замерщика сохранена', r.json?.user?.role === 'measurer', r.text);

r = await call('users', { method: 'POST', body: { login: 'montazh', password: 'Montazh12345', name: 'Монтажник', role: 'installer' } });
check('монтажник добавлен', r.json?.user?.role === 'installer', r.text);

r = await call('users', { method: 'POST', body: { login: 'staryi', password: 'Staryi12345', name: 'Старый', role: 'user' } });
check('старая роль user становится менеджером', r.json?.user?.role === 'manager', r.text);

r = await call('users', { method: 'POST', body: { login: 'hacker', password: 'Hacker12345', name: 'Чужой', role: 'superadmin' } });
check('выдуманная роль не проходит', r.json?.user?.role === 'manager', r.text);

check('сотрудник добавлен', r.status === 200 && r.json?.user?.role === 'manager', r.text);

r = await call('users');
check('в списке все сотрудники с ролями', r.json?.users?.length === 5 && r.json.users.some((item) => item.role === 'installer'), r.text);
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
