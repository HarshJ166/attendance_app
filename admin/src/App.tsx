import { useAuth0 } from '@auth0/auth0-react';
import { useEffect, useState } from 'react';
import { useLoad } from './api';
import { PageGuard } from './components/PageGuard';
import { Icon } from './components/Icon';
import { Dashboard } from './pages/Dashboard';
import { EmployeeProfile } from './pages/EmployeeProfile';
import { Employees } from './pages/Employees';
import { Places } from './pages/Places';
import { Register } from './pages/Register';
import { Review } from './pages/Review';
import { Settings } from './pages/Settings';

type Page = { name: 'dashboard' | 'review' | 'employees' | 'employee' | 'places' | 'register' | 'settings'; id?: number };
function pageFromHash(): Page {
  const [, a, b] = location.hash.split('/'); // "#/employees/12" → ["#", "employees", "12"]
  if (a === 'employees' && b && /^\d+$/.test(b)) return { name: 'employee', id: Number(b) };
  if (a === 'review' || a === 'employees' || a === 'places' || a === 'register' || a === 'settings') return { name: a };
  return { name: 'dashboard' };
}
const NAV: { hash: string; label: string; icon: string; match: Page['name'][] }[] = [
  { hash: '#/', label: 'Dashboard', icon: 'dashboard', match: ['dashboard'] },
  { hash: '#/review', label: 'Review', icon: 'review', match: ['review'] },
  { hash: '#/employees', label: 'Employees', icon: 'employees', match: ['employees', 'employee'] },
  { hash: '#/places', label: 'Places', icon: 'places', match: ['places'] },
  { hash: '#/register', label: 'Register', icon: 'register', match: ['register'] },
  { hash: '#/settings', label: 'Settings', icon: 'settings', match: ['settings'] },
];

// Remembered per browser; storage can be blocked (private mode), so never let it break the panel.
const readCollapsed = () => { try { return localStorage.getItem('geomark.nav') === 'collapsed'; } catch { return false; } };
const saveCollapsed = (v: boolean) => { try { localStorage.setItem('geomark.nav', v ? 'collapsed' : 'open'); } catch { /* ignore */ } };

export default function App() {
  const { isLoading, isAuthenticated, loginWithRedirect, logout, user, error } = useAuth0();

  if (isLoading) return <div className="center muted">Loading…</div>;
  if (!isAuthenticated) {
    return (
      <div className="center">
        <div className="login">
          <div className="brand">GeoMark <span className="brand-sub">HR panel</span></div>
          <p className="muted">Attendance, selfies and locations for your team. HR access only.</p>
          {error ? <div className="notice error">{error.message}</div> : null}
          <button className="btn" onClick={() => void loginWithRedirect()}>Log in</button>
        </div>
      </div>
    );
  }
  return <Shell name={user?.name ?? user?.email ?? ''} onLogout={() => void logout({ logoutParams: { returnTo: window.location.origin } })} />;
}

function Shell({ name, onLogout }: { name: string; onLogout: () => void }) {
  const [page, setPage] = useState<Page>(pageFromHash());
  useEffect(() => {
    const on = () => setPage(pageFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // One light request decides whether this person is HR, and feeds the review badge.
  const review = useLoad<{ items: unknown[] }>('/admin/review');

  if (review.error?.status === 403) {
    return (
      <div className="center">
        <div className="login">
          <div className="brand">GeoMark <span className="brand-sub">HR panel</span></div>
          <div className="notice error">This panel is for HR only. Your account doesn’t have admin access.</div>
          <button className="btn secondary" onClick={onLogout}>Log out</button>
        </div>
      </div>
    );
  }

  const pending = review.data?.items.length ?? 0;
  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
      <nav className="nav" aria-label="Main">
        <div className="nav-head">
          <div className="brand">
            <span className="brand-full">GeoMark <span className="brand-sub">HR panel</span></span>
            <span className="brand-mark" aria-hidden="true">G</span>
          </div>
          <button className="icon-btn nav-toggle" onClick={() => { setCollapsed(!collapsed); saveCollapsed(!collapsed); }}
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} title={collapsed ? 'Expand menu' : 'Collapse menu'}>
            <Icon name={collapsed ? 'expand' : 'collapse'} size={18} />
          </button>
        </div>
        {NAV.map((n) => (
          <a key={n.hash} href={n.hash} aria-current={n.match.includes(page.name) ? 'page' : undefined} title={collapsed ? n.label : undefined} aria-label={n.label}>
            <Icon name={n.icon} />
            <span className="nav-label">{n.label}</span>
            {n.label === 'Review' && pending ? <span className="count num" aria-label={`${pending} waiting`}>{pending}</span> : null}
          </a>
        ))}
        <div className="nav-foot">
          <div className="me" title={name}>
            <span className="me-initial" aria-hidden="true">{(name.trim()[0] ?? '?').toUpperCase()}</span>
            <span className="nav-label me-name">{name}</span>
          </div>
          <button className="icon-btn" onClick={onLogout} title="Log out" aria-label="Log out">
            <Icon name="logout" size={18} />
          </button>
        </div>
      </nav>
      <main>
        <PageGuard key={`${page.name}-${page.id ?? ''}`}>
        {page.name === 'dashboard' ? <Dashboard onReviewed={review.reload} /> : null}
        {page.name === 'review' ? <Review onReviewed={review.reload} /> : null}
        {page.name === 'employees' ? <Employees /> : null}
        {page.name === 'employee' && page.id ? <EmployeeProfile key={page.id} id={page.id} /> : null}
        {page.name === 'places' ? <Places /> : null}
        {page.name === 'register' ? <Register /> : null}
        {page.name === 'settings' ? <Settings /> : null}
        </PageGuard>
      </main>
    </div>
  );
}
