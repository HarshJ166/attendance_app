import { useEffect, useState } from 'react';
import { useApi, type Place } from '../api';
import { parseCsv } from '../csv';

type Row = { line: number; name: string; email: string; employee_code: string; phone: string; designation: string; role: 'employee' | 'admin'; placeNames: string[]; siteIds: number[]; problems: string[] };
type Result = { row: Row; ok: boolean; link?: string; password?: string; error?: string };
const MAX = 200;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Excel-safe CSV cell: quoted, and never starting with = + - @ (formula injection). */
const cell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
};

const TEMPLATE = 'name,email,employee_code,phone,designation,role,places\n"Asha Patil",asha@example.com,JJ-101,9820000000,Field sales,employee,"Dahanukarwadi, Kandivali (W)"\n';

export function ImportEmployees({ sites, existing, onClose, onDone }: {
  sites: Place[];
  existing: { email: string | null }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const api = useApi();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);
  const offices = sites.filter((s) => s.kind === 'office');

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !running && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose, running]);

  async function read(file: File) {
    setFileErr(null);
    setResults([]);
    const table = parseCsv(await file.text());
    if (table.length < 2) return setFileErr('The file has no rows under the header.');
    const head = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
    const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
    const c = { name: col('name', 'full_name'), email: col('email', 'e-mail'), code: col('employee_code', 'code', 'emp_code'), phone: col('phone', 'mobile'), desig: col('designation', 'title'), role: col('role', 'access'), places: col('places', 'place', 'office', 'offices') };
    if (c.name < 0 || c.email < 0) return setFileErr('The header must have at least “name” and “email” columns. Download the template to see the format.');
    if (table.length - 1 > MAX) return setFileErr(`Up to ${MAX} people per file. This one has ${table.length - 1}.`);
    const taken = new Set(existing.map((e) => e.email?.toLowerCase()).filter(Boolean));
    const seen = new Set<string>();
    const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    setRows(table.slice(1).map((r, i) => {
      const email = get(r, c.email).toLowerCase();
      const placeNames = get(r, c.places).split(/[;|]/).map((x) => x.trim()).filter(Boolean);
      const siteIds = placeNames.map((n) => offices.find((o) => o.name.toLowerCase() === n.toLowerCase())?.id).filter((x): x is number => !!x);
      const roleRaw = get(r, c.role).toLowerCase();
      const problems: string[] = [];
      if (!get(r, c.name)) problems.push('name missing');
      if (!EMAIL.test(email)) problems.push('email missing or invalid');
      else if (taken.has(email)) problems.push('already an employee');
      else if (seen.has(email)) problems.push('email repeated in this file');
      seen.add(email);
      const unknown = placeNames.filter((n) => !offices.some((o) => o.name.toLowerCase() === n.toLowerCase()));
      if (unknown.length) problems.push(`unknown place: ${unknown.join(', ')}`);
      return {
        line: i + 2, name: get(r, c.name), email, employee_code: get(r, c.code), phone: get(r, c.phone), designation: get(r, c.desig),
        role: roleRaw === 'admin' || roleRaw === 'hr' ? 'admin' : 'employee', placeNames, siteIds, problems,
      };
    }));
  }

  const ready = (rows ?? []).filter((r) => !r.problems.length);

  async function run() {
    setRunning(true);
    const out: Result[] = [];
    for (const row of ready) {
      try {
        const r = await api<{ password: string | null; set_password_link: string | null }>('/admin/employees', {
          body: { name: row.name, email: row.email, employee_code: row.employee_code || null, phone: row.phone || null, designation: row.designation || null, role: row.role, site_ids: row.siteIds },
        });
        out.push({ row, ok: true, link: r.set_password_link ?? undefined, password: r.password ?? undefined });
      } catch (e) {
        out.push({ row, ok: false, error: (e as Error).message });
      }
      setResults([...out]); // live progress
    }
    setRunning(false);
    onDone();
  }

  const done = results.length > 0 && !running;
  const created = results.filter((r) => r.ok);

  return (
    <>
      <div className="scrim" onClick={() => !running && onClose()} />
      <aside className="panel" role="dialog" aria-modal="true" aria-label="Import employees" style={{ width: 'min(860px, 100vw)' }}>
        <div className="panel-head">
          <h2>Import employees from CSV</h2>
          <button className="btn secondary small" onClick={onClose} disabled={running}>Close</button>
        </div>

        {!rows || fileErr ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ margin: 0 }}>One row per person. Columns: <span className="mono">name, email, employee_code, phone, designation, role, places</span>. Only name and email are required. <span className="mono">role</span> is <i>employee</i> (default) or <i>admin</i>. <span className="mono">places</span> are office names from the Places page, separated by <span className="mono">;</span>.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <label className="btn">
                Choose CSV file
                <input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
              </label>
              <button className="btn secondary" onClick={() => download('geomark-employees-template.csv', TEMPLATE)}>Download template</button>
            </div>
            {fileErr ? <div className="notice error">{fileErr}</div> : null}
            <p className="small muted" style={{ margin: 0 }}>Nothing is created until you review the list and press “Create logins”. Each person gets a real GeoMark login with the company default password (they can change it in the app).</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            <div className="summary" style={{ fontSize: 17 }}>
              <b>{rows.length}</b> rows · <b>{ready.length}</b> ready · <b>{rows.length - ready.length}</b> with problems (skipped)
            </div>
            <div className="table-wrap" style={{ maxHeight: 360 }}>
              <table className="list">
                <thead><tr><th>Line</th><th>Name</th><th>Email</th><th>Designation</th><th>Access</th><th>Places</th><th>Result</th></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const res = results.find((x) => x.row === r);
                    return (
                      <tr key={r.line} style={{ cursor: 'default' }}>
                        <td className="num muted">{r.line}</td>
                        <td>{r.name || '–'}</td>
                        <td className="small">{r.email || '–'}</td>
                        <td className="small">{r.designation || '–'}</td>
                        <td className="small">{r.role === 'admin' ? 'HR admin' : 'Employee'}</td>
                        <td className="small">{r.placeNames.join(', ') || <span className="muted">none</span>}</td>
                        <td className="small">
                          {r.problems.length ? <span className="chip absent">{r.problems.join('; ')}</span>
                            : res ? (res.ok ? <span className="chip present">✓ created</span> : <span className="chip absent">{res.error}</span>)
                            : running ? <span className="muted">waiting…</span> : <span className="chip off">ready</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {!done ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="btn" disabled={running || !ready.length} onClick={() => void run()}>
                  {running ? `Creating ${results.length + 1} of ${ready.length}…` : `Create ${ready.length} ${ready.length === 1 ? 'login' : 'logins'}`}
                </button>
                <button className="btn secondary" disabled={running} onClick={() => setRows(null)}>Choose another file</button>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                <div className="notice" style={{ background: 'var(--present-tint)', color: 'var(--present)' }}>
                  ✓ {created.length} {created.length === 1 ? 'login' : 'logins'} created{results.length - created.length ? `, ${results.length - created.length} failed (see the list)` : ''}.
                </div>
                {created.length && created[0].password ? (
                  <p style={{ margin: 0 }}>Everyone logs in to the GeoMark app with their email and the company default password <b className="mono">{created[0].password}</b>. They can change it in the app: Profile → Change password.</p>
                ) : created.length ? (
                  <div>
                    <button className="btn" onClick={() => download('geomark-set-password-links.csv',
                      ['name,email,set_password_link (valid 7 days)', ...created.map((r) => [r.row.name, r.row.email, r.link!].map(cell).join(','))].join('\r\n'))}>
                      Download set-password links (CSV)
                    </button>
                    <p className="small muted">Send each person their own link. These links aren’t shown again; you can make a new one from their profile.</p>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )}
      </aside>
    </>
  );
}
