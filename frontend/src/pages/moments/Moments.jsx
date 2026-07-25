import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const FONT_MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";

function formatDateRange(start, end) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const opts = { month: 'short', day: 'numeric', year: 'numeric' };

  if (startDate.toDateString() === endDate.toDateString()) {
    return startDate.toLocaleDateString('en-US', opts);
  }
  return `${startDate.toLocaleDateString('en-US', opts)} → ${endDate.toLocaleDateString('en-US', opts)}`;
}

export default function Moments() {
  const [status, setStatus] = useState('loading');
  const [moments, setMoments] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const PAGE_SIZE = 20;

  function fetchPage(offset) {
    return fetch(`${API_BASE}/api/moments?limit=${PAGE_SIZE}&offset=${offset}`, {
      credentials: 'include',
    }).then((res) => res.json());
  }

  useEffect(() => {
    fetchPage(0)
      .then((data) => {
        setMoments(data.moments);
        setHasMore(data.has_more);
        setStatus('loaded');
      })
      .catch(() => setStatus('error'));
  }, []);

  async function handleLoadMore() {
    setLoadingMore(true);
    try {
      const data = await fetchPage(moments.length);
      setMoments((prev) => [...prev, ...data.moments]);
      setHasMore(data.has_more);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <span style={styles.title}>moments</span>
      </header>

      {status === 'loading' && <p style={styles.message}>loading…</p>}
      {status === 'error' && <p style={styles.message}>couldn't load moments.</p>}
      {status === 'loaded' && moments.length === 0 && (
        <p style={styles.message}>no moments yet — run the clustering script first.</p>
      )}

      {status === 'loaded' && moments.length > 0 && (
        <div style={styles.grid}>
          {moments.map((m) => (
            <Link key={m.id} to={`/moments/${m.id}`} style={styles.card}>
              <img src={m.cover_thumb_url} alt="" style={styles.image} loading="lazy" />
              <div style={styles.cardInfo}>
                {m.place_name && <span style={styles.placeName}>{m.place_name}</span>}
                <span style={styles.dateRange}>{formatDateRange(m.start_date, m.end_date)}</span>
                <span style={styles.photoCount}>{m.photo_count} photo{m.photo_count !== 1 ? 's' : ''}</span>
              </div>
            </Link>
          ))}
          {hasMore && (
            <button onClick={handleLoadMore} disabled={loadingMore} style={styles.loadMoreButton}>
              {loadingMore ? 'loading…' : 'load more'}
            </button>
          )}
        </div>
      )}
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
    maxWidth: '900px',
    margin: '0 auto 24px',
  },
  title: {
    fontSize: '16px',
    letterSpacing: '1px',
    color: '#E8A33D',
  },
  message: {
    maxWidth: '900px',
    margin: '0 auto',
    fontSize: '13px',
    color: '#9CA3AF',
  },
  grid: {
    maxWidth: '900px',
    margin: '0 auto',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '16px',
  },
  card: {
    display: 'block',
    background: '#12151C',
    border: '1px solid #262B36',
    borderRadius: '8px',
    overflow: 'hidden',
    textDecoration: 'none',
    color: 'inherit',
  },
  image: {
    width: '100%',
    aspectRatio: '4/3',
    objectFit: 'cover',
    display: 'block',
  },
  cardInfo: {
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  dateRange: {
    fontSize: '13px',
    color: '#E5E7EB',
  },
  placeName: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#E8A33D',
  },
  photoCount: {
    fontSize: '11px',
    color: '#6B7280',
  },
  loadMoreButton: {
    gridColumn: '1 / -1',
    background: 'transparent',
    border: '1px solid #2D3340',
    color: '#9CA3AF',
    borderRadius: '6px',
    padding: '10px',
    fontFamily: FONT_MONO,
    fontSize: '12px',
    cursor: 'pointer',
  },
};
