import { describe, expect, it, vi } from 'vitest';
import { compactHandshakeFromSdp, decodeCompactHandshake } from '../../utils/compact-signaling';
import { applyInitialAnswer, createInitialAnswer, createInitialOffer } from './initial-call';

const fingerprint = Array.from({ length: 32 }, (_, index) => index.toString(16).padStart(2, '0')).join(':');
const sdp = [
  'v=0',
  'a=ice-ufrag:ufrag123',
  'a=ice-pwd:password123',
  `a=fingerprint:sha-256 ${fingerprint}`,
  'a=candidate:1 1 UDP 2130706431 192.168.1.23 54321 typ host',
].join('\r\n');

const createPeer = (): RTCPeerConnection => ({
  createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp }),
  createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp }),
  setLocalDescription: vi.fn().mockResolvedValue(undefined),
  setRemoteDescription: vi.fn().mockResolvedValue(undefined),
  localDescription: { sdp },
} as unknown as RTCPeerConnection);

describe('initial QR call signaling', () => {
  it('creates a compact offer after ICE gathering completes', async () => {
    const peer = createPeer();
    const initializePeerConnection = vi.fn().mockResolvedValue(peer);
    const createOfferDataChannel = vi.fn();
    const waitForIceGathering = vi.fn().mockResolvedValue(true);

    const result = await createInitialOffer({
      initializePeerConnection,
      createOfferDataChannel,
      waitForIceGathering,
    });

    expect(initializePeerConnection).toHaveBeenCalledWith('offerer');
    expect(createOfferDataChannel).toHaveBeenCalledWith(peer);
    expect(peer.createOffer).toHaveBeenCalledOnce();
    expect(waitForIceGathering).toHaveBeenCalledWith(peer);
    expect(decodeCompactHandshake(result as string).role).toBe('offer');
  });

  it('rebuilds an offer and creates a compact answer', async () => {
    const peer = createPeer();
    const initializePeerConnection = vi.fn().mockResolvedValue(peer);
    const waitForIceGathering = vi.fn().mockResolvedValue(true);
    const offerHandshake = decodeCompactHandshake(compactHandshakeFromSdp('offer', sdp));

    const result = await createInitialAnswer(offerHandshake, {
      initializePeerConnection,
      waitForIceGathering,
    });

    expect(initializePeerConnection).toHaveBeenCalledWith('answerer');
    expect(peer.setRemoteDescription).toHaveBeenCalledWith(expect.objectContaining({
      type: 'offer',
      sdp: expect.stringContaining('a=setup:actpass'),
    }));
    expect(peer.createAnswer).toHaveBeenCalledOnce();
    expect(decodeCompactHandshake(result as string).role).toBe('answer');
  });

  it('applies a compact answer as a rebuilt data-channel description', async () => {
    const peer = createPeer();
    const answerHandshake = decodeCompactHandshake(compactHandshakeFromSdp('answer', sdp));

    await applyInitialAnswer(peer, answerHandshake);

    expect(peer.setRemoteDescription).toHaveBeenCalledWith(expect.objectContaining({
      type: 'answer',
      sdp: expect.stringContaining('a=setup:active'),
    }));
  });
});
