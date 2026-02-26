import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from './useAuth';

const SocketContext = createContext<Socket | null>(null);

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  useEffect(() => {
    if (ready && user) {
      const s = io(import.meta.env.VITE_SOCKET_BASE_URL || '', {
        withCredentials: true,
      });
      setSocket(s);
      return () => {
        s.disconnect();
      };
    }
  }, [ready, user]);
  return <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}