// Раздел «Сервер»: состояние связи, сотрудники, резервные копии, смена пароля.
// Виден только когда приложение работает на собственном сервере.

import { useCallback, useEffect, useState } from 'react';
import {
  apiUrl,
  changeOwnPassword, deleteServerUser, listServerBackups, listServerUsers, restoreServerBackup,
  saveServerUser, serverFilesGc, serverFilesUsage, serverHealth,
  type ServerBackup, type ServerRole, type ServerUser,
} from '../lib/serverApi';
import { hydrate } from '../lib/photoStore';
import { formatWorkspaceSize, normalizeWorkspace, type Workspace } from '../lib/serverWorkspace';
import { getStorageNote } from '../lib/storage';
import type { ServerSync } from '../lib/useServerSync';

const STATUS_LABEL: Record<string, string> = {
  idle: 'Ожидание',
  loading: 'Загрузка базы…',
  saving: 'Сохранение…',
  synced: 'Всё сохранено на сервере',
  offline: 'Нет связи — правки ждут в браузере',
  error: 'Ошибка',
};

export default function ServerPanel(props: {
  sync: ServerSync;
  workspace: Workspace;
  onRestored: (workspace: Workspace) => void;
}) {
  const { sync } = props;
  const isAdmin = sync.user?.role === 'admin';
  const [users, setUsers] = useState<ServerUser[]>([]);
  const [backups, setBackups] = useState<ServerBackup[]>([]);
  const [health, setHealth] = useState<{ version: string; php: string; maxUploadMb: number } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [newLogin, setNewLogin] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<ServerRole>('user');

  const [oldPassword, setOldPassword] = useState('');
  const [ownPassword, setOwnPassword] = useState('');
  const [files, setFiles] = useState<{ files: number; bytes: number } | null>(null);
  const [cleaning, setCleaning] = useState(false);

  const reload = useCallback(async () => {
    try {
      setHealth(await serverHealth());
      setFiles(await serverFilesUsage());
      setError('');
      if (isAdmin) {
        setUsers(await listServerUsers());
        setBackups(await listServerBackups());
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [isAdmin]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  const addUser = async () => {
    setMessage('');
    setError('');
    try {
      await saveServerUser({ login: newLogin.trim(), password: newPassword, name: newName.trim() || newLogin.trim(), role: newRole });
      setNewLogin('');
      setNewName('');
      setNewPassword('');
      setMessage('Сотрудник сохранён. Передайте ему логин и пароль.');
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const cleanFiles = async () => {
    if (!confirm('Удалить с хостинга файлы, на которые больше нет ссылок из проектов и резервных копий?')) return;
    setCleaning(true);
    setMessage('');
    setError('');
    try {
      const result = await serverFilesGc();
      setFiles({ files: result.files, bytes: result.bytes });
      setMessage(result.removed > 0
        ? `Удалено файлов: ${result.removed}, освобождено ${formatWorkspaceSize(result.freed)}.`
        : 'Лишних файлов не найдено — всё занятое место используется.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCleaning(false);
    }
  };

  const removeUser = async (login: string) => {
    if (!confirm(`Удалить доступ сотрудника «${login}»?`)) return;
    try {
      await deleteServerUser(login);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const restore = async (file: string) => {
    if (!confirm(`Вернуть базу к копии от ${file}? Текущая версия тоже останется в копиях.`)) return;
    try {
      const result = await restoreServerBackup<unknown>(file);
      props.onRestored(await hydrate(normalizeWorkspace(result.data)));
      setMessage('База восстановлена из резервной копии.');
      await sync.refresh();
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const updatePassword = async () => {
    setMessage('');
    setError('');
    try {
      await changeOwnPassword(oldPassword, ownPassword);
      setOldPassword('');
      setOwnPassword('');
      setMessage('Пароль изменён.');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const counts = props.workspace;

  return (
    <div className="view server-view">
      <header className="view-head">
        <div>
          <h1>Сервер</h1>
          <p className="view-sub">Общая база на вашем хостинге: доступ сотрудников, состояние связи и резервные копии.</p>
        </div>
        <div className="server-head-actions">
          <a className="server-check-link" href={apiUrl('check')} target="_blank" rel="noreferrer">Проверка установки</a>
          <button type="button" onClick={() => void sync.refresh()}>Обновить с сервера</button>
        </div>
      </header>

      <section className="server-cards">
        <div className={`server-card status-${sync.status}`}>
          <div className="server-card-title">Состояние</div>
          <div className="server-card-value">{STATUS_LABEL[sync.status] ?? sync.status}</div>
          <div className="server-card-note">
            {sync.savedAt ? `Последнее сохранение: ${new Date(sync.savedAt).toLocaleString('ru-RU')}` : 'Пока без сохранений'}
            {sync.pendingChanges ? ' · есть несохранённые правки' : ''}
          </div>
        </div>
        <div className="server-card">
          <div className="server-card-title">Вы вошли как</div>
          <div className="server-card-value">{sync.user?.name || sync.user?.login}</div>
          <div className="server-card-note">{sync.user?.role === 'admin' ? 'Владелец (полные права)' : 'Сотрудник'} · версия базы №{sync.rev}</div>
        </div>
        <div className="server-card">
          <div className="server-card-title">Фотографии на хостинге</div>
          <div className="server-card-value">{files ? `${files.files} файлов · ${formatWorkspaceSize(files.bytes)}` : '—'}</div>
          <div className="server-card-note">
            Фото и подложки эскизов лежат отдельными файлами, поэтому база остаётся лёгкой.
            {isAdmin && (
              <> · <button type="button" className="link-button" onClick={() => void cleanFiles()} disabled={cleaning}>
                {cleaning ? 'Убираем…' : 'убрать лишние'}
              </button></>
            )}
          </div>
        </div>
        <div className="server-card">
          <div className="server-card-title">В базе</div>
          <div className="server-card-value">{counts.projects.length} проектов · {counts.clients.length} клиентов</div>
          <div className="server-card-note">
            Шаблонов: {counts.templates.length} · статей: {counts.knowledge.length}
            {health ? ` · PHP ${health.php} · загрузка до ${health.maxUploadMb} МБ` : ''}
          </div>
        </div>
      </section>

      {(message || error || sync.error) && (
        <div className={error || sync.error ? 'server-alert error' : 'server-alert'}>{error || sync.error || message}</div>
      )}

      {getStorageNote() && <div className="server-alert">{getStorageNote()}</div>}

      <section className="server-block">
        <h2>Мой пароль</h2>
        <div className="server-form-row">
          <label><span>Текущий пароль</span><input type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} autoComplete="current-password" /></label>
          <label><span>Новый пароль</span><input type="password" value={ownPassword} onChange={(event) => setOwnPassword(event.target.value)} autoComplete="new-password" /></label>
          <button type="button" onClick={() => void updatePassword()} disabled={!oldPassword || ownPassword.length < 8}>Сменить пароль</button>
        </div>
        <button type="button" className="server-logout" onClick={() => void sync.logout()}>Выйти из системы</button>
      </section>

      {isAdmin && (
        <section className="server-block">
          <h2>Сотрудники</h2>
          <p className="server-hint">Каждому — свой логин. Все работают с одной общей базой проектов и клиентов.</p>
          <table className="server-table">
            <thead><tr><th>Логин</th><th>Имя</th><th>Права</th><th /></tr></thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.login}>
                  <td><b>{item.login}</b></td>
                  <td>{item.name}</td>
                  <td>{item.role === 'admin' ? 'Владелец' : 'Сотрудник'}</td>
                  <td className="right">
                    {item.login !== sync.user?.login && (
                      <button type="button" className="link-danger" onClick={() => void removeUser(item.login)}>Удалить</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="server-form-row">
            <label><span>Логин</span><input value={newLogin} onChange={(event) => setNewLogin(event.target.value)} placeholder="zamer" /></label>
            <label><span>Имя</span><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Сергей, замерщик" /></label>
            <label><span>Пароль</span><input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="минимум 8 символов" /></label>
            <label><span>Права</span>
              <select value={newRole} onChange={(event) => setNewRole(event.target.value as ServerRole)}>
                <option value="user">Сотрудник</option>
                <option value="admin">Владелец</option>
              </select>
            </label>
            <button type="button" onClick={() => void addUser()} disabled={newLogin.trim().length < 3 || newPassword.length < 8}>
              Добавить / обновить
            </button>
          </div>
        </section>
      )}

      {isAdmin && (
        <section className="server-block">
          <h2>Резервные копии</h2>
          <p className="server-hint">Копия базы создаётся автоматически перед сохранением, но не чаще раза в 10 минут. Хранятся последние 60.</p>
          {backups.length === 0 ? <div className="server-empty">Копий пока нет.</div> : (
            <table className="server-table">
              <thead><tr><th>Когда</th><th>Размер</th><th /></tr></thead>
              <tbody>
                {backups.map((item) => (
                  <tr key={item.file}>
                    <td>{new Date(item.createdAt).toLocaleString('ru-RU')}</td>
                    <td>{formatWorkspaceSize(item.size)}</td>
                    <td className="right"><button type="button" onClick={() => void restore(item.file)}>Восстановить</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
