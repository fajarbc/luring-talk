import { describe, expect, it } from 'vitest';
import {
  buildDataChannelSdp,
  compactHandshakeFromSdp,
  decodeCompactHandshake,
} from './compact-signaling';
import { browserShapedSdpFixtures } from './compact-signaling.fixtures';

const fingerprintHex = '00:01:02:03:04:05:06:07:08:09:0A:0B:0C:0D:0E:0F:10:11:12:13:14:15:16:17:18:19:1A:1B:1C:1D:1E:1F';

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
      expect(rebuiltSdp).not.toMatch(/^m=(audio|video) /m);
      expect(rebuiltSdp.match(/^a=candidate:/gm)).toHaveLength(fixture.expectedCandidates.length);
      expect(rebuiltSdp).toContain('a=end-of-candidates');
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

  it('rejects malformed SDP before it can produce a QR payload', () => {
    const commonLines = [
      'v=0',
      'a=ice-ufrag:offerUfrag',
      'a=ice-pwd:offerPassword',
    ];
    const candidate = 'a=candidate:1 1 UDP 2130706431 192.168.1.20 5001 typ host';
    const sdpWith = (fingerprintLine: string, candidateLine: string) => [
      ...commonLines,
      fingerprintLine,
      candidateLine,
    ].join('\r\n');
    const malformedSdps = [
      commonLines.join('\r\n'),
      sdpWith(
        `a=fingerprint:sha-256 ${fingerprintHex}`,
        'a=candidate:1 1 UDP 2130706431 192.168.1.20 0 typ host',
      ),
      sdpWith(
        `a=fingerprint:sha-256 ${fingerprintHex}`,
        'a=candidate:1 1 TCP 2130706431 192.168.1.20 5001 typ host',
      ),
      sdpWith('a=fingerprint:sha-256 truncated', candidate),
      sdpWith(
        `a=fingerprint:sha-256 ${fingerprintHex}`,
        'a=candidate:1 1 UDP 2130706431 203.0.113.8 5001 typ srflx raddr 192.168.1.20 rport 5001',
      ),
    ];

    for (const sdp of malformedSdps) {
      expect(() => compactHandshakeFromSdp('offer', sdp)).toThrow();
    }
  });
});
