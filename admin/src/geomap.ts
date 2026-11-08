import L from 'leaflet';

/**
 * One small map API for the admin panel. Uses Mappls (Indian street detail) when VITE_MAPPLS_KEY is set
 * and the SDK loads; otherwise, or if Mappls fails (network, wallet empty, key revoked), OpenStreetMap via Leaflet.
 * Points are HTML markers in both engines; hover text is the element's `title`.
 */

export type LL = { lat: number; lng: number };
export type Handle = { move(p: LL, radius?: number): void };
export type GeoMap = {
  engine: 'mappls' | 'osm';
  /** Fit points (with an optional radius in metres around each) into view, without animation. */
  fit(points: (LL & { r?: number })[], maxZoom: number): void;
  /** Circle of `radius` metres: the allowed area of a place, or a GPS accuracy ring. */
  area(p: LL, radius: number, s: { color: string; fillOpacity: number; opacity?: number; stroke?: boolean }): Handle;
  /** HTML marker centred on the point (see `dot`). */
  marker(p: LL, html: string, onDragEnd?: (p: LL) => void): Handle;
  dashed(a: LL, b: LL, color: string): void;
  onClick(cb: (p: LL) => void): void;
  remove(): void;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Round dot, optional permanent label to its right; `title` shows on hover. */
export function dot(o: { size: number; fill: string; ring?: string; ringW?: number; hollow?: boolean; title?: string; label?: string; className?: string }) {
  const style = `width:${o.size}px;height:${o.size}px;background:${o.hollow ? 'transparent' : o.fill};border:${o.ringW ?? 2}px solid ${o.ring ?? '#fff'}`;
  return `<div class="gm-dot ${o.className ?? ''}" style="${style}"${o.title ? ` title="${esc(o.title)}"` : ''}>${o.label ? `<span class="gm-label">${esc(o.label)}</span>` : ''}</div>`;
}
/** A text chip centred on the point (e.g. a distance on a line). */
export const chip = (text: string) => `<div class="gm-chip">${esc(text)}</div>`;

function boundsOf(points: (LL & { r?: number })[]) {
  let s = 90, w = 180, n = -90, e = -180;
  for (const p of points) {
    const dLat = (p.r ?? 0) / 111_320, dLng = (p.r ?? 0) / (111_320 * Math.cos((p.lat * Math.PI) / 180));
    s = Math.min(s, p.lat - dLat); n = Math.max(n, p.lat + dLat);
    w = Math.min(w, p.lng - dLng); e = Math.max(e, p.lng + dLng);
  }
  return { s, w, n, e };
}

// ---------- Mappls ----------

type MapplsMap = {
  addListener(ev: string, cb: (e: { lngLat: LL }) => void): void;
  fitBounds(b: [[number, number], [number, number]], o: object): void;
  jumpTo(o: { center: [number, number]; zoom: number }): void;
  remove(): void;
};
type MapplsMarker = { setLngLat(p: [number, number]): void; getLngLat(): LL; getElement(): HTMLElement; on(ev: string, cb: () => void): void };
declare global {
  interface Window {
    mappls?: {
      Map: new (id: string, o: object) => MapplsMap;
      Marker: new (o: object) => MapplsMarker;
      Circle: new (o: object) => object;
      Polyline: new (o: object) => object;
      remove(o: { map: MapplsMap; layer: object }): void;
    };
  }
}

let sdk: Promise<boolean> | null = null;
function loadMappls(): Promise<boolean> {
  const key = import.meta.env.VITE_MAPPLS_KEY?.trim();
  if (!key) return Promise.resolve(false);
  return (sdk ??= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `https://sdk.mappls.com/map/sdk/web?v=3.0&access_token=${encodeURIComponent(key)}`;
    s.onload = () => resolve(!!window.mappls?.Map);
    s.onerror = () => resolve(false);
    setTimeout(() => resolve(false), 10_000);
    document.head.append(s);
  }));
}

let ids = 0;
// Mappls (MapLibre) uses 512 px tiles: its zoom z shows what Leaflet's z+1 shows. Callers speak Leaflet zoom.
const Z = (z: number) => z - 1;
async function mapplsMap(el: HTMLElement, center: LL, zoom: number, scrollZoom: boolean): Promise<GeoMap | null> {
  const mp = window.mappls!;
  el.id ||= `gm-${++ids}`;
  const map = new mp.Map(el.id, { center: { lat: center.lat, lng: center.lng }, zoom: Z(zoom), scrollZoom, scrollWheel: scrollZoom, zoomControl: true });
  const loaded = await new Promise<boolean>((ok) => {
    map.addListener('load', () => ok(true));
    setTimeout(() => ok(false), 10_000);
  });
  if (!loaded) {
    map.remove();
    el.replaceChildren();
    return null;
  }
  return {
    engine: 'mappls',
    fit(points, maxZoom) {
      const b = boundsOf(points);
      map.fitBounds([[b.w, b.s], [b.e, b.n]], { padding: 32, maxZoom: Z(maxZoom), animate: false });
    },
    area(p, radius, s) {
      const draw = (c: LL, r: number) =>
        new mp.Circle({ map, center: c, radius: r, fillColor: s.color, fillOpacity: s.fillOpacity, strokeColor: s.color, strokeOpacity: s.stroke === false ? 0 : s.opacity ?? 1, strokeWeight: s.stroke === false ? 0 : 2 });
      let layer = draw(p, radius), r0 = radius;
      return {
        move(c, r = r0) {
          mp.remove({ map, layer });
          layer = draw(c, (r0 = r));
        },
      };
    },
    marker(p, html, onDragEnd) {
      const m = new mp.Marker({ map, position: p, html, draggable: !!onDragEnd });
      Object.assign(m.getElement().style, { width: '0px', height: '0px', backgroundImage: 'none' }); // our HTML centres itself
      if (onDragEnd) m.on('dragend', () => onDragEnd(m.getLngLat()));
      return { move: (c) => m.setLngLat([c.lng, c.lat]) };
    },
    dashed: (a, b, color) => void new mp.Polyline({ map, path: [a, b], strokeColor: color, strokeOpacity: 0.7, strokeWeight: 2, dasharray: [2, 2] }),
    onClick: (cb) => map.addListener('click', (e) => cb(e.lngLat)),
    remove: () => map.remove(),
  };
}

// ---------- OpenStreetMap (Leaflet) ----------

function osmMap(el: HTMLElement, center: LL, zoom: number, scrollZoom: boolean): GeoMap {
  // View first, without animation: Leaflet attaches layers only once a view exists (else _leaflet_pos throws).
  const map = L.map(el, { scrollWheelZoom: scrollZoom }).setView([center.lat, center.lng], zoom, { animate: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
  const icon = (html: string) => L.divIcon({ className: '', html, iconSize: [0, 0] });
  return {
    engine: 'osm',
    fit(points, maxZoom) {
      const b = boundsOf(points);
      map.fitBounds([[b.s, b.w], [b.n, b.e]], { padding: [32, 32], maxZoom, animate: false });
    },
    area(p, radius, s) {
      const c = L.circle([p.lat, p.lng], { radius, color: s.color, weight: 2, opacity: s.opacity ?? 1, stroke: s.stroke !== false, fillColor: s.color, fillOpacity: s.fillOpacity }).addTo(map);
      return { move: (q, r) => void c.setLatLng([q.lat, q.lng]).setRadius(r ?? c.getRadius()) };
    },
    marker(p, html, onDragEnd) {
      const m = L.marker([p.lat, p.lng], { icon: icon(html), draggable: !!onDragEnd }).addTo(map);
      if (onDragEnd) m.on('dragend', () => onDragEnd(m.getLatLng()));
      return { move: (c) => void m.setLatLng([c.lat, c.lng]) };
    },
    dashed: (a, b, color) => void L.polyline([[a.lat, a.lng], [b.lat, b.lng]], { color, weight: 2, dashArray: '6 6', opacity: 0.7 }).addTo(map),
    onClick: (cb) => void map.on('click', (e: L.LeafletMouseEvent) => cb(e.latlng)),
    remove: () => void map.remove(),
  };
}

/** Mappls if available, else OpenStreetMap. Returns null if `cancelled()` turns true while loading. */
export async function openMap(el: HTMLElement, o: { center: LL; zoom: number; scrollZoom?: boolean }, cancelled = () => false): Promise<GeoMap | null> {
  const scroll = o.scrollZoom ?? true;
  if (await loadMappls()) {
    if (cancelled()) return null;
    const m = await mapplsMap(el, o.center, o.zoom, scroll).catch(() => null);
    if (m && cancelled()) return m.remove(), null;
    if (m) return m;
  }
  return cancelled() ? null : osmMap(el, o.center, o.zoom, scroll);
}

/**
 * React helper: build a map in `el`, call `draw` once it is ready, and remove it on cleanup
 * (also when the component unmounts before the async Mappls load finishes).
 */
export function mountMap(el: HTMLElement, o: Parameters<typeof openMap>[1], draw: (m: GeoMap) => void): () => void {
  let map: GeoMap | null = null, gone = false;
  void openMap(el, o, () => gone).then((m) => {
    if (!m) return;
    el.dataset.map = m.engine; // 'mappls' | 'osm' (QA and debugging)
    draw((map = m));
  });
  return () => {
    gone = true;
    map?.remove();
  };
}
