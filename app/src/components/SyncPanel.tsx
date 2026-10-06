import { useEffect, useState } from 'react';
import type { ClientProfile, Project, ProjectSettings, Template } from '../types';
import QRCode from 'qrcode';
import {
  defaultSyncConfig,
  generateSyncRoom,
  loadSyncConfig,
  makeProjectQrShare,
  makeSyncShareUrl,
  performFullSync,
  saveSyncConfig,
} from '../lib/sync';
import type { SyncConfig, SyncStatus } from '../lib/sync';
import { fmtDate } from '../lib/format';

export default function SyncPanel(props: {
  projects: Project[];
  clients?: ClientProfile[];
  templates: Template[];
  settings: ProjectSettings;
  onSyncUpdated: (data: { projects: Project[]; clients?: ClientProfile[]; templates: Template[]; settings: ProjectSettings }) => void;
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
  const [projectShareUrl, setProjectShareUrl] = useState<string>('');
  const [projectQrStatus, setProjectQrStatus] = useState<string>('');
  const [projectQrError, setProjectQrError] = useState<string>('');
  const activeProjectForQr = props.projects.some((project) => project.id === selProjectForQr) ? selProjectForQr : props.projects[0]?.id ?? '';

  // Обновление QR-кода комнаты синхронизации
  useEffect(() => {
    if (config.enabled && config.roomCode && config.secretKey) {
      const url = makeSyncShareUrl(config.roomCode, config.secretKey);
      QRCode.toDataURL(url, { width: 300, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#092a55', light: '#ffffff' } })
        .then((url) => setQrDataUrl(url))
        .catch(() => {});
    }
  }, [config.enabled, config.roomCode, config.secretKey]);

  // Обновление QR-кода отдельного выбранного проекта.
  // В QR кладём сжатый проект напрямую или короткую #share-ссылку для крупных проектов.
  // Так передача остаётся рабочей даже при недоступном облаке для небольших и средних проектов.
  useEffect(() => {
    let alive = true;
    const p = props.projects.find((x) => x.id === activeProjectForQr);
    if (!p) {
      Promise.resolve().then(() => {
        if (!alive) return;
        setProjectQrDataUrl('');
        setProjectShareUrl('');
        setProjectQrError('');
        setProjectQrStatus('');
      });
      return () => { alive = false; };
    }

    const generate = async () => {
      await Promise.resolve();
      if (!alive) return;
      setProjectQrDataUrl('');
      setProjectShareUrl('');
      setProjectQrError('');
      setProjectQrStatus('Готовим QR-ссылку проекта…');
      try {
        const share = await makeProjectQrShare(p);
        if (!alive) return;
        const qr = await QRCode.toDataURL(share.url, {
          width: 320,
          margin: 4,
          errorCorrectionLevel: share.urlLength > 1800 ? 'L' : 'M',
          color: { dark: '#092a55', light: '#ffffff' },
        });
        if (!alive) return;
        setProjectShareUrl(share.url);
        setProjectQrDataUrl(qr);
        setProjectQrStatus(share.note);
      } catch (error) {
        if (!alive) return;
        setProjectQrError(`${(error as Error).message}. Попробуйте интернет-соединение, удалите тяжёлые вложения или включите облачную синхронизацию.`);
        setProjectQrStatus('');
      }
    };
    generate();
    return () => { alive = false; };
  }, [activeProjectForQr, props.projects]);

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
                <div className="actions system-action-strip">
                  <button className="btn primary small" onClick={handleManualSync} disabled={syncing}>
                    {syncing ? 'Обновление…' : '↻ Синхронизировать сейчас'}
                  </button>
                  <div className="dropdown action-dropdown wide">
                    <button className="btn ghost small" type="button">Настройки ▾</button>
                    <div className="dropdown-menu">
                      <button type="button" className="danger-menu-item" onClick={handleDisconnect}>Отключить синхронизацию</button>
                    </div>
                  </div>
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
          <h3>📱 Передача проекта по QR-коду на телефон</h3>
          <div className="muted small" style={{ marginBottom: 14 }}>
            Позволяет открыть конкретную кухню на телефоне коллеги или клиента. QR теперь использует сжатую ссылку проекта или короткую облачную ссылку для крупных проектов, поэтому код нормально сканируется камерой телефона.
          </div>

          {props.projects.length === 0 ? (
            <div className="empty small">Сначала создайте хотя бы один проект.</div>
          ) : (
            <>
              <label>
                Выберите проект для передачи:
                <select
                  value={activeProjectForQr}
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

              {projectQrStatus && <div className="muted small" style={{ marginTop: 10 }}>{projectQrStatus}</div>}
              {projectQrError && <div className="warn-box" style={{ marginTop: 10 }}>{projectQrError}</div>}
              {props.projects.some((project) => project.id === activeProjectForQr) && projectQrDataUrl && (
                <div className="qr-container" style={{ marginTop: 16 }}>
                  <img src={projectQrDataUrl} alt="QR-код проекта" className="qr-image" width={300} height={300} />
                  <div className="qr-hint">
                    <b>Проверено для сканирования:</b> откройте камеру телефона, наведите на весь белый квадрат и перейдите по ссылке — проект импортируется автоматически.
                  </div>
                  {projectShareUrl && (
                    <div className="sync-url-box" style={{ marginTop: 10 }}>
                      <input readOnly value={projectShareUrl} className="sync-url-input" />
                      <button className="btn small ghost" type="button" onClick={() => navigator.clipboard.writeText(projectShareUrl)}>Копировать</button>
                    </div>
                  )}
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
