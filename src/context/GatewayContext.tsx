import {
  createContext,
  useContext,
  useEffect,
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
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [client, setClient] = useState<OpenClawClient | null>(null);
  const [snapshot, setSnapshot] = useState<GatewaySnapshot | null>(null);
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  const setToken = (t: string) => {
    OpenClawClient.setStoredToken(t);
    setTokenState(t);
  };

  useEffect(() => {
    if (!token) {
      setStatus('disconnected');
      setClient(null);
      setSnapshot(null);
      setServerVersion(null);
      return;
    }

    const c = new OpenClawClient(token);
    setClient(c);

    const unsub = c.onStatus((s) => {
      setStatus(s);
      if (s === 'connected') {
        setSnapshot(c.snapshot);
        setServerVersion(c.serverVersion);
      }
    });

    c.connect();

    return () => {
      unsub();
      c.destroy();
      setClient(null);
    };
  }, [token]);

  return (
    <GatewayContext.Provider value={{ client, status, snapshot, serverVersion, token, setToken }}>
      {children}
    </GatewayContext.Provider>
  );
}

export function useGateway() {
  return useContext(GatewayContext);
}
