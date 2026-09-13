/// <reference types="vite/client" />
declare module '*.txt?raw' { const value: string; export default value; }

interface Window {
  SCRABBLE_CONNECTION?: {
    peerServer?: Record<string, unknown>;
    iceServers?: Array<Record<string, unknown>>;
  };
}
