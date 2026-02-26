import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSocket } from '../hooks/useSocket';
import { useSodium } from '../hooks/useSodium';
import { getUserPublicKeys } from '../api';

interface Message {
  id: string;
  fromUserId: string;
  toUserId: string;
  ciphertext: string;
  nonce: string;
  createdAt: string;
}

export default function ChatPage() {
  const { id: peerId } = useParams<{ id: string }>();
  const { user, keys } = useAuth();
  const socket = useSocket();
  const sodium = useSodium();
  const [peerKeys, setPeerKeys] = useState<{ curve25519PublicKey: string } | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Fetch peer public keys
  useEffect(() => {
    async function fetchPeer() {
      if (!peerId) return;
      try {
        const res = await getUserPublicKeys(peerId);
        setPeerKeys({ curve25519PublicKey: res.curve25519PublicKey });
      } catch {
        setPeerKeys(null);
      }
    }
    fetchPeer();
  }, [peerId]);

  // Scroll to bottom when messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Socket event handlers
  useEffect(() => {
    if (!socket) return;
    function handleReceive(msg: any) {
      if (msg.fromUserId === peerId || msg.toUserId === peerId) {
        setMessages((prev) => [...prev, msg]);
      }
    }
    function handleSent(msg: any) {
      if (msg.toUserId === peerId) {
        setMessages((prev) => [...prev, msg]);
      }
    }
    socket.on('dm:receive', handleReceive);
    socket.on('dm:sent', handleSent);
    return () => {
      socket.off('dm:receive', handleReceive);
      socket.off('dm:sent', handleSent);
    };
  }, [socket, peerId]);

  async function encryptAndSend() {
    if (!socket || !keys || !peerKeys || !sodium || !peerId) return;
    const message = input.trim();
    if (!message) return;
    const messageBytes = sodium.from_string(message);
    const recipientPub = sodium.from_base64(peerKeys.curve25519PublicKey);
    const senderPriv = sodium.from_base64(keys.curveSecretKey);
    const shared = sodium.crypto_scalarmult(senderPriv, recipientPub);
    const symmetric = sodium.crypto_generichash(32, shared);
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const cipher = sodium.crypto_secretbox_easy(messageBytes, nonce, symmetric);
    const ciphertext = sodium.to_base64(cipher);
    const nonceB64 = sodium.to_base64(nonce);
    socket.emit('dm:send', { toUserId: peerId, ciphertext, nonce: nonceB64 }, (ack: any) => {
      // handle ack if necessary
    });
    setInput('');
  }

  function decryptMessage(msg: Message): string {
    if (!sodium || !keys) return '';
    const cipher = sodium.from_base64(msg.ciphertext);
    const nonce = sodium.from_base64(msg.nonce);
    let otherPublicKeyB64: string;
    if (msg.fromUserId === user?.id) {
      // we sent this message; decrypt using recipient key (peerId)
      if (!peerKeys) return '';
      otherPublicKeyB64 = peerKeys.curve25519PublicKey;
    } else {
      // message from peer; we need sender's curve key; we only have peer's keys
      otherPublicKeyB64 = peerKeys?.curve25519PublicKey || '';
    }
    const otherPub = sodium.from_base64(otherPublicKeyB64);
    const myPriv = sodium.from_base64(keys.curveSecretKey);
    const shared = sodium.crypto_scalarmult(myPriv, otherPub);
    const symmetric = sodium.crypto_generichash(32, shared);
    try {
      const plain = sodium.crypto_secretbox_open_easy(cipher, nonce, symmetric);
      return sodium.to_string(plain);
    } catch {
      return '[unable to decrypt]';
    }
  }

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <h3>Chat with {peerId}</h3>
      <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #ccc', padding: '0.5rem' }}>
        {messages.map((msg) => (
          <div key={msg.id} style={{ marginBottom: '0.5rem' }}>
            <strong>{msg.fromUserId === user?.id ? 'You' : 'Them'}:</strong>{' '}
            <span>{decryptMessage(msg)}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          encryptAndSend();
        }}
        style={{ marginTop: '0.5rem' }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message…"
          style={{ flex: 1, width: '80%' }}
        />
        <button type="submit" style={{ marginLeft: '0.5rem' }}>
          Send
        </button>
      </form>
    </div>
  );
}