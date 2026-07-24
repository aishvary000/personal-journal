
import { useState } from 'react';
import { useParams } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const FONT_MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";

// This page is intentionally NOT wrapped in ProtectedRoute — the person
// viewing it isn't logged in at all. Access is gated purely by knowing the
// share link (an unguessable UUID) plus the passcode.
export default function SharePage() {
  const { shareId } = useParams();
  const [passcode, setPasscode] = useState('');
  const [status, setStatus] = useState('locked'); // 'locked' | 'loading' | 'unlocked' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [photos, setPhotos] = useState([]);
  const [activeVideo, setActiveVideo] = useState(null); // photo object currently open in the modal, or null

  async function handleUnlock(e) {
    e.preventDefault();
    setStatus('loading');
    setErrorMessage('');

    try {
      const res = await fetch(`${API_BASE}/api/shares/${shareId}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMessage(data.error || 'something went wrong');
        setStatus('locked');
        return;
      }

      setPhotos(data.photos);
      setStatus('unlocked');
    } catch {
      setErrorMessage('could not reach server');
      setStatus('locked');
    }
  }

  if (status === 'unlocked') {
    return (
      <div style={styles.page}>
        <header style={styles.header}>
          <span style={styles.title}>shared photos</span>
        </header>
        <div style={styles.grid}>
          {photos.map((p) => (
            <figure key={p.id} style={styles.card}>
              {p.media_type === 'video' ? (
                <button
                  onClick={() => setActiveVideo(p)}
                  style={{ ...styles.thumbLink, ...styles.thumbButtonReset }}
                >
                  <img src={p.thumb_url} alt="" style={styles.image} loading="lazy" />
                  <span style={styles.playOverlay} aria-hidden="true">▶</span>
                </button>
              ) : (
                <a href={p.full_url} target="_blank" rel="noopener noreferrer" style={styles.thumbLink}>
                  <img src={p.thumb_url} alt="" style={styles.image} loading="lazy" />
                </a>
              )}
              <figcaption style={styles.caption}>
                <a href={p.download_url} style={styles.downloadLink}>
                  ⬇ download
                </a>
              </figcaption>
            </figure>
          ))}
        </div>

        {activeVideo && (
          <div style={styles.modalBackdrop} onClick={() => setActiveVideo(null)}>
            <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <video
                src={activeVideo.full_url}
                controls
                autoPlay={false}
                style={styles.modalVideo}
              />
              <button onClick={() => setActiveVideo(null)} style={styles.modalClose}>
                close
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={styles.lockedPage}>
      <form onSubmit={handleUnlock} style={styles.lockCard}>
        <span style={styles.lockTitle}>enter passcode</span>
        <input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="passcode"
          style={styles.input}
          disabled={status === 'loading'}
          autoFocus
        />
        {errorMessage && <div style={styles.error}>{errorMessage}</div>}
        <button type="submit" style={styles.button} disabled={status === 'loading' || !passcode}>
          {status === 'loading' ? 'checking…' : 'unlock'}
        </button>
      </form>
    </div>
  );
}

const styles = {
  lockedPage: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0B0D12',
    fontFamily: FONT_MONO,
    padding: '24px',
  },
  lockCard: {
    width: '100%',
    maxWidth: '360px',
    background: '#12151C',
    border: '1px solid #262B36',
    borderRadius: '8px',
    padding: '28px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  lockTitle: {
    fontSize: '14px',
    color: '#E8A33D',
    letterSpacing: '0.5px',
  },
  input: {
    background: '#0B0D12',
    border: '1px solid #2D3340',
    borderRadius: '6px',
    padding: '10px 12px',
    color: '#E5E7EB',
    fontFamily: FONT_MONO,
    fontSize: '14px',
  },
  error: {
    fontSize: '12px',
    color: '#F87171',
  },
  button: {
    background: '#E8A33D',
    color: '#0B0D12',
    border: 'none',
    borderRadius: '6px',
    padding: '10px',
    fontFamily: FONT_MONO,
    fontWeight: 600,
    cursor: 'pointer',
  },
  page: {
    minHeight: '100vh',
    background: '#0B0D12',
    fontFamily: FONT_MONO,
    padding: '32px 24px',
    color: '#E5E7EB',
  },
  header: {
    maxWidth: '900px',
    margin: '0 auto 24px',
  },
  title: {
    fontSize: '16px',
    color: '#E8A33D',
    letterSpacing: '1px',
  },
  grid: {
    maxWidth: '900px',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '16px',
  },
  card: {
    margin: 0,
    display: 'block',
    background: '#12151C',
    border: '1px solid #262B36',
    borderRadius: '8px',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    aspectRatio: '1',
    objectFit: 'cover',
    display: 'block',
  },
  caption: {
    padding: '8px 10px',
    fontSize: '11px',
    display: 'flex',
    justifyContent: 'flex-end',
  },
  downloadLink: {
    color: '#E8A33D',
    textDecoration: 'none',
  },
  thumbLink: {
    position: 'relative',
    display: 'block',
  },
  thumbButtonReset: {
    border: 'none',
    padding: 0,
    margin: 0,
    background: 'none',
    cursor: 'pointer',
    width: '100%',
  },
  playOverlay: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '44px',
    height: '44px',
    borderRadius: '50%',
    background: 'rgba(11, 13, 18, 0.7)',
    color: '#E8A33D',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    pointerEvents: 'none',
  },
  modalBackdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(11, 13, 18, 0.9)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '24px',
  },
  modalContent: {
    maxWidth: '90vw',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    alignItems: 'center',
  },
  modalVideo: {
    maxWidth: '90vw',
    maxHeight: '80vh',
    borderRadius: '8px',
  },
  modalClose: {
    background: 'transparent',
    border: '1px solid #2D3340',
    color: '#9CA3AF',
    borderRadius: '6px',
    padding: '8px 16px',
    fontFamily: FONT_MONO,
    fontSize: '13px',
    cursor: 'pointer',
  },
};
