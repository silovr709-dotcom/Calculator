<?php
/**
 * Единая точка входа API калькулятора РЕцепт.
 * Работает и по «красивым» адресам (api/state), и без mod_rewrite (api/index.php?r=state).
 */

declare(strict_types=1);

require __DIR__ . '/core.php';

header('X-Robots-Tag: noindex, nofollow');

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/** Определяем маршрут: сначала ?r=, затем хвост пути после index.php. */
$route = isset($_GET['r']) ? trim((string) $_GET['r'], '/') : '';
if ($route === '') {
    $path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
    $script = (string) ($_SERVER['SCRIPT_NAME'] ?? '');
    $base = rtrim(dirname($script), '/');
    if ($base !== '' && strpos($path, $base) === 0) {
        $path = substr($path, strlen($base));
    }
    $route = trim(str_replace('index.php', '', $path), '/');
}

$users = recept_users();
$needsSetup = $users === [];

switch ($route . ' ' . $method) {
    /* ---------- состояние сервера ---------- */
    case 'health GET':
        recept_json(200, [
            'ok' => true,
            'app' => 'recept-calculator',
            'version' => RECEPT_API_VERSION,
            'php' => PHP_VERSION,
            'needsSetup' => $needsSetup,
            'maxUploadMb' => (int) round(recept_bytes((string) ini_get('post_max_size')) / 1048576),
        ]);
        // no break

    /* ---------- страница самопроверки установки (открывается в браузере) ---------- */
    case 'check GET': {
        $root = dirname(__DIR__);
        $rows = [];

        $phpOk = version_compare(PHP_VERSION, '8.0', '>=');
        $rows[] = [
            $phpOk ? 'ok' : 'bad',
            'Версия PHP',
            PHP_VERSION,
            $phpOk ? '' : 'Нужна PHP 8.0 и выше. Панель хостинга → Сайты → ваш сайт → PHP → версия 8.1 или 8.2.',
        ];

        $files = [
            'index.html' => 'Главный файл приложения',
            '.htaccess' => 'Скрытый файл настроек Apache',
            '.user.ini' => 'Скрытый файл настроек PHP',
            'assets' => 'Папка со стилями и скриптами',
            'api/core.php' => 'Серверная часть',
            'api/.htaccess' => 'Скрытый файл настроек папки api',
        ];
        foreach ($files as $name => $label) {
            $exists = file_exists($root . '/' . $name);
            $rows[] = [
                $exists ? 'ok' : 'bad',
                $label,
                $name . ($exists ? ' — на месте' : ' — НЕ НАЙДЕН'),
                $exists ? '' : 'Файл не загрузился на хостинг. Залейте его заново (в FTP-программе включите показ скрытых файлов).',
            ];
        }

        $rootEnv = (string) ($_SERVER['RECEPT_ROOT_HTACCESS'] ?? getenv('RECEPT_ROOT_HTACCESS'));
        $apiEnv = (string) ($_SERVER['RECEPT_API_HTACCESS'] ?? getenv('RECEPT_API_HTACCESS'));
        $htOk = $rootEnv === '1' || $apiEnv === '1';
        $rows[] = [
            $htOk ? 'ok' : 'warn',
            'Настройки .htaccess применяются',
            $htOk ? 'да' : 'не удалось подтвердить',
            $htOk ? '' : 'Либо файл .htaccess не залит, либо хостинг не даёт его применять (AllowOverride). Приложение будет работать, но красивые адреса и переход на HTTPS могут не действовать.',
        ];

        $dataDir = recept_data_dir(true);
        $rows[] = [
            $dataDir !== '' ? 'ok' : 'bad',
            'Папка для данных',
            $dataDir !== '' ? 'создана, запись разрешена' : 'нет доступа на запись',
            $dataDir !== '' ? '' : 'Создайте папку recept-data рядом с папкой сайта и дайте права 755, либо укажите путь в файле api/config.php.',
        ];

        foreach (['json' => 'Обработка данных', 'mbstring' => 'Русские буквы', 'zlib' => 'Сжатие и резервные копии'] as $ext => $label) {
            $has = extension_loaded($ext);
            $rows[] = [
                $has ? 'ok' : 'bad',
                $label . ' (расширение ' . $ext . ')',
                $has ? 'включено' : 'выключено',
                $has ? '' : 'Включите расширение ' . $ext . ' в настройках PHP вашего хостинга.',
            ];
        }

        $postMax = recept_bytes((string) ini_get('post_max_size'));
        $postOk = $postMax >= 32 * 1048576;
        $rows[] = [
            $postOk ? 'ok' : 'warn',
            'Максимальный размер сохранения',
            (string) ini_get('post_max_size'),
            $postOk ? '' : 'Маловато для проектов с фотографиями. В файле .user.ini поставьте post_max_size = 128M и upload_max_filesize = 128M.',
        ];

        $rows[] = [
            'ok',
            'Учётные записи',
            $needsSetup ? 'ещё не созданы — откройте главную страницу сайта' : 'создано: ' . count($users),
            '',
        ];

        $bad = 0;
        $warn = 0;
        foreach ($rows as $row) {
            if ($row[0] === 'bad') {
                $bad += 1;
            } elseif ($row[0] === 'warn') {
                $warn += 1;
            }
        }
        if ($bad > 0) {
            $verdict = ['bad', 'Есть проблемы: ' . $bad . '. Смотрите красные строки и подсказки к ним.'];
        } elseif ($warn > 0) {
            $verdict = ['warn', 'Работать можно, но есть замечания: ' . $warn . '.'];
        } else {
            $verdict = ['ok', 'Всё в порядке — можно пользоваться. Откройте главную страницу сайта.'];
        }

        $icons = ['ok' => '✓', 'warn' => '!', 'bad' => '✕'];
        $html = '<!doctype html><html lang="ru"><head><meta charset="utf-8">'
            . '<meta name="viewport" content="width=device-width, initial-scale=1">'
            . '<title>Проверка установки — РЕцепт</title><style>'
            . 'body{font:15px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f4f6fb;color:#16213f;margin:0;padding:24px}'
            . '.wrap{max-width:780px;margin:0 auto}h1{font-size:22px;margin:0 0 4px}'
            . 'p.sub{color:#5b6b8f;margin:0 0 18px}'
            . '.verdict{padding:14px 16px;border-radius:12px;font-weight:600;margin-bottom:18px}'
            . '.verdict.ok{background:#e7f6ec;color:#17603a}.verdict.warn{background:#fff6e2;color:#7a5200}'
            . '.verdict.bad{background:#fdeaea;color:#8d1f1f}'
            . 'table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(22,33,63,.12)}'
            . 'td{padding:10px 12px;border-top:1px solid #eef1f7;vertical-align:top}tr:first-child td{border-top:0}'
            . 'td.i{width:28px;text-align:center;font-weight:700}td.i.ok{color:#1d9a57}td.i.warn{color:#c08a00}td.i.bad{color:#d13b3b}'
            . 'td.n{width:38%}td.v{color:#44557d}.hint{display:block;margin-top:4px;color:#8d1f1f;font-size:13px}'
            . '.foot{margin-top:18px;font-size:13px;color:#5b6b8f}a{color:#16213f}'
            . '</style></head><body><div class="wrap"><h1>Проверка установки калькулятора</h1>'
            . '<p class="sub">Эта страница смотрит на файлы сайта со стороны сервера — скрытые файлы видно даже там, где файловый менеджер их прячет.</p>'
            . '<div class="verdict ' . $verdict[0] . '">' . htmlspecialchars($verdict[1], ENT_QUOTES, 'UTF-8') . '</div><table>';
        foreach ($rows as $row) {
            $html .= '<tr><td class="i ' . $row[0] . '">' . $icons[$row[0]] . '</td>'
                . '<td class="n">' . htmlspecialchars($row[1], ENT_QUOTES, 'UTF-8') . '</td>'
                . '<td class="v">' . htmlspecialchars($row[2], ENT_QUOTES, 'UTF-8')
                . ($row[3] !== '' ? '<span class="hint">' . htmlspecialchars($row[3], ENT_QUOTES, 'UTF-8') . '</span>' : '')
                . '</td></tr>';
        }
        $html .= '</table><p class="foot">Адрес этой страницы: <code>/api/index.php?r=check</code>. '
            . 'Обновите её (F5) после любых изменений на хостинге. '
            . 'Главная страница сайта: <a href="../">открыть приложение</a>.</p></div></body></html>';

        http_response_code(200);
        header('Content-Type: text/html; charset=utf-8');
        header('Cache-Control: no-store');
        echo $html;
        exit;
    }

    /* ---------- первый запуск: создаём администратора ---------- */
    case 'setup POST': {
        if (!$needsSetup) {
            recept_fail(409, 'Администратор уже создан. Войдите под своим логином.');
        }
        $body = recept_body();
        $login = trim((string) ($body['login'] ?? ''));
        $password = (string) ($body['password'] ?? '');
        $name = trim((string) ($body['name'] ?? $login));
        if (mb_strlen($login) < 3 || !preg_match('/^[\w.@\-]+$/u', $login)) {
            recept_fail(400, 'Логин: минимум 3 символа, латиница, цифры, точка или дефис');
        }
        if (mb_strlen($password) < 8) {
            recept_fail(400, 'Пароль должен быть не короче 8 символов');
        }
        $user = [
            'login' => $login,
            'name' => $name !== '' ? $name : $login,
            'role' => 'admin',
            'hash' => password_hash($password, PASSWORD_DEFAULT),
            'createdAt' => gmdate('c'),
        ];
        if (!recept_save_users([$user])) {
            recept_fail(500, 'Не удалось сохранить пользователя — проверьте права на папку данных');
        }
        recept_start_session();
        session_regenerate_id(true);
        $_SESSION['login'] = $login;
        recept_json(200, ['ok' => true, 'user' => recept_public_user($user)]);
    }

    /* ---------- вход и выход ---------- */
    case 'login POST': {
        recept_login_guard();
        $body = recept_body();
        $login = trim((string) ($body['login'] ?? ''));
        $password = (string) ($body['password'] ?? '');
        $user = recept_find_user($login);
        if ($user === null || !password_verify($password, (string) ($user['hash'] ?? ''))) {
            recept_login_failed();
            recept_fail(401, 'Неверный логин или пароль');
        }
        recept_login_ok();
        recept_start_session();
        session_regenerate_id(true);
        $_SESSION['login'] = (string) $user['login'];
        recept_json(200, ['ok' => true, 'user' => recept_public_user($user)]);
    }

    case 'logout POST':
        recept_start_session();
        $_SESSION = [];
        session_destroy();
        recept_json(200, ['ok' => true]);
        // no break

    case 'session GET': {
        $user = recept_current_user();
        $meta = $user === null ? ['rev' => 0, 'updatedAt' => '', 'updatedBy' => '', 'size' => 0] : recept_state_meta();
        recept_json(200, [
            'ok' => true,
            'needsSetup' => $needsSetup,
            'user' => $user === null ? null : recept_public_user($user),
            'state' => $meta,
            'version' => RECEPT_API_VERSION,
        ]);
    }

    case 'password POST': {
        $user = recept_require_user();
        $body = recept_body();
        $old = (string) ($body['oldPassword'] ?? '');
        $new = (string) ($body['newPassword'] ?? '');
        if (!password_verify($old, (string) ($user['hash'] ?? ''))) {
            recept_fail(400, 'Текущий пароль указан неверно');
        }
        if (mb_strlen($new) < 8) {
            recept_fail(400, 'Новый пароль должен быть не короче 8 символов');
        }
        $all = recept_users();
        foreach ($all as $index => $item) {
            if (mb_strtolower((string) $item['login']) === mb_strtolower((string) $user['login'])) {
                $all[$index]['hash'] = password_hash($new, PASSWORD_DEFAULT);
            }
        }
        recept_save_users($all);
        recept_json(200, ['ok' => true]);
    }

    /* ---------- сотрудники ---------- */
    case 'users GET': {
        recept_require_admin();
        recept_json(200, ['ok' => true, 'users' => array_map('recept_public_user', recept_users())]);
    }

    case 'users POST': {
        $admin = recept_require_admin();
        $body = recept_body();
        $login = trim((string) ($body['login'] ?? ''));
        $password = (string) ($body['password'] ?? '');
        $name = trim((string) ($body['name'] ?? $login));
        $role = ($body['role'] ?? 'user') === 'admin' ? 'admin' : 'user';
        if (mb_strlen($login) < 3 || !preg_match('/^[\w.@\-]+$/u', $login)) {
            recept_fail(400, 'Логин: минимум 3 символа, латиница, цифры, точка или дефис');
        }
        if (mb_strlen($password) < 8) {
            recept_fail(400, 'Пароль должен быть не короче 8 символов');
        }
        $all = recept_users();
        foreach ($all as $index => $item) {
            if (mb_strtolower((string) $item['login']) === mb_strtolower($login)) {
                // Обновляем существующего: пароль и роль.
                $all[$index]['hash'] = password_hash($password, PASSWORD_DEFAULT);
                $all[$index]['name'] = $name !== '' ? $name : $login;
                $all[$index]['role'] = $role;
                recept_save_users($all);
                recept_json(200, ['ok' => true, 'user' => recept_public_user($all[$index]), 'updated' => true]);
            }
        }
        $user = [
            'login' => $login,
            'name' => $name !== '' ? $name : $login,
            'role' => $role,
            'hash' => password_hash($password, PASSWORD_DEFAULT),
            'createdAt' => gmdate('c'),
            'createdBy' => (string) $admin['login'],
        ];
        $all[] = $user;
        recept_save_users($all);
        recept_json(200, ['ok' => true, 'user' => recept_public_user($user)]);
    }

    case 'users DELETE': {
        $admin = recept_require_admin();
        $login = trim((string) ($_GET['login'] ?? ''));
        if (mb_strtolower($login) === mb_strtolower((string) $admin['login'])) {
            recept_fail(400, 'Нельзя удалить самого себя');
        }
        $all = array_values(array_filter(recept_users(), static fn ($item) => mb_strtolower((string) $item['login']) !== mb_strtolower($login)));
        if ($all === []) {
            recept_fail(400, 'Должен остаться хотя бы один пользователь');
        }
        recept_save_users($all);
        recept_json(200, ['ok' => true]);
    }

    /* ---------- рабочая база ---------- */
    case 'state GET': {
        recept_require_user();
        $meta = recept_state_meta();
        recept_json(200, ['ok' => true, 'rev' => $meta['rev'], 'updatedAt' => $meta['updatedAt'], 'updatedBy' => $meta['updatedBy'], 'data' => recept_load_state()]);
    }

    case 'state PUT':
    case 'state POST': {
        $user = recept_require_user();
        $body = recept_body_raw();
        if (!is_object($body) || !isset($body->data)) {
            recept_fail(400, 'Нет поля data с рабочей базой');
        }
        $baseRev = isset($body->baseRev) ? (int) $body->baseRev : -1;
        $result = recept_save_state($body->data, $baseRev, $user);
        if (!empty($result['conflict'])) {
            recept_json(409, ['ok' => false, 'conflict' => true, 'error' => 'База изменилась на сервере', 'rev' => $result['rev'], 'updatedAt' => $result['updatedAt'], 'updatedBy' => $result['updatedBy'], 'data' => $result['data']]);
        }
        recept_json(200, ['ok' => true, 'rev' => $result['rev'], 'updatedAt' => $result['updatedAt'], 'size' => $result['size']]);
    }

    /* ---------- резервные копии ---------- */
    case 'backups GET': {
        recept_require_admin();
        recept_json(200, ['ok' => true, 'backups' => recept_backup_list()]);
    }

    case 'backups/restore POST': {
        $user = recept_require_admin();
        $body = recept_body();
        $data = recept_backup_read((string) ($body['file'] ?? ''));
        if ($data === null) {
            recept_fail(404, 'Резервная копия не найдена');
        }
        $result = recept_save_state($data, -1, $user);
        recept_json(200, ['ok' => true, 'rev' => $result['rev'], 'data' => $data]);
    }

    /* ---------- история версий проекта ---------- */

    case 'history GET': {
        recept_require_user();
        $projectId = isset($_GET['projectId']) ? (string) $_GET['projectId'] : '';
        recept_json(200, ['ok' => true, 'versions' => recept_history_list($projectId)]);
    }

    case 'history/item GET': {
        recept_require_user();
        $projectId = isset($_GET['projectId']) ? (string) $_GET['projectId'] : '';
        $file = isset($_GET['file']) ? (string) $_GET['file'] : '';
        $project = recept_history_read($projectId, $file);
        if ($project === null) {
            recept_fail(404, 'Версия проекта не найдена');
        }
        recept_json(200, ['ok' => true, 'project' => $project]);
    }

    /* ---------- документы проекта (договор, чек, КП, бланк) ---------- */

    case 'docs GET': {
        recept_require_user();
        $projectId = isset($_GET['projectId']) ? (string) $_GET['projectId'] : '';
        recept_json(200, ['ok' => true, 'documents' => recept_docs_list($projectId)]);
    }

    case 'docs POST': {
        $user = recept_require_user();
        $body = recept_body();
        $projectId = isset($body['projectId']) ? (string) $body['projectId'] : '';
        $data = isset($body['data']) ? (string) $body['data'] : '';
        if ($data === '') {
            recept_fail(400, 'Пустой документ');
        }
        $bytes = base64_decode($data, true);
        if ($bytes === false) {
            recept_fail(400, 'Документ повреждён при передаче');
        }
        $saved = recept_file_put($bytes, isset($body['mime']) ? (string) $body['mime'] : '');
        $record = recept_docs_add($projectId, [
            'fileId' => $saved['id'],
            'kind' => isset($body['kind']) ? (string) $body['kind'] : 'other',
            'name' => isset($body['name']) ? (string) $body['name'] : 'Документ',
            'size' => $saved['size'],
        ], $user);
        recept_json(200, ['ok' => true, 'document' => $record]);
    }

    case 'docs/status POST': {
        recept_require_user();
        $body = recept_body();
        $record = recept_docs_set_status(
            isset($body['projectId']) ? (string) $body['projectId'] : '',
            isset($body['id']) ? (string) $body['id'] : '',
            isset($body['status']) ? (string) $body['status'] : ''
        );
        if ($record === null) {
            recept_fail(404, 'Документ не найден');
        }
        recept_json(200, ['ok' => true, 'document' => $record]);
    }

    case 'docs DELETE': {
        recept_require_user();
        $ok = recept_docs_delete(
            isset($_GET['projectId']) ? (string) $_GET['projectId'] : '',
            isset($_GET['id']) ? (string) $_GET['id'] : ''
        );
        if (!$ok) {
            recept_fail(404, 'Документ не найден');
        }
        recept_json(200, ['ok' => true]);
    }

    /* ---------- наряд на монтаж для мастера ---------- */

    case 'workorder POST': {
        $user = recept_require_user();
        $record = recept_order_put(recept_body(), $user);
        recept_json(200, ['ok' => true, 'id' => $record['id'], 'order' => recept_order_summary($record)]);
    }

    case 'workorder GET': {
        // Мастер открывает наряд по ссылке, без входа в систему.
        $id = isset($_GET['id']) ? (string) $_GET['id'] : '';
        $record = recept_order_get($id);
        if ($record === null) {
            recept_fail(404, 'Наряд не найден. Попросите менеджера прислать свежую ссылку.');
        }
        $record['views'] = (int) $record['views'] + 1;
        recept_order_save($record);
        recept_json(200, [
            'ok' => true,
            'payload' => $record['payload'],
            'status' => $record['status'],
            'log' => $record['log'],
            'createdAt' => $record['createdAt'],
        ]);
    }

    case 'workorder/mark POST': {
        $id = isset($_GET['id']) ? (string) $_GET['id'] : '';
        $record = recept_order_get($id);
        if ($record === null) {
            recept_fail(404, 'Наряд не найден');
        }
        $body = recept_body();
        $record = recept_order_mark(
            $record,
            isset($body['status']) ? (string) $body['status'] : '',
            isset($body['comment']) ? (string) $body['comment'] : '',
            isset($body['who']) ? (string) $body['who'] : ''
        );
        recept_json(200, ['ok' => true, 'status' => $record['status'], 'log' => $record['log']]);
    }

    case 'workorder/list GET': {
        recept_require_user();
        recept_json(200, ['ok' => true, 'orders' => recept_orders_list()]);
    }

    case 'workorder DELETE': {
        recept_require_user();
        $id = isset($_GET['id']) ? (string) $_GET['id'] : '';
        $file = recept_order_file($id);
        if ($file === null) {
            recept_fail(404, 'Наряд не найден');
        }
        @unlink($file);
        recept_json(200, ['ok' => true]);
    }

    /* ---------- КП по ссылке для клиента ---------- */

    case 'offers POST': {
        $user = recept_require_user();
        $record = recept_offer_put(recept_body(), $user);
        recept_json(200, ['ok' => true, 'id' => $record['id'], 'offer' => recept_offer_summary($record)]);
    }

    case 'offers GET': {
        // Открывается клиентом без входа: ссылка содержит длинный случайный идентификатор.
        $id = isset($_GET['id']) ? (string) $_GET['id'] : '';
        $record = recept_offer_get($id);
        if ($record === null) {
            recept_fail(404, 'Предложение не найдено. Возможно, ссылка устарела.');
        }
        $record = recept_offer_track_view($record);
        recept_json(200, [
            'ok' => true,
            'title' => $record['title'],
            'client' => $record['client'],
            'total' => $record['total'],
            'payload' => $record['payload'],
            'createdAt' => $record['createdAt'],
            'approvedAt' => $record['approvedAt'],
            'approvedBy' => $record['approvedBy'],
            'approveComment' => $record['approveComment'],
        ]);
    }

    case 'offers/approve POST': {
        $id = isset($_GET['id']) ? (string) $_GET['id'] : '';
        $record = recept_offer_get($id);
        if ($record === null) {
            recept_fail(404, 'Предложение не найдено');
        }
        if (!empty($record['approvedAt'])) {
            recept_json(200, ['ok' => true, 'approvedAt' => $record['approvedAt'], 'approvedBy' => $record['approvedBy']]);
        }
        $body = recept_body();
        $name = isset($body['name']) ? trim((string) $body['name']) : '';
        $comment = isset($body['comment']) ? trim((string) $body['comment']) : '';
        $record['approvedAt'] = gmdate('c');
        $record['approvedBy'] = $name !== '' ? mb_substr($name, 0, 120) : ($record['client'] !== '' ? $record['client'] : 'Клиент');
        $record['approveComment'] = $comment !== '' ? mb_substr($comment, 0, 1000) : null;
        recept_offer_save($record);
        recept_json(200, ['ok' => true, 'approvedAt' => $record['approvedAt'], 'approvedBy' => $record['approvedBy']]);
    }

    case 'offers/list GET': {
        recept_require_user();
        recept_json(200, ['ok' => true, 'offers' => recept_offers_list()]);
    }

    case 'offers DELETE': {
        recept_require_user();
        $id = isset($_GET['id']) ? (string) $_GET['id'] : '';
        $file = recept_offer_file($id);
        if ($file === null) {
            recept_fail(404, 'Предложение не найдено');
        }
        @unlink($file);
        recept_json(200, ['ok' => true]);
    }

    /* ---------- файлы проектов: фото и подложки эскизов ---------- */

    case 'files/missing POST': {
        recept_require_user();
        $body = recept_body();
        $hashes = isset($body['hashes']) && is_array($body['hashes']) ? $body['hashes'] : [];
        recept_json(200, ['ok' => true, 'missing' => recept_files_missing($hashes)]);
    }

    case 'files POST':
    case 'files PUT': {
        recept_require_user();
        $body = recept_body();
        $mime = isset($body['mime']) ? (string) $body['mime'] : '';
        $data = isset($body['data']) ? (string) $body['data'] : '';
        if ($data === '') {
            recept_fail(400, 'Пустой файл');
        }
        $bytes = base64_decode($data, true);
        if ($bytes === false) {
            recept_fail(400, 'Файл повреждён при передаче');
        }
        $result = recept_file_put($bytes, $mime);
        recept_json(200, ['ok' => true] + $result);
    }

    case 'files GET': {
        // Доступ по длинному неугадываемому имени (sha256 содержимого) — так работают
        // ссылки в клиентских документах и переданные по QR проекты.
        $id = isset($_GET['id']) ? strtolower((string) $_GET['id']) : '';
        $file = recept_file_path($id);
        if ($file === null) {
            recept_fail(404, 'Файл не найден');
        }
        $ext = strtolower((string) pathinfo($file, PATHINFO_EXTENSION));
        http_response_code(200);
        header('Content-Type: ' . recept_file_mime($ext));
        header('Content-Length: ' . (string) filesize($file));
        header('Cache-Control: public, max-age=31536000, immutable');
        header('X-Content-Type-Options: nosniff');
        readfile($file);
        exit;
    }

    case 'files/gc POST': {
        recept_require_admin();
        $result = recept_files_gc();
        $usage = recept_files_usage();
        recept_json(200, ['ok' => true, 'removed' => $result['removed'], 'freed' => $result['freed'], 'files' => $usage['count'], 'bytes' => $usage['bytes']]);
    }

    case 'files/usage GET': {
        recept_require_user();
        $usage = recept_files_usage();
        recept_json(200, ['ok' => true, 'files' => $usage['count'], 'bytes' => $usage['bytes']]);
    }

    /* ---------- передача проекта на телефон ---------- */
    case 'share POST': {
        recept_require_user();
        $body = recept_body();
        if (!isset($body['payload'])) {
            recept_fail(400, 'Нет данных для передачи');
        }
        $id = recept_share_put(is_array($body['payload']) ? $body['payload'] : ['value' => $body['payload']]);
        recept_json(200, ['ok' => true, 'id' => $id]);
    }

    case 'share GET': {
        // Открывается по ссылке из QR — без входа, доступ по длинному случайному коду.
        $payload = recept_share_get((string) ($_GET['id'] ?? ''));
        if ($payload === null) {
            recept_fail(404, 'Передача не найдена или устарела');
        }
        recept_json(200, ['ok' => true, 'payload' => $payload]);
    }
}

recept_fail(404, 'Неизвестный запрос к API: ' . ($route === '' ? '(пусто)' : $route));

/** Перевод строк вида «64M» в байты. */
function recept_bytes(string $value): float
{
    $value = trim($value);
    if ($value === '') {
        return 0;
    }
    $unit = strtolower(substr($value, -1));
    $number = (float) $value;
    if ($unit === 'g') {
        return $number * 1073741824;
    }
    if ($unit === 'm') {
        return $number * 1048576;
    }
    if ($unit === 'k') {
        return $number * 1024;
    }
    return $number;
}
