import { useState } from 'react';
import { Button, Screen, T } from '../ui';
import { color, font } from '../theme';

/** DPDP notice. Agreement is recorded on the server (POST /consent) with a timestamp. */
export function Consent({ onAgree, onLogout }: { onAgree: () => Promise<void>; onLogout: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function agree() {
    setBusy(true);
    setError(null);
    try {
      await onAgree();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={
        <>
          <Button label="I agree" onPress={agree} busy={busy} />
          <Button label="Log out" kind="secondary" onPress={onLogout} />
        </>
      }
    >
      <T kind="title">Before you start</T>
      <T>
        GeoMark takes a photo of you and checks your location only when you tap{' '}
        <T style={{ fontFamily: font.bodyBold }}>Mark attendance</T>.
      </T>
      <T>It is used only to record your attendance for HR.</T>
      <T>
        To confirm it is really you, your selfie is compared with the profile photo HR keeps for you (face matching).
        Only the comparison result is stored with your attendance.
      </T>
      <T>Check-in selfies are deleted automatically after 90 days. Your profile photo and face data are deleted when you leave.</T>
      {error ? <T style={{ color: color.danger }}>{error}</T> : null}
    </Screen>
  );
}
