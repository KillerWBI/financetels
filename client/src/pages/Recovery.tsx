import { useState } from 'react';
import { api } from '../api';

type Account = Awaited<ReturnType<typeof api.recoveryAccounts>>[number];

interface Props {
  onBack: () => void;
  onDone: (token: string) => void;
  resetToken?: string; // ссылка вида /?reset=...
}

// Бета-восстановление без почты: ключ восстановления хранится в настройках сервера (Railway → RECOVERY_KEY).
export function Recovery({ onBack, onDone, resetToken }: Props) {
  const [key, setKey] = useState('');
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [token, setToken] = useState(resetToken ?? '');
  const [link, setLink] = useState('');
  const [chosen, setChosen] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const showAccounts = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => setAccounts(await api.recoveryAccounts(key.trim())));
  };

  const pick = (a: Account) =>
    void run(async () => {
      const r = await api.recoveryLink(key.trim(), a.id);
      setToken(r.token);
      setChosen(a.email);
      setLink(`${window.location.origin}${r.path}`);
    });

  const reset = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await api.resetPassword(token, password);
      onDone(r.token);
    });
  };

  return (
    <div className="login">
      <div className="login-card">
        <h1 className="brand big">Восстановление доступа</h1>

        {token ? (
          <form onSubmit={reset} style={{ display: 'grid', gap: '0.5rem' }}>
            <p className="muted">{chosen ? `Новый пароль для ${chosen}.` : 'Задайте новый пароль.'} Ссылка действует 30 минут и срабатывает один раз.</p>
            {link && (
              <label>
                Ссылка сброса
                <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              </label>
            )}
            <label>
              Новый пароль
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete="new-password" />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="primary" disabled={busy}>Сохранить и войти</button>
          </form>
        ) : accounts ? (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <p className="muted">Аккаунтов: {accounts.length}. Выберите свой: у него будут ваши смены и платежи.</p>
            {accounts.map((a) => (
              <button key={a.id} type="button" className="account-row" disabled={busy} onClick={() => pick(a)}>
                <strong>{a.email}</strong>
                <span className="muted">
                  создан {a.createdAt.slice(0, 10)} · смен {a.shifts}, платежей {a.expenses}, доходов {a.incomes}, целей {a.goals}
                </span>
              </button>
            ))}
            {error && <p className="error" role="alert">{error}</p>}
          </div>
        ) : (
          <form onSubmit={showAccounts} style={{ display: 'grid', gap: '0.5rem' }}>
            <p className="muted">Введите ключ восстановления. Он лежит в Railway: сервис app → Variables → RECOVERY_KEY.</p>
            <label>
              Ключ восстановления
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} required autoComplete="off" />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="primary" disabled={busy}>Показать аккаунты</button>
          </form>
        )}

        <button type="button" className="link" onClick={onBack}>Назад ко входу</button>
      </div>
    </div>
  );
}
