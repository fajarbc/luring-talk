import React, { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { AppState } from './types';
import VideoCall from './components/VideoCall';
import ErrorScreen from './src/screens/ErrorScreen';
import HomeScreen from './src/screens/HomeScreen';
import ShowCodeScreen from './src/screens/ShowCodeScreen';
import ScanScreen from './src/screens/ScanScreen';
import {
  buildDataChannelSdp,
  compactHandshakeFromSdp,
  decodeCompactHandshake,
  CompactHandshake,
} from './utils/compact-signaling';
import { getLocalIP } from './utils/network';
import { usePeerConnection } from './src/webrtc/usePeerConnection';

const DEBUG_MODE = import.meta.env.VITE_DEBUG_MODE === 'true';

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
  const [localIP, setLocalIP] = useState('Detecting LAN addresses…');
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [signalString, setSignalString] = useState('');
  const [manualInputVal, setManualInputVal] = useState('');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState('');
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isProcessingManualInput, setIsProcessingManualInput] = useState(false);

  const bgVideoRef = useRef<HTMLVideoElement>(null);
  const negotiationInFlight = useRef(false);

  const appendDebug = useCallback((message: string) => {
    setDebugInfo((previous) => previous ? `${previous}\n${message}` : message);
  }, []);

  const {
    peerRef,
    localStreamRef,
    remoteStream,
    isReconnecting,
    initializePeerConnection,
    createOfferDataChannel,
    waitForIceGathering,
    endPeerConnection,
    switchCamera,
  } = usePeerConnection({ appendDebug, setAppState, setError, setWarning });

  useEffect(() => {
    if (localStreamRef.current && bgVideoRef.current) {
      bgVideoRef.current.srcObject = localStreamRef.current;
    }
  }, [appState, facingMode, localStreamRef]);

  useEffect(() => {
    let cancelled = false;
    void getLocalIP().then((address) => {
      if (!cancelled) setLocalIP(address);
    });

    return () => {
      cancelled = true;
    };
  }, []);

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
    endPeerConnection();
    negotiationInFlight.current = false;
    setIsProcessingManualInput(false);
    setQrCodeData(null);
    setSignalString('');
    setManualInputVal('');
    setFacingMode('user');
    setDebugInfo('');
    setError(null);
    setWarning(null);
    setAppState(AppState.HOME);
  };

  const startCall = async () => {
    setError(null);
    setDebugInfo('⏳ Creating data-channel offer…');
    setAppState(AppState.GENERATING_OFFER);

    try {
      const peer = await initializePeerConnection('offerer');
      createOfferDataChannel(peer);
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
    if (negotiationInFlight.current) {
      setWarning('Connection is already being established. Please wait…');
      return;
    }
    negotiationInFlight.current = true;
    setIsProcessingManualInput(true);
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
      await generateQR(compactAnswer);
      setAppState(AppState.SHOWING_ANSWER);
    } catch (offerError) {
      console.error('Error establishing answer:', offerError);
      setError(`Connection failed during data-channel setup: ${(offerError as Error).message}`);
      endCall();
    } finally {
      negotiationInFlight.current = false;
      setIsProcessingManualInput(false);
    }
  };

  const processAnswer = async (handshake: CompactHandshake) => {
    if (negotiationInFlight.current) {
      setWarning('Connection is already being established. Please wait…');
      return;
    }
    const peer = peerRef.current;
    if (!peer) {
      setError('Connection not established. Start a call first.');
      return;
    }

    negotiationInFlight.current = true;
    setIsProcessingManualInput(true);
    setDebugInfo('⏳ Setting remote data-channel answer…');

    try {
      await peer.setRemoteDescription(normalizeDescription(handshake));
      appendDebug('✅ Remote data-channel answer set; waiting for channel open');
    } catch (answerError) {
      console.error('Error setting final answer:', answerError);
      setError(`Handshake failed: ${(answerError as Error).message}`);
    } finally {
      negotiationInFlight.current = false;
      setIsProcessingManualInput(false);
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

  const handleManualInput = (inputValue = manualInputVal) => {
    if (negotiationInFlight.current) {
      setWarning('Connection is already being established. Please wait…');
      return;
    }

    const value = inputValue.trim();
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

  const handleManualPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    if (!text.trim()) return;
    event.preventDefault();
    setManualInputVal(text);
    handleManualInput(text);
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setManualInputVal(text);
        handleManualInput(text);
      }
    } catch {
      setError('Could not access clipboard. Please paste the code manually.');
    }
  };

  const handleSwitchCamera = async () => {
    const nextMode = await switchCamera(facingMode);
    if (nextMode) setFacingMode(nextMode);
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
    return <ErrorScreen error={error} onRetry={endCall} />;
  }

  if (appState === AppState.CONNECTED && localStreamRef.current) {
    return (
      <>
        <VideoCall
          localStream={localStreamRef.current}
          remoteStream={remoteStream}
          onEndCall={endCall}
          onSwitchCamera={handleSwitchCamera}
        />
        {isReconnecting && (
          <div role="status" aria-live="polite" className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] bg-yellow-500/90 text-black px-6 py-3 rounded-full font-bold shadow-lg flex items-center gap-2">
            <span className="material-symbols-outlined animate-spin text-sm" aria-hidden="true">sync</span>
            Reconnecting…
          </div>
        )}
        {warning && (
          <div role="status" aria-live="polite" className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] bg-yellow-500/90 text-black px-6 py-3 rounded-full font-bold shadow-lg">
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
        <div role="status" aria-live="polite" className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] max-w-[calc(100%-3rem)] bg-yellow-500/90 text-black px-6 py-3 rounded-full font-bold shadow-lg text-sm text-center">
          {warning}
        </div>
      )}

      {isSetup && localStreamRef.current && (
        <div className="absolute inset-0 z-0 opacity-20 pointer-events-none overflow-hidden">
          <video ref={bgVideoRef} autoPlay muted playsInline className="w-full h-full object-cover blur-md scale-110" />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent" />
        </div>
      )}

      <header className="sticky top-0 z-20 flex items-center justify-between px-6 py-4 glass-panel border-b-0 border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-neon-cyan">
            <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" className="w-7 h-7 object-contain" />
          </div>
          <div>
            <h1 className="text-lg font-bold leading-none tracking-wide text-white">LuringTalk</h1>
            <span className="text-[10px] font-bold text-primary uppercase tracking-[0.2em]">P2P Secure</span>
          </div>
        </div>
        {isSetup && <button onClick={endCall} aria-label="Close setup" className="w-11 h-11 -m-1.5 rounded-full bg-white/10 flex items-center justify-center"><span className="material-symbols-outlined text-sm" aria-hidden="true">close</span></button>}
      </header>

      <main className="flex-1 flex flex-col w-full max-w-md mx-auto p-6 gap-6 z-10 relative">
        {appState === AppState.HOME && (
          <HomeScreen
            localIP={localIP}
            showInstallPrompt={Boolean(installPrompt && !isInstalled)}
            onInstall={handleInstallApp}
            onStartCall={startCall}
            onJoinCall={() => {
              setError(null);
              setAppState(AppState.SCANNING_OFFER);
            }}
          />
        )}

        {(appState === AppState.GENERATING_OFFER || appState === AppState.GENERATING_ANSWER) && (
          <div role="status" aria-live="polite" className="flex flex-col items-center justify-center flex-1">
            <div aria-hidden="true" className="w-20 h-20 border-4 border-white/10 border-t-primary rounded-full animate-spin mb-8" />
            <h2 className="text-xl font-bold text-white tracking-wide animate-pulse">Establishing Link…</h2>
            <p className="text-sm text-gray-400 mt-2">Preparing the data-channel handshake</p>
          </div>
        )}

        {(appState === AppState.SHOWING_OFFER || appState === AppState.SHOWING_ANSWER) && qrCodeData && (
          <ShowCodeScreen
            qrCodeData={qrCodeData}
            signalString={signalString}
            isOffer={appState === AppState.SHOWING_OFFER}
            onCopyCode={() => navigator.clipboard.writeText(signalString).then(() => setWarning('Code copied to clipboard.'))}
            onContinue={() => setAppState(AppState.SCANNING_ANSWER)}
          />
        )}

        {isScanning && (
          <ScanScreen
            instruction={appState === AppState.SCANNING_OFFER ? "Scan Host's QR Code" : 'Scan Guest\'s QR Code'}
            onScan={appState === AppState.SCANNING_OFFER ? handleScanOffer : handleScanAnswer}
            onClose={endCall}
            debugMode={DEBUG_MODE}
            debugInfo={debugInfo}
            manualInputValue={manualInputVal}
            onManualInputChange={setManualInputVal}
            onManualPaste={handleManualPaste}
            onPasteFromClipboard={handlePasteFromClipboard}
            onConnect={() => handleManualInput()}
            isProcessingManualInput={isProcessingManualInput}
          />
        )}
      </main>
    </div>
  );
}

export default App;
