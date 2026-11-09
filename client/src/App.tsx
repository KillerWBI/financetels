import { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api';
import { Login } from './pages/Login';
import { Recovery } from './pages/Recovery';
import { CalendarPage } from './pages/CalendarPage';
import { BalancePage } from './pages/BalancePage';
import { OverviewPage } from './pages/OverviewPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { GoalsPage } from './pages/GoalsPage';
import { IncomesPage } from './pages/IncomesPage';
import { SettingsPage } from './pages/SettingsPage';

const TABS = [
  { id: 'balance', label: 'Баланс' },
  { id: 'calendar', label: 'График' },
  { id: 'overview', label: 'Обзор' },
  { id: 'payments', label: 'Платежи' },
  { id: 'goals', label: 'Цели' },
  { id: 'incomes', label: 'Доходы' },
  { id: 'settings', label: 'Настройки' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const [tab, setTab] = useState<TabId>('balance');
  const [recovering, setRecovering] = useState(false);
  const resetToken = new URLSearchParams(window.location.search).get('reset') ?? undefined;

  useEffect(() => {
    const onLogout = () => setAuthed(false);
    window.addEventListener('budget-logout', onLogout);
    return () => window.removeEventListener('budget-logout', onLogout);
  }, []);

  if (!authed && (recovering || resetToken)) {
    return (
      <Recovery
        resetToken={resetToken}
        onBack={() => {
          if (resetToken) window.history.replaceState(null, '', '/');
          setRecovering(false);
          if (resetToken) window.location.reload();
        }}
        onDone={(t) => {
          setToken(t);
          window.history.replaceState(null, '', '/');
          window.location.reload();
        }}
      />
    );
  }

  if (!authed) {
    return (
      <Login
        onDone={async (mode, email, password) => {
          const r = mode === 'login' ? await api.login(email, password) : await api.register(email, password);
          setToken(r.token);
          setAuthed(true);
        }}
        onForgot={() => setRecovering(true)}
      />
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <h1 className="brand">Смены и деньги</h1>
        <nav className="tabs" aria-label="Разделы">
          {TABS.map((t) => (
            <button key={t.id} className={t.id === tab ? 'tab active' : 'tab'} onClick={() => setTab(t.id)} aria-current={t.id === tab}>
              {t.label}
            </button>
          ))}
        </nav>
        <button
          className="link"
          onClick={() => {
            setToken(null);
            setAuthed(false);
          }}
        >
          Выйти
        </button>
      </header>
      <main className="page">
        {tab === 'balance' && <BalancePage />}
        {tab === 'calendar' && <CalendarPage />}
        {tab === 'overview' && <OverviewPage />}
        {tab === 'payments' && <PaymentsPage />}
        {tab === 'goals' && <GoalsPage />}
        {tab === 'incomes' && <IncomesPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
