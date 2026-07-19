
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit() {
    if (!password || loading) return;
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      console.log('Login response data:', data); // Log the response data for debugging
      console.log('Login response:', res); // Log the response object for debugging
      if (data.ok) {
        navigate('/dashboard', { replace: true });
      } else {
        setError('access denied — wrong password');
        setPassword('');
        inputRef.current?.focus();
      }
    } catch {
      console.error('Error during login request'); // Log an error message for debugging
      setError('could not reach server');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSubmit();
  }

  return (
    <div style={styles.page}>
      <style>{css}</style>
      <div style={styles.card}>
        <div style={styles.promptLine}>
          <span style={styles.promptSymbol}>$</span>
          <span style={styles.promptText}>auth --user admin</span>
        </div>

        <div style={styles.inputRow}>
          <span style={styles.chevron}>&gt;</span>
          <input
            ref={inputRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="password"
            disabled={loading}
            style={styles.input}
            autoComplete="current-password"
          />
          <span className="cursor-blink" style={styles.cursor} aria-hidden="true">
            ▍
          </span>
        </div>

        {error && (
          <div style={styles.errorLine}>
            <span style={styles.errorPrefix}>✕</span> {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading || !password}
          style={{
            ...styles.button,
            ...(loading || !password ? styles.buttonDisabled : {}),
          }}
        >
          {loading ? 'verifying…' : 'log in'}
        </button>

        <div style={styles.footer}>single-user session · token expires in 7 days</div>
      </div>
    </div>
  );
}

const css = `
  @media (prefers-reduced-motion: reduce) {
    .cursor-blink { animation: none !important; opacity: 1 !important; }
  }
  @keyframes blink {
    0%, 49% { opacity: 1; }
    50%, 100% { opacity: 0; }
  }
  .cursor-blink { animation: blink 1s step-start infinite; }
  .login-input::placeholder { color: #4B5563; }
`;

const FONT_MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";

const styles = {
  page: {
    minHeight: '100vh',
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0B0D12',
    fontFamily: FONT_MONO,
    padding: '24px',
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    background: '#12151C',
    border: '1px solid #262B36',
    borderRadius: '8px',
    padding: '28px 28px 22px',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.2), 0 20px 60px rgba(0,0,0,0.5)',
  },
  promptLine: {
    display: 'flex',
    gap: '8px',
    marginBottom: '20px',
    fontSize: '13px',
    color: '#6B7280',
  },
  promptSymbol: { color: '#E8A33D' },
  promptText: { color: '#9CA3AF' },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    background: '#0B0D12',
    border: '1px solid #2D3340',
    borderRadius: '6px',
    padding: '12px 14px',
  },
  chevron: { color: '#E8A33D', fontSize: '15px' },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#E5E7EB',
    fontSize: '15px',
    fontFamily: FONT_MONO,
    letterSpacing: '1px',
  },
  cursor: {
    color: '#E8A33D',
    fontSize: '15px',
    lineHeight: 1,
  },
  errorLine: {
    marginTop: '12px',
    fontSize: '13px',
    color: '#F87171',
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
  },
  errorPrefix: { color: '#F87171' },
  button: {
    marginTop: '20px',
    width: '100%',
    padding: '12px',
    background: '#E8A33D',
    color: '#0B0D12',
    border: 'none',
    borderRadius: '6px',
    fontFamily: FONT_MONO,
    fontSize: '14px',
    fontWeight: 600,
    letterSpacing: '0.5px',
    cursor: 'pointer',
    transition: 'opacity 0.15s ease',
  },
  buttonDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  footer: {
    marginTop: '18px',
    fontSize: '11px',
    color: '#4B5563',
    textAlign: 'center',
  },
};