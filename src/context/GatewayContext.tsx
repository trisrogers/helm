import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  OpenClawClient,
  type ConnectionStatus,
  type GatewaySnapshot,
} from '../lib/openclaw-client';

interface GatewayContextValue {
  client: OpenClawClient | null;
  status: ConnectionStatus;
  snapshot: GatewaySnapshot | null;
  serverVersion: string | null;
  token: string;
  setToken: (t: string) => void;
}

const GatewayContext = createContext<GatewayContextValue>({
  client: null,
  status: 'disconnected',
  snapshot: null,
  serverVersion: null,
  token: '',
  setToken: () => {},
});

export function GatewayProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState(() => OpenClawClient.getStoredToken());
  // One client per token, created at render time. The effect below owns its
  // connection lifecycle (connect/subscribe/destroy); status/snapshot/version
  // are seeded from the client and refreshed by the subscription callback.
  // CONSTRAINT: destroy() is permanent, so this assumes the effect runs once
  // per client. A StrictMode setup/cleanup/setup with the same memoized client
  // would reconnect a dead client and stick at 'disconnected'. StrictMode is
  // deliberately off (see main.tsx, voice-react); revisit if that changes.
  const client = useMemo(() => (token ? new OpenClawClient(token) : null), [token]);
  const [status, setStatus] = useState<ConnectionStatus>(client?.status ?? 'disconnected');
  const [snapshot, setSnapshot] = useState<GatewaySnapshot | null>(client?.snapshot ?? null);
  const [serverVersion, setServerVersion] = useState<string | null>(client?.serverVersion ?? null);

  // Reset the derived state during render when the client changes (token swap or
  // sign-out), the React-endorsed alternative to resetting it inside an effect.
  const prevClient = useRef(client);
  if (prevClient.current !== client) {
    prevClient.current = client;
    setStatus(client?.status ?? 'disconnected');
    setSnapshot(client?.snapshot ?? null);
    setServerVersion(client?.serverVersion ?? null);
  }

  const setToken = (t: string) => {
    OpenClawClient.setStoredToken(t);
    setTokenState(t);
  };

  useEffect(() => {
    if (!client) return;

    const unsub = client.onStatus((s) => {
      setStatus(s);
      if (s === 'connected') {
        setSnapshot(client.snapshot);
        setServerVersion(client.serverVersion);
      }
    });

    client.connect();

    return () => {
      unsub();
      client.destroy();
    };
  }, [client]);

  return (
    <GatewayContext.Provider value={{ client, status, snapshot, serverVersion, token, setToken }}>
      {children}
    </GatewayContext.Provider>
  );
}

// Co-located with the provider on purpose; splitting it out would churn ~8
// screen imports for a Fast-Refresh-only lint with no runtime benefit.
// eslint-disable-next-line react-refresh/only-export-components
export function useGateway() {
  return useContext(GatewayContext);
}
