import type { CompactCandidate, CompactHandshakeRole } from './compact-signaling';

/**
 * Sanitized, browser-shaped SDP fixtures for the compact extractor.
 *
 * They keep the candidate variations that matter to the QR payload while
 * avoiding device-specific session identifiers and media sections. Real
 * Chrome, Safari, and Firefox captures still belong in device-lab acceptance.
 */
export interface CompactSignalingFixture {
  label: string;
  role: CompactHandshakeRole;
  preferredSubnet: string;
  sdp: string;
  expectedCandidates: CompactCandidate[];
}

const fingerprint = '00:01:02:03:04:05:06:07:08:09:0A:0B:0C:0D:0E:0F:10:11:12:13:14:15:16:17:18:19:1A:1B:1C:1D:1E:1F';

export const browserShapedSdpFixtures: readonly CompactSignalingFixture[] = [
  {
    label: 'Chrome Android hotspot candidates',
    role: 'offer',
    preferredSubnet: '192.168.43.1',
    sdp: [
      'v=0',
      'o=- 123 2 IN IP4 0.0.0.0',
      's=-',
      't=0 0',
      'a=ice-ufrag:androidOffer',
      'a=ice-pwd:androidPassword',
      `a=fingerprint:sha-256 ${fingerprint}`,
      'a=candidate:1 1 UDP 2113937151 10.0.0.5 54400 typ host generation 0 ufrag:androidOffer network-cost 999',
      'a=candidate:2 1 UDP 2113937150 android-phone.local 54401 typ host generation 0 ufrag:androidOffer',
      'a=candidate:3 1 UDP 2113937149 192.168.43.25 54402 typ host generation 0 ufrag:androidOffer',
      'a=candidate:4 1 UDP 1677734911 198.51.100.20 54403 typ srflx raddr 192.168.43.25 rport 54402',
    ].join('\r\n'),
    expectedCandidates: [
      { address: '192.168.43.25', port: 54402 },
      { address: '10.0.0.5', port: 54400 },
      { address: 'android-phone.local', port: 54401 },
    ],
  },
  {
    label: 'Safari iOS hotspot candidates',
    role: 'answer',
    preferredSubnet: '192.168.43.1',
    sdp: [
      'v=0',
      'o=- 456 2 IN IP4 0.0.0.0',
      's=-',
      't=0 0',
      'a=ice-ufrag:iosAnswer',
      'a=ice-pwd:iosPassword',
      `a=fingerprint:sha-256 ${fingerprint}`,
      'a=candidate:1 1 udp 2113937151 10.0.0.8 54500 typ host',
      'a=candidate:2 1 udp 2113937150 iphone-camera.local 54501 typ host',
      'a=candidate:3 1 udp 2113937149 192.168.43.26 54502 typ host',
      'a=candidate:4 1 tcp 2113937148 192.168.43.27 54503 typ host',
    ].join('\r\n'),
    expectedCandidates: [
      { address: '192.168.43.26', port: 54502 },
      { address: '10.0.0.8', port: 54500 },
      { address: 'iphone-camera.local', port: 54501 },
    ],
  },
  {
    label: 'Firefox desktop with Docker candidates',
    role: 'offer',
    preferredSubnet: '192.168.1.1',
    sdp: [
      'v=0',
      'o=- 789 2 IN IP4 0.0.0.0',
      's=-',
      't=0 0',
      'a=ice-ufrag:firefoxOffer',
      'a=ice-pwd:firefoxPassword',
      `a=fingerprint:sha-256 ${fingerprint}`,
      'a=candidate:1 1 UDP 2113937151 172.20.0.2 54600 typ host',
      'a=candidate:2 1 UDP 2113937150 192.168.1.42 54601 typ host',
      'a=candidate:3 1 UDP 2113937149 firefox-desktop.local 54602 typ host',
      'a=candidate:4 1 UDP 2113937148 192.168.1.43 54603 typ host',
      'a=candidate:5 1 UDP 1677734911 203.0.113.8 54604 typ srflx raddr 192.168.1.42 rport 54601',
    ].join('\r\n'),
    expectedCandidates: [
      { address: '192.168.1.42', port: 54601 },
      { address: '192.168.1.43', port: 54603 },
      { address: '172.20.0.2', port: 54600 },
    ],
  },
];
