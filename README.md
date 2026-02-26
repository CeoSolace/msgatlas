# Private Messaging Platform

This repository contains a **full‑stack, production‑ready private messaging platform**.  It is built as a monorepo with a TypeScript/Node.js backend and a Vite/React/TypeScript frontend.  The design takes inspiration from Discord: users can create servers, join or invite others, send direct messages (DMs) and server messages, and even create anonymous one‑off chat rooms.  All message content is end‑to‑end encrypted (E2EE) using [libsodium](https://libsodium.org) so that the server never sees plaintext.

The platform is designed to be scalable, secure and ready for deployment on hosting providers such as [Render](https://render.com).  It includes integration with Redis for presence and rate limiting, Cloudinary for image uploads, MongoDB for persistent storage and Argon2 for password hashing.

## Features

* **Email/password authentication** – users can register and log in via email.  Sessions are stored in HTTP‑only cookies.  Passwords are hashed with Argon2id.
* **End‑to‑end encryption** – DMs and server messages are encrypted on the client using X25519 key agreement and XChaCha20‑Poly1305 AEAD.  The server only stores ciphertext and does not possess decryption keys.
* **DM bounce storage** – direct messages are temporarily stored in the central MongoDB control plane until both the sender and recipient acknowledge delivery.  Messages are automatically purged after a configurable TTL.
* **Discord‑style servers** – any user can create a server backed by their own external MongoDB instance.  The backend validates the external connection string, blocks private IP ranges, enforces TLS and manages an LRU pool of per‑server connections.  Within a server you can create channels, send E2EE messages and upload an optional icon.
* **Anonymous link chats** – users can spin up anonymous rooms which live entirely in Redis.  Each room has a 5‑hour TTL and is removed when memory pressure increases.
* **Redis based presence and rate limiting** – online status, pub/sub for Socket.IO and rate limiting tokens are kept in Redis.  A watchdog ensures that memory usage stays below 23.4 MB and trims anonymous rooms when necessary.
* **Cloudinary media uploads** – avatars, server icons and image attachments are stored in Cloudinary.  The backend signs uploads on demand so that the client can upload directly from the browser.  Only metadata (public_id, secure_url, dimensions) is stored in the database.
* **Autoscaling ready** – Socket.IO uses the Redis adapter for horizontal scaling.  All keys in Redis are TTL‑based and the application never crashes if Redis becomes unavailable.
* **Dev secret auto‑generation** – in development mode the server automatically generates secrets (cookie signing key, KMS master key, sodium pepper) if they are missing.  In production the absence of secrets will cause the server to abort unless `EPHEMERAL_SECRETS_IN_PROD=1` is set.

## Architecture

The system consists of a **control plane** and a **data plane**:

| Component | Description |
|---|---|
| **Control plane** | A central MongoDB instance that stores user accounts, sessions, public encryption keys, the server registry, membership indexes, DM bounce storage and references to uploaded images. |
| **Data plane** | A separate MongoDB database per server.  When a user creates a server they must provide a connection string to their own MongoDB instance.  Each server stores its own members, channels, invites and encrypted messages.  Connections are pooled and validated through a strict URI validator which blocks private IP ranges and enforces TLS. |
| **Redis** | An in‑memory store used for presence, rate limiting, anonymous rooms and the Socket.IO pub/sub adapter.  A watchdog enforces a hard memory limit of 23.4 MB by trimming anonymous buffers when necessary. |
| **Cloudinary** | Used to store user avatars, server icons and optional attachments.  The server only provides signed upload parameters; uploads occur directly from the client. |

```
┌──────────────────┐              ┌────────────────────────────────────────────────┐
│  Client (React) │── WebSocket ─►│ Backend (Fastify + Socket.IO)                │
│                 │              │ - Auth & Sessions                            │
│                 │              │ - API routes                                 │
│                 │              │ - Redis presence & rate limiting             │
│                 │              │ - DM bounce storage                          │
│                 │              │ - Cloudinary signatures                      │
└──────────────────┘              │ - Redis watchdog                             │
                                 │ - Autoscaling via Redis adapter             │
                                 └──────────────────────────────────────────────┘
                                                     │
                                                     │
                       ┌──────────────────────────────┴─────────────────────────────┐
                       │                                                              │
               ┌─────────────────────────┐                              ┌────────────────────────┐
               │ Control Plane (MongoDB) │                              │ Redis                 │
               │ - Users                  │                              │ - Presence           │
               │ - Sessions               │                              │ - Pub/Sub            │
               │ - Server registry        │                              │ - Anonymous rooms    │
               │ - Membership indexes     │                              │ - Rate limiting      │
               │ - DM bounce storage      │                              │ - Watchdog trimming  │
               └─────────────────────────┘                              └────────────────────────┘
                                        │
                                        │  (Per server)
                                        ▼
                            ┌────────────────────────────┐
                            │ Data Plane (MongoDB)       │
                            │ - serverMembers            │
                            │ - channels                 │
                            │ - invites                 │
                            │ - encrypted serverMessages│
                            └────────────────────────────┘
```

## Getting Started (Development)

### Prerequisites

* **Node.js 20+** and **npm**
* **MongoDB** – you will need at least one MongoDB instance for the control plane.  To experiment with servers you can spin up additional instances or use free clusters from MongoDB Atlas.
* **Redis** – used for presence and anonymous chats.  You can run a local Redis (`docker run -p 6379:6379 redis:7`) in development.
* **Cloudinary account** – create an account at [cloudinary.com](https://cloudinary.com) and obtain your cloud name, API key and API secret.

### Setup

1. Clone the repository and install dependencies for both the backend and frontend:

```bash
cd messaging-app

# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

2. Copy the example environment files and fill in your secrets:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Edit `backend/.env` to point `MONGO_URI` at your control plane database, set `REDIS_URL` to your Redis instance and fill in the Cloudinary credentials.  Edit `frontend/.env` to point at your backend’s base URL and include your Cloudinary cloud name and API key.

3. Start the backend in development mode (hot‑reload with `ts-node`):

```bash
cd backend
npm run dev
```

The backend listens on port defined by `PORT` (default 3000) and exposes a health check at `/health`.

4. Start the frontend development server:

```bash
cd frontend
npm run dev
```

This will launch Vite on port 5173.  The React application will proxy API calls to the backend and connect via Socket.IO.

### Encryption Keys

On first registration the client generates an Ed25519 identity key and a X25519 key pair for key agreement.  The public keys are uploaded to the backend and stored in the user record.  Your private keys are stored in the browser (IndexedDB by default, falling back to `localStorage` for browsers without IndexedDB support).  The server never sees nor can reconstruct your private keys.

### Cloudinary Setup

The backend provides a signed upload endpoint (`POST /api/media/sign`) which returns a timestamp and signature.  The client uploads files directly to Cloudinary using the provided parameters and then calls `POST /api/media/confirm` to persist the metadata on the server.  For production deployments **do not enable unsigned uploads**.

## Deployment on Render

This repository is ready to be deployed to [Render](https://render.com).  Create two services: one for the backend and one for the frontend.

### Backend Service

* **Type**: Web Service (Node)
* **Build Command**: `cd backend && npm ci && npm run build`
* **Start Command**: `cd backend && npm run start`
* **Health Check Path**: `/health`
* **Environment Variables**: copy all keys from `backend/.env.example` and set appropriate values.  Ensure `NODE_ENV=production`.

### Frontend Service

* **Type**: Static Site
* **Build Command**: `cd frontend && npm ci && npm run build`
* **Publish Directory**: `frontend/dist`
* **Environment Variables**: copy values from `frontend/.env.example` and set `VITE_API_BASE_URL` and `VITE_SOCKET_BASE_URL` to your backend service URL.

## Security Checklist

* **Secrets management** – never commit real secrets.  Always supply values through environment variables or secret managers.  In production the absence of secrets causes startup to abort unless `EPHEMERAL_SECRETS_IN_PROD=1` is explicitly set.  In development secrets are autogenerated for convenience.
* **TLS enforced** – external MongoDB URIs must use `mongodb+srv://` or include `tls=true`.  The server rejects connection strings that resolve to private IP ranges or local addresses.
* **Input validation** – all API endpoints use [Zod](https://github.com/colinhacks/zod) to validate request bodies.  Invalid inputs return a 400 error.
* **Rate limiting** – the backend uses Redis to issue tokens per IP/user for rate limiting.  Anonymous rooms and other keys include TTLs.
* **Data minimisation** – message plaintext never touches the server.  Attachments are uploaded directly to Cloudinary and only metadata is stored.  Private keys remain on the client.
* **Watchdog** – a Redis watchdog runs every 30 seconds to trim anonymous chat buffers when used memory exceeds 20 MB and performs aggressive cleanup when above 23 MB.
* **Dev warnings** – when dev secrets are autogenerated the server logs a warning.  Do not run production workloads without properly provisioning secrets.

## Project Structure

```text
messaging-app/
  ├── backend/         # Fastify/Node.js backend
  │   ├── src/         # TypeScript sources
  │   ├── .env.example # Example environment variables
  │   ├── package.json
  │   └── tsconfig.json
  ├── frontend/        # Vite/React frontend
  │   ├── src/         # React components and hooks
  │   ├── .env.example
  │   ├── package.json
  │   ├── tsconfig.json
  │   └── vite.config.ts
  ├── .gitignore
  ├── README.md
  └── ...
```

Enjoy using and extending this private messaging platform!  Pull requests are welcome.