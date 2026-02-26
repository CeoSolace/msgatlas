import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { SocketProvider } from './hooks/useSocket';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import HomePage from './pages/HomePage';
import ChatPage from './pages/ChatPage';
import ServerPage from './pages/ServerPage';

function PrivateRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/dm/:id" element={<ChatPage />} />
      <Route path="/server/:serverId/:channelId?" element={<ServerPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function PublicRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

function AppRoutes() {
  const { user, ready } = useAuth();
  if (!ready) {
    return <div style={{ padding: '1rem' }}>Loading…</div>;
  }
  return user ? <PrivateRoutes /> : <PublicRoutes />;
}

export default function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </SocketProvider>
    </AuthProvider>
  );
}