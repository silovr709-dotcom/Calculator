// Экран входа. Показывается, когда приложение открыто на своём сервере, но вход ещё не выполнен.
// При самом первом запуске здесь же создаётся учётная запись владельца.

import { useState, type FormEvent } from 'react';

export default function ServerLogin(props: {
  needsSetup: boolean;
  error?: string;
  onLogin: (login: string, password: string) => Promise<void>;
  onSetup: (login: string, password: string, name: string) => Promise<void>;
}) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (props.needsSetup) {
      if (password.length < 8) { setError('Пароль должен быть не короче 8 символов'); return; }
      if (password !== password2) { setError('Пароли не совпадают'); return; }
    }
    setBusy(true);
    try {
      if (props.needsSetup) await props.onSetup(login.trim(), password, name.trim() || login.trim());
      else await props.onLogin(login.trim(), password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="server-login">
      <form className="server-login-card" onSubmit={submit}>
        <div className="server-login-brand">
          <div className="server-login-logo">РЕцепт</div>
          <div className="server-login-sub">Кухни · расчёт, замер, документы</div>
        </div>

        {props.needsSetup ? (
          <>
            <h1>Первый запуск</h1>
            <p className="server-login-hint">Создайте учётную запись владельца. Под ней вы потом добавите сотрудников.</p>
          </>
        ) : (
          <>
            <h1>Вход</h1>
            <p className="server-login-hint">Введите логин и пароль, выданные владельцем.</p>
          </>
        )}

        <label>
          <span>Логин</span>
          <input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" autoFocus required placeholder="например, ivan" />
        </label>

        {props.needsSetup && (
          <label>
            <span>Как вас зовут</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Иван Петров" />
          </label>
        )}

        <label>
          <span>Пароль</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={props.needsSetup ? 'new-password' : 'current-password'} required />
        </label>

        {props.needsSetup && (
          <label>
            <span>Повторите пароль</span>
            <input type="password" value={password2} onChange={(event) => setPassword2(event.target.value)} autoComplete="new-password" required />
          </label>
        )}

        {(error || props.error) && <div className="server-login-error">{error || props.error}</div>}

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Проверяем…' : props.needsSetup ? 'Создать и войти' : 'Войти'}
        </button>

        <div className="server-login-foot">
          Данные проектов и клиентов хранятся на вашем хостинге. Пароль можно сменить в разделе «Сервер».
        </div>
      </form>
    </div>
  );
}
