import { describe, expect, it } from 'vitest';
import {
  buildDataChannelSdp,
  compactHandshakeFromSdp,
  decodeCompactHandshake,
  encodeCompactHandshake,
  getPrivateIpv4Subnet,
  selectHostCandidates,
  type CompactHandshake,
} from './compact-signaling';

const fingerprint = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const fingerprintHex = '00:01:02:03:04:05:06:07:08:09:0A:0B:0C:0D:0E:0F:10:11:12:13:14:15:16:17:18:19:1A:1B:1C:1D:1E:1F';

const handshake: CompactHandshake = {
  version: 1,
  role: 'offer',
  ufrag: 'offerUfrag',
  pwd: 'offerPassword',
  fingerprint,
  candidates: [
    { address: '192.168.1.20', port: 5001 },
    { address: '10.0.0.4', port: 5002 },
    { address: 'phone.local', port: 5003 },
  ],
};

describe('compact signaling', () => {
  it('round-trips the QR handshake without changing its fields', () => {
    const encoded = encodeCompactHandshake(handshake);

    expect(encoded).toBe(
      `v1|o|offerUfrag|offerPassword|${fingerprint}|192.168.1.20:5001,10.0.0.4:5002,phone.local:5003`,
    );
    expect(decodeCompactHandshake(encoded)).toEqual(handshake);
  });

  it('derives a /24 subnet only from private IPv4 addresses', () => {
    expect(getPrivateIpv4Subnet('192.168.44.12')).toBe('192.168.44');
    expect(getPrivateIpv4Subnet('10.8.0.2')).toBe('10.8.0');
    expect(getPrivateIpv4Subnet('fajarbc.github.io')).toBeUndefined();
    expect(getPrivateIpv4Subnet('192.168.999.12')).toBeUndefined();
  });

  it('selects three unique host candidates in LAN-first order', () => {
    const candidates = selectHostCandidates([
      'a=candidate:1 1 UDP 2130706431 10.0.0.4 5001 typ host',
      'a=candidate:2 1 UDP 2130706430 192.168.1.20 5002 typ host',
      'a=candidate:3 1 UDP 2122260223 192.168.1.21 5003 typ host',
      'a=candidate:4 1 UDP 2122260222 192.168.1.20 5004 typ host',
      'a=candidate:5 1 TCP 2122260221 192.168.1.22 5005 typ host',
      'a=candidate:6 1 UDP 2122260220 203.0.113.10 5006 typ srflx raddr 192.168.1.20 rport 5006',
      'a=candidate:7 1 UDP 2122260219 phone.local 5007 typ host',
    ], '192.168.1.99');

    expect(candidates).toEqual([
      { address: '192.168.1.20', port: 5002 },
      { address: '192.168.1.21', port: 5003 },
      { address: '10.0.0.4', port: 5001 },
    ]);
  });

  it('limits the candidate list without replacing the first port for a duplicate address', () => {
    expect(selectHostCandidates([
      'a=candidate:1 1 UDP 2130706431 10.0.0.4 5001 typ host',
      'a=candidate:2 1 UDP 2130706430 192.168.1.20 5002 typ host',
      'a=candidate:3 1 UDP 2122260229 192.168.1.20 5003 typ host',
      'a=candidate:4 1 UDP 2122260228 172.20.0.2 5004 typ host',
    ], undefined, 2)).toEqual([
      { address: '10.0.0.4', port: 5001 },
      { address: '192.168.1.20', port: 5002 },
    ]);
  });

  it('keeps the detected LAN candidate ahead of Docker and VPN interfaces in the compact handshake', () => {
    const sdp = [
      'v=0',
      'a=ice-ufrag:offerUfrag',
      'a=ice-pwd:offerPassword',
      `a=fingerprint:sha-256 ${fingerprintHex}`,
      'a=candidate:1 1 UDP 2130706431 172.20.0.2 5001 typ host',
      'a=candidate:2 1 UDP 2130706430 10.8.0.2 5002 typ host',
      'a=candidate:3 1 UDP 2122260223 192.168.44.12 5003 typ host',
      'a=candidate:4 1 UDP 2122260222 192.168.44.12 5004 typ host',
      'a=candidate:5 1 UDP 2122260221 192.168.44.13 5005 typ host',
    ].join('\r\n');

    expect(decodeCompactHandshake(compactHandshakeFromSdp('offer', sdp, getPrivateIpv4Subnet('192.168.44.1'))).candidates).toEqual([
      { address: '192.168.44.12', port: 5003 },
      { address: '192.168.44.13', port: 5005 },
      { address: '172.20.0.2', port: 5001 },
    ]);
  });

  it('uses valid mDNS candidates only after filtering unusable host lines', () => {
    const candidates = selectHostCandidates([
      'a=candidate:1 1 UDP 2130706431 127.0.0.1 5001 typ host',
      'a=candidate:2 1 UDP 2130706430 8.8.8.8 5002 typ host',
      'a=candidate:3 1 UDP 2122260223 192.168.1.20 5003 typ srflx raddr 192.168.1.21 rport 5003',
      'a=candidate:4 1 TCP 2122260222 192.168.1.21 5004 typ host',
      'a=candidate:5 1 UDP 2122260221 phone.local 5005 typ host',
      'a=candidate:6 1 UDP 2122260220 tablet.local 5006 typ host',
    ]);

    expect(candidates).toEqual([
      { address: 'phone.local', port: 5005 },
      { address: 'tablet.local', port: 5006 },
    ]);
  });

  it('extracts a compact handshake from data-channel SDP', () => {
    const sdp = [
      'v=0',
      'a=ice-ufrag:offerUfrag',
      'a=ice-pwd:offerPassword',
      `a=fingerprint:sha-256 ${fingerprintHex}`,
      'a=candidate:1 1 UDP 2130706431 192.168.1.20 5001 typ host',
      'a=candidate:2 1 UDP 2130706430 phone.local 5002 typ host',
      'a=candidate:3 1 UDP 2122260229 10.0.0.4 5003 typ host',
    ].join('\r\n');

    expect(decodeCompactHandshake(compactHandshakeFromSdp('offer', sdp))).toEqual({
      ...handshake,
      candidates: [
        { address: '192.168.1.20', port: 5001 },
        { address: '10.0.0.4', port: 5003 },
        { address: 'phone.local', port: 5002 },
      ],
    });
  });

  it('builds a valid data-channel SDP template for both roles', () => {
    const offerSdp = buildDataChannelSdp(handshake, { sessionId: '123' });
    const answerSdp = buildDataChannelSdp({ ...handshake, role: 'answer' });

    expect(offerSdp).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');
    expect(offerSdp).toContain('a=setup:actpass');
    expect(offerSdp).toContain('a=sctp-port:5000');
    expect(offerSdp).toContain(`a=fingerprint:sha-256 ${fingerprintHex}`);
    expect(offerSdp.match(/^a=candidate:/gm)).toHaveLength(3);
    expect(offerSdp).toContain('o=- 123 2 IN IP4 0.0.0.0');
    expect(answerSdp).toContain('a=setup:active');
  });

  it('rejects malformed fingerprints, duplicate candidate addresses, and invalid ports', () => {
    expect(() => decodeCompactHandshake('v1|o|ufrag|pwd|not-base64|192.168.1.20:5001')).toThrow(
      'Compact handshake fingerprint',
    );

    expect(() => decodeCompactHandshake(
      `v1|o|ufrag|pwd|${fingerprint}|192.168.1.20:5001,192.168.1.20:5002`,
    )).toThrow('candidates must be unique');

    expect(() => decodeCompactHandshake(
      `v1|o|ufrag|pwd|${fingerprint}|192.168.1.20:0`,
    )).toThrow('invalid host candidate');
  });
});
