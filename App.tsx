import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { AppState } from './types';
import QRScanner from './components/QRScanner';
import VideoCall from './components/VideoCall';
import {
  buildDataChannelSdp,
  compactHandshakeFromSdp,
  decodeCompactHandshake,
  CompactHandshake,
} from './utils/compact-signaling';

const ICE_GATHERING_TIMEOUT = 10000;
const DEBUG_MODE = import.meta.env.VITE_DEBUG_MODE === 'true';

type ConnectionRole = 'offerer' | 'answerer';

type DataChannelMessage =
  | { type: 'description'; description: RTCSessionDescriptionInit }
  | { type: 'candidate'; candidate: RTCIceCandidateInit };

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const normalizeDescription = (handshake: CompactHandshake): RTCSessionDescriptionInit => ({
  type: handshake.role === 'offer' ? 'offer' : 'answer',
  sdp: buildDataChannelSdp(handshake, { sessionId: String(Date.now()) }),
});

function App() {
  const [appState, setAppState] = useState<AppState>(AppState.HOME);
  const [localIP] = useState('LAN candidates from this device');
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [signalString, setSignalString] = useState('');
  const [manualInputVal, setManualInputVal] = useState('');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState('');
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const pc = useRef<RTCPeerConnection | null>(null);
  const dataChannel = useRef<RTCDataChannel | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const bgVideoRef = useRef<HTMLVideoElement>(null);
  const mediaStarted = useRef(false);
  const dataChannelReady = useRef(false);
  const initialHandshakeComplete = useRef(false);
  const makingOffer = useRef(false);
  const ignoreOffer = useRef(false);
  const isSettingRemoteAnswerPending = useRef(false);
  const iceGatheringWaitCleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (localStream.current && bgVideoRef.current) {
      bgVideoRef.current.srcObject = localStream.current;
    }
  }, [appState, facingMode]);

  useEffect(() => {
    if (!warning) return;
    const timer = window.setTimeout(() => setWarning(null), 5000);
    return () => window.clearTimeout(timer);
  }, [warning]);

  useEffect(() => {
    const checkInstalled = () => {
      const standalone = window.matchMedia('(display-mode: standalone)').matches;
      const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
      setIsInstalled(standalone || iosStandalone);
    };
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
      setWarning('App installed successfully.');
    };

    checkInstalled();
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const appendDebug = useCallback((message: string) => {
    setDebugInfo((previous) => previous ? `${previous}\n${message}` : message);
  }, []);

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

      localStream.current = stream;
      if (bgVideoRef.current) bgVideoRef.current.srcObject = stream;
      return stream;
    } catch (mediaError) {
      console.error('Error getting media:', mediaError);
      setError('Could not access microphone or camera. Please check permissions.');
      return null;
    }
  }, []);

  const sendDataChannelMessage = useCallback((message: DataChannelMessage): boolean => {
    const channel = dataChannel.current;
    if (!channel || channel.readyState !== 'open') return false;
    channel.send(JSON.stringify(message));
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
    let message: DataChannelMessage;
    try {
      message = JSON.parse(String(event.data)) as DataChannelMessage;
    } catch {
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
    if (!description?.type || !description.sdp) return;

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
  }, [appendDebug, sendLocalDescription]);

  const startMediaAndRenegotiate = useCallback(async () => {
    const peer = pc.current;
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
  }, [appendDebug, captureLocalMedia]);

  const setupDataChannel = useCallback((
    peer: RTCPeerConnection,
    channel: RTCDataChannel,
    polite: boolean,
  ) => {
    if (dataChannel.current === channel) return;
    dataChannel.current = channel;
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
  }, [appendDebug, handleDataChannelMessage, startMediaAndRenegotiate]);

  const initializePeerConnection = useCallback(async (connectionRole: ConnectionRole) => {
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
      const stream = event.streams[0] || remoteStreamRef.current || new MediaStream();
      if (!event.streams[0] && !stream.getTracks().includes(event.track)) {
        stream.addTrack(event.track);
      }
      remoteStreamRef.current = stream;
      setRemoteStream(stream);
      appendDebug(`📹 Remote ${event.track.kind} received with stream`);
      if (localStream.current) setAppState(AppState.CONNECTED);
    };

    peer.onconnectionstatechange = () => {
      appendDebug(`🔗 Connection: ${peer.connectionState}`);
      if (peer.connectionState === 'failed') {
        setError('Connection failed. Please retry the call.');
      }
    };

    peer.oniceconnectionstatechange = () => {
      appendDebug(`❄️ ICE: ${peer.iceConnectionState}`);
    };

    peer.onsignalingstatechange = () => {
      appendDebug(`📬 Signaling: ${peer.signalingState}`);
    };

    pc.current = peer;
    return peer;
  }, [appendDebug, sendDataChannelMessage, sendLocalDescription, setupDataChannel]);

  const waitForIceGathering = (peer: RTCPeerConnection) => new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId: number | undefined;
    let checkInterval: number | undefined;
    let cancel = () => undefined;

    const settle = (completed: boolean) => {
      if (settled) return;
      settled = true;
      if (checkInterval !== undefined) window.clearInterval(checkInterval);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      if (iceGatheringWaitCleanup.current === cancel) {
        iceGatheringWaitCleanup.current = null;
      }
      resolve(completed);
    };

    cancel = () => settle(false);
    iceGatheringWaitCleanup.current?.();
    iceGatheringWaitCleanup.current = cancel;

    if (peer.iceGatheringState === 'complete') {
      settle(true);
      return;
    }

    timeoutId = window.setTimeout(() => {
      setWarning('Network discovery is taking longer than expected…');
      settle(true);
    }, ICE_GATHERING_TIMEOUT);
    checkInterval = window.setInterval(() => {
      if (peer.iceGatheringState === 'complete') {
        settle(true);
      }
    }, 100);
  });

  const generateQR = async (text: string) => {
    try {
      const url = await QRCode.toDataURL(text, {
        width: 512,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
        errorCorrectionLevel: 'L',
      });
      setQrCodeData(url);
      setSignalString(text);
      appendDebug(`▣ QR payload: ${text.length} chars`);
    } catch (qrError) {
      console.error('QR generation error:', qrError);
      setError(`Failed to generate QR code (${text.length} chars). Use manual input instead.`);
    }
  };

  const endCall = () => {
    iceGatheringWaitCleanup.current?.();
    localStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    dataChannel.current?.close();
    dataChannel.current = null;
    pc.current?.close();
    pc.current = null;
    remoteStreamRef.current = null;
    mediaStarted.current = false;
    dataChannelReady.current = false;
    initialHandshakeComplete.current = false;
    makingOffer.current = false;
    ignoreOffer.current = false;
    isSettingRemoteAnswerPending.current = false;
    setRemoteStream(null);
    setQrCodeData(null);
    setSignalString('');
    setManualInputVal('');
    setFacingMode('user');
    setDebugInfo('');
    setError(null);
    setWarning(null);
    setAppState(AppState.HOME);
  };

  const startDebugCall = async () => {
    const stream = await captureLocalMedia();
    if (!stream) return;
    setRemoteStream(stream);
    setWarning('Debug mode: joined video call.');
    setAppState(AppState.CONNECTED);
  };

  const startCall = async () => {
    setError(null);
    setDebugInfo('⏳ Creating data-channel offer…');
    setAppState(AppState.GENERATING_OFFER);

    try {
      const peer = await initializePeerConnection('offerer');
      const channel = peer.createDataChannel('luring-signaling');
      setupDataChannel(peer, channel, false);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (!await waitForIceGathering(peer)) return;
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error('Peer did not produce an offer SDP.');
      const compactOffer = compactHandshakeFromSdp('offer', sdp);
      await generateQR(compactOffer);
      setAppState(AppState.SHOWING_OFFER);
    } catch (startError) {
      console.error('Start call error:', startError);
      setError(`Failed to generate offer: ${(startError as Error).message}`);
    }
  };

  const processOffer = async (handshake: CompactHandshake) => {
    setError(null);
    setDebugInfo('⏳ Rebuilding data-channel offer…');
    setAppState(AppState.GENERATING_ANSWER);

    try {
      const peer = await initializePeerConnection('answerer');
      await peer.setRemoteDescription(normalizeDescription(handshake));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      if (!await waitForIceGathering(peer)) return;
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error('Peer did not produce an answer SDP.');
      const compactAnswer = compactHandshakeFromSdp('answer', sdp);
      initialHandshakeComplete.current = true;
      await generateQR(compactAnswer);
      setAppState(AppState.SHOWING_ANSWER);
    } catch (offerError) {
      console.error('Error establishing answer:', offerError);
      setError(`Connection failed during data-channel setup: ${(offerError as Error).message}`);
      endCall();
    }
  };

  const processAnswer = async (handshake: CompactHandshake) => {
    setDebugInfo('⏳ Setting remote data-channel answer…');
    const peer = pc.current;
    if (!peer) {
      setError('Connection not established. Start a call first.');
      return;
    }

    try {
      await peer.setRemoteDescription(normalizeDescription(handshake));
      initialHandshakeComplete.current = true;
      appendDebug('✅ Remote data-channel answer set; waiting for channel open');
    } catch (answerError) {
      console.error('Error setting final answer:', answerError);
      setError(`Handshake failed: ${(answerError as Error).message}`);
    }
  };

  const decodeExpectedHandshake = (value: string, expectedRole: 'offer' | 'answer') => {
    try {
      const handshake = decodeCompactHandshake(value.trim());
      if (handshake.role !== expectedRole) {
        throw new Error(`Expected a ${expectedRole} handshake.`);
      }
      return handshake;
    } catch (decodeError) {
      setError(`Invalid ${expectedRole} code: ${(decodeError as Error).message}`);
      return null;
    }
  };

  const handleScanOffer = (data: string) => {
    appendDebug(`📥 OFFER QR scanned (${data.length} chars)`);
    const handshake = decodeExpectedHandshake(data, 'offer');
    if (handshake) void processOffer(handshake);
  };

  const handleScanAnswer = (data: string) => {
    appendDebug(`📥 ANSWER QR scanned (${data.length} chars)`);
    const handshake = decodeExpectedHandshake(data, 'answer');
    if (handshake) void processAnswer(handshake);
  };

  const handleManualInput = () => {
    const value = manualInputVal.trim();
    if (!value) return;
    if (appState === AppState.SCANNING_OFFER || appState === AppState.HOME) {
      const handshake = decodeExpectedHandshake(value, 'offer');
      if (handshake) void processOffer(handshake);
      return;
    }
    if (appState === AppState.SCANNING_ANSWER) {
      const handshake = decodeExpectedHandshake(value, 'answer');
      if (handshake) void processAnswer(handshake);
    }
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setManualInputVal(text);
    } catch {
      setError('Could not access clipboard. Please paste the code manually.');
    }
  };

  const switchCamera = async () => {
    if (!localStream.current) return;
    const currentVideo = localStream.current.getVideoTracks()[0];
    if (!currentVideo) {
      setWarning('Cannot switch camera in audio-only mode.');
      return;
    }

    const nextMode = facingMode === 'user' ? 'environment' : 'user';
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
      newTrack.enabled = currentVideo.enabled;
      const sender = pc.current?.getSenders().find((candidate) => candidate.track?.kind === 'video');
      await sender?.replaceTrack(newTrack);
      currentVideo.stop();
      localStream.current.removeTrack(currentVideo);
      localStream.current.addTrack(newTrack);
      setFacingMode(nextMode);
    } catch (switchError) {
      console.error('Failed to switch camera:', switchError);
      setWarning('Unable to switch camera.');
    }
  };

  const handleInstallApp = async () => {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
    } catch (installError) {
      console.error('Install prompt failed:', installError);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-background text-white font-sans flex items-center justify-center p-6">
        <div className="glass-panel p-8 rounded-3xl w-full max-w-sm text-center shadow-neon-pink border border-red-500/30">
          <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6">
            <span className="material-symbols-outlined text-4xl text-red-500">signal_disconnected</span>
          </div>
          <h2 className="text-2xl font-bold mb-2">Connection Failed</h2>
          <p className="text-gray-300 mb-8">{error}</p>
          <button onClick={endCall} className="w-full py-4 rounded-xl bg-white text-black font-bold tracking-wider">
            RETRY
          </button>
        </div>
      </div>
    );
  }

  if (appState === AppState.CONNECTED && localStream.current) {
    return (
      <>
        <VideoCall
          localStream={localStream.current}
          remoteStream={remoteStream}
          onEndCall={endCall}
          onSwitchCamera={switchCamera}
        />
        {warning && (
          <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] bg-yellow-500/90 text-black px-6 py-3 rounded-full font-bold shadow-lg">
            {warning}
          </div>
        )}
      </>
    );
  }

  const isScanning = appState === AppState.SCANNING_OFFER || appState === AppState.SCANNING_ANSWER;
  const isSetup = appState !== AppState.HOME;

  return (
    <div className="min-h-screen bg-background text-white font-sans overflow-hidden flex flex-col selection:bg-primary/30 relative">
      {warning && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] bg-yellow-500/90 text-black px-6 py-3 rounded-full font-bold shadow-lg text-sm whitespace-nowrap">
          {warning}
        </div>
      )}

      {isSetup && localStream.current && (
        <div className="absolute inset-0 z-0 opacity-20 pointer-events-none overflow-hidden">
          <video ref={bgVideoRef} autoPlay muted playsInline className="w-full h-full object-cover blur-md scale-110" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
        </div>
      )}

      <header className="sticky top-0 z-20 flex items-center justify-between px-6 py-4 glass-panel border-b-0 border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-neon-cyan">
            <span className="material-symbols-outlined text-[18px] text-white">leak_add</span>
          </div>
          <div>
            <h1 className="text-lg font-bold leading-none tracking-wide text-white">LuringTalk</h1>
            <span className="text-[10px] font-bold text-primary uppercase tracking-[0.2em]">P2P Secure</span>
          </div>
        </div>
        {isSetup && <button onClick={endCall} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center"><span className="material-symbols-outlined text-sm">close</span></button>}
      </header>

      <main className="flex-1 flex flex-col w-full max-w-md mx-auto p-6 gap-6 z-10 relative">
        {appState === AppState.HOME && (
          <div className="flex flex-col h-full justify-center">
            {installPrompt && !isInstalled && (
              <div className="glass-panel rounded-2xl p-4 mb-6 border border-white/10 shadow-neon-cyan">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-white">Install LuringTalk</p>
                    <p className="text-xs text-gray-400">Add to Home Screen for offline access.</p>
                  </div>
                  <button onClick={handleInstallApp} className="bg-primary text-black font-bold px-4 py-2 rounded-lg">Install</button>
                </div>
              </div>
            )}
            <div className="relative mb-12 flex flex-col items-center justify-center">
              <div className="absolute w-64 h-64 rounded-full border border-primary/20 animate-[spin_10s_linear_infinite]" />
              <div className="absolute w-48 h-48 rounded-full border border-secondary/20 animate-[spin_7s_linear_infinite_reverse]" />
              <div className="w-32 h-32 rounded-full bg-surface border border-white/10 shadow-neon-cyan flex items-center justify-center relative z-10 glass-panel">
                <span className="material-symbols-outlined text-5xl text-primary animate-pulse">wifi_tethering</span>
              </div>
              <div className="mt-8 text-center">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Signaling mode</p>
                <div className="inline-block px-6 py-2 rounded-full bg-white/5 border border-white/10 font-mono text-sm text-primary shadow-neon-cyan">{localIP}</div>
              </div>
            </div>
            <div className="flex flex-col gap-4 mt-auto mb-8">
              <button onClick={startCall} className="relative group w-full h-16 rounded-2xl bg-gradient-to-r from-primary to-blue-500 p-[1px] shadow-neon-cyan">
                <div className="h-full w-full rounded-2xl bg-black/50 backdrop-blur-sm flex items-center justify-center gap-3"><span className="material-symbols-outlined text-primary">add_call</span><span className="text-lg font-bold tracking-wider">START CALL</span></div>
              </button>
              <button onClick={() => { setError(null); setAppState(AppState.SCANNING_OFFER); }} className="relative group w-full h-16 rounded-2xl bg-gradient-to-r from-secondary to-pink-600 p-[1px] shadow-neon-pink">
                <div className="h-full w-full rounded-2xl bg-black/50 backdrop-blur-sm flex items-center justify-center gap-3"><span className="material-symbols-outlined text-secondary">qr_code_scanner</span><span className="text-lg font-bold tracking-wider">JOIN CALL</span></div>
              </button>
            </div>
            <p className="text-center text-[10px] text-gray-600 uppercase tracking-widest">Wi-Fi LAN Only • No Internet Needed</p>
          </div>
        )}

        {(appState === AppState.GENERATING_OFFER || appState === AppState.GENERATING_ANSWER) && (
          <div className="flex flex-col items-center justify-center flex-1">
            <div className="w-20 h-20 border-4 border-white/10 border-t-primary rounded-full animate-spin mb-8" />
            <h2 className="text-xl font-bold text-white tracking-wide animate-pulse">Establishing Link…</h2>
            <p className="text-sm text-gray-400 mt-2">Preparing the data-channel handshake</p>
          </div>
        )}

        {(appState === AppState.SHOWING_OFFER || appState === AppState.SHOWING_ANSWER) && qrCodeData && (
          <div className="flex flex-col items-center flex-1">
            <div className="w-full glass-panel rounded-3xl p-6 flex flex-col items-center shadow-2xl relative">
              <div className="absolute -top-3 px-4 py-1 rounded-full bg-primary text-black text-xs font-bold uppercase tracking-wider shadow-neon-cyan">
                {appState === AppState.SHOWING_OFFER ? 'Step 1: Scan Me' : 'Step 2: Show Host'}
              </div>
              <div className="bg-white p-2 rounded-xl mb-6 mt-2"><img src={qrCodeData} alt="Compact signaling QR" className="w-64 h-64 object-contain" /></div>
              <div className="w-full flex flex-col gap-2">
                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Or copy code manually</label>
                <div className="flex gap-2"><input type="text" readOnly value={signalString} className="flex-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 truncate" /><button onClick={() => navigator.clipboard.writeText(signalString).then(() => setWarning('Code copied to clipboard.'))} className="bg-white/10 rounded-lg px-3 py-2"><span className="material-symbols-outlined text-sm">content_copy</span></button></div>
                <p className="text-[10px] text-center text-primary">{signalString.length} characters</p>
              </div>
            </div>
            <p className="mt-6 text-center text-gray-400 text-sm max-w-[260px]">{appState === AppState.SHOWING_OFFER ? 'Waiting for Device B to scan this code…' : 'Share this answer with caller to open the data channel.'}</p>
            {appState === AppState.SHOWING_OFFER && <button onClick={() => setAppState(AppState.SCANNING_ANSWER)} className="mt-auto w-full py-4 rounded-xl bg-gradient-to-r from-accent to-green-600 text-black font-bold shadow-neon-green flex items-center justify-center gap-2"><span>I Scanned Device B</span><span className="material-symbols-outlined">arrow_forward</span></button>}
            {appState === AppState.SHOWING_ANSWER && <div className="mt-auto flex flex-col items-center justify-center gap-2 text-primary animate-pulse"><span className="w-2 h-2 bg-primary rounded-full" /><span className="text-xs font-bold uppercase tracking-wider">Waiting for Host to Connect</span></div>}
          </div>
        )}

        {isScanning && (
          <div className="fixed inset-0 z-50 bg-black">
            <QRScanner
              instruction={appState === AppState.SCANNING_OFFER ? "Scan Host's QR Code" : "Scan Guest's QR Code"}
              onScan={appState === AppState.SCANNING_OFFER ? handleScanOffer : handleScanAnswer}
              onClose={endCall}
            />
            {DEBUG_MODE && <div className="absolute top-20 left-4 right-4 z-[65] bg-black/90 border border-primary/50 rounded-lg p-4 font-mono text-xs text-primary whitespace-pre-wrap max-h-40 overflow-y-auto">{debugInfo || 'Waiting for QR code scan…'}</div>}
            <div className="absolute bottom-8 left-6 right-6 z-[60]">
              <div className="glass-panel p-4 rounded-2xl flex flex-col gap-3 shadow-neon-pink border border-secondary/20 bg-black/80">
                <label className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">Or paste compact code</label>
                <input type="text" placeholder="v1|o/a|ufrag|pwd|fingerprint|ip:port" value={manualInputVal} onChange={(event) => setManualInputVal(event.target.value)} className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-3 text-sm text-white" />
                <div className="flex gap-2"><button onClick={handlePasteFromClipboard} className="flex-1 bg-white/10 text-white font-bold py-3 rounded-lg"><span className="material-symbols-outlined align-middle">content_paste</span> Paste</button><button onClick={handleManualInput} className="flex-1 bg-secondary text-black font-bold py-3 rounded-lg">Process code</button></div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
