import { useNavigate } from 'react-router-dom';

const FONT_MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";

export default function Dashboard() {
  const navigate = useNavigate();

  async function handleLogout() {
    await fetch('/api/logout', { method: 'POST', credentials: 'include' });
    navigate('/login', { replace: true });
  }

  const bootLines = [
    { label: 'session', value: 'valid', ok: true },
    { label: 'store', value: 'redis', ok: true },
    { label: 'auth', value: 'bcrypt · verified', ok: true },
  ];

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <span style={styles.title}>dashboard</span>
        <button onClick={handleLogout} style={styles.logoutBtn}>
          log out
        </button>
      </header>

      <div style={styles.terminal}>
        {bootLines.map((line) => (
          <div key={line.label} style={styles.line}>
            <span style={styles.check}>✓</span>
            <span style={styles.lineLabel}>{line.label}</span>
            <span style={styles.lineValue}>{line.value}</span>
          </div>
        ))}
      </div>

      <p style={styles.body}>
        You're in. This route only rendered because <code style={styles.code}>ProtectedRoute</code>{' '}
        confirmed a valid session with the server before mounting it — reload this page, and the
        same check runs again.
      </p>
    </div>
  );
}

const styles = {
  page: {
    minHeight: '100vh',
    background: '#0B0D12',
    fontFamily: FONT_MONO,
    padding: '32px 24px',
    color: '#E5E7EB',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    maxWidth: '520px',
    margin: '0 auto 24px',
  },
  title: {
    fontSize: '15px',
    letterSpacing: '1px',
    color: '#E8A33D',
  },
  logoutBtn: {
    background: 'transparent',
    border: '1px solid #2D3340',
    color: '#9CA3AF',
    fontFamily: FONT_MONO,
    fontSize: '12px',
    padding: '8px 14px',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  terminal: {
    maxWidth: '520px',
    margin: '0 auto 20px',
    background: '#12151C',
    border: '1px solid #262B36',
    borderRadius: '8px',
    padding: '18px 20px',
  },
  line: {
    display: 'flex',
    gap: '10px',
    fontSize: '13px',
    padding: '4px 0',
  },
  check: { color: '#4ADE80' },
  lineLabel: { color: '#6B7280', minWidth: '70px' },
  lineValue: { color: '#D1D5DB' },
  body: {
    maxWidth: '520px',
    margin: '0 auto',
    fontSize: '13px',
    lineHeight: 1.6,
    color: '#9CA3AF',
  },
  code: {
    background: '#1A1E27',
    padding: '2px 6px',
    borderRadius: '4px',
    color: '#E8A33D',
    fontSize: '12px',
  },
};
