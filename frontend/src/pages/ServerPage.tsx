import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSocket } from '../hooks/useSocket';
import { useSodium } from '../hooks/useSodium';
import { getServerChannels, getServerMembers } from '../api';

interface ServerMessage {
  id: string;
  serverId: string;
  channelId: string;
  fromUserId: string;
  ciphertext: string;
  nonce: string;
  createdAt: string;
}

export default function ServerPage() {
  const { serverId, channelId } = useParams<{ serverId: string; channelId?: string }>();
  const { user, keys } = useAuth();
  const socket = useSocket();
  const sodium = useSodium();
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [members, setMembers] = useState<{ id: string; curve25519PublicKey: string }[]>([]);
  const [currentChannel, setCurrentChannel] = useState<string | undefined>(channelId);
  const [messages, setMessages] = useState<ServerMessage[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Fetch channels and members on mount or when serverId changes
  useEffect(() => {
    async function fetchData() {
      if (!serverId) return;
      try {
        const ch = await getServerChannels(serverId);
        setChannels(ch.channels);
        if (!currentChannel && ch.channels.length) {
          setCurrentChannel(ch.channels[0].id);
        }
        // fetch members and their keys
        try {
          const memberRes = await getServerMembers(serverId);
          setMembers(memberRes.members);
        } catch {
          setMembers([]);
        }
      } catch {
        setChannels([]);
      }
    }
    fetchData();
  }, [serverId]);

  // Join channel when it changes
  useEffect(() => {
    if (!socket || !serverId || !currentChannel) return;
    socket.emit('server:join', { serverId, channelId: currentChannel }, () => {});
  }, [socket, serverId, currentChannel]);

  // Socket event handlers
  useEffect(() => {
    if (!socket) return;
    function handleReceive(msg: any) {
      if (msg.serverId === serverId && msg.channelId === currentChannel) {
        setMessages((prev) => [...prev, msg]);
      }
    }
    socket.on('server:receive', handleReceive);
    return () => {
      socket.off('server:receive', handleReceive);
    };
  }, [socket, serverId, currentChannel]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    if (!socket || !keys || !sodium || !currentChannel || !serverId || !user) return;
    const text = input.trim();
    if (!text) return;
    // Build map of encrypted payloads per member, including self
    const payloadMap: Record<string, { ciphertext: string; nonce: string }> = {};
    const senderPriv = sodium.from_base64(keys.curveSecretKey);
    for (const member of members) {
      const memberPub = sodium.from_base64(member.curve25519PublicKey);
      const shared = sodium.crypto_scalarmult(senderPriv, memberPub);
      const symmetric = sodium.crypto_generichash(32, shared);
      const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
      const cipher = sodium.crypto_secretbox_easy(sodium.from_string(text), nonce, symmetric);
      payloadMap[member.id] = {
        ciphertext: sodium.to_base64(cipher),
        nonce: sodium.to_base64(nonce),
      };
    }
    // Include our own copy; though we are in members array, ensure present
    if (!payloadMap[user.id]) {
      const myPub = sodium.from_base64(keys.curvePublicKey);
      const shared = sodium.crypto_scalarmult(senderPriv, myPub);
      const symmetric = sodium.crypto_generichash(32, shared);
      const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
      const cipher = sodium.crypto_secretbox_easy(sodium.from_string(text), nonce, symmetric);
      payloadMap[user.id] = {
        ciphertext: sodium.to_base64(cipher),
        nonce: sodium.to_base64(nonce),
      };
    }
    const envelope = {
      senderCurvePublicKey: keys.curvePublicKey,
      map: payloadMap,
    };
    const encoded = sodium.to_base64(sodium.from_string(JSON.stringify(envelope)));
    socket.emit(
      'server:send',
      { serverId, channelId: currentChannel, ciphertext: encoded, nonce: '0' },
      () => {}
    );
    setInput('');
  }

  function decryptMessage(msg: ServerMessage): string {
    if (!sodium || !keys) return '';
    try {
      const jsonStr = sodium.to_string(sodium.from_base64(msg.ciphertext));
      const envelope = JSON.parse(jsonStr);
      const target = envelope.map[user!.id];
      if (!target) return '';
      const senderPub = sodium.from_base64(envelope.senderCurvePublicKey);
      const myPriv = sodium.from_base64(keys.curveSecretKey);
      const shared = sodium.crypto_scalarmult(myPriv, senderPub);
      const symmetric = sodium.crypto_generichash(32, shared);
      const cipher = sodium.from_base64(target.ciphertext);
      const nonce = sodium.from_base64(target.nonce);
      const plain = sodium.crypto_secretbox_open_easy(cipher, nonce, symmetric);
      return sodium.to_string(plain);
    } catch {
      return '[unable to decrypt]';
    }
  }

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <h3>Server {serverId}</h3>
      <div style={{ display: 'flex', marginBottom: '1rem' }}>
        <div style={{ width: '200px', marginRight: '1rem' }}>
          <h4>Channels</h4>
          <ul>
            {channels.map((ch) => (
              <li key={ch.id} style={{ marginBottom: '0.25rem' }}>
                <button onClick={() => setCurrentChannel(ch.id)} style={{ fontWeight: currentChannel === ch.id ? 'bold' : 'normal' }}>
                  {ch.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #ccc', padding: '0.5rem' }}>
            {messages.map((msg) => (
              <div key={msg.id} style={{ marginBottom: '0.5rem' }}>
                <strong>{msg.fromUserId === user?.id ? 'You' : msg.fromUserId}:</strong>{' '}
                <span>{decryptMessage(msg)}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            style={{ marginTop: '0.5rem' }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message…"
              style={{ width: '80%' }}
            />
            <button type="submit" style={{ marginLeft: '0.5rem' }}>
              Send
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}