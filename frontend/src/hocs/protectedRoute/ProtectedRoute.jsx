import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { apiFetch } from '../../utils/fetch-api';

// Wrap any route element with this to require an authenticated session:
//   <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
//
// On mount, asks the server "am I authenticated" via /api/me (from the auth-internals doc).
// This is the only reliable check — a cookie merely *existing* in the browser says nothing
// about whether the server still considers it valid (expired, logged out, store restarted).
export default function ProtectedRoute({ children }) {
  const [status, setStatus] = useState('checking'); // 'checking' | 'authed' | 'unauthed'

  useEffect(() => {
    let cancelled = false;

    apiFetch('/api/me')
      .then((res) => {
        return res;
      })
      .then((data) => {
        if (!cancelled) setStatus(data.authenticated ? 'authed' : 'unauthed');
      })
      .catch(() => {
        if (!cancelled) setStatus('unauthed');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'checking') {
    return (
      <div style={styles.wrap}>
        <span className="pulse" style={styles.text}>
          checking session…
        </span>
        <style>{`
          @media (prefers-reduced-motion: reduce) {
            .pulse { animation: none !important; }
          }
          @keyframes pulse { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }
          .pulse { animation: pulse 1.4s ease-in-out infinite; }
        `}</style>
      </div>
    );
  }

  if (status === 'unauthed') {
    return <Navigate to="/login" replace />;
  }

  return children;
}

const styles = {
  wrap: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0B0D12',
  },
  text: {
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: '13px',
    color: '#6B7280',
  },
};
