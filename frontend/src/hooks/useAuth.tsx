import React, { createContext, useContext, useEffect, useState } from 'react';
import { register as apiRegister, login as apiLogin, logout as apiLogout, getMe } from '../api';
import { saveKeys, loadKeys } from '../utils/storage';
import { useSodium } from './useSodium';

interface User {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  publicKey: string;
  curve25519PublicKey: string;
  servers: { id: string; name: string; iconUrl: string | null }[];
}

interface Keys {
  identityKey: string;
  identityPublicKey: string;
  curveSecretKey: string;
  curvePublicKey: string;
}

interface AuthContextProps {
  user: User | null;
  keys: Keys | null;
  ready: boolean;
  register: (args: { email: string; password: string; displayName: string }) => Promise<void>;
  login: (args: { email: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextProps | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const sodium = useSodium();
  const [user, setUser] = useState<User | null>(null);
  const [keys, setKeys] = useState<Keys | null>(null);
  const [ready, setReady] = useState<boolean>(false);

  // Load user and keys on mount
  useEffect(() => {
    async function init() {
      if (!sodium) return;
      try {
        const me = await getMe();
        setUser(me);
      } catch {
        setUser(null);
      }
      // load keys from storage
      const stored = loadKeys();
      if (stored) setKeys(stored);
      setReady(true);
    }
    init();
  }, [sodium]);

  async function generateKeys() {
    if (!sodium) throw new Error('Sodium not ready');
    // Identity key pair (Ed25519)
    const identityKeyPair = sodium.crypto_sign_keypair();
    // Curve25519 key pair for key agreement
    const curveKeyPair = sodium.crypto_kx_keypair();
    const newKeys: Keys = {
      identityKey: sodium.to_base64(identityKeyPair.privateKey),
      identityPublicKey: sodium.to_base64(identityKeyPair.publicKey),
      curveSecretKey: sodium.to_base64(curveKeyPair.privateKey),
      curvePublicKey: sodium.to_base64(curveKeyPair.publicKey),
    };
    saveKeys(newKeys);
    setKeys(newKeys);
    return newKeys;
  }

  async function registerWithServer({ email, password, displayName }: { email: string; password: string; displayName: string }) {
    if (!sodium) throw new Error('Sodium not ready');
    let currentKeys = keys;
    if (!currentKeys) {
      currentKeys = await generateKeys();
    }
    await apiRegister({
      email,
      password,
      displayName,
      publicKey: currentKeys.identityPublicKey,
      curve25519PublicKey: currentKeys.curvePublicKey,
    });
    const me = await getMe();
    setUser(me);
  }

  async function loginToServer({ email, password }: { email: string; password: string }) {
    await apiLogin({ email, password });
    const me = await getMe();
    setUser(me);
    // ensure keys are loaded
    const stored = loadKeys();
    if (stored) setKeys(stored);
  }

  async function logoutFromServer() {
    await apiLogout();
    setUser(null);
  }

  const value: AuthContextProps = {
    user,
    keys,
    ready: ready && !!sodium,
    register: registerWithServer,
    login: loginToServer,
    logout: logoutFromServer,
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}