import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { api, ApiError, placeLabel, uploadSelfie, type Attendance } from '../api';
import { formatDistance } from '../geo';
import { Button, Problem, T } from '../ui';
import { color, font, space } from '../theme';

const GOOD_ACCURACY_M = 50; // wait for this before calling the location "found"
const GPS_PATIENCE_MS = 20_000; // after this, accept the best fix we have (server flags if weak)

type Trouble = { title: string; message: string; action: string; onAction: () => void };

type Verdict = { ok: true; text: string } | { ok: false; text: string };

const whereOf = (fix: Location.LocationObject, mocked: boolean) => ({
  lat: fix.coords.latitude,
  lng: fix.coords.longitude,
  accuracy_m: Math.min(50_000, Math.max(1, Math.round(fix.coords.accuracy ?? 50_000))),
  mocked,
});

export function Capture({ getToken, onDone, onCancel }: {
  getToken: () => Promise<string>;
  onDone: (saved: Attendance | null) => void;
  onCancel: () => void;
}) {
  const inset = useSafeAreaInsets();
  const cam = useRef<CameraView>(null);
  const [, requestCamera] = useCameraPermissions();
  const [phase, setPhase] = useState<'checking' | 'camera' | 'preview' | 'sending'>('checking');
  const [trouble, setTrouble] = useState<Trouble | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);

  // Location runs while the person frames the selfie, so it is usually ready by the time they shoot.
  const [fix, setFix] = useState<Location.LocationObject | null>(null);
  const [patienceOver, setPatienceOver] = useState(false);
  const [mocked, setMocked] = useState(false); // sticky: one fake reading is enough
  const watch = useRef<Location.LocationSubscription | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopGps = () => {
    watch.current?.remove();
    watch.current = null;
    if (timer.current) clearTimeout(timer.current);
  };

  const startGps = useCallback(async () => {
    stopGps();
    setFix(null);
    setPatienceOver(false);
    setMocked(false);
    watch.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 0 },
      (loc) => {
        if (loc.mocked) setMocked(true);
        // Take the newest reading once it's good (the person may be walking in), else keep the most accurate one.
        const acc = loc.coords.accuracy ?? Infinity;
        setFix((prev) => (!prev || acc <= GOOD_ACCURACY_M || acc <= (prev.coords.accuracy ?? Infinity) ? loc : prev));
      },
    );
    timer.current = setTimeout(() => setPatienceOver(true), GPS_PATIENCE_MS);
  }, []);

  const prepare = useCallback(async () => {
    setTrouble(null);
    const camera = await requestCamera();
    if (!camera.granted) {
      return setTrouble({
        title: 'Allow the camera',
        message: 'GeoMark needs the camera to take your attendance selfie.',
        action: camera.canAskAgain ? 'Allow camera' : 'Open settings',
        onAction: camera.canAskAgain ? () => void prepare() : () => void Linking.openSettings(),
      });
    }
    const where = await Location.requestForegroundPermissionsAsync();
    if (!where.granted) {
      return setTrouble({
        title: 'Allow location',
        message: 'GeoMark needs your location to check you are at the office.',
        action: where.canAskAgain ? 'Allow location' : 'Open settings',
        onAction: where.canAskAgain ? () => void prepare() : () => void Linking.openSettings(),
      });
    }
    if (!(await Location.hasServicesEnabledAsync())) {
      return setTrouble({
        title: 'Turn on location',
        message: 'Location is switched off on this phone. Turn it on, then come back and tap Try again.',
        action: 'Open location settings',
        onAction: () => void Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => Linking.openSettings()),
      });
    }
    setPhase('camera');
    await startGps();
  }, [requestCamera, startGps]);

  // Run once on open. (prepare's deps can change identity per render; re-running would restart GPS.)
  useEffect(() => {
    void prepare();
    return stopGps;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accuracy = fix?.coords.accuracy ?? null;
  const locationReady = !!fix && ((accuracy ?? Infinity) <= GOOD_ACCURACY_M || patienceOver);
  const noLocationAtAll = patienceOver && !fix;

  // The SERVER decides where you may check in (all your offices, branches, home) and logs blocked attempts.
  // Asked once as soon as GPS is good; "Check again" re-asks with the latest reading.
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const asked = useRef(false);
  const ask = useCallback(async (f: Location.LocationObject, mk: boolean) => {
    try {
      const r = await api<{ site: { name: string; kind: 'office' | 'home' }; distance_m: number }>(await getToken(), '/attendance/check', whereOf(f, mk));
      setVerdict({
        ok: true,
        text: r.site.kind === 'home' ? 'Location found · at Home (WFH)' : `Location found · ${formatDistance(r.distance_m)} from ${placeLabel(r.site.name, r.site.kind)}`,
      });
    } catch (e) {
      setVerdict({ ok: false, text: e instanceof ApiError ? e.message : 'Could not check your location. Please try again.' });
    }
  }, [getToken]);
  useEffect(() => {
    if (locationReady && fix && !asked.current) {
      asked.current = true;
      void ask(fix, mocked);
    }
  }, [locationReady, fix, mocked, ask]);
  const askAgain = () => {
    if (!fix) return;
    setVerdict(null);
    void ask(fix, mocked);
  };

  const blocked: string | null = mocked ? 'A fake-location app is on. Turn it off to mark attendance.' : verdict && !verdict.ok ? verdict.text : null;
  const allowed = !mocked && verdict?.ok === true;

  async function shoot() {
    const pic = await cam.current?.takePictureAsync({ quality: 0.8 });
    if (!pic) return;
    const rendered = await ImageManipulator.manipulate(pic.uri).resize({ width: 720, height: null }).renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
    setPhoto(saved.uri);
    setPhase('preview');
  }

  async function submit() {
    if (!photo || !fix) return;
    setPhase('sending');
    setTrouble(null);
    try {
      const token = await getToken();
      const file = new File(photo);
      const where = whereOf(fix, mocked);
      const { url, key } = await api<{ url: string; key: string }>(token, '/selfie-upload-url', { bytes: file.size, ...where });
      await uploadSelfie(url, file);
      const { attendance } = await api<{ attendance: Attendance }>(token, '/attendance', { ...where, photo_key: key });
      stopGps();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone(attendance);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'already_marked') return onDone(null);
      if (e instanceof ApiError && (e.code === 'face_unclear' || e.code === 'face_multiple')) {
        // The server already deleted that selfie; go straight back to the camera.
        setPhoto(null);
        setCameraReady(false);
        setPhase('camera');
        setTrouble({
          title: e.code === 'face_unclear' ? 'We couldn’t see your face' : 'Only you in the selfie, please',
          message: e.message,
          action: 'Take it again',
          onAction: () => setTrouble(null),
        });
        return;
      }
      setPhase('preview');
      setTrouble({
        title: e instanceof ApiError && e.code === 'offline' ? 'No internet' : e instanceof ApiError && e.status === 403 ? "Can't mark attendance here" : 'Could not mark attendance',
        message: e instanceof ApiError ? e.message : 'Something went wrong. Please try again.',
        action: 'Try again',
        onAction: () => void submit(),
      });
    }
  }

  if (trouble) return <Problem {...trouble} secondary="Go back" onSecondary={onCancel} />;
  if (noLocationAtAll) {
    return (
      <Problem
        title="Can't find your location"
        message="Move near a window or step outside, then try again."
        action="Try again"
        onAction={() => void startGps()}
        secondary="Go back"
        onSecondary={onCancel}
      />
    );
  }

  const locationLine = !fix
    ? 'Finding your location…'
    : locationReady
      ? 'Location found'
      : `Finding your location… (within ${Math.round(accuracy ?? 0)} m)`;

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={{ flex: 1 }}>
        {phase === 'camera' ? (
          <>
            <CameraView ref={cam} style={StyleSheet.absoluteFill} facing="front" onCameraReady={() => setCameraReady(true)} />
            <View pointerEvents="none" style={st.ovalWrap}>
              <View style={st.oval} />
              <T style={st.hint}>Look at the camera</T>
            </View>
          </>
        ) : photo ? (
          <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel="Your selfie" />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={() => { stopGps(); onCancel(); }}
          style={[st.cancel, { top: inset.top + space.sm }]}
        >
          <T style={{ color: '#fff', fontFamily: font.bodyBold }}>Cancel</T>
        </Pressable>
      </View>

      <View style={[st.panel, { paddingBottom: inset.bottom + space.xl }]}>
        {blocked ? (
          <View style={st.blocked} accessibilityLiveRegion="assertive">
            <T style={{ color: color.danger, fontFamily: font.bodyBold }}>{blocked}</T>
            {!mocked ? (
              <Pressable accessibilityRole="button" onPress={askAgain} style={{ minHeight: 48, justifyContent: 'center' }}>
                <T style={{ color: color.danger, fontFamily: font.bodyBold, textDecorationLine: 'underline' }}>Check again</T>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={st.locRow} accessibilityLiveRegion="polite">
            <View style={[st.dot, { backgroundColor: allowed ? color.present : color.line }]} />
            <T style={{ color: allowed ? color.present : color.muted, fontFamily: font.bodyBold }}>
              {allowed ? verdict.text : locationReady ? 'Checking your location…' : locationLine}
            </T>
          </View>
        )}

        {phase === 'camera' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take selfie"
            disabled={!cameraReady || !!blocked}
            onPress={() => void shoot()}
            style={({ pressed }) => [st.shutter, { opacity: cameraReady && !blocked ? 1 : 0.35 }, pressed && { transform: [{ scale: 0.95 }] }]}
          >
            <View style={st.shutterInner} />
          </Pressable>
        ) : (
          <>
            <Button
              label={allowed ? 'Use this photo' : blocked ? 'Not allowed here' : 'Waiting for location…'}
              onPress={() => void submit()}
              busy={phase === 'sending'}
              disabled={!allowed}
            />
            <Button label="Take again" kind="secondary" disabled={phase === 'sending'} onPress={() => { setPhoto(null); setCameraReady(false); setPhase('camera'); }} />
          </>
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  ovalWrap: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  oval: { width: '68%', aspectRatio: 3 / 4, borderRadius: 999, borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)' },
  hint: { color: '#fff', fontFamily: font.bodyBold, textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  cancel: { position: 'absolute', left: space.lg, minHeight: 56, minWidth: 56, justifyContent: 'center', paddingHorizontal: space.sm },
  panel: { backgroundColor: color.surface, paddingTop: space.xl, paddingHorizontal: space.xl, gap: space.lg, alignItems: 'stretch' },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 12, height: 12, borderRadius: 6 },
  blocked: { backgroundColor: color.dangerTint, borderRadius: 12, padding: space.md },
  shutter: { alignSelf: 'center', width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: color.present, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 62, height: 62, borderRadius: 31, backgroundColor: color.present },
});
