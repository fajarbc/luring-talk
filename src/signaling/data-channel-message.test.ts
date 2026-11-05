import { describe, expect, it } from 'vitest';
import {
  parseDataChannelMessage,
  serializeDataChannelMessage,
  type DataChannelMessage,
} from './data-channel-message';

describe('data-channel message codec', () => {
  it('round-trips session descriptions', () => {
    const message: DataChannelMessage = {
      type: 'description',
      description: { type: 'offer', sdp: 'v=0\r\n' },
    };

    expect(parseDataChannelMessage(serializeDataChannelMessage(message))).toEqual(message);
  });

  it('round-trips ICE candidates', () => {
    const message: DataChannelMessage = {
      type: 'candidate',
      candidate: {
        candidate: 'candidate:1 1 UDP 2122252543 192.168.1.2 50000 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: 'local-ufrag',
      },
    };

    expect(parseDataChannelMessage(serializeDataChannelMessage(message))).toEqual(message);
  });

  it('rejects malformed JSON and unsupported message shapes', () => {
    expect(parseDataChannelMessage('{')).toBeNull();
    expect(parseDataChannelMessage('[]')).toBeNull();
    expect(parseDataChannelMessage('{"type":"description","description":{"type":"rollback","sdp":"v=0"}}')).toBeNull();
    expect(parseDataChannelMessage('{"type":"candidate","candidate":{"candidate":3}}')).toBeNull();
  });
});
