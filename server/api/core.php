<?php
/**
 * Ядро серверной части калькулятора РЕцепт для виртуального хостинга (reg.ru и любой другой Apache + PHP).
 * Никаких внешних библиотек и баз данных: данные лежат в JSON-файлах, доступ закрыт паролем.
 */

declare(strict_types=1);

const RECEPT_API_VERSION = '1.0.0';
const RECEPT_SESSION_NAME = 'receptsid';
const RECEPT_SESSION_TTL = 60 * 60 * 24 * 30; // 30 дней «запомнить меня»
const RECEPT_LOGIN_MAX_FAILS = 10;            // попыток входа
const RECEPT_LOGIN_WINDOW = 600;              // за 10 минут
const RECEPT_BACKUP_MIN_INTERVAL = 600;       // не чаще одной копии в 10 минут
const RECEPT_BACKUP_KEEP = 60;                // сколько копий держать

/** Папка с данными. Выбирается один раз и запоминается в data-path.txt рядом с API. */
function recept_data_dir(bool $soft = false): string
{
    static $resolved = null;
    if ($resolved !== null) {
        return $resolved;
    }

    $configured = getenv('RECEPT_DATA_DIR');
    $candidates = [];
    if (is_string($configured) && $configured !== '') {
        $candidates[] = $configured;
    }

    $configFile = __DIR__ . '/config.php';
    if (is_file($configFile)) {
        /** @var array<string,string> $config */
        $config = require $configFile;
        if (!empty($config['dataDir'])) {
            $candidates[] = (string) $config['dataDir'];
        }
    }

    // 1. Лучший вариант: папка рядом с корнем сайта — её не видно из браузера вообще.
    $docRoot = isset($_SERVER['DOCUMENT_ROOT']) ? rtrim((string) $_SERVER['DOCUMENT_ROOT'], '/') : '';
    if ($docRoot !== '' && is_dir(dirname($docRoot))) {
        $candidates[] = dirname($docRoot) . '/recept-data';
    }
    // 2. Запасной вариант: папка внутри сайта, закрытая .htaccess.
    $candidates[] = dirname(__DIR__) . '/recept-data';

    foreach ($candidates as $candidate) {
        if (!is_dir($candidate) && !@mkdir($candidate, 0770, true) && !is_dir($candidate)) {
            continue;
        }
        if (!is_writable($candidate)) {
            continue;
        }
        recept_protect_dir($candidate);
        $resolved = rtrim($candidate, '/');
        return $resolved;
    }

    if ($soft) {
        return '';
    }
    recept_fail(500, 'Нет доступной папки для данных. Создайте папку recept-data рядом с папкой сайта и дайте права на запись.');
}

/** Закрываем папку с данными от веба на случай, если она оказалась внутри сайта. */
function recept_protect_dir(string $dir): void
{
    $htaccess = $dir . '/.htaccess';
    if (!is_file($htaccess)) {
        @file_put_contents($htaccess, "Require all denied\n<IfModule !mod_authz_core.c>\n  Order allow,deny\n  Deny from all\n</IfModule>\n");
    }
    if (!is_file($dir . '/index.html')) {
        @file_put_contents($dir . '/index.html', '');
    }
}

function recept_path(string $name): string
{
    return recept_data_dir() . '/' . $name;
}

function recept_read_json(string $file, $fallback, bool $assoc = true)
{
    if (!is_file($file)) {
        return $fallback;
    }
    $raw = @file_get_contents($file);
    if ($raw === false || $raw === '') {
        return $fallback;
    }
    $data = json_decode($raw, $assoc);
    return $data === null && json_last_error() !== JSON_ERROR_NONE ? $fallback : $data;
}

/** Атомарная запись: сначала во временный файл, потом подмена — файл не бьётся при обрыве связи. */
function recept_write_json(string $file, $value): bool
{
    $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        return false;
    }
    return recept_write_raw($file, $json);
}

function recept_write_raw(string $file, string $contents): bool
{
    $tmp = $file . '.tmp' . bin2hex(random_bytes(4));
    if (@file_put_contents($tmp, $contents, LOCK_EX) === false) {
        return false;
    }
    @chmod($tmp, 0660);
    if (!@rename($tmp, $file)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

function recept_json(int $status, array $payload): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function recept_fail(int $status, string $message, array $extra = []): void
{
    recept_json($status, array_merge(['ok' => false, 'error' => $message], $extra));
}

/**
 * Сырое тело запроса. Браузер может прислать его сжатым (заголовок X-Recept-Encoding: gzip) —
 * это важно для хостингов с жёстким лимитом на размер запроса: проект с фотографиями
 * уезжает в несколько раз меньшим объёмом.
 */
function recept_input(): string
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return '';
    }
    $encoding = strtolower(trim((string) ($_SERVER['HTTP_X_RECEPT_ENCODING'] ?? '')));
    if ($encoding === 'gzip' && function_exists('gzdecode')) {
        $unpacked = @gzdecode($raw);
        if ($unpacked === false) {
            recept_fail(400, 'Не удалось распаковать данные запроса');
        }
        return $unpacked;
    }
    return $raw;
}

/** Тело запроса как объекты (пустой объект остаётся объектом, а не массивом). */
function recept_body_raw()
{
    $raw = recept_input();
    if ($raw === '') {
        return null;
    }
    $data = json_decode($raw, false);
    if ($data === null) {
        recept_fail(400, 'Ожидался JSON в теле запроса');
    }
    return $data;
}

function recept_body(): array
{
    $raw = recept_input();
    if ($raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        recept_fail(400, 'Ожидался JSON в теле запроса');
    }
    return $data;
}

/* ------------------------------------------------------------------ */
/* Пользователи и вход                                                  */
/* ------------------------------------------------------------------ */

function recept_users(): array
{
    $users = recept_read_json(recept_path('users.json'), []);
    return is_array($users) ? $users : [];
}

function recept_save_users(array $users): bool
{
    return recept_write_json(recept_path('users.json'), array_values($users));
}

function recept_find_user(string $login): ?array
{
    $login = mb_strtolower(trim($login));
    foreach (recept_users() as $user) {
        if (mb_strtolower((string) ($user['login'] ?? '')) === $login) {
            return $user;
        }
    }
    return null;
}

function recept_public_user(array $user): array
{
    return [
        'login' => (string) ($user['login'] ?? ''),
        'name' => (string) ($user['name'] ?? $user['login'] ?? ''),
        'role' => (string) ($user['role'] ?? 'user'),
        'createdAt' => (string) ($user['createdAt'] ?? ''),
    ];
}

function recept_start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name(RECEPT_SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => RECEPT_SESSION_TTL,
        'path' => '/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    @ini_set('session.gc_maxlifetime', (string) RECEPT_SESSION_TTL);
    session_start();
}

function recept_current_user(): ?array
{
    recept_start_session();
    $login = $_SESSION['login'] ?? null;
    if (!is_string($login) || $login === '') {
        return null;
    }
    $user = recept_find_user($login);
    if ($user === null) {
        unset($_SESSION['login']);
        return null;
    }
    return $user;
}

function recept_require_user(): array
{
    $user = recept_current_user();
    if ($user === null) {
        recept_fail(401, 'Нужно войти в систему');
    }
    return $user;
}

function recept_require_admin(): array
{
    $user = recept_require_user();
    if (($user['role'] ?? 'user') !== 'admin') {
        recept_fail(403, 'Нужны права администратора');
    }
    return $user;
}

/** Простая защита от подбора пароля: счётчик неудач по IP. */
function recept_login_guard(): void
{
    $file = recept_path('login-attempts.json');
    $all = recept_read_json($file, []);
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $now = time();
    $entry = is_array($all[$ip] ?? null) ? $all[$ip] : ['count' => 0, 'start' => $now];
    if ($now - (int) $entry['start'] > RECEPT_LOGIN_WINDOW) {
        $entry = ['count' => 0, 'start' => $now];
    }
    if ((int) $entry['count'] >= RECEPT_LOGIN_MAX_FAILS) {
        recept_fail(429, 'Слишком много попыток входа. Попробуйте через 10 минут.');
    }
}

function recept_login_failed(): void
{
    $file = recept_path('login-attempts.json');
    $all = recept_read_json($file, []);
    if (!is_array($all)) {
        $all = [];
    }
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $now = time();
    $entry = is_array($all[$ip] ?? null) ? $all[$ip] : ['count' => 0, 'start' => $now];
    if ($now - (int) $entry['start'] > RECEPT_LOGIN_WINDOW) {
        $entry = ['count' => 0, 'start' => $now];
    }
    $entry['count'] = (int) $entry['count'] + 1;
    $all[$ip] = $entry;
    recept_write_json($file, $all);
}

function recept_login_ok(): void
{
    $file = recept_path('login-attempts.json');
    $all = recept_read_json($file, []);
    if (!is_array($all)) {
        return;
    }
    unset($all[(string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown')]);
    recept_write_json($file, $all);
}

/* ------------------------------------------------------------------ */
/* Рабочая база: проекты, клиенты, шаблоны, настройки                   */
/* ------------------------------------------------------------------ */

function recept_state_file(): string
{
    return recept_path('state.json');
}

function recept_state_meta(): array
{
    $meta = recept_read_json(recept_path('state-meta.json'), []);
    return [
        'rev' => (int) ($meta['rev'] ?? 0),
        'updatedAt' => (string) ($meta['updatedAt'] ?? ''),
        'updatedBy' => (string) ($meta['updatedBy'] ?? ''),
        'size' => (int) ($meta['size'] ?? 0),
    ];
}

function recept_empty_state()
{
    return json_decode('{"projects":[],"clients":[],"templates":[],"settings":null,"pricebooks":[],"knowledge":[]}');
}

function recept_load_state()
{
    $state = recept_read_json(recept_state_file(), null, false);
    return is_object($state) || is_array($state) ? $state : recept_empty_state();
}

/** Сохранение базы с проверкой номера версии, чтобы двое не затёрли правки друг друга. */
function recept_save_state($data, int $baseRev, array $user): array
{
    $lock = @fopen(recept_path('state.lock'), 'c');
    if ($lock === false) {
        recept_fail(500, 'Нет доступа к файлу блокировки. Проверьте права на папку данных.');
    }
    @flock($lock, LOCK_EX);

    try {
        $meta = recept_state_meta();
        if ($baseRev >= 0 && $meta['rev'] !== $baseRev) {
            return [
                'conflict' => true,
                'rev' => $meta['rev'],
                'updatedAt' => $meta['updatedAt'],
                'updatedBy' => $meta['updatedBy'],
                'data' => recept_load_state(),
            ];
        }

        recept_make_backup($meta);

        $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($json === false) {
            recept_fail(400, 'Не удалось сохранить: данные не кодируются в JSON');
        }
        if (!recept_write_raw(recept_state_file(), $json)) {
            recept_fail(507, 'Не удалось записать данные на диск. Возможно, закончилось место на хостинге.');
        }

        $next = [
            'rev' => $meta['rev'] + 1,
            'updatedAt' => gmdate('c'),
            'updatedBy' => (string) ($user['login'] ?? ''),
            'size' => strlen($json),
        ];
        recept_write_json(recept_path('state-meta.json'), $next);
        return ['conflict' => false] + $next;
    } finally {
        @flock($lock, LOCK_UN);
        @fclose($lock);
    }
}

/** Резервная копия предыдущего состояния — не чаще, чем раз в RECEPT_BACKUP_MIN_INTERVAL. */
function recept_make_backup(array $meta): void
{
    $stateFile = recept_state_file();
    if (!is_file($stateFile) || filesize($stateFile) === 0) {
        return;
    }
    $dir = recept_path('backups');
    if (!is_dir($dir) && !@mkdir($dir, 0770, true) && !is_dir($dir)) {
        return;
    }
    recept_protect_dir($dir);

    $files = glob($dir . '/state-*.json*') ?: [];
    rsort($files);
    if ($files !== [] && time() - (int) @filemtime($files[0]) < RECEPT_BACKUP_MIN_INTERVAL) {
        return;
    }

    $name = $dir . '/state-' . gmdate('Ymd-His') . '-r' . $meta['rev'] . '.json';
    $raw = @file_get_contents($stateFile);
    if ($raw === false) {
        return;
    }
    if (function_exists('gzencode')) {
        $packed = gzencode($raw, 6);
        if ($packed !== false) {
            recept_write_raw($name . '.gz', $packed);
        } else {
            recept_write_raw($name, $raw);
        }
    } else {
        recept_write_raw($name, $raw);
    }

    $files = glob($dir . '/state-*.json*') ?: [];
    rsort($files);
    foreach (array_slice($files, RECEPT_BACKUP_KEEP) as $old) {
        @unlink($old);
    }
}

function recept_backup_list(): array
{
    $dir = recept_path('backups');
    $files = glob($dir . '/state-*.json*') ?: [];
    rsort($files);
    $list = [];
    foreach ($files as $file) {
        $list[] = [
            'file' => basename($file),
            'size' => (int) @filesize($file),
            'createdAt' => gmdate('c', (int) @filemtime($file)),
        ];
    }
    return $list;
}

function recept_backup_read(string $file)
{
    $file = basename($file);
    if (!preg_match('/^state-[\w\-.]+\.json(\.gz)?$/', $file)) {
        return null;
    }
    $path = recept_path('backups') . '/' . $file;
    if (!is_file($path)) {
        return null;
    }
    $raw = @file_get_contents($path);
    if ($raw === false) {
        return null;
    }
    if (substr($file, -3) === '.gz' && function_exists('gzdecode')) {
        $unpacked = gzdecode($raw);
        if ($unpacked === false) {
            return null;
        }
        $raw = $unpacked;
    }
    $data = json_decode($raw, false);
    return is_object($data) || is_array($data) ? $data : null;
}

/* ------------------------------------------------------------------ */
/* Передача проекта на телефон по QR                                    */
/* ------------------------------------------------------------------ */

function recept_share_dir(): string
{
    $dir = recept_path('shares');
    if (!is_dir($dir) && !@mkdir($dir, 0770, true) && !is_dir($dir)) {
        recept_fail(500, 'Нет доступа к папке передач');
    }
    recept_protect_dir($dir);
    return $dir;
}

function recept_share_put(array $payload): string
{
    $dir = recept_share_dir();
    $id = bin2hex(random_bytes(9));
    recept_write_json($dir . '/' . $id . '.json', ['createdAt' => gmdate('c'), 'payload' => $payload]);

    // Чистим передачи старше 30 дней.
    foreach (glob($dir . '/*.json') ?: [] as $file) {
        if (time() - (int) @filemtime($file) > 60 * 60 * 24 * 30) {
            @unlink($file);
        }
    }
    return $id;
}

function recept_share_get(string $id): ?array
{
    if (!preg_match('/^[a-f0-9]{8,64}$/', $id)) {
        return null;
    }
    $file = recept_share_dir() . '/' . $id . '.json';
    $data = recept_read_json($file, null);
    return is_array($data) && isset($data['payload']) ? $data['payload'] : null;
}
