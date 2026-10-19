/**
 * Keeps remote tracks in one stable MediaStream even when a browser omits or
 * changes the stream list on a later RTCTrackEvent.
 */
export const mergeRemoteTrack = (
  currentStream: MediaStream | null,
  eventStream: MediaStream | undefined,
  track: MediaStreamTrack,
): MediaStream => {
  const targetStream = currentStream ?? eventStream ?? new MediaStream();

  if (eventStream && eventStream !== targetStream) {
    eventStream.getTracks().forEach((eventTrack) => {
      if (!targetStream.getTracks().some((existingTrack) => existingTrack.id === eventTrack.id)) {
        targetStream.addTrack(eventTrack);
      }
    });
  }

  if (!targetStream.getTracks().some((existingTrack) => existingTrack.id === track.id)) {
    targetStream.addTrack(track);
  }

  return targetStream;
};
