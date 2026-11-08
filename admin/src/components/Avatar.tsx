/** Employee photo, or initials on a tint when there is none. */
export function Avatar({ name, url, size = 40 }: { name: string; url: string | null | undefined; size?: number }) {
  const initials = name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?';
  return url ? (
    <img src={url} alt="" width={size} height={size} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: 'none', background: 'var(--muted-tint)' }} />
  ) : (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: '50%', background: 'var(--present-tint)', color: 'var(--present)', display: 'inline-grid', placeItems: 'center', font: `600 ${Math.round(size * 0.38)}px var(--display)`, flex: 'none' }}>
      {initials}
    </span>
  );
}
