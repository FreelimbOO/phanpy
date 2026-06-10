import Link from '../components/link';

export default function NotFound() {
  return (
    <div
      id="not-found-page"
      tabIndex="-1"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'var(--bg-color, #fff)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '1em',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '4em', margin: 0 }}>404</h1>
      <p style={{ margin: 0 }}>Page not found.</p>
      <p style={{ margin: 0 }}>
        <Link to="/">Go home</Link>
      </p>
    </div>
  );
}
