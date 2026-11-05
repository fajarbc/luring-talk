import { useCallback, useRef, useState } from 'react';

const DISCONNECT_GRACE_PERIOD = 5000;
const RECOVERY_TIMEOUT = 20000;
const MAX_ICE_RESTART_ATTEMPTS = 1;

type MutableRef<T> = { current: T };

interface ConnectionRecoveryOptions {
  peerRef: MutableRef<RTCPeerConnection | null>;
  userEndedCall: MutableRef<boolean>;
  appendDebug: (message: string) => void;
  setError: (message: string | null) => void;
}

export function useConnectionRecovery({
  peerRef,
  userEndedCall,
  appendDebug,
  setError,
}: ConnectionRecoveryOptions) {
  const [isReconnecting, setIsReconnecting] = useState(false);
  const disconnectTimer = useRef<number | null>(null);
  const recoveryTimeout = useRef<number | null>(null);
  const recoveryStartedAt = useRef<number | null>(null);
  const iceRestartAttempts = useRef(0);

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
  }, [appendDebug, clearRecoveryTimers, peerRef, setError, userEndedCall]);

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
  }, [appendDebug, clearRecoveryTimers, peerRef, requestIceRestart, setError, userEndedCall]);

  return { isReconnecting, clearRecoveryTimers, armConnectionRecovery, iceRestartAttempts };
}
