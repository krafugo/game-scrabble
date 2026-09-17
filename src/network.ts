// Rooms ride on peer-room: a WebRTC data channel when a path exists and an
// encrypted relay over public MQTT brokers when it does not, seats that
// survive reloads, and a stored message for a player who is offline. This
// file adapts that library to the shape the rest of the app expects: the
// host coordinates the table, guests send actions, the host sends each
// guest its own redacted state.
import { Room, createSeat, type ConnectionSettings, type Member, type Seat } from 'peer-room';
import type { Action, RulesMode } from './scrabble';

export const APP = 'scrabble';
export const MAX_SEATS = 4;

export type RoomMember = { token: string; name: string; isHost: boolean; connected: boolean };
export type RoomSettings = { rules: RulesMode };
export type RoomSnapshot = {
  code: string;
  role: 'host' | 'guest';
  token: string;
  name: string;
  members: RoomMember[];
  started: boolean;
  settings: RoomSettings;
  /** The peer-room seat: identity and keys. Without it a saved room cannot rejoin. */
  seat: Seat;
};
export type ConnectionStatus = 'starting' | 'open' | 'connecting' | 'ready' | 'closed' | 'error';
/** What the host announces with its seat so guests learn the table's rules and whether the game began. */
type HostMeta = { started: boolean; rules: RulesMode };
type ActionMessage = { id: string; action: Action };

declare global {
  interface Window { SCRABBLE_CONNECTION?: ConnectionSettings; }
}

const safeCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const STATUS: Record<string, ConnectionStatus> = { connecting: 'starting', waiting: 'open', connected: 'ready', offline: 'connecting', rejected: 'error', left: 'closed' };

export type RoomCallbacks = {
  status?: (status: ConnectionStatus, message: string, path?: 'direct' | 'relay' | 'none') => void;
  members?: (members: RoomMember[], started: boolean, settings: RoomSettings) => void;
  /** Host only. `id` is unique per action so a replay after a reload can be ignored. */
  action?: (token: string, action: Action, id: string) => void;
  state?: (state: unknown) => void;
  error?: (message: string) => void;
};

export class ScrabbleRoom {
  readonly seat: Seat;
  private readonly callbacks: RoomCallbacks;
  private room: Room | null = null;
  private membersList: RoomMember[];
  private settings: RoomSettings;
  private started = false;
  private closed = false;
  private queue: Array<() => void> = [];

  private constructor(seat: Seat, callbacks: RoomCallbacks, settings: RoomSettings, restored?: Pick<RoomSnapshot, 'members' | 'started'>) {
    this.seat = seat;
    this.callbacks = callbacks;
    this.settings = { rules: settings.rules };
    this.started = restored?.started || false;
    this.membersList = restored?.members?.length
      ? restored.members.map(member => ({ ...member, connected: member.token === seat.token }))
      : [{ token: seat.token, name: seat.name, isHost: seat.role === 'host', connected: true }];
    if (seat.role === 'host') seat.meta = { started: this.started, rules: this.settings.rules } satisfies HostMeta;
    this.callbacks.status?.('starting', seat.role === 'host' ? 'Opening a room…' : 'Starting secure connection…');
    void this.open();
  }

  static async createHost(name: string, code = safeCode(), callbacks: RoomCallbacks = {}, settings: RoomSettings = { rules: 'friendly' }) {
    return new ScrabbleRoom(await createSeat(APP, 'host', name.trim() || 'Host', code), callbacks, settings);
  }
  static async join(code: string, name: string, callbacks: RoomCallbacks = {}) {
    return new ScrabbleRoom(await createSeat(APP, 'guest', name.trim() || 'Player', code), callbacks, { rules: 'friendly' });
  }
  static restore(snapshot: RoomSnapshot, callbacks: RoomCallbacks = {}) {
    return new ScrabbleRoom(snapshot.seat, callbacks, snapshot.settings, snapshot);
  }

  get code() { return this.seat.code; }
  get role() { return this.seat.role; }
  get token() { return this.seat.token; }
  get name() { return this.seat.name; }
  get members() { return this.membersList.slice(); }
  get isStarted() { return this.started; }
  get rules() { return this.settings.rules; }
  get snapshot(): RoomSnapshot {
    return { code: this.code, role: this.role, token: this.token, name: this.name, members: this.members, started: this.started, settings: { ...this.settings }, seat: this.seat };
  }

  private async open() {
    try {
      const room = await Room.open(this.seat, {
        seats: MAX_SEATS,
        locked: this.role === 'host' && this.started,
        members: this.membersList.filter(m => m.token !== this.token).map(m => ({ token: m.token, name: m.name, role: m.isHost ? 'host' : 'guest' })),
        settings: window.SCRABBLE_CONNECTION,
        transports: import.meta.env.DEV && new URLSearchParams(location.hash.slice(1)).get('transport') === 'local' ? { local: true, direct: false, relay: false } : undefined,
      }, {
        status: s => this.callbacks.status?.(STATUS[s.kind] ?? 'connecting', s.text, s.path),
        members: list => this.roster(list),
        data: env => {
          if (this.role === 'host' && env.channel === 'action') {
            const message = env.data as ActionMessage;
            if (message && typeof message === 'object' && message.action) this.callbacks.action?.(env.from, message.action, message.id ?? env.id);
          } else if (this.role === 'guest' && env.channel === 'state') this.callbacks.state?.(env.data);
        },
        error: text => this.callbacks.error?.(text),
      });
      if (this.closed) { room.close(false); return; }
      this.room = room;
      for (const task of this.queue) task();
      this.queue = [];
    } catch (error) {
      this.callbacks.error?.(error instanceof Error ? error.message : String(error));
    }
  }
  private roster(list: Member[]) {
    const host = list.find(member => member.role === 'host');
    if (this.role === 'guest' && host?.meta && typeof host.meta === 'object') {
      const meta = host.meta as Partial<HostMeta>;
      if (typeof meta.started === 'boolean') this.started = meta.started;
      if (meta.rules === 'friendly' || meta.rules === 'official') this.settings = { rules: meta.rules };
    }
    this.membersList = list.map(member => ({ token: member.token, name: member.name, isHost: member.role === 'host', connected: member.token === this.token || member.online }));
    this.callbacks.members?.(this.members, this.started, this.settings);
  }
  private whenOpen(task: () => void) { if (this.room) task(); else this.queue.push(task); }

  start() {
    if (this.role !== 'host') return;
    this.started = true;
    this.whenOpen(() => { this.room!.setMeta({ started: true, rules: this.settings.rules } satisfies HostMeta); this.room!.lock(); });
    this.callbacks.members?.(this.members, true, this.settings);
  }
  setRules(rules: RulesMode) {
    if (this.role !== 'host' || this.started) return;
    this.settings = { rules };
    this.whenOpen(() => this.room!.setMeta({ started: false, rules } satisfies HostMeta));
    this.callbacks.members?.(this.members, false, this.settings);
  }
  /** Host: each guest receives its own redacted view. The latest view per guest is what a returning guest gets. */
  broadcastState(stateFor: (token: string) => unknown) {
    if (this.role !== 'host') return;
    this.whenOpen(() => { for (const member of this.membersList) if (!member.isHost) this.room!.send(stateFor(member.token), { channel: 'state', to: member.token }); });
  }
  sendAction(action: Action) {
    if (this.role !== 'guest') return;
    const message: ActionMessage = { id: crypto.randomUUID(), action };
    this.whenOpen(() => this.room!.send(message, { channel: 'action' }));
  }
  /** Leave for good: tells the table and clears what was retained for this seat. */
  close() {
    if (this.closed) return;
    this.closed = true;
    this.room?.close(true);
  }
}

export const makeRoomInvite = (code: string) => `${window.location.origin}${window.location.pathname}#room=${encodeURIComponent(code)}`;
