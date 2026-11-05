import {
  buildDataChannelSdp,
  compactHandshakeFromSdp,
  type CompactHandshake,
} from '../../utils/compact-signaling';

interface InitialCallDependencies {
  initializePeerConnection: (role: 'offerer' | 'answerer') => Promise<RTCPeerConnection>;
  waitForIceGathering: (peer: RTCPeerConnection) => Promise<boolean>;
}

interface InitialOfferDependencies extends InitialCallDependencies {
  createOfferDataChannel: (peer: RTCPeerConnection) => RTCDataChannel;
}

const normalizeDescription = (handshake: CompactHandshake): RTCSessionDescriptionInit => ({
  type: handshake.role === 'offer' ? 'offer' : 'answer',
  sdp: buildDataChannelSdp(handshake, { sessionId: String(Date.now()) }),
});

const compactLocalDescription = (peer: RTCPeerConnection, role: 'offer' | 'answer'): string => {
  const sdp = peer.localDescription?.sdp;
  if (!sdp) throw new Error(`Peer did not produce an ${role} SDP.`);
  return compactHandshakeFromSdp(role, sdp);
};

export const createInitialOffer = async ({
  initializePeerConnection,
  createOfferDataChannel,
  waitForIceGathering,
}: InitialOfferDependencies): Promise<string | null> => {
  const peer = await initializePeerConnection('offerer');
  createOfferDataChannel(peer);
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  if (!await waitForIceGathering(peer)) return null;
  return compactLocalDescription(peer, 'offer');
};

export const createInitialAnswer = async (
  handshake: CompactHandshake,
  { initializePeerConnection, waitForIceGathering }: InitialCallDependencies,
): Promise<string | null> => {
  const peer = await initializePeerConnection('answerer');
  await peer.setRemoteDescription(normalizeDescription(handshake));
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  if (!await waitForIceGathering(peer)) return null;
  return compactLocalDescription(peer, 'answer');
};

export const applyInitialAnswer = async (
  peer: RTCPeerConnection,
  handshake: CompactHandshake,
): Promise<void> => {
  await peer.setRemoteDescription(normalizeDescription(handshake));
};
