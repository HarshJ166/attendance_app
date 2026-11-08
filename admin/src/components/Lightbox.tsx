import { useEffect, useRef } from 'react';

/** Full-screen photo viewer: Esc, the Close button, or a click outside the photo closes it. */
export function Lightbox({ src, alt, caption, onClose }: { src: string; alt: string; caption?: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation(); // close the viewer, not the panel underneath
        onClose();
      }
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onClose]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={alt} onClick={onClose}>
      <figure onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={alt} />
        {caption ? <figcaption>{caption}</figcaption> : null}
      </figure>
      <div className="lightbox-actions" onClick={(e) => e.stopPropagation()}>
        <a className="btn secondary small" href={src} target="_blank" rel="noreferrer">Open original ↗</a>
        <button ref={close} className="btn small" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
