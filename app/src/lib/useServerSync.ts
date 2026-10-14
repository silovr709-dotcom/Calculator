// Связь приложения с собственным сервером: вход, загрузка общей базы и автосохранение.
// Браузер остаётся быстрым кэшем, источник правды — сервер на хостинге.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ServerUnavailableError, fetchServerState, fetchSession, saveServerState,
  serverLogin, serverLogout, serverSetup, type ServerUser,
} from './serverApi';
import { mergeWorkspaces, normalizeWorkspace, readLocalWorkspace, workspaceSignature, writeLocalWorkspace, type Workspace } from './serverWorkspace';

export type ServerMode = 'checking' | 'standalone' | 'server';
export type ServerSaveStatus = 'idle' | 'loading' | 'saving' | 'synced' | 'offline' | 'error';

const SAVE_DELAY = 1500;      // пауза после правки, через которую уходит сохранение
const RETRY_DELAY = 15000;    // повтор после обрыва связи
const REFRESH_DELAY = 30000;  // как часто подтягиваем правки коллег

export interface ServerSync {
  mode: ServerMode;
  status: ServerSaveStatus;
  user: ServerUser | null;
  needsSetup: boolean;
  rev: number;
  savedAt: string;
  error: string;
  pendingChanges: boolean;
  login: (login: string, password: string) => Promise<void>;
  setup: (login: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  scheduleSave: (workspace: Workspace) => void;
  saveNow: (workspace: Workspace) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useServerSync(onApply: (workspace: Workspace) => void): ServerSync {
  const [mode, setMode] = useState<ServerMode>('checking');
  const [status, setStatus] = useState<ServerSaveStatus>('idle');
  const [user, setUser] = useState<ServerUser | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [rev, setRev] = useState(0);
  const [savedAt, setSavedAt] = useState('');
  const [error, setError] = useState('');
  const [pendingChanges, setPendingChanges] = useState(false);

  const applyRef = useRef(onApply);
  const revRef = useRef(0);
  const readyRef = useRef(false);           // до первой загрузки ничего не отправляем
  const appliedSignatureRef = useRef('');   // что последним пришло с сервера
  const pendingRef = useRef<Workspace | null>(null);
  const timerRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const offlineRef = useRef(false);
  const retryAtRef = useRef(0);

  useEffect(() => { applyRef.current = onApply; }, [onApply]);

  const applyWorkspace = useCallback((workspace: Workspace) => {
    appliedSignatureRef.current = workspaceSignature(workspace);
    writeLocalWorkspace(workspace);
    applyRef.current(workspace);
  }, []);

  /** Сохранение с разбором конфликта: если коллега успел раньше — сливаем и пробуем ещё раз. */
  const flush = useCallback(async (workspace: Workspace): Promise<void> => {
    if (savingRef.current) {
      pendingRef.current = workspace;
      return;
    }
    savingRef.current = true;
    setStatus('saving');
    let candidate = workspace;
    try {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const result = await saveServerState(revRef.current, candidate);
        if (result.ok) {
          offlineRef.current = false;
          revRef.current = result.rev;
          setRev(result.rev);
          setSavedAt(result.updatedAt);
          appliedSignatureRef.current = workspaceSignature(candidate);
          setStatus('synced');
          setError('');
          setPendingChanges(pendingRef.current !== null);
          return;
        }
        // Конфликт: на сервере более новая версия. Сливаем её с нашей и сохраняем объединённое.
        const remote = normalizeWorkspace(result.data);
        candidate = mergeWorkspaces(candidate, remote);
        revRef.current = result.rev;
        setRev(result.rev);
        applyWorkspace(candidate);
      }
      pendingRef.current = candidate;
      setStatus('error');
      setError('Не удалось согласовать правки с сервером — попробуем ещё раз через несколько секунд');
    } catch (e) {
      if (e instanceof ServerUnavailableError) {
        // Правки остаются в очереди: их отправит повторная попытка, когда связь вернётся.
        offlineRef.current = true;
        retryAtRef.current = Date.now() + RETRY_DELAY;
        pendingRef.current = candidate;
        setPendingChanges(true);
        setStatus('offline');
        setError('Нет связи с сервером — правки сохранены в браузере и уйдут при восстановлении связи');
      } else {
        setStatus('error');
        setError((e as Error).message);
      }
    } finally {
      savingRef.current = false;
    }
  }, [applyWorkspace]);

  const scheduleSave = useCallback((workspace: Workspace) => {
    if (!readyRef.current) return;
    if (workspaceSignature(workspace) === appliedSignatureRef.current) return;
    pendingRef.current = workspace;
    setPendingChanges(true);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const next = pendingRef.current;
      pendingRef.current = null;
      if (next) void flush(next);
    }, SAVE_DELAY);
  }, [flush]);

  const saveNow = useCallback(async (workspace: Workspace) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    await flush(workspace);
  }, [flush]);

  /** Первая загрузка: сливаем то, что было в браузере, с тем, что лежит на сервере. */
  const pull = useCallback(async () => {
    setStatus('loading');
    try {
      const remoteState = await fetchServerState<unknown>();
      const remote = normalizeWorkspace(remoteState.data);
      const local = readLocalWorkspace();
      const merged = mergeWorkspaces(local, remote);
      revRef.current = remoteState.rev;
      setRev(remoteState.rev);
      setSavedAt(remoteState.updatedAt);
      applyWorkspace(merged);
      readyRef.current = true;
      setStatus('synced');
      setError('');
      if (workspaceSignature(merged) !== workspaceSignature(remote)) {
        await flush(merged); // в браузере были правки, которых нет на сервере — отправляем
      }
    } catch (e) {
      readyRef.current = false;
      if (e instanceof ServerUnavailableError) {
        setStatus('offline');
        setError('Сервер не отвечает — работаем на данных браузера');
      } else {
        setStatus('error');
        setError((e as Error).message);
      }
    }
  }, [applyWorkspace, flush]);

  const boot = useCallback(async () => {
    try {
      const session = await fetchSession();
      setMode('server');
      setNeedsSetup(session.needsSetup);
      setUser(session.user);
      if (session.user) await pull();
    } catch (e) {
      if (e instanceof ServerUnavailableError) {
        setMode('standalone');
        setStatus('idle');
      } else {
        setMode('server');
        setStatus('error');
        setError((e as Error).message);
      }
    }
  }, [pull]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void boot(); }, 0);
    return () => window.clearTimeout(timer);
  }, [boot]);

  // Насос очереди: отправляет накопленные правки, в том числе после обрыва связи.
  useEffect(() => {
    if (mode !== 'server' || !user) return;
    const timer = window.setInterval(() => {
      const next = pendingRef.current;
      if (!next || savingRef.current || !readyRef.current) return;
      if (offlineRef.current && Date.now() < retryAtRef.current) return;
      pendingRef.current = null;
      void flush(next);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [flush, mode, user]);

  // Правки коллег: периодически проверяем, не появилась ли на сервере новая версия.
  useEffect(() => {
    if (mode !== 'server' || !user) return;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      if (savingRef.current || pendingRef.current || !readyRef.current) return;
      try {
        const session = await fetchSession();
        if (session.state.rev === revRef.current) return;
        const remoteState = await fetchServerState<unknown>();
        const remote = normalizeWorkspace(remoteState.data);
        const merged = mergeWorkspaces(readLocalWorkspace(), remote);
        revRef.current = remoteState.rev;
        setRev(remoteState.rev);
        setSavedAt(remoteState.updatedAt);
        applyWorkspace(merged);
        setStatus('synced');
      } catch {
        // молча: следующая попытка через полминуты
      }
    };
    const interval = window.setInterval(() => { void tick(); }, REFRESH_DELAY);
    const onFocus = () => { void tick(); };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [applyWorkspace, mode, user]);

  // Закрытие вкладки с несохранёнными правками — предупреждаем.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingRef.current && !savingRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const login = useCallback(async (loginName: string, password: string) => {
    const nextUser = await serverLogin(loginName, password);
    setUser(nextUser);
    setNeedsSetup(false);
    setError('');
    await pull();
  }, [pull]);

  const setup = useCallback(async (loginName: string, password: string, name: string) => {
    const nextUser = await serverSetup(loginName, password, name);
    setUser(nextUser);
    setNeedsSetup(false);
    setError('');
    await pull();
  }, [pull]);

  const logout = useCallback(async () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const pending = pendingRef.current;
    if (pending) await flush(pending);
    await serverLogout();
    readyRef.current = false;
    setUser(null);
    setStatus('idle');
  }, [flush]);

  return { mode, status, user, needsSetup, rev, savedAt, error, pendingChanges, login, setup, logout, scheduleSave, saveNow, refresh: pull };
}
