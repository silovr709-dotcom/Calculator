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
