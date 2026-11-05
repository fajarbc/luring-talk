type StateSetter<T> = (value: T) => void;

export type FacingMode = 'user' | 'environment';

export async function captureLocalMedia(
  setError: StateSetter<string | null>,
  setWarning: StateSetter<string | null>,
): Promise<MediaStream | null> {
  const audio = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  try {
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
          facingMode: 'user',
        },
        audio,
      });
    } catch (videoError) {
      console.warn('Video initialization failed, falling back to audio-only.', videoError);
      setWarning('Video device failed. Switching to audio-only mode.');
      return await navigator.mediaDevices.getUserMedia({ audio, video: false });
    }
  } catch (mediaError) {
    console.error('Error getting media:', mediaError);
    setError('Could not access microphone or camera. Please check permissions.');
    return null;
  }
}

export async function switchLocalCamera(
  stream: MediaStream | null,
  peer: RTCPeerConnection | null,
  facingMode: FacingMode,
  setWarning: StateSetter<string | null>,
): Promise<FacingMode | null> {
  if (!stream) return null;
  const currentVideo = stream.getVideoTracks()[0];
  if (!currentVideo) {
    setWarning('Cannot switch camera in audio-only mode.');
    return null;
  }

  const nextMode: FacingMode = facingMode === 'user' ? 'environment' : 'user';
  try {
    const newStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: nextMode,
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    });
    const newTrack = newStream.getVideoTracks()[0];
    if (!newTrack) throw new Error('No camera track was returned.');
    newTrack.enabled = currentVideo.enabled;
    const sender = peer?.getSenders().find((candidate) => candidate.track?.kind === 'video');
    await sender?.replaceTrack(newTrack);
    currentVideo.stop();
    stream.removeTrack(currentVideo);
    stream.addTrack(newTrack);
    return nextMode;
  } catch (switchError) {
    console.error('Failed to switch camera:', switchError);
    setWarning('Unable to switch camera.');
    return null;
  }
}
