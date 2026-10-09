import { describe, expect, it } from 'vitest';
import {
  buildDataChannelSdp,
  compactHandshakeFromSdp,
  decodeCompactHandshake,
} from './compact-signaling';
import { browserShapedSdpFixtures } from './compact-signaling.fixtures';

describe('compact signaling browser-shaped fixtures', () => {
  for (const fixture of browserShapedSdpFixtures) {
    it(`keeps the compact ${fixture.label} payload under 200 characters`, () => {
      const encoded = compactHandshakeFromSdp(
        fixture.role,
        fixture.sdp,
        fixture.preferredSubnet,
      );
      const decoded = decodeCompactHandshake(encoded);

      expect(encoded.length).toBeLessThanOrEqual(200);
      expect(decoded.role).toBe(fixture.role);
      expect(decoded.candidates).toEqual(fixture.expectedCandidates);
    });

    it(`rebuilds a data-channel SDP for ${fixture.label}`, () => {
      const handshake = decodeCompactHandshake(
        compactHandshakeFromSdp(fixture.role, fixture.sdp, fixture.preferredSubnet),
      );
      const rebuiltSdp = buildDataChannelSdp(handshake, { sessionId: 'fixture-session' });
      const extracted = decodeCompactHandshake(
        compactHandshakeFromSdp(fixture.role, rebuiltSdp, fixture.preferredSubnet),
      );

      expect(rebuiltSdp).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');
      expect(rebuiltSdp).toContain(
        fixture.role === 'offer' ? 'a=setup:actpass' : 'a=setup:active',
      );
      expect(extracted).toEqual(handshake);
    });
  }

  it('rejects garbage before it can reach the WebRTC flow', () => {
    const invalidPayloads = [
      '',
      'not a compact handshake',
      'v2|o|ufrag|password|AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=|192.168.1.20:5001',
      'v1|x|ufrag|password|AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=|192.168.1.20:5001',
      'v1|o|ufrag|password|AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=|192.168.1.20:not-a-port',
    ];

    for (const payload of invalidPayloads) {
      expect(() => decodeCompactHandshake(payload)).toThrow();
    }
  });
});
