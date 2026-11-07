import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type TextProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, font, radius, size, space } from './theme';

/** Screen with safe-area padding; `footer` sits at the bottom, where the thumb reaches. */
export function Screen({ children, footer, tabbed = false }: { children: ReactNode; footer?: ReactNode; tabbed?: boolean }) {
  const inset = useSafeAreaInsets();
  // Inside the tab bar, the bar already pads for the gesture area.
  return (
    <View style={[s.screen, { paddingTop: inset.top + space.xl, paddingBottom: tabbed ? space.lg : inset.bottom + space.xl }]}>
      <View style={s.content}>{children}</View>
      {footer ? <View style={s.footer}>{footer}</View> : null}
    </View>
  );
}

export function T({ style, kind = 'body', ...rest }: TextProps & { kind?: 'title' | 'body' | 'small' | 'status' | 'time' }) {
  return <Text {...rest} style={[s[kind], style]} />;
}

export function Button({
  label, onPress, kind = 'primary', busy = false, disabled = false,
}: { label: string; onPress: () => void; kind?: 'primary' | 'secondary'; busy?: boolean; disabled?: boolean }) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off, busy }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        kind === 'primary' ? s.primary : s.secondary,
        pressed && kind === 'primary' && { backgroundColor: color.presentPressed },
        pressed && kind === 'secondary' && { backgroundColor: color.mutedTint },
        off && { opacity: 0.55 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={kind === 'primary' ? '#fff' : color.present} />
      ) : (
        <Text style={[s.buttonText, kind === 'secondary' && { color: color.present }]}>{label}</Text>
      )}
    </Pressable>
  );
}

/** A plain-language problem with one way to fix it. */
export function Problem({
  title, message, action, onAction, secondary, onSecondary,
}: { title: string; message: string; action: string; onAction: () => void; secondary?: string; onSecondary?: () => void }) {
  return (
    <Screen
      footer={
        <>
          <Button label={action} onPress={onAction} />
          {secondary && onSecondary ? <Button label={secondary} kind="secondary" onPress={onSecondary} /> : null}
        </>
      }
    >
      <View style={[s.badge, { backgroundColor: color.dangerTint }]}>
        <Text style={[s.badgeGlyph, { color: color.danger }]}>!</Text>
      </View>
      <T kind="title">{title}</T>
      <T style={{ color: color.muted }}>{message}</T>
    </Screen>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingHorizontal: space.xl },
  content: { flex: 1, gap: space.md },
  footer: { gap: space.md },
  title: { fontFamily: font.display, fontSize: size.title, lineHeight: size.title * 1.2, color: color.ink },
  body: { fontFamily: font.body, fontSize: size.body, lineHeight: size.body * 1.4, color: color.ink },
  small: { fontFamily: font.body, fontSize: size.small, lineHeight: size.small * 1.4, color: color.muted },
  status: { fontFamily: font.displayBold, fontSize: size.status, lineHeight: size.status * 1.15, color: color.ink },
  time: { fontFamily: font.displayBold, fontSize: size.time, lineHeight: size.time * 1.1, color: color.ink, fontVariant: ['tabular-nums'] },
  button: { minHeight: 64, borderRadius: radius, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  primary: { backgroundColor: color.present },
  secondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: color.line },
  buttonText: { fontFamily: font.bodyBold, fontSize: size.button, color: '#fff' },
  badge: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  badgeGlyph: { fontFamily: font.displayBold, fontSize: 36, lineHeight: 44 },
});
