import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { api, ApiError, type Month } from './api';
import { T } from './ui';
import { color, font } from './theme';

export const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const shift = (month: string, by: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export const monthName = (month: string) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
export const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).toUpperCase();

/** One month of the signed-in person's attendance. Refetches when `month` changes. */
export function useMonth(month: string, getToken: () => Promise<string>) {
  const [state, setState] = useState<{ month: string; data?: Month; error?: string } | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api<Month>(await getToken(), `/attendance/month?month=${month}`);
        if (alive) setState({ month, data });
      } catch (e) {
        if (alive) setState({ month, error: e instanceof ApiError ? e.message : 'Could not load your attendance.' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [month, getToken]);
  const current = state?.month === month ? state : null; // never show last month's data under this month's title
  return { data: current?.data ?? null, error: current?.error ?? null, loading: !current };
}

/** ‹ November 2026 › (can't go past the current month). */
export function MonthHeader({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Arrow label="‹" a11y="Previous month" onPress={() => onChange(shift(month, -1))} />
      <T style={{ fontFamily: font.display, fontSize: 22, lineHeight: 28 }}>{monthName(month)}</T>
      <Arrow label="›" a11y="Next month" disabled={month >= thisMonth()} onPress={() => onChange(shift(month, 1))} />
    </View>
  );
}

function Arrow({ label, a11y, onPress, disabled = false }: { label: string; a11y: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : 1 }}
    >
      <T style={{ fontFamily: font.displayBold, fontSize: 32, lineHeight: 38, color: color.present }}>{label}</T>
    </Pressable>
  );
}
