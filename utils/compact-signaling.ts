/**
 * Compact, LAN-only signaling primitives for the initial data-channel handshake.
 *
 * The QR payload deliberately contains only the ICE credentials, the DTLS
 * fingerprint, and a small set of host candidates. Once both peers have the
 * data channel, the application can exchange full SDP over it instead of
 * forcing media SDP through a QR code.
 */

export type CompactHandshakeRole = 'offer' | 'answer';

export interface CompactCandidate {
  address: string;
  port: number;
}

export interface CompactHandshake {
  version: 1;
  role: CompactHandshakeRole;
  ufrag: string;
  pwd: string;
  /** Base64-encoded raw SHA-256 fingerprint bytes. */
  fingerprint: string;
  candidates: CompactCandidate[];
}

const COMPACT_VERSION = 'v1';
const MAX_CANDIDATES = 3;
const SHA256_FINGERPRINT_BYTES = 32;
const PRIVATE_IPV4 = /^10\.(?:\d{1,3}\.){2}\d{1,3}$|^192\.168\.(?:\d{1,3})\.\d{1,3}$|^172\.(?:1[6-9]|2\d|3[0-1])\.(?:\d{1,3}\.)\d{1,3}$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const MDNS = /^[a-z0-9-]+\.local$/i;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const isValidPort = (port: number): boolean => Number.isInteger(port) && port > 0 && port <= 65535;

const isPrivateIpv4 = (address: string): boolean => {
  if (!IPV4.test(address) || !PRIVATE_IPV4.test(address)) return false;
  return address.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255);
};

const isUsableHostAddress = (address: string): boolean => isPrivateIpv4(address) || MDNS.test(address);

const isSameSubnet = (address: string, preferredSubnet?: string): boolean => {
  if (!preferredSubnet || !isPrivateIpv4(address) || !isPrivateIpv4(preferredSubnet)) return false;
  const addressParts = address.split('.');
  const preferredParts = preferredSubnet.split('.');
  return addressParts.slice(0, 3).join('.') === preferredParts.slice(0, 3).join('.');
};

interface ParsedSdpCandidate extends CompactCandidate {
  addressRank: number;
  sourceIndex: number;
}

const parseCandidateLine = (line: string, sourceIndex: number): ParsedSdpCandidate | null => {
  const fields = line.trim().split(/\s+/);
  if (fields.length < 8 || !fields[0].startsWith('a=candidate:')) return null;
  if (fields[2].toLowerCase() !== 'udp' || fields[6].toLowerCase() !== 'typ' || fields[7].toLowerCase() !== 'host') return null;

  const address = fields[4];
  const port = Number(fields[5]);
  if (!isUsableHostAddress(address) || !isValidPort(port)) return null;

  return {
    address,
    port,
    addressRank: isPrivateIpv4(address) ? 0 : 1,
    sourceIndex,
  };
};

/**
 * Selects at most three host candidates, preferring private IPv4 addresses
 * (and the known LAN subnet) over mDNS names. Candidates are deduplicated by
 * address so a VPN/Docker interface cannot crowd out the useful LAN address.
 */
export const selectHostCandidates = (
  candidateLines: string[],
  preferredSubnet?: string,
  maxCandidates = MAX_CANDIDATES,
): CompactCandidate[] => {
  const deduped = new Map<string, ParsedSdpCandidate>();

  candidateLines.forEach((line, sourceIndex) => {
    const parsed = parseCandidateLine(line, sourceIndex);
    if (!parsed || deduped.has(parsed.address)) return;
    deduped.set(parsed.address, parsed);
  });

  return [...deduped.values()]
    .sort((left, right) => {
      const leftSubnetRank = isSameSubnet(left.address, preferredSubnet) ? 0 : 1;
      const rightSubnetRank = isSameSubnet(right.address, preferredSubnet) ? 0 : 1;
      return leftSubnetRank - rightSubnetRank || left.addressRank - right.addressRank || left.sourceIndex - right.sourceIndex;
    })
    .slice(0, Math.max(1, maxCandidates))
    .map(({ address, port }) => ({ address, port }));
};

const fingerprintToBase64 = (fingerprint: string): string => {
  const hex = fingerprint.replace(/[^0-9a-f]/gi, '');
  if (hex.length !== SHA256_FINGERPRINT_BYTES * 2 || hex.length % 2 !== 0) {
    throw new Error('Expected a SHA-256 DTLS fingerprint with 32 bytes.');
  }

  const bytes = new Uint8Array(SHA256_FINGERPRINT_BYTES);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return toBase64(bytes);
};

const base64ToFingerprint = (encoded: string): string => {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(encoded);
  } catch {
    throw new Error('Compact handshake fingerprint is not valid base64.');
  }
  if (bytes.length !== SHA256_FINGERPRINT_BYTES) {
    throw new Error('Compact handshake fingerprint must contain 32 bytes.');
  }

  return [...bytes]
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
};

const assertTokenSafe = (value: string, label: string): void => {
  if (!value || value.includes('|') || value.includes(',')) {
    throw new Error(`Compact handshake ${label} is invalid.`);
  }
};

const roleToken = (role: CompactHandshakeRole): 'o' | 'a' => role === 'offer' ? 'o' : 'a';
const parseRoleToken = (token: string): CompactHandshakeRole => {
  if (token === 'o') return 'offer';
  if (token === 'a') return 'answer';
  throw new Error('Compact handshake role must be o or a.');
};

/**
 * Encodes a validated handshake into the QR-friendly wire format:
 * v1|o|ufrag|pwd|fingerprint-base64|ip:port,ip:port
 */
export const encodeCompactHandshake = (handshake: CompactHandshake): string => {
  if (handshake.version !== 1) throw new Error('Unsupported compact handshake version.');
  assertTokenSafe(handshake.ufrag, 'ufrag');
  assertTokenSafe(handshake.pwd, 'password');
  const fingerprint = fingerprintToBase64(base64ToFingerprint(handshake.fingerprint));
  if (!handshake.candidates.length || handshake.candidates.length > MAX_CANDIDATES) {
    throw new Error(`Compact handshake must contain 1-${MAX_CANDIDATES} candidates.`);
  }

  const candidates = handshake.candidates.map(({ address, port }) => {
    if (!isUsableHostAddress(address) || !isValidPort(port)) {
      throw new Error('Compact handshake contains an invalid host candidate.');
    }
    return `${address}:${port}`;
  });

  return [COMPACT_VERSION, roleToken(handshake.role), handshake.ufrag, handshake.pwd, fingerprint, candidates.join(',')].join('|');
};

const parseCandidateToken = (token: string): CompactCandidate => {
  const separator = token.lastIndexOf(':');
  if (separator <= 0) throw new Error('Compact handshake candidate is missing its port.');
  const address = token.slice(0, separator).replace(/^\[|\]$/g, '');
  const port = Number(token.slice(separator + 1));
  if (!isUsableHostAddress(address) || !isValidPort(port)) {
    throw new Error('Compact handshake contains an invalid host candidate.');
  }
  return { address, port };
};

/** Decodes and validates the QR wire format without touching WebRTC globals. */
export const decodeCompactHandshake = (value: string): CompactHandshake => {
  const fields = value.trim().split('|');
  if (fields.length !== 6 || fields[0] !== COMPACT_VERSION) {
    throw new Error('Unsupported compact handshake format.');
  }

  const [, roleTokenValue, ufrag, pwd, fingerprint, candidateField] = fields;
  const role = parseRoleToken(roleTokenValue);
  assertTokenSafe(ufrag, 'ufrag');
  assertTokenSafe(pwd, 'password');
  base64ToFingerprint(fingerprint);

  const candidates = candidateField.split(',').filter(Boolean).map(parseCandidateToken);
  if (!candidates.length || candidates.length > MAX_CANDIDATES) {
    throw new Error(`Compact handshake must contain 1-${MAX_CANDIDATES} candidates.`);
  }
  const uniqueAddresses = new Set(candidates.map(({ address }) => address));
  if (uniqueAddresses.size !== candidates.length) {
    throw new Error('Compact handshake candidates must be unique by address.');
  }

  return { version: 1, role, ufrag, pwd, fingerprint, candidates };
};

const readSdpAttribute = (lines: string[], prefix: string): string => {
  const line = lines.find((candidate) => candidate.startsWith(prefix));
  if (!line) throw new Error(`SDP is missing ${prefix}.`);
  const value = line.slice(prefix.length).trim();
  if (!value) throw new Error(`SDP is missing a value for ${prefix}.`);
  return value;
};

/** Extracts the compact QR payload from an offer or answer SDP. */
export const compactHandshakeFromSdp = (
  role: CompactHandshakeRole,
  sdp: string,
  preferredSubnet?: string,
): string => {
  const lines = sdp.replace(/\r/g, '').split('\n').map((line) => line.trim()).filter(Boolean);
  const candidateLines = lines.filter((line) => line.startsWith('a=candidate:'));
  const candidates = selectHostCandidates(candidateLines, preferredSubnet);
  if (!candidates.length) throw new Error('SDP contains no usable private host candidates.');

  const fingerprint = fingerprintToBase64(readSdpAttribute(lines, 'a=fingerprint:sha-256 '));
  return encodeCompactHandshake({
    version: 1,
    role,
    ufrag: readSdpAttribute(lines, 'a=ice-ufrag:'),
    pwd: readSdpAttribute(lines, 'a=ice-pwd:'),
    fingerprint,
    candidates,
  });
};

export interface DataChannelSdpOptions {
  sessionId?: string;
}

/** Rebuilds a minimal SDP offer/answer for the initial data-channel exchange. */
export const buildDataChannelSdp = (
  handshake: CompactHandshake,
  options: DataChannelSdpOptions = {},
): string => {
  const decoded = decodeCompactHandshake(encodeCompactHandshake(handshake));
  const setup = decoded.role === 'offer' ? 'actpass' : 'active';
  const sessionId = options.sessionId || '0';
  assertTokenSafe(sessionId, 'session id');

  const candidateLines = decoded.candidates.map(({ address, port }, index) => (
    `a=candidate:${index + 1} 1 UDP ${2130706431 - index} ${address} ${port} typ host`
  ));

  return [
    'v=0',
    `o=- ${sessionId} 2 IN IP4 0.0.0.0`,
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    `a=ice-ufrag:${decoded.ufrag}`,
    `a=ice-pwd:${decoded.pwd}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${base64ToFingerprint(decoded.fingerprint)}`,
    `a=setup:${setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    ...candidateLines,
    'a=end-of-candidates',
    '',
  ].join('\r\n');
};
