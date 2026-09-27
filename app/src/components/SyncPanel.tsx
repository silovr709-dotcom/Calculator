import { useEffect, useState } from 'react';
import type { Project, ProjectSettings, Template } from '../types';
import QRCode from 'qrcode';
import {
  defaultSyncConfig,
  generateSyncRoom,
  loadSyncConfig,
  makeProjectShareUrl,
  makeSyncShareUrl,
  performFullSync,
  saveSyncConfig,
} from '../lib/sync';
import type { SyncConfig, SyncStatus } from '../lib/sync';
import { fmtDate } from '../lib/format';

export default function SyncPanel(props: {
  projects: Project[];
  templates: Template[];
  settings: ProjectSettings;
  onSyncUpdated: (data: { projects: Project[]; templates: Template[]; settings: ProjectSettings }) => void;
  syncStatus: SyncStatus;
  onSetSyncStatus: (st: SyncStatus) => void;
}) {
  const [config, setConfig] = useState<SyncConfig>(() => loadSyncConfig());
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [pinInput, setPinInput] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [syncing, setSyncing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selProjectForQr, setSelProjectForQr] = useState<string>(props.projects[0]?.id ?? '');
  const [projectQrDataUrl, setProjectQrDataUrl] = useState<string>('');

  // Обновление QR-кода комнаты синхронизации
  useEffect(() => {
    if (config.enabled && config.roomCode && config.secretKey) {
      const url = makeSyncShareUrl(config.roomCode, config.secretKey);
      QRCode.toDataURL(url, { width: 260, margin: 2, color: { dark: '#10231f', light: '#ffffff' } })
        .then((url) => setQrDataUrl(url))
        .catch(() => {});
    } else {
      setQrDataUrl('');
    }
  }, [config.enabled, config.roomCode, config.secretKey]);

  // Обновление QR-кода отдельного выбранного проекта
  useEffect(() => {
    const p = props.projects.find((x) => x.id === selProjectForQr);
    if (p) {
      const url = makeProjectShareUrl(p);
      QRCode.toDataURL(url, { width: 240, margin: 2, color: { dark: '#10231f', light: '#ffffff' } })
        .then((url) => setProjectQrDataUrl(url))
        .catch(() => {});
    } else {
      setProjectQrDataUrl('');
    }
  }, [selProjectForQr, props.projects]);

  const handleCreateRoom = async () => {
    const { roomCode, secretKey } = generateSyncRoom();
    const newCfg: SyncConfig = {
      ...config,
      enabled: true,
      roomCode,
      secretKey,
      lastSyncedAt: null,
    };
    saveSyncConfig(newCfg);
    setConfig(newCfg);
    setSyncing(true);
    setStatusMsg('Создание комнаты и загрузка данных в облако…');
    const res = await performFullSync(newCfg);
    setSyncing(false);
    props.onSetSyncStatus(res.status);
    setStatusMsg(res.message);
    if (res.merged) props.onSyncUpdated(res.merged);
  };

  const handleJoinByPin = async () => {
    const pin = pinInput.trim();
    if (!pin) {
      alert('Введите 4-значный PIN-код или ключ комнаты');
      return;
    }
    // Если пользователь ввёл полный ключ или только PIN
    const secretKey = pin.startsWith('recept_') ? pin : `recept_${pin}_cloud`;
    const roomCode = pin.startsWith('recept_') ? pin.split('_')[1] || pin : pin;

    const newCfg: SyncConfig = {
      ...config,
      enabled: true,
      roomCode,
      secretKey,
      lastSyncedAt: null,
    };
    saveSyncConfig(newCfg);
    setConfig(newCfg);
    setSyncing(true);
    setStatusMsg('Подключение к комнате и загрузка проектов…');
    const res = await performFullSync(newCfg);
    setSyncing(false);
    props.onSetSyncStatus(res.status);
    setStatusMsg(res.message);
    if (res.merged) props.onSyncUpdated(res.merged);
  };

  const handleManualSync = async () => {
    if (!config.enabled) return;
    setSyncing(true);
    setStatusMsg('Синхронизация…');
    props.onSetSyncStatus('syncing');
    const res = await performFullSync(config);
    setSyncing(false);
    props.onSetSyncStatus(res.status);
    setStatusMsg(res.message);
    if (res.merged) props.onSyncUpdated(res.merged);
    setConfig(loadSyncConfig());
  };

  const handleDisconnect = () => {
    if (!confirm('Отключить это устройство от облачной синхронизации? Проекты останутся сохранены в этом браузере локально.')) return;
    const newCfg = defaultSyncConfig();
    saveSyncConfig(newCfg);
    setConfig(newCfg);
    props.onSetSyncStatus('idle');
    setStatusMsg('Синхронизация отключена.');
  };

  const shareUrl = config.enabled ? makeSyncShareUrl(config.roomCode, config.secretKey) : '';

  const handleCopyLink = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Синхронизация между устройствами</h1>
          <div className="muted">
            Единый доступ ко всем расчётам с телефона, планшета, рабочего и домашнего компьютеров.
          </div>
        </div>
      </header>

      {/* Основной блок облачной синхронизации */}
      <div className="grid2" style={{ alignItems: 'start' }}>
        <section className="card">
          <h3>
            {config.enabled ? '🟢 Облако подключено' : '⚪ Облачная синхронизация выключена'}
          </h3>
          <div className="muted small" style={{ marginBottom: 16 }}>
            Все проекты сохраняются в зашифрованной комнате. Изменения на компьютере или телефоне сразу синхронизируются.
          </div>

          {config.enabled ? (
            <div className="sync-active-box">
              <div className="pin-banner">
                <span className="pin-label">Ваш код комнаты (PIN):</span>
                <span className="pin-code">{config.roomCode}</span>
              </div>

              {qrDataUrl && (
                <div className="qr-container">
                  <img src={qrDataUrl} alt="QR-код для подключения" className="qr-image" />
                  <div className="qr-hint">
                    📱 <b>Наведите камеру телефона</b> на QR-код, чтобы открыть калькулятор на смартфоне с вашей базой проектов.
                  </div>
                </div>
              )}

              <div className="sync-url-box">
                <input readOnly value={shareUrl} className="sync-url-input" />
                <button className="btn small ghost" onClick={handleCopyLink}>
                  {copied ? 'Скопировано! ✓' : 'Копировать ссылку'}
                </button>
              </div>

              <div className="sync-status-row">
                <div>
                  Статус: <b>{syncing ? 'Синхронизация…' : props.syncStatus === 'synced' ? 'Синхронизировано' : props.syncStatus === 'offline' ? 'Офлайн (локально)' : 'Готово'}</b>
                  {config.lastSyncedAt && <div className="muted small">Посл. синхронизация: {fmtDate(config.lastSyncedAt)}</div>}
                  {statusMsg && <div className="small" style={{ marginTop: 4, color: 'var(--accent)' }}>{statusMsg}</div>}
                </div>
                <div className="actions">
                  <button className="btn primary small" onClick={handleManualSync} disabled={syncing}>
                    {syncing ? 'Обновление…' : '↻ Синхронизировать сейчас'}
                  </button>
                  <button className="btn danger small" onClick={handleDisconnect}>
                    Отключить
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="sync-setup-box">
              <div style={{ marginBottom: 20 }}>
                <button className="btn primary block" style={{ fontSize: 16, padding: '12px 18px' }} onClick={handleCreateRoom}>
                  ＋ Включить синхронизацию (создать новую комнату)
                </button>
                <div className="muted small" style={{ textAlign: 'center', marginTop: 8 }}>
                  Калькулятор создаст персональную комнату и покажет QR-код для быстрого входа с телефона.
                </div>
              </div>

              <div className="hr-text"><span>ИЛИ</span></div>

              <div className="join-pin-box" style={{ marginTop: 16 }}>
                <label>
                  <b>Подключиться к уже созданной комнате по PIN-коду</b>
                  <div className="muted small">Если вы уже включили синхронизацию на другом устройстве, введите код оттуда:</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <input
                      placeholder="Например: 7482"
                      value={pinInput}
                      onChange={(e) => setPinInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleJoinByPin(); }}
                      style={{ fontSize: 16, fontWeight: 700, letterSpacing: 2, textAlign: 'center' }}
                    />
                    <button className="btn ghost" onClick={handleJoinByPin}>
                      Войти
                    </button>
                  </div>
                </label>
              </div>
            </div>
          )}
        </section>

        {/* Быстрая передача отдельного проекта по QR (Direct Share) */}
        <section className="card">
          <h3>📱 Прямая передача проекта по QR-коду (без облака)</h3>
          <div className="muted small" style={{ marginBottom: 14 }}>
            Позволяет мгновенно открыть конкретную кухню на телефоне коллеги или клиента, даже без интернета и облака.
          </div>

          {props.projects.length === 0 ? (
            <div className="empty small">Сначала создайте хотя бы один проект.</div>
          ) : (
            <>
              <label>
                Выберите проект для передачи:
                <select
                  value={selProjectForQr}
                  onChange={(e) => setSelProjectForQr(e.target.value)}
                  style={{ width: '100%', marginTop: 6 }}
                >
                  {props.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.client || 'Без клиента'})
                    </option>
                  ))}
                </select>
              </label>

              {projectQrDataUrl && (
                <div className="qr-container" style={{ marginTop: 16 }}>
                  <img src={projectQrDataUrl} alt="QR-код проекта" className="qr-image" style={{ width: 200, height: 200 }} />
                  <div className="qr-hint">
                    Отсканируйте камерой смартфона — проект откроется прямо в браузере телефона.
                  </div>
                </div>
              )}
            </>
          )}

          <div style={{ marginTop: 24, padding: 12, background: '#f8faf9', borderRadius: 8, border: '1px solid var(--line)' }}>
            <b>💡 Преимущества Local-First архитектуры:</b>
            <ul style={{ margin: '8px 0 0 18px', padding: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--muted)' }}>
              <li>Работает <b>полностью офлайн</b> на объектах без связи.</li>
              <li>При появлении интернета изменения объединяются без потери правок.</li>
              <li>Все расчёты остаются под вашим контролем.</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
