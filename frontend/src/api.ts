const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

async function handleResponse(res: Response) {
  if (!res.ok) {
    const text = await res.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = { error: text || 'Request failed' }; }
    throw payload;
  }
  return res.json();
}

export async function register(user: {
  email: string;
  password: string;
  displayName: string;
  publicKey: string;
  curve25519PublicKey: string;
}) {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });
  return handleResponse(res);
}

export async function login(user: { email: string; password: string }) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(user),
  });
  return handleResponse(res);
}

export async function logout() {
  const res = await fetch(`${API_BASE}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });
  return handleResponse(res);
}

export async function getMe() {
  const res = await fetch(`${API_BASE}/api/me`, {
    credentials: 'include',
  });
  return handleResponse(res);
}

export async function getUserPublicKeys(userId: string) {
  const res = await fetch(`${API_BASE}/api/users/${userId}/public-keys`, {
    credentials: 'include',
  });
  return handleResponse(res);
}

export async function getServers() {
  const res = await fetch(`${API_BASE}/api/server/list`, {
    credentials: 'include',
  });
  return handleResponse(res);
}

export async function createServer(payload: { name: string; externalMongoUri: string }) {
  const res = await fetch(`${API_BASE}/api/server/create`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function joinServer(serverId: string) {
  const res = await fetch(`${API_BASE}/api/server/${serverId}/join`, {
    method: 'POST',
    credentials: 'include',
  });
  return handleResponse(res);
}

export async function getServerChannels(serverId: string) {
  const res = await fetch(`${API_BASE}/api/server/${serverId}/channels`, {
    credentials: 'include',
  });
  return handleResponse(res);
}

export async function getServerMembers(serverId: string) {
  const res = await fetch(`${API_BASE}/api/server/${serverId}/members`, {
    credentials: 'include',
  });
  return handleResponse(res);
}

export async function signMedia(payload: { folder?: string; type: 'avatar' | 'serverIcon' | 'attachment'; serverId?: string }) {
  const res = await fetch(`${API_BASE}/api/media/sign`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}

export async function confirmMedia(payload: {
  type: 'avatar' | 'serverIcon' | 'attachment';
  public_id: string;
  secure_url: string;
  bytes: number;
  width?: number;
  height?: number;
  format?: string;
  resource_type?: string;
  serverId?: string;
}) {
  const res = await fetch(`${API_BASE}/api/media/confirm`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}