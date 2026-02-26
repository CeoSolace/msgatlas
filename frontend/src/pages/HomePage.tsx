import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { getServers, createServer, joinServer, signMedia, confirmMedia } from '../api';
import { useEffect } from 'react';

export default function HomePage() {
  const { user, logout } = useAuth();
  const [servers, setServers] = useState(user?.servers || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dmUserId, setDmUserId] = useState('');
  const [newServerName, setNewServerName] = useState('');
  const [newMongoUri, setNewMongoUri] = useState('');
  const [joinServerId, setJoinServerId] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  useEffect(() => {
    async function refresh() {
      setLoading(true);
      try {
        const res = await getServers();
        setServers(res.servers);
      } catch (err: any) {
        setError(err.error || 'Failed to fetch servers');
      } finally {
        setLoading(false);
      }
    }
    refresh();
  }, []);
  const handleDM = (e: React.FormEvent) => {
    e.preventDefault();
    if (dmUserId) {
      navigate(`/dm/${dmUserId}`);
      setDmUserId('');
    }
  };
  return (
    <div style={{ padding: '1rem' }}>
      <header style={{ marginBottom: '1rem' }}>
        <h2>Welcome, {user?.displayName}</h2>
        {/* Avatar display and upload */}
        <div style={{ display: 'flex', alignItems: 'center', marginTop: '0.5rem' }}>
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt="avatar"
              style={{ width: '48px', height: '48px', borderRadius: '50%', marginRight: '0.5rem' }}
            />
          ) : (
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: '#ccc',
                display: 'inline-block',
                marginRight: '0.5rem',
              }}
            />
          )}
          <button
            onClick={() => {
              fileInputRef.current?.click();
            }}
            disabled={uploadingAvatar}
          >
            {uploadingAvatar ? 'Uploading…' : 'Change Avatar'}
          </button>
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                setUploadingAvatar(true);
                // Request signed upload params
                const sig = await signMedia({ type: 'avatar' });
                // Build FormData for Cloudinary
                const formData = new FormData();
                formData.append('file', file);
                formData.append('api_key', sig.apiKey);
                formData.append('timestamp', String(sig.timestamp));
                formData.append('signature', sig.signature);
                formData.append('folder', sig.folder);
                const cloudRes = await fetch(
                  `https://api.cloudinary.com/v1_1/${sig.cloudName}/upload`,
                  {
                    method: 'POST',
                    body: formData,
                  }
                );
                const uploadJson = await cloudRes.json();
                if (!uploadJson.public_id || !uploadJson.secure_url) {
                  throw new Error('Cloudinary upload failed');
                }
                await confirmMedia({
                  type: 'avatar',
                  public_id: uploadJson.public_id,
                  secure_url: uploadJson.secure_url,
                  bytes: uploadJson.bytes || 0,
                  width: uploadJson.width,
                  height: uploadJson.height,
                  format: uploadJson.format,
                  resource_type: uploadJson.resource_type,
                });
                // After confirming avatar, reload the page to refresh user context
                window.location.reload();
              } catch (err: any) {
                console.error(err);
                setError(err.error || err.message || 'Avatar upload failed');
              } finally {
                setUploadingAvatar(false);
              }
            }}
          />
        </div>
        <button onClick={() => logout()} style={{ marginTop: '0.5rem' }}>Logout</button>
      </header>
      <section>
        <h3>Your Servers</h3>
        {loading && <div>Loading…</div>}
        {error && <div style={{ color: 'red' }}>{error}</div>}
        <ul>
          {servers.map((srv) => (
            <li key={srv.id}>
              <Link to={`/server/${srv.id}`}>{srv.name}</Link>
            </li>
          ))}
        </ul>
      </section>
      <section style={{ marginTop: '2rem' }}>
        <h3>Direct Message</h3>
        <form onSubmit={handleDM}>
          <input
            type="text"
            placeholder="Recipient user ID"
            value={dmUserId}
            onChange={(e) => setDmUserId(e.target.value)}
            required
          />{' '}
          <button type="submit">Start Chat</button>
        </form>
      </section>
      {/* Server creation form */}
      <section style={{ marginTop: '2rem' }}>
        <h3>Create Server</h3>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newServerName || !newMongoUri) return;
            setLoading(true);
            setError(null);
            try {
              await createServer({ name: newServerName, externalMongoUri: newMongoUri });
              setNewServerName('');
              setNewMongoUri('');
              const res = await getServers();
              setServers(res.servers);
            } catch (err: any) {
              setError(err.error || err.message || 'Failed to create server');
            } finally {
              setLoading(false);
            }
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '400px' }}>
            <input
              type="text"
              placeholder="Server name"
              value={newServerName}
              onChange={(e) => setNewServerName(e.target.value)}
              required
              style={{ marginBottom: '0.5rem' }}
            />
            <input
              type="text"
              placeholder="External MongoDB URI"
              value={newMongoUri}
              onChange={(e) => setNewMongoUri(e.target.value)}
              required
              style={{ marginBottom: '0.5rem' }}
            />
            <button type="submit">Create</button>
          </div>
        </form>
      </section>
      {/* Join server form */}
      <section style={{ marginTop: '2rem' }}>
        <h3>Join Server</h3>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!joinServerId) return;
            setLoading(true);
            setError(null);
            try {
              await joinServer(joinServerId);
              setJoinServerId('');
              const res = await getServers();
              setServers(res.servers);
            } catch (err: any) {
              setError(err.error || err.message || 'Failed to join server');
            } finally {
              setLoading(false);
            }
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '400px' }}>
            <input
              type="text"
              placeholder="Server ID"
              value={joinServerId}
              onChange={(e) => setJoinServerId(e.target.value)}
              required
              style={{ marginBottom: '0.5rem' }}
            />
            <button type="submit">Join</button>
          </div>
        </form>
      </section>
    </div>
  );
}