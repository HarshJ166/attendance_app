import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Auth0Provider, useAuth0 } from 'react-native-auth0';
import { AnekLatin_600SemiBold } from '@expo-google-fonts/anek-latin/600SemiBold';
import { AnekLatin_700Bold } from '@expo-google-fonts/anek-latin/700Bold';
import { SourceSans3_400Regular } from '@expo-google-fonts/source-sans-3/400Regular';
import { SourceSans3_600SemiBold } from '@expo-google-fonts/source-sans-3/600SemiBold';
import { api, ApiError, type Attendance, type Me } from './src/api';
import { Problem } from './src/ui';
import { color } from './src/theme';
import { Login } from './src/screens/Login';
import { Consent } from './src/screens/Consent';
import { Home } from './src/screens/Home';
import { Capture } from './src/screens/Capture';
import { CalendarTab } from './src/screens/CalendarTab';
import { Stats } from './src/screens/Stats';
import { Profile } from './src/screens/Profile';
import { TabBar, type Tab } from './src/TabBar';

const auth0 = Constants.expoConfig?.extra?.auth0 as { domain: string; clientId: string; audience: string };
const CUSTOM_SCHEME = 'geomark'; // must match the react-native-auth0 plugin in app.json and Auth0 callback URLs

export default function App() {
  const [fontsLoaded] = useFonts({ AnekLatin_600SemiBold, AnekLatin_700Bold, SourceSans3_400Regular, SourceSans3_600SemiBold, ...Ionicons.font });
  if (!fontsLoaded) return null;
  return (
    <SafeAreaProvider>
      <Auth0Provider domain={auth0.domain} clientId={auth0.clientId}>
        <StatusBar style="dark" />
        <Main />
      </Auth0Provider>
    </SafeAreaProvider>
  );
}

// Login → Consent → four tabs (+ full-screen camera). Plain state instead of a router (see AGENTS.md note).
function Main() {
  const { authorize, clearSession, getCredentials, user, isLoading } = useAuth0();
  const [me, setMe] = useState<Me | null>(null);
  const [today, setToday] = useState<Attendance | null>(null);
  const [tab, setTab] = useState<Tab>('today');
  const [capturing, setCapturing] = useState(false);
  const [problem, setProblem] = useState<ApiError | null>(null);

  const getToken = useCallback(async () => {
    const creds = await getCredentials();
    if (!creds?.accessToken) throw new ApiError(401, 'unauthenticated', 'Please log in again.');
    return creds.accessToken;
  }, [getCredentials]);

  const load = useCallback(async () => {
    setProblem(null);
    try {
      const token = await getToken();
      const [m, t] = await Promise.all([
        api<Me>(token, '/me'),
        api<{ attendance: Attendance | null }>(token, '/attendance/today'),
      ]);
      setMe(m);
      setToday(t.attendance);
    } catch (e) {
      setProblem(e instanceof ApiError ? e : new ApiError(401, 'unauthenticated', 'Please log in again.'));
    }
  }, [getToken]);

  useEffect(() => {
    if (user) void load();
    else {
      setMe(null);
      setToday(null);
      setTab('today');
      setCapturing(false);
    }
  }, [user, load]);

  const login = async () => {
    await authorize({ audience: auth0.audience, scope: 'openid profile email offline_access' }, { customScheme: CUSTOM_SCHEME });
  };
  const logout = async () => {
    setCapturing(false);
    setTab('today');
    setProblem(null);
    await clearSession({}, { customScheme: CUSTOM_SCHEME }).catch(() => undefined);
  };

  if (isLoading) return <Splash />;
  if (!user) return <Login onLogin={login} />;

  if (problem) {
    if (problem.status === 401) {
      return <Problem title="Please log in again" message="Your session has ended." action="Log in again" onAction={() => void logout()} />;
    }
    if (problem.status === 403) {
      return <Problem title="No access yet" message={problem.message} action="Log out" onAction={() => void logout()} />;
    }
    return (
      <Problem
        title={problem.code === 'offline' ? 'No internet' : 'Something went wrong'}
        message={problem.message}
        action="Try again"
        onAction={() => void load()}
        secondary="Log out"
        onSecondary={() => void logout()}
      />
    );
  }

  if (!me) return <Splash />;

  if (!me.consented_at) {
    return (
      <Consent
        onAgree={async () => {
          const r = await api<{ consented_at: string }>(await getToken(), '/consent', {});
          setMe({ ...me, consented_at: r.consented_at });
        }}
        onLogout={() => void logout()}
      />
    );
  }

  if (capturing && me.sites.length) {
    return (
      <Capture
        getToken={getToken}
        onCancel={() => setCapturing(false)}
        onDone={async (saved) => {
          if (saved) setToday(saved);
          setCapturing(false);
          if (!saved) await load(); // already marked elsewhere: fetch the real record
        }}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <View style={{ flex: 1 }}>
        {tab === 'today' ? <Home me={me} attendance={today} onMark={() => setCapturing(true)} /> : null}
        {tab === 'calendar' ? <CalendarTab getToken={getToken} /> : null}
        {tab === 'stats' ? <Stats getToken={getToken} /> : null}
        {tab === 'profile' ? <Profile me={me} onLogout={() => void logout()} /> : null}
      </View>
      <TabBar active={tab} onChange={setTab} />
    </View>
  );
}

function Splash() {
  return (
    <View style={{ flex: 1, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color={color.present} />
    </View>
  );
}
