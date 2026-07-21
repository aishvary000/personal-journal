
import { useState, useEffect } from 'react';

const FONT_MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";

export default function OnThisDay() {
  const [status, setStatus] = useState('loading'); // 'loading' | 'loaded' | 'error'
  const [photos, setPhotos] = useState([]);
  const [range, setRange] = useState({ start: '', end: '' });

  useEffect(() => {
    // No query params = defaults to today on both the start and end, per the
    // backend's photosInRangeHandler — this is the plain "On This Day" case.
    fetch(`https://api.personal-journal.aishvary.dev/api/photos`, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('request failed');
        return res.json();
      })
      .then((data) => {
        setPhotos(data.photos);
        setRange({ start: data.start, end: data.end });
        setStatus('loaded');
      })
      .catch(() => setStatus('error'));
  }, []);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <span style={styles.title}>on this day</span>
        {range.start && <span style={styles.date}>{range.start}</span>}
      </header>

      {status === 'loading' && <p style={styles.message}>loading photos…</p>}
      {status === 'error' && <p style={styles.message}>couldn't load photos — try refreshing.</p>}
      {status === 'loaded' && photos.length === 0 && (
        <p style={styles.message}>nothing from this day in past years yet.</p>
      )}

      {status === 'loaded' && photos.length > 0 && (
        <div style={styles.grid}>
          {photos.map((p) => (
            <figure key={p.id} style={styles.card}>
              <img src={p.url} alt="" style={styles.image} loading="lazy" />
              <figcaption style={styles.caption}>
                {p.years_ago === 0 ? 'today' : `${p.years_ago} year${p.years_ago > 1 ? 's' : ''} ago`}
              </figcaption>
            </figure>
          ))}
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
    display: 'flex',
    alignItems: 'baseline',
    gap: '12px',
    maxWidth: '900px',
    margin: '0 auto 24px',
  },
  title: {
    fontSize: '16px',
    letterSpacing: '1px',
    color: '#E8A33D',
  },
  date: {
    fontSize: '13px',
    color: '#6B7280',
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
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '16px',
  },
  card: {
    margin: 0,
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
    color: '#6B7280',
  },
};
