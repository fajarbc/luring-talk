import { afterEach, describe, expect, it, vi } from 'vitest';
import { mergeRemoteTrack } from './remote-media';

class FakeMediaStream {
  private readonly tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }

  addTrack(track: MediaStreamTrack): void {
    this.tracks.push(track);
  }

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }
}

const createTrack = (id: string, kind: 'audio' | 'video'): MediaStreamTrack => ({ id, kind } as MediaStreamTrack);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('mergeRemoteTrack', () => {
  it('keeps the browser-provided stream and avoids duplicate tracks', () => {
    const audioTrack = createTrack('audio-1', 'audio');
    const eventStream = new FakeMediaStream([audioTrack]) as unknown as MediaStream;

    const result = mergeRemoteTrack(null, eventStream, audioTrack);

    expect(result).toBe(eventStream);
    expect(result.getTracks()).toEqual([audioTrack]);
  });

  it('creates one stable stream when track events do not include streams', () => {
    vi.stubGlobal('MediaStream', FakeMediaStream);
    const audioTrack = createTrack('audio-1', 'audio');
    const videoTrack = createTrack('video-1', 'video');

    const firstResult = mergeRemoteTrack(null, undefined, audioTrack);
    const secondResult = mergeRemoteTrack(firstResult, undefined, videoTrack);

    expect(secondResult).toBe(firstResult);
    expect(secondResult.getTracks()).toEqual([audioTrack, videoTrack]);
  });

  it('merges tracks from a changed browser-provided stream into the current stream', () => {
    const audioTrack = createTrack('audio-1', 'audio');
    const videoTrack = createTrack('video-1', 'video');
    const currentStream = new FakeMediaStream([audioTrack]) as unknown as MediaStream;
    const eventStream = new FakeMediaStream([videoTrack]) as unknown as MediaStream;

    const result = mergeRemoteTrack(currentStream, eventStream, videoTrack);

    expect(result).toBe(currentStream);
    expect(result.getTracks()).toEqual([audioTrack, videoTrack]);
  });
});
