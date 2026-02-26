import mongoose, { Schema, Document, Model } from 'mongoose';
import { config } from '../config';

/**
 * User document interface.
 */
export interface IUser extends Document {
  email: string;
  passwordHash: string;
  displayName: string;
  publicKey: string; // Ed25519 public key (base64)
  curve25519PublicKey: string; // X25519 public key (base64)
  avatarPublicId?: string;
  avatarUrl?: string;
  createdAt: Date;
}

const UserSchema = new Schema<IUser>({
  email: { type: String, unique: true, required: true, index: true },
  passwordHash: { type: String, required: true },
  displayName: { type: String, required: true },
  publicKey: { type: String, required: true },
  curve25519PublicKey: { type: String, required: true },
  avatarPublicId: { type: String },
  avatarUrl: { type: String },
  createdAt: { type: Date, default: () => new Date() },
});

/**
 * Session document interface.
 */
export interface ISession extends Document {
  sessionId: string;
  userId: mongoose.Types.ObjectId;
  expiresAt: Date;
  createdAt: Date;
}

const SessionSchema = new Schema<ISession>({
  sessionId: { type: String, unique: true, required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: () => new Date() },
});

/**
 * Server registry document interface.
 */
export interface IServerRegistry extends Document {
  name: string;
  ownerId: mongoose.Types.ObjectId;
  encryptedMongoUri: string; // encrypted external DB URI
  iconPublicId?: string;
  iconUrl?: string;
  createdAt: Date;
}

const ServerRegistrySchema = new Schema<IServerRegistry>({
  name: { type: String, required: true },
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  encryptedMongoUri: { type: String, required: true },
  iconPublicId: { type: String },
  iconUrl: { type: String },
  createdAt: { type: Date, default: () => new Date() },
});

/**
 * Server membership index document.
 */
export interface IServerMembership extends Document {
  serverId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  role: string;
  joinedAt: Date;
}

const ServerMembershipSchema = new Schema<IServerMembership>({
  serverId: { type: Schema.Types.ObjectId, ref: 'ServerRegistry', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  role: { type: String, default: 'member' },
  joinedAt: { type: Date, default: () => new Date() },
});

/**
 * Direct message (DM) bounce storage document.
 */
export interface IDMMessage extends Document {
  fromUserId: mongoose.Types.ObjectId;
  toUserId: mongoose.Types.ObjectId;
  ciphertext: Buffer;
  nonce: Buffer;
  attachment?: {
    publicId: string;
    secureUrl: string;
    width: number;
    height: number;
    bytes: number;
    format: string;
    resourceType: string;
  };
  ackBySender: boolean;
  ackByRecipient: boolean;
  createdAt: Date;
}

const DMMessageSchema = new Schema<IDMMessage>({
  fromUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  toUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  ciphertext: { type: Buffer, required: true },
  nonce: { type: Buffer, required: true },
  attachment: {
    publicId: { type: String },
    secureUrl: { type: String },
    width: { type: Number },
    height: { type: Number },
    bytes: { type: Number },
    format: { type: String },
    resourceType: { type: String },
  },
  ackBySender: { type: Boolean, default: false },
  ackByRecipient: { type: Boolean, default: false },
  createdAt: { type: Date, default: () => new Date(), index: true },
});

// TTL index for bounce storage: messages expire after configured hours
DMMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: config.dmTtlHours * 3600 });

// Compound index to quickly find messages between two users
DMMessageSchema.index({ fromUserId: 1, toUserId: 1, createdAt: -1 });

// Models
export let UserModel: Model<IUser>;
export let SessionModel: Model<ISession>;
export let ServerRegistryModel: Model<IServerRegistry>;
export let ServerMembershipModel: Model<IServerMembership>;
export let DMMessageModel: Model<IDMMessage>;

/**
 * Initialise the central MongoDB connection and models.  This function
 * must be called once during server startup.
 */
export async function initCentralDb(): Promise<typeof mongoose> {
  const uri = config.mongoUri;
  if (!uri) {
    throw new Error('MONGO_URI must be set');
  }
  // Use the new MongoDB driver connection string parser
  await mongoose.connect(uri, {
    // @ts-ignore – options type differs across Mongoose versions
    autoIndex: true,
  });
  // Initialise models once the connection is established
  UserModel = mongoose.model<IUser>('User', UserSchema);
  SessionModel = mongoose.model<ISession>('Session', SessionSchema);
  ServerRegistryModel = mongoose.model<IServerRegistry>('ServerRegistry', ServerRegistrySchema);
  ServerMembershipModel = mongoose.model<IServerMembership>('ServerMembership', ServerMembershipSchema);
  DMMessageModel = mongoose.model<IDMMessage>('DMMessage', DMMessageSchema);
  return mongoose;
}