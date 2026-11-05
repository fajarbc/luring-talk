export type DataChannelMessage =
  | { type: 'description'; description: RTCSessionDescriptionInit }
  | { type: 'candidate'; candidate: RTCIceCandidateInit };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isDescription = (value: unknown): value is RTCSessionDescriptionInit => {
  if (!isRecord(value)) return false;
  return (value.type === 'offer' || value.type === 'answer') &&
    typeof value.sdp === 'string' &&
    value.sdp.length > 0;
};

const isCandidate = (value: unknown): value is RTCIceCandidateInit => {
  if (!isRecord(value) || typeof value.candidate !== 'string') return false;

  const validSdpMid = value.sdpMid === undefined || value.sdpMid === null || typeof value.sdpMid === 'string';
  const validSdpMLineIndex = value.sdpMLineIndex === undefined ||
    value.sdpMLineIndex === null ||
    typeof value.sdpMLineIndex === 'number';
  const validUsernameFragment = value.usernameFragment === undefined ||
    value.usernameFragment === null ||
    typeof value.usernameFragment === 'string';

  return validSdpMid && validSdpMLineIndex && validUsernameFragment;
};

export const serializeDataChannelMessage = (message: DataChannelMessage): string =>
  JSON.stringify(message);

export const parseDataChannelMessage = (data: unknown): DataChannelMessage | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof data === 'string' ? data : String(data));
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  if (parsed.type === 'description' && isDescription(parsed.description)) {
    return { type: 'description', description: parsed.description };
  }
  if (parsed.type === 'candidate' && isCandidate(parsed.candidate)) {
    return { type: 'candidate', candidate: parsed.candidate };
  }

  return null;
};
