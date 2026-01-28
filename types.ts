export enum AppState {
  HOME = 'HOME',
  GENERATING_OFFER = 'GENERATING_OFFER',
  SHOWING_OFFER = 'SHOWING_OFFER', // Host shows this to Peer
  SCANNING_OFFER = 'SCANNING_OFFER', // Peer scans Host
  GENERATING_ANSWER = 'GENERATING_ANSWER',
  SHOWING_ANSWER = 'SHOWING_ANSWER', // Peer shows this to Host
  SCANNING_ANSWER = 'SCANNING_ANSWER', // Host scans Peer
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}

export interface PeerConnectionConfig {
  iceServers: RTCIceServer[];
}

export interface SignalingData {
  type: 'offer' | 'answer';
  sdp: string;
}

export type CallRole = 'host' | 'peer' | null;