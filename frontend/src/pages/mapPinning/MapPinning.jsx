
import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { Link } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

const API_BASE = import.meta.env.VITE_API_BASE_URL;
const FONT_MONO = "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace";

// Leaflet's default marker icons reference image files in a way that breaks
// under most bundlers (Vite included) unless explicitly re-pointed like this.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

function formatDateRange(start, end) {
  const opts = { month: 'short', day: 'numeric', year: 'numeric' };
  const s = new Date(start).toLocaleDateString('en-US', opts);
  const e = new Date(end).toLocaleDateString('en-US', opts);
  return s === e ? s : `${s} → ${e}`;
}

export default function MapView() {
  const [status, setStatus] = useState('loading');
  const [points, setPoints] = useState([]);

  useEffect(() => {
    fetch(`${API_BASE}/api/moments/map-points`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        setPoints(data.points);
        setStatus('loaded');
      })
      .catch(() => setStatus('error'));
  }, []);

  // Center the map on the average of all points, or a sensible default
  // (India) if there's nothing to show yet.
  const center =
    points.length > 0
      ? [
          points.reduce((sum, p) => sum + p.latitude, 0) / points.length,
          points.reduce((sum, p) => sum + p.longitude, 0) / points.length,
        ]
      : [20.5937, 78.9629];

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <span style={styles.title}>map</span>
      </header>

      {status === 'loading' && <p style={styles.message}>loading…</p>}
      {status === 'error' && <p style={styles.message}>couldn't load map points.</p>}
      {status === 'loaded' && points.length === 0 && (
        <p style={styles.message}>no located moments yet.</p>
      )}

      {status === 'loaded' && points.length > 0 && (
        <div style={styles.mapWrapper}>
          <MapContainer center={center} zoom={5} style={styles.map} scrollWheelZoom={true}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {points.map((p) => (
              <Marker key={p.id} position={[p.latitude, p.longitude]}>
                <Popup>
                  <div style={styles.popupContent}>
                    {p.cover_thumb_url && (
                      <img src={p.cover_thumb_url} alt="" style={styles.popupImage} />
                    )}
                    <div style={styles.popupPlace}>{p.place_name || 'Unknown location'}</div>
                    <div style={styles.popupMeta}>
                      {formatDateRange(p.start_date, p.end_date)} · {p.photo_count} photo{p.photo_count !== 1 ? 's' : ''}
                    </div>
                    <Link to={`/moments/${p.id}`} style={styles.popupLink}>view moment →</Link>
                  </div>
                </Popup>
              </Marker>
            ))}
          </MapContainer>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#0B0D12', fontFamily: FONT_MONO, padding: '32px 24px', color: '#E5E7EB' },
  header: { maxWidth: '1000px', margin: '0 auto 24px' },
  title: { fontSize: '16px', letterSpacing: '1px', color: '#E8A33D' },
  message: { maxWidth: '1000px', margin: '0 auto', fontSize: '13px', color: '#9CA3AF' },
  mapWrapper: { maxWidth: '1000px', margin: '0 auto', borderRadius: '8px', overflow: 'hidden', border: '1px solid #262B36' },
  map: { height: '70vh', width: '100%' },
  popupContent: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '160px' },
  popupImage: { width: '100%', aspectRatio: '4/3', objectFit: 'cover', borderRadius: '4px' },
  popupPlace: { fontWeight: 600, fontSize: '13px' },
  popupMeta: { fontSize: '11px', color: '#666' },
  popupLink: { fontSize: '12px', color: '#0B84FF', textDecoration: 'none' },
};
