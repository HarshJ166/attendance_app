import { useState } from 'react';
import { View } from 'react-native';
import { Button, Screen, T } from '../ui';
import { color, font, space } from '../theme';

export function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login() {
    setBusy(true);
    setError(null);
    try {
      await onLogin();
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? '');
      // Closing the browser is not an error the person needs to read about.
      if (!/cancel/i.test(msg)) setError('Could not log in. Check your internet and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen footer={<Button label="Log in" onPress={login} busy={busy} />}>
      <View style={{ flex: 1, justifyContent: 'center', gap: space.md }}>
        <T style={{ fontFamily: font.displayBold, fontSize: 48, lineHeight: 54, color: color.present }}>GeoMark</T>
        <T>Mark your attendance with a selfie, once a day.</T>
        {error ? <T style={{ color: color.danger }}>{error}</T> : null}
      </View>
    </Screen>
  );
}
