import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from './ui';
import { color, font } from './theme';

export type Tab = 'today' | 'calendar' | 'stats' | 'profile';

const TABS: { key: Tab; label: string; icon: 'today' | 'calendar' | 'stats-chart' | 'person-circle' }[] = [
  { key: 'today', label: 'Today', icon: 'today' },
  { key: 'calendar', label: 'Calendar', icon: 'calendar' },
  { key: 'stats', label: 'Stats', icon: 'stats-chart' },
  { key: 'profile', label: 'Profile', icon: 'person-circle' },
];

/** Bottom tabs: icon + word (never icon-only), 64 tall, safe-area aware. */
export function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const inset = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: 'row', backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.line, paddingBottom: inset.bottom }}
    >
      {TABS.map((t) => {
        const on = t.key === active;
        const tint = on ? color.present : color.muted;
        return (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(t.key)}
            style={{ flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 2 }}
          >
            <Ionicons name={on ? t.icon : `${t.icon}-outline`} size={26} color={tint} />
            <T style={{ fontSize: 13, lineHeight: 16, color: tint, fontFamily: on ? font.bodyBold : font.body }}>{t.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}
