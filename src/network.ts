import { DataConnection, Peer } from 'peerjs';
import type { Action, RulesMode } from './scrabble';

export type RoomMember = { token: string; name: string; isHost: boolean; connected: boolean };
export type RoomSettings = { rules: RulesMode };
export type ConnectionStatus = 'starting' | 'open' | 'connecting' | 'ready' | 'closed' | 'error';

type WireMessage =
  | { type: 'hello'; version: 1; code: string; token: string; name: string }
  | { type: 'welcome'; members: RoomMember[]; started: boolean; settings: RoomSettings }
  | { type: 'lobby'; members: RoomMember[]; started: boolean; settings: RoomSettings }
  | { type: 'action'; action: Action }
  | { type: 'state'; state: unknown }
  | { type: 'reject'; message: string }
  | { type: 'ping'; at: number }
  | { type: 'pong'; at: number };

type ConnectionConfig = {
  peerServer?: Record<string, unknown>;
  iceServers?: Array<Record<string, unknown>>;
};

declare global {
  interface Window {
    SCRABBLE_CONNECTION?: ConnectionConfig;
  }
}

const config = () => {
  const source = window.SCRABBLE_CONNECTION || {};
  return {
    ...(source.peerServer || {}),
    debug: 0,
    config: { iceServers: source.iceServers || [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478', 'turn:eu-0.turn.peerjs.com:443?transport=tcp', 'turn:us-0.turn.peerjs.com:443?transport=tcp'], username: 'peerjs', credential: 'peerjsp' },
    ], sdpSemantics: 'unified-plan' },
  };
};

const peerIdFor = (code: string) => `scrabble-${code.toLowerCase()}`;
const guestIdFor = (token: string) => `scrabble-player-${token.toLowerCase()}`;
const randomToken = () => crypto.randomUUID().replaceAll('-', '').slice(0, 12);
const safeCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

export type RoomCallbacks = {
  status?: (status: ConnectionStatus, message: string) => void;
  members?: (members: RoomMember[], started: boolean, settings: RoomSettings) => void;
  action?: (token: string, action: Action) => void;
  state?: (state: unknown) => void;
  error?: (message: string) => void;
};

export class ScrabbleRoom {
  readonly code: string;
  readonly role: 'host' | 'guest';
  readonly token: string;
  readonly name: string;
  readonly peer: Peer;
  private readonly callbacks: RoomCallbacks;
  private readonly connections = new Map<string, DataConnection>();
  private membersList: RoomMember[];
  private settings: RoomSettings;
  private started = false;
  private heartbeat?: number;
  private guestAttempts = 0;
  private guestRetryTimer?: number;

  private constructor(code: string, role: 'host' | 'guest', token: string, name: string, callbacks: RoomCallbacks, settings: RoomSettings) {
    this.code = code;
    this.role = role;
    this.token = token;
    this.name = name;
    this.callbacks = callbacks;
    this.settings = { rules: settings.rules };
    this.membersList = [{ token, name, isHost: role === 'host', connected: true }];
    this.peer = role === 'host' ? new Peer(peerIdFor(code), config()) : new Peer(guestIdFor(token), config());
    this.bindPeer();
  }

  static createHost(name: string, code = safeCode(), callbacks: RoomCallbacks = {}, settings: RoomSettings = { rules: 'friendly' }) {
    return new ScrabbleRoom(code, 'host', randomToken(), name.trim() || 'Host', callbacks, settings);
  }

  static join(code: string, name: string, token = randomToken(), callbacks: RoomCallbacks = {}) {
    return new ScrabbleRoom(code.trim().toUpperCase(), 'guest', token, name.trim() || 'Player', callbacks, { rules: 'friendly' });
  }

  get members() { return this.membersList.slice(); }
  get isStarted() { return this.started; }
  get rules() { return this.settings.rules; }

  private report(status: ConnectionStatus, message: string) { this.callbacks.status?.(status, message); }

  private bindPeer() {
    this.report('starting', this.role === 'host' ? 'Opening a room…' : 'Starting secure connection…');
    this.peer.on('open', () => {
      if (this.role === 'host') {
        this.report('open', `Room ${this.code} is ready.`);
        this.callbacks.members?.(this.members, this.started, this.settings);
      } else {
        this.report('connecting', `Joining room ${this.code}…`);
        this.connectGuest();
      }
      this.heartbeat = window.setInterval(() => this.connections.forEach(connection => {
        if (connection.open) this.send(connection, { type: 'ping', at: Date.now() });
      }), 20_000);
    });
    this.peer.on('connection', (connection: DataConnection) => this.bindConnection(connection, false));
    this.peer.on('error', error => {
      const message = error instanceof Error ? error.message : String(error);
      this.report('error', message);
      this.callbacks.error?.(message);
    });
    this.peer.on('disconnected', () => { this.report('connecting', 'Reconnecting to the signaling service…'); this.peer.reconnect(); });
    this.peer.on('close', () => this.report('closed', 'The room connection closed.'));
  }

  private connectGuest() {
    if (this.role !== 'guest' || this.peer.destroyed) return;
    if (this.guestRetryTimer) window.clearTimeout(this.guestRetryTimer);
    this.guestAttempts++;
    const connection = this.peer.connect(peerIdFor(this.code), { reliable: true, metadata: { version: 1, code: this.code, token: this.token, name: this.name } });
    this.bindConnection(connection, true);
    this.guestRetryTimer = window.setTimeout(() => {
      if (connection.open || this.peer.destroyed) return;
      connection.close();
      if (this.guestAttempts < 4) {
        this.report('connecting', `The room is taking a moment — retrying (${this.guestAttempts}/3)…`);
        this.connectGuest();
      } else {
        this.report('error', `Could not connect to peer ${peerIdFor(this.code)}. Keep the host tab open and try joining again.`);
        this.callbacks.error?.(`Could not connect to peer ${peerIdFor(this.code)}. Keep the host tab open and try joining again.`);
      }
    }, 8_000);
  }

  private bindConnection(connection: DataConnection, outgoing: boolean) {
    connection.on('open', () => {
      const metadata = (connection.metadata || {}) as Partial<Extract<WireMessage, { type: 'hello' }>>;
      if (this.role === 'guest' && outgoing) {
        this.guestAttempts = 0;
        if (this.guestRetryTimer) window.clearTimeout(this.guestRetryTimer);
        this.connections.set('host', connection);
        this.send(connection, { type: 'hello', version: 1, code: this.code, token: this.token, name: this.name });
      }
      if (this.role === 'host' && !outgoing) {
        const token = String(metadata.token || '');
        const name = String(metadata.name || 'Player').slice(0, 20);
        if (!token || metadata.code !== this.code || this.started || this.membersList.filter(member => member.connected).length >= 4 || this.membersList.some(member => member.token === token)) {
          this.send(connection, { type: 'reject', message: this.started ? 'This game has already started.' : 'This room is full.' });
          connection.close();
          return;
        }
        this.connections.set(token, connection);
        this.membersList.push({ token, name, isHost: false, connected: true });
        this.send(connection, { type: 'welcome', members: this.members, started: this.started, settings: this.settings });
        this.broadcastLobby();
        this.callbacks.members?.(this.members, this.started, this.settings);
        this.report('ready', `${name} joined the room.`);
      }
      if (this.role === 'guest') this.report('ready', `Connected to ${this.code}.`);
    });
    connection.on('data', raw => this.handleMessage(connection, raw as WireMessage));
    connection.on('close', () => {
      for (const [token, candidate] of this.connections) if (candidate === connection) {
        this.connections.delete(token);
        const member = this.membersList.find(item => item.token === token);
        if (member) member.connected = false;
        this.callbacks.members?.(this.members, this.started, this.settings);
        this.report('closed', member ? `${member.name} disconnected.` : 'A player disconnected.');
      }
    });
    connection.on('error', error => {
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.error?.(message);
      if (this.role === 'guest' && outgoing && !connection.open && this.guestAttempts < 4) this.guestRetryTimer = window.setTimeout(() => this.connectGuest(), 500);
    });
  }

  private send(connection: DataConnection, message: WireMessage) {
    if (connection.open) connection.send(message);
  }

  private handleMessage(connection: DataConnection, message: WireMessage) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'ping') { this.send(connection, { type: 'pong', at: message.at }); return; }
    if (message.type === 'pong') return;
    if (this.role === 'host') {
      if (message.type === 'action') {
        const token = [...this.connections.entries()].find(([, candidate]) => candidate === connection)?.[0];
        if (token) this.callbacks.action?.(token, message.action);
      }
      return;
    }
    if (message.type === 'welcome' || message.type === 'lobby') {
      this.membersList = message.members;
      this.started = message.started;
      this.settings = message.settings || this.settings;
      this.callbacks.members?.(this.members, this.started, this.settings);
      return;
    }
    if (message.type === 'state') this.callbacks.state?.(message.state);
    if (message.type === 'reject') this.callbacks.error?.(message.message);
  }

  private broadcastLobby() {
    const message: WireMessage = { type: 'lobby', members: this.members, started: this.started, settings: this.settings };
    this.connections.forEach(connection => this.send(connection, message));
  }

  start() {
    if (this.role !== 'host') return;
    this.started = true;
    this.broadcastLobby();
    this.callbacks.members?.(this.members, true, this.settings);
  }

  setRules(rules: RulesMode) {
    if (this.role !== 'host' || this.started) return;
    this.settings = { rules };
    this.broadcastLobby();
    this.callbacks.members?.(this.members, false, this.settings);
  }

  broadcastState(stateFor: (token: string) => unknown) {
    if (this.role !== 'host') return;
    this.connections.forEach((connection, token) => this.send(connection, { type: 'state', state: stateFor(token) }));
  }

  sendAction(action: Action) {
    if (this.role !== 'guest') return;
    const connection = [...this.connections.values()][0];
    if (connection) this.send(connection, { type: 'action', action });
  }

  close() {
    if (this.heartbeat) window.clearInterval(this.heartbeat);
    if (this.guestRetryTimer) window.clearTimeout(this.guestRetryTimer);
    this.connections.forEach(connection => connection.close());
    this.peer.destroy();
  }
}

export const makeRoomInvite = (code: string) => `${window.location.origin}${window.location.pathname}#room=${encodeURIComponent(code)}`;
