import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await register({ email, password, displayName });
      navigate('/');
    } catch (err: any) {
      setError(err.error || 'Registration failed');
    }
  }
  return (
    <div style={{ maxWidth: '400px', margin: '2rem auto' }}>
      <h2>Register</h2>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label>Email<br />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label>Password<br />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label>Display Name<br />
            <input type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          </label>
        </div>
        <button type="submit">Register</button>
      </form>
      <p style={{ marginTop: '1rem' }}>
        Already have an account? <Link to="/login">Login</Link>
      </p>
    </div>
  );
}