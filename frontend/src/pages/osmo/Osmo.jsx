
import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const FONT_MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";

export default function Osmo() {
  const [status, setStatus] = useState('loading');
  const [photos, setPhotos] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeVideo, setActiveVideo] = useState(null);

  const PAGE_SIZE = 20;

  function fetchPage(offset) {
    return fetch(`${API_BASE}/api/osmo/photos?limit=${PAGE_SIZE}&offset=${offset}`, {
      credentials: 'include',
    }).then((res) => res.json());
  }

  useEffect(() => {
    fetchPage(0)
      .then((data) => {
        setPhotos(data.photos);
        setHasMore(data.has_more);
        setStatus('loaded');
      })
      .catch(() => setStatus('error'));
  }, []);

  async function handleLoadMore() {
    setLoadingMore(true);
    try {
      const data = await fetchPage(photos.length);
      setPhotos((prev) => [...prev, ...data.photos]);
      setHasMore(data.has_more);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <span style={styles.title}>osmo footage</span>
      </header>

      {status === 'loading' && <p style={styles.message}>loading…</p>}
      {status === 'error' && <p style={styles.message}>couldn't load osmo footage.</p>}
      {status === 'loaded' && photos.length === 0 && (
        <p style={styles.message}>no osmo footage synced yet.</p>
      )}

      {status === 'loaded' && photos.length > 0 && (
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
                <span>{new Date(p.taken_at).toLocaleDateString()}</span>
                <a href={p.download_url} style={styles.downloadLink}>⬇ download</a>
              </figcaption>
            </figure>
          ))}
          {hasMore && (
            <button onClick={handleLoadMore} disabled={loadingMore} style={styles.loadMoreButton}>
              {loadingMore ? 'loading…' : 'load more'}
            </button>
          )}
        </div>
      )}

      {activeVideo && (
        <div style={styles.modalBackdrop} onClick={() => setActiveVideo(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <video src={activeVideo.full_url} controls autoPlay={false} style={styles.modalVideo} />
            <button onClick={() => setActiveVideo(null)} style={styles.modalClose}>close</button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#0B0D12', fontFamily: FONT_MONO, padding: '32px 24px', color: '#E5E7EB' },
  header: { maxWidth: '900px', margin: '0 auto 24px' },
  title: { fontSize: '16px', letterSpacing: '1px', color: '#E8A33D' },
  message: { maxWidth: '900px', margin: '0 auto', fontSize: '13px', color: '#9CA3AF' },
  grid: { maxWidth: '900px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '16px' },
  card: { margin: 0, background: '#12151C', border: '1px solid #262B36', borderRadius: '8px', overflow: 'hidden', position: 'relative' },
  image: { width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' },
  thumbLink: { position: 'relative', display: 'block' },
  thumbButtonReset: { border: 'none', padding: 0, margin: 0, background: 'none', cursor: 'pointer', width: '100%' },
  playOverlay: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '44px', height: '44px', borderRadius: '50%', background: 'rgba(11, 13, 18, 0.7)', color: '#E8A33D', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', pointerEvents: 'none' },
  caption: { padding: '8px 10px', fontSize: '11px', color: '#6B7280', display: 'flex', justifyContent: 'space-between' },
  downloadLink: { color: '#E8A33D', textDecoration: 'none' },
  loadMoreButton: { gridColumn: '1 / -1', background: 'transparent', border: '1px solid #2D3340', color: '#9CA3AF', borderRadius: '6px', padding: '10px', fontFamily: FONT_MONO, fontSize: '12px', cursor: 'pointer' },
  modalBackdrop: { position: 'fixed', inset: 0, background: 'rgba(11, 13, 18, 0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '24px' },
  modalContent: { maxWidth: '90vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' },
  modalVideo: { maxWidth: '90vw', maxHeight: '80vh', borderRadius: '8px' },
  modalClose: { background: 'transparent', border: '1px solid #2D3340', color: '#9CA3AF', borderRadius: '6px', padding: '8px 16px', fontFamily: FONT_MONO, fontSize: '13px', cursor: 'pointer' },
};
