import { describe, expect, it } from 'vitest';
import {
  buildDataChannelSdp,
  compactHandshakeFromSdp,
  decodeCompactHandshake,
} from './compact-signaling';

const fingerprintHex = '00:01:02:03:04:05:06:07:08:09:0A:0B:0C:0D:0E:0F:10:11:12:13:14:15:16:17:18:19:1A:1B:1C:1D:1E:1F';

const fullBrowserOfferSdp = [
  'v=0',
  'o=- 123456789 2 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1 2',
  'a=ice-options:trickle',
  'a=ice-ufrag:chromeOffer',
  'a=ice-pwd:chromePassword',
  `a=fingerprint:sha-256 ${fingerprintHex}`,
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=mid:0',
  'a=sendrecv',
  'a=candidate:1 1 UDP 2113937151 10.0.0.8 54500 typ host generation 0 ufrag:chromeOffer network-cost 999',
  'a=candidate:2 1 UDP 2113937150 192.168.43.25 54501 typ host generation 0 ufrag:chromeOffer network-cost 999',
  'a=end-of-candidates',
  'm=video 9 UDP/TLS/RTP/SAVPF 96',
  'a=mid:1',
  'a=sendrecv',
  'a=candidate:3 1 UDP 2113937149 192.168.43.26 54503 typ host generation 0 ufrag:chromeOffer network-cost 999',
  'a=candidate:4 1 UDP 1677734911 198.51.100.20 54504 typ srflx raddr 192.168.43.26 rport 54503',
  'a=end-of-candidates',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'a=mid:2',
].join('\r\n');

const decodeFullBrowserOffer = () => decodeCompactHandshake(
  compactHandshakeFromSdp('offer', fullBrowserOfferSdp, '192.168.43.1'),
);

describe('compact signaling full browser SDP', () => {
  it('extracts host candidates across bundled audio and video sections', () => {
    const encoded = compactHandshakeFromSdp(
      'offer',
      fullBrowserOfferSdp,
      '192.168.43.1',
    );
    const decoded = decodeCompactHandshake(encoded);

    expect(encoded.length).toBeLessThanOrEqual(200);
    expect(decoded.ufrag).toBe('chromeOffer');
    expect(decoded.candidates).toEqual([
      { address: '192.168.43.25', port: 54501 },
      { address: '192.168.43.26', port: 54503 },
      { address: '10.0.0.8', port: 54500 },
    ]);
  });

  it('rebuilds the compact result as data-channel-only SDP', () => {
    const handshake = decodeFullBrowserOffer();
    const rebuiltSdp = buildDataChannelSdp(handshake, { sessionId: 'chrome-offer' });
    const rebuiltHandshake = decodeCompactHandshake(
      compactHandshakeFromSdp('offer', rebuiltSdp, '192.168.43.1'),
    );

    expect(rebuiltSdp).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');
    expect(rebuiltSdp).not.toMatch(/^m=(audio|video) /m);
    expect(rebuiltSdp.match(/^a=candidate:/gm)).toHaveLength(3);
    expect(rebuiltSdp).toContain('a=end-of-candidates');
    expect(rebuiltHandshake).toEqual(handshake);
  });
});
