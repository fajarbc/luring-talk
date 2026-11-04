import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { AppState } from '../../types';
import { mergeRemoteTrack } from '../../utils/remote-media';
import {
  parseDataChannelMessage,
  serializeDataChannelMessage,
  type DataChannelMessage,
} from '../signaling/data-channel-message';

const ICE_GATHERING_TIMEOUT = 10000;
const DISCONNECT_GRACE_PERIOD = 5000;
const RECOVERY_TIMEOUT = 20000;
const MAX_ICE_RESTART_ATTEMPTS = 1;

type ConnectionRole = 'offerer' | 'answerer';
type FacingMode = 'user' | 'environment';

interface PeerConnectionOptions {
  appendDebug: (message: string) => void;
  setAppState: Dispatch<SetStateAction<AppState>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setWarning: Dispatch<SetStateAction<string | null>>;
}

export function usePeerConnection({
  appendDebug,
  setAppState,
  setError,
  setWarning,
}: PeerConnectionOptions) {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isReconnecting, setIsReconnecting] = useState(false);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const mediaStarted = useRef(false);
  const dataChannelReady = useRef(false);
  const initialHandshakeComplete = useRef(false);
  const makingOffer = useRef(false);
  const ignoreOffer = useRef(false);
  const isSettingRemoteAnswerPending = useRef(false);
  const disconnectTimer = useRef<number | null>(null);
  const recoveryTimeout = useRef<number | null>(null);
  const recoveryStartedAt = useRef<number | null>(null);
  const iceRestartAttempts = useRef(0);
  const userEndedCall = useRef(false);
  const iceGatheringWaitCleanup = useRef<(() => void) | null>(null);

  const clearRecoveryTimers = useCallback((): boolean => {
    const wasRecovering = recoveryStartedAt.current !== null;
    if (disconnectTimer.current !== null) {
      window.clearTimeout(disconnectTimer.current);
      disconnectTimer.current = null;
    }
    if (recoveryTimeout.current !== null) {
      window.clearTimeout(recoveryTimeout.current);
      recoveryTimeout.current = null;
    }
    recoveryStartedAt.current = null;
    iceRestartAttempts.current = 0;
    setIsReconnecting(false);
    return wasRecovering;
  }, []);

  const requestIceRestart = useCallback((peer: RTCPeerConnection) => {
    if (
      userEndedCall.current ||
      peerRef.current !== peer ||
      iceRestartAttempts.current >= MAX_ICE_RESTART_ATTEMPTS
    ) {
      return;
    }

    iceRestartAttempts.current += 1;
    appendDebug(`🔁 Restarting ICE (attempt ${iceRestartAttempts.current}/${MAX_ICE_RESTART_ATTEMPTS})`);
    try {
      peer.restartIce();
    } catch (restartError) {
      console.error('ICE restart failed:', restartError);
      clearRecoveryTimers();
      setError(`Connection recovery failed: ${(restartError as Error).message}`);
    }
  }, [appendDebug, clearRecoveryTimers, setError]);

  const armConnectionRecovery = useCallback((peer: RTCPeerConnection, restartImmediately = false) => {
    if (userEndedCall.current || peerRef.current !== peer) return;

    if (recoveryStartedAt.current === null) {
      recoveryStartedAt.current = Date.now();
      appendDebug('⚠️ Connection interrupted; allowing a short recovery window');
    }
    setIsReconnecting(true);

    if (recoveryTimeout.current === null) {
      recoveryTimeout.current = window.setTimeout(() => {
        recoveryTimeout.current = null;
        if (userEndedCall.current || peerRef.current !== peer || peer.connectionState === 'connected') return;
        clearRecoveryTimers();
        setError('Connection failed after 20 seconds of recovery attempts. Please retry the call.');
      }, RECOVERY_TIMEOUT);
    }

    if (restartImmediately) {
      if (disconnectTimer.current !== null) {
        window.clearTimeout(disconnectTimer.current);
        disconnectTimer.current = null;
      }
      requestIceRestart(peer);
      return;
    }

    if (disconnectTimer.current !== null || iceRestartAttempts.current >= MAX_ICE_RESTART_ATTEMPTS) return;
    disconnectTimer.current = window.setTimeout(() => {
      disconnectTimer.current = null;
      if (userEndedCall.current || peerRef.current !== peer || peer.connectionState === 'connected') return;
      requestIceRestart(peer);
    }, DISCONNECT_GRACE_PERIOD);
  }, [appendDebug, clearRecoveryTimers, requestIceRestart, setError]);

  const captureLocalMedia = useCallback(async (): Promise<MediaStream | null> => {
    const audio = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
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
        stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      }

      localStreamRef.current = stream;
      return stream;
    } catch (mediaError) {
      console.error('Error getting media:', mediaError);
      setError('Could not access microphone or camera. Please check permissions.');
      return null;
    }
  }, [setError, setWarning]);

  const sendDataChannelMessage = useCallback((message: DataChannelMessage): boolean => {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== 'open') return false;
    channel.send(serializeDataChannelMessage(message));
    return true;
  }, []);

  const sendLocalDescription = useCallback((peer: RTCPeerConnection) => {
    const description = peer.localDescription;
    if (description) {
      sendDataChannelMessage({
        type: 'description',
        description: {
          type: description.type,
          sdp: description.sdp,
        },
      });
    }
  }, [sendDataChannelMessage]);

  const handleDataChannelMessage = useCallback(async (
    peer: RTCPeerConnection,
    polite: boolean,
    event: MessageEvent,
  ) => {
    const message = parseDataChannelMessage(event.data);
    if (!message) {
      appendDebug('⚠️ Ignored malformed signaling message');
      return;
    }

    if (message.type === 'candidate') {
      try {
        await peer.addIceCandidate(message.candidate);
      } catch (candidateError) {
        if (!ignoreOffer.current) {
          console.error('Error adding remote ICE candidate:', candidateError);
        }
      }
      return;
    }

    const description = message.description;
    try {
      const readyForOffer = !makingOffer.current && (
        peer.signalingState === 'stable' || isSettingRemoteAnswerPending.current
      );
      const offerCollision = description.type === 'offer' && !readyForOffer;
      ignoreOffer.current = !polite && offerCollision;
      if (ignoreOffer.current) {
        appendDebug('↩️ Ignored colliding offer on impolite peer');
        return;
      }

      isSettingRemoteAnswerPending.current = description.type === 'answer';
      await peer.setRemoteDescription(description);
      isSettingRemoteAnswerPending.current = false;
      appendDebug(`📨 Remote ${description.type} received over data channel`);

      if (description.type === 'offer') {
        await peer.setLocalDescription();
        sendLocalDescription(peer);
      }
    } catch (descriptionError) {
      isSettingRemoteAnswerPending.current = false;
      console.error('Error handling data-channel description:', descriptionError);
      setError(`Renegotiation failed: ${(descriptionError as Error).message}`);
    }
  }, [appendDebug, sendLocalDescription, setError]);

  const startMediaAndRenegotiate = useCallback(async () => {
    const peer = peerRef.current;
    if (!peer || mediaStarted.current) return;

    mediaStarted.current = true;
    const stream = await captureLocalMedia();
    if (!stream) {
      mediaStarted.current = false;
      return;
    }

    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    appendDebug('🎥 Local media added; renegotiation will use the data channel');
    setAppState(AppState.CONNECTED);
  }, [appendDebug, captureLocalMedia, setAppState]);

  const setupDataChannel = useCallback((
    peer: RTCPeerConnection,
    channel: RTCDataChannel,
    polite: boolean,
  ) => {
    if (dataChannelRef.current === channel) return;
    dataChannelRef.current = channel;
    channel.binaryType = 'arraybuffer';
    channel.onopen = () => {
      dataChannelReady.current = true;
      initialHandshakeComplete.current = true;
      appendDebug('🔌 Signaling data channel open');
      setWarning('Secure signaling channel connected. Starting media…');
      void startMediaAndRenegotiate();
    };
    channel.onmessage = (event) => {
      void handleDataChannelMessage(peer, polite, event);
    };
    channel.onclose = () => {
      dataChannelReady.current = false;
      appendDebug('🔌 Signaling data channel closed');
    };
    channel.onerror = (event) => {
      console.error('Data channel error:', event);
      setError('Signaling channel failed. Please retry.');
    };
  }, [appendDebug, handleDataChannelMessage, setError, setWarning, startMediaAndRenegotiate]);

  const initializePeerConnection = useCallback(async (connectionRole: ConnectionRole) => {
    userEndedCall.current = false;
    clearRecoveryTimers();
    const peer = new RTCPeerConnection({
      iceServers: [],
      iceTransportPolicy: 'all',
      iceCandidatePoolSize: 0,
    });
    const polite = connectionRole === 'answerer';

    peer.onicecandidate = (event) => {
      if (!event.candidate || !dataChannelReady.current) return;
      sendDataChannelMessage({
        type: 'candidate',
        candidate: event.candidate.toJSON(),
      });
    };

    peer.onnegotiationneeded = async () => {
      if (!initialHandshakeComplete.current || !dataChannelReady.current) return;
      try {
        makingOffer.current = true;
        await peer.setLocalDescription();
        sendLocalDescription(peer);
      } catch (negotiationError) {
        console.error('Negotiation error:', negotiationError);
        setError(`Negotiation failed: ${(negotiationError as Error).message}`);
      } finally {
        makingOffer.current = false;
      }
    };

    peer.ondatachannel = (event) => {
      setupDataChannel(peer, event.channel, polite);
    };

    peer.ontrack = (event) => {
      const stream = mergeRemoteTrack(remoteStreamRef.current, event.streams[0], event.track);
      remoteStreamRef.current = stream;
      setRemoteStream(stream);
      appendDebug(`📹 Remote ${event.track.kind} received with stream`);
      if (localStreamRef.current) setAppState(AppState.CONNECTED);
    };

    peer.onconnectionstatechange = () => {
      const connectionState = peer.connectionState;
      appendDebug(`🔗 Connection: ${connectionState}`);
      if (connectionState === 'connected') {
        const wasRecovering = clearRecoveryTimers();
        if (wasRecovering && !userEndedCall.current) {
          setWarning('Connection restored.');
        }
        return;
      }
      if (connectionState === 'disconnected') {
        armConnectionRecovery(peer);
        return;
      }
      if (connectionState === 'failed') {
        if (iceRestartAttempts.current < MAX_ICE_RESTART_ATTEMPTS) {
          armConnectionRecovery(peer, true);
          return;
        }
        if (!userEndedCall.current && peerRef.current === peer) {
          clearRecoveryTimers();
          setError('Connection failed after retrying ICE. Please retry the call.');
        }
      }
    };

    peer.oniceconnectionstatechange = () => {
      appendDebug(`❄️ ICE: ${peer.iceConnectionState}`);
    };

    peer.onsignalingstatechange = () => {
      appendDebug(`📬 Signaling: ${peer.signalingState}`);
    };

    peerRef.current = peer;
    return peer;
  }, [appendDebug, armConnectionRecovery, clearRecoveryTimers, sendDataChannelMessage, sendLocalDescription, setError, setWarning, setupDataChannel, setAppState]);

  const createOfferDataChannel = useCallback((peer: RTCPeerConnection) => {
    const channel = peer.createDataChannel('luring-signaling');
    setupDataChannel(peer, channel, false);
    return channel;
  }, [setupDataChannel]);

  const waitForIceGathering = useCallback((peer: RTCPeerConnection): Promise<boolean> => new Promise((resolve) => {
    let settled = false;
    const timers: { timeoutId?: number; checkInterval?: number } = {};

    const settle = (completed: boolean) => {
      if (settled) return;
      settled = true;
      if (timers.checkInterval !== undefined) window.clearInterval(timers.checkInterval);
      if (timers.timeoutId !== undefined) window.clearTimeout(timers.timeoutId);
      if (iceGatheringWaitCleanup.current === cancel) {
        iceGatheringWaitCleanup.current = null;
      }
      resolve(completed);
    };

    const cancel = () => settle(false);
    iceGatheringWaitCleanup.current?.();
    iceGatheringWaitCleanup.current = cancel;

    timers.timeoutId = window.setTimeout(() => {
      setWarning('Network discovery is taking longer than expected…');
      settle(true);
    }, ICE_GATHERING_TIMEOUT);
    timers.checkInterval = window.setInterval(() => {
      if (peer.iceGatheringState === 'complete') settle(true);
    }, 100);

    if (peer.iceGatheringState === 'complete') {
      settle(true);
      return;
    }
  }), [setWarning]);

  const endPeerConnection = useCallback(() => {
    iceGatheringWaitCleanup.current?.();
    userEndedCall.current = true;
    clearRecoveryTimers();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    remoteStreamRef.current = null;
    mediaStarted.current = false;
    dataChannelReady.current = false;
    initialHandshakeComplete.current = false;
    makingOffer.current = false;
    ignoreOffer.current = false;
    isSettingRemoteAnswerPending.current = false;
    setRemoteStream(null);
  }, [clearRecoveryTimers]);

  const switchCamera = useCallback(async (facingMode: FacingMode): Promise<FacingMode | null> => {
    const stream = localStreamRef.current;
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
      const sender = peerRef.current?.getSenders().find((candidate) => candidate.track?.kind === 'video');
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
  }, [setWarning]);

  return {
    peerRef,
    localStreamRef,
    remoteStream,
    isReconnecting,
    initializePeerConnection,
    createOfferDataChannel,
    waitForIceGathering,
    endPeerConnection,
    switchCamera,
  };
}
