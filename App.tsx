import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { AppState, CallRole, SignalingData } from './types';
import { getLocalIP, formatSDPForQR, parseSDPFromQR } from './utils/network';
import QRScanner from './components/QRScanner';
import VideoCall from './components/VideoCall';

const ICE_GATHERING_TIMEOUT = 10000; // 10 seconds timeout for candidate gathering
const DEBUG_MODE = import.meta.env.VITE_DEBUG_MODE === 'true';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}
console.log('DEBUG_MODE:', DEBUG_MODE, 'VITE_DEBUG_MODE:', import.meta.env.VITE_DEBUG_MODE);

function App() {
  const [appState, setAppState] = useState<AppState>(AppState.HOME);
  const [localIP, setLocalIP] = useState<string>('Detecting...');
  const [role, setRole] = useState<CallRole>(null);
  const [qrCodeData, setQrCodeData] = useState<string | null>(null);
  const [signalString, setSignalString] = useState<string>('');
  const [manualInputVal, setManualInputVal] = useState('');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  
  // Error & Warning States
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string>('');
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState<boolean>(false);
  
  // WebRTC Refs
  const pc = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const bgVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    getLocalIP().then(setLocalIP);
  }, []);

  const startDebugCall = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
          facingMode: 'user'
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      localStream.current = stream;
      setRemoteStream(stream);
      setWarning('Debug mode: joined video call.');
      setAppState(AppState.CONNECTED);
    } catch (e) {
      console.error("Debug mode getUserMedia error:", e);
      setError("Debug mode failed to access camera/mic.");
    }
  }, []);

  useEffect(() => {
    const checkInstalled = () => {
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
      const isIOSStandalone = (window.navigator as any).standalone === true;
      setIsInstalled(isStandalone || isIOSStandalone);
    };

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
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

  // Effect to attach local stream to background video for preview (Smooth transition handled via CSS)
  useEffect(() => {
    if (localStream.current && bgVideoRef.current) {
        bgVideoRef.current.srcObject = localStream.current;
    }
  }, [appState, facingMode]);

  // Clear warning after 5 seconds
  useEffect(() => {
    if (warning) {
        const timer = setTimeout(() => setWarning(null), 5000);
        return () => clearTimeout(timer);
    }
  }, [warning]);

  // Clear debug info when leaving scanner state
  useEffect(() => {
    if (appState !== AppState.SCANNING_OFFER && appState !== AppState.SCANNING_ANSWER) {
        setDebugInfo('');
    } else {
        setDebugInfo(`🔍 Scanning for ${appState === AppState.SCANNING_OFFER ? 'OFFER' : 'ANSWER'}...`);
    }
  }, [appState]);

  // Fallback: Force transition to CONNECTED after 15 seconds in SHOWING_ANSWER
  // This handles cases where tracks don't arrive but connection is ready
  useEffect(() => {
    if (appState === AppState.SHOWING_ANSWER && pc.current) {
      const timeout = setTimeout(() => {
        if (appState === AppState.SHOWING_ANSWER && pc.current?.signalingState === 'stable') {
          console.log("⏱️ Timeout: Forcing transition to CONNECTED after 15s in SHOWING_ANSWER");
          setDebugInfo(prev => prev + `\n⏱️ Timeout - forcing connection`);
          setAppState(AppState.CONNECTED);
        }
      }, 15000);
      return () => clearTimeout(timeout);
    }
  }, [appState]);

  /**
   * Initializes the RTCPeerConnection and Local Media Stream.
   * This is called before generating an offer or an answer.
   */
  const initializePeerConnection = useCallback(async () => {
    const config: RTCConfiguration = {
      // Try local first, but add STUN servers as fallback for mDNS/local discovery
      iceServers: [],
      iceTransportPolicy: 'all', 
      iceCandidatePoolSize: 0
      // iceServers: [
      //   { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
      // ], 
      // iceCandidatePoolSize: 10
    };
    
    const peer = new RTCPeerConnection(config);
    
    // Handle ICE Candidates
    let candidateCount = 0;
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        candidateCount++;
        console.log(`ICE Candidate ${candidateCount}:`, event.candidate.candidate.substring(0, 50));
        setDebugInfo(prev => prev + `\n📄 ICE Candidate #${candidateCount}`);
      } else {
        console.log("ICE Gathering Complete. Total candidates:", candidateCount);
        setDebugInfo(prev => prev + `\n🌟 ICE Gathering done (${candidateCount} candidates)`);
      }
    };

    // Monitoring Connection State
    peer.onconnectionstatechange = () => {
        const state = peer.connectionState;
        console.log("Connection State:", state);
        setDebugInfo(prev => prev + `\n🔗 ConnState: ${state}`);
        switch(state) {
            case 'disconnected':
            case 'failed':
            case 'closed':
                setError("Connection lost. Peer disconnected.");
                break;
        }
    };

    // Monitoring ICE State
    peer.oniceconnectionstatechange = () => {
      const iceState = peer.iceConnectionState;
      console.log("ICE State:", iceState);
      setDebugInfo(prev => prev + `\n❄️ ICEState: ${iceState}`);
      
      switch(iceState) {
        case 'new':
          setDebugInfo(prev => prev + `\n🔋 ICE gathering starting...`);
          break;
        case 'checking':
          setDebugInfo(prev => prev + `\n🔍 ICE checking candidates...`);
          break;
        case 'connected':
        case 'completed':
          console.log("ICE Connected/Completed - Setting app to CONNECTED");
          setDebugInfo(prev => prev + `\n✅ ICE CONNECTED - Starting video call`);
          setAppState(AppState.CONNECTED);
          break;
        case 'disconnected':
          setDebugInfo(prev => prev + `\n⚠️ ICE disconnected`);
          break;
        case 'failed':
          console.error("ICE Connection Failed");
          setDebugInfo(prev => prev + `\n❌ ICE FAILED`);
          setError("Connection Failed - Network instability detected.");
          break;
      }
    };

    // Monitor signaling state
    peer.onsignalingstatechange = () => {
      const sigState = peer.signalingState;
      console.log("Signaling State:", sigState);
      setDebugInfo(prev => prev + `\n📬 SigState: ${sigState}`);
    };

    // Handle Remote Stream
    peer.ontrack = (event) => {
      console.log("Received remote track:", event.track.kind);
      console.log("Signaling state when track arrived:", peer.signalingState, "Connection:", peer.connectionState);
      setDebugInfo(prev => prev + `\n📹 Remote ${event.track.kind} received`);
      const stream = event.streams[0];
      if (stream) {
        setRemoteStream(stream);
        console.log("Remote stream set, stream has", stream.getTracks().length, "tracks");
        
        // Check if we have both audio and video tracks
        const hasAudio = stream.getAudioTracks().length > 0;
        const hasVideo = stream.getVideoTracks().length > 0;
        console.log("Stream tracks - Audio:", hasAudio, "Video:", hasVideo);
        setDebugInfo(prev => prev + `\n✅ Tracks ready (A:${hasAudio} V:${hasVideo})`);
        
        // Accept signalingState: 'have-remote-offer' (before answer) or 'stable' (after answer)
        const sigState = peer.signalingState;
        if (sigState === 'have-remote-offer' || sigState === 'stable') {
          console.log("✅ READY TO CONNECT - Tracks received with signalingState:", sigState);
          setDebugInfo(prev => prev + `\n🚀 Transitioning to video call...`);
          setTimeout(() => {
            console.log("Setting app state to CONNECTED from ontrack");
            setAppState(AppState.CONNECTED);
          }, 100);
        } else {
          console.log("⚠️ Signaling state not ready:", sigState);
        }
      }
    };

    // Get User Media
    try {
      const audioConstraints = {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
      };

      let stream: MediaStream;

      try {
          // 1. Try Video + Audio
          console.log("Requesting Video + Audio...");
          stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
              width: { ideal: 1280 }, 
              height: { ideal: 720 }, 
              frameRate: { ideal: 30 },
              facingMode: 'user' 
            }, 
            audio: audioConstraints 
          });
      } catch (videoError) {
          console.warn("Video initialization failed, falling back to audio-only.", videoError);
          // 2. Fallback: Audio Only
          setWarning("Video device failed. Switching to Audio-only mode.");
          stream = await navigator.mediaDevices.getUserMedia({ 
              audio: audioConstraints,
              video: false
          });
      }
      
      localStream.current = stream;
      stream.getTracks().forEach(track => {
        peer.addTrack(track, stream);
      });
      
      if (bgVideoRef.current) bgVideoRef.current.srcObject = stream;
      
    } catch (e) {
      console.error("Error getting media:", e);
      setError("Could not access microphone or camera. Please check permissions.");
      return null;
    }

    pc.current = peer;
    return peer;
  }, []);

  const switchCamera = async () => {
    if (!localStream.current) return;
    
    if (localStream.current.getVideoTracks().length === 0) {
        setWarning("Cannot switch camera in audio-only mode.");
        return;
    }
    
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: nextMode,
          width: { ideal: 1280 }, 
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        }
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      const oldVideoTrack = localStream.current.getVideoTracks()[0];

      if (oldVideoTrack) {
        newVideoTrack.enabled = oldVideoTrack.enabled;
        oldVideoTrack.stop();
        localStream.current.removeTrack(oldVideoTrack);
        localStream.current.addTrack(newVideoTrack);
      }

      if (pc.current) {
        const senders = pc.current.getSenders();
        const sender = senders.find(s => s.track?.kind === 'video');
        if (sender) {
          sender.replaceTrack(newVideoTrack);
        }
      }

      setFacingMode(nextMode);
    } catch (e) {
      console.error("Failed to switch camera:", e);
      setWarning("Unable to switch camera.");
    }
  };

  /**
   * Device A Flow: Create Offer
   * 1. Initialize Peer
   * 2. Create Offer
   * 3. Set Local Description
   * 4. Wait for ICE gathering to complete (so candidates are included in SDP)
   * 5. Generate QR code
   */
  const startCall = async () => {
    setRole('host');
    setError(null);
    setAppState(AppState.GENERATING_OFFER);
    
    const peer = await initializePeerConnection();
    if (!peer) return;

    try {
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        await waitForIceGathering(peer);

        const payload: SignalingData = {
        type: 'offer',
        sdp: peer.localDescription?.sdp || ''
        };
        
        const qrData = formatSDPForQR(payload);
        generateQR(qrData);
        setSignalString(qrData);
        
        setAppState(AppState.SHOWING_OFFER);
    } catch (err) {
        console.error("Start call error:", err);
        setError("Failed to generate offer. Please retry.");
    }
  };

  const joinCall = () => {
    setRole('peer');
    setError(null);
    if (DEBUG_MODE) {
      startDebugCall();
      return;
    }
    setAppState(AppState.SCANNING_OFFER);
  };

  const handleScanOffer = async (data: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const msg = `[${timestamp}] 📥 OFFER SCANNED\nLength: ${data.length}\nData: ${data.substring(0, 30)}...`;
    setDebugInfo(msg);
    console.log(msg, data);
    
    const signal = parseSDPFromQR(data);
    console.log("Parsed signal:", signal);
    
    if (!signal || signal.type !== 'offer') {
      const errMsg = `❌ Parse failed: ${signal?.type || 'null'}`;
      setDebugInfo(prev => prev + `\n${errMsg}`);
      console.error(errMsg);
      setError("Invalid QR Code. Expected an Offer from the Caller.");
      return;
    }
    setDebugInfo(prev => prev + `\n✅ Parsed OFFER successfully\n→ Processing...`);
    console.log("Processing valid offer");
    processOffer(signal);
  };

  const handleManualInput = (inputStr: string) => {
    const cleanStr = inputStr.trim();
    if (!cleanStr) {
      console.log("Empty input");
      return;
    }

    const timestamp = new Date().toLocaleTimeString();
    setDebugInfo(`[${timestamp}] 📋 Manual paste\nLength: ${cleanStr.length}`);
    console.log("Processing manual input:", cleanStr.substring(0, 50) + "...");

    // Dismiss keyboard logic
    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
    }

    const signal = parseSDPFromQR(cleanStr);
    console.log("Parsed signal:", signal ? `type=${signal.type}` : "null");
    setDebugInfo(prev => prev + `\n${signal ? `✅ Parsed as ${signal.type?.toUpperCase()}` : `❌ Parse failed`}\n→ Processing...`);

    if (signal && signal.type && signal.sdp) {
        if (appState === AppState.SCANNING_OFFER || appState === AppState.HOME) {
            if (signal.type === 'offer') {
                console.log("Processing offer");
                processOffer(signal);
            } else {
                setError("Incorrect code. Expected an OFFER (from Caller).");
            }
        } else if (appState === AppState.SCANNING_ANSWER) {
            if (signal.type === 'answer') {
                 console.log("Processing answer");
                 processAnswer(signal);
            } else {
                setError("Incorrect code. Expected an ANSWER (from Caller).");
            }
        } else {
            console.log("Invalid app state for manual input:", appState);
            setError("Not in scanning mode. Start or join a call first.");
        }
    } else {
        console.log("Failed to parse signal");
        if (cleanStr.length > 20) {
            setError("Invalid code format. Please ensure you copied the entire string.");
        }
    }
  };

  /**
   * Device B Flow: Process Offer & Create Answer
   */
  const processOffer = async (signal: SignalingData) => {
    setDebugInfo(prev => prev + `\n⏳ Initializing peer...`);
    setAppState(AppState.GENERATING_ANSWER);
    
    const peer = await initializePeerConnection();
    if (!peer) return;

    try {
      let remoteDesc: RTCSessionDescriptionInit;
      if (typeof signal.sdp === 'object' && signal.sdp.sdp) {
        remoteDesc = signal.sdp;
      } else {
        // Normalize line endings to CRLF for WebRTC
        const sdpStr = typeof signal.sdp === 'string' ? signal.sdp : signal.sdp.toString();
        const normalizedSdp = sdpStr.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
        
        if (normalizedSdp.trim().startsWith('{')) {
          remoteDesc = JSON.parse(normalizedSdp);
        } else {
          remoteDesc = { type: 'offer', sdp: normalizedSdp };
        }
      }
      await peer.setRemoteDescription(remoteDesc);
      
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIceGathering(peer);

      const payload: SignalingData = {
        type: 'answer',
        sdp: peer.localDescription?.sdp || ''
      };
      
      const qrData = formatSDPForQR(payload);
      generateQR(qrData);
      setSignalString(qrData);
      
      setAppState(AppState.SHOWING_ANSWER);
    } catch (err) {
      console.error("Error establishing answer", err);
      setError("Connection failed during negotiation. Ensure both devices are on same WiFi.");
      endCall(); 
    }
  };

  const handleScanAnswer = async (data: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const msg = `[${timestamp}] 📥 ANSWER SCANNED\nLength: ${data.length}\nData: ${data.substring(0, 30)}...`;
    setDebugInfo(msg);
    console.log(msg, data);
    
    const signal = parseSDPFromQR(data);
    console.log("Parsed signal:", signal);
    
    if (!signal || signal.type !== 'answer') {
      const errMsg = `❌ Parse failed: ${signal?.type || 'null'}`;
      setDebugInfo(prev => prev + `\n${errMsg}`);
      console.error(errMsg);
      setError("Invalid QR Code. Expected an Answer from the Caller.");
      return;
    }
    setDebugInfo(prev => prev + `\n✅ Parsed ANSWER successfully\n→ Processing...`);
    console.log("Processing valid answer");
    processAnswer(signal);
  };

  /**
   * Device A Flow: Process Answer
   * This completes the handshake.
   */
  const processAnswer = async (signal: SignalingData) => {
    setDebugInfo(prev => prev + `\n⏳ Setting remote answer...`);
    if (!pc.current) {
      console.error("No peer connection available");
      setError("Connection not established. Start a call first.");
      return;
    }
    
    console.log("Current connection state:", pc.current.connectionState, "ICE state:", pc.current.iceConnectionState, "Signaling state:", pc.current.signalingState);
    
    try {
      // Only set remote description if we're in the right state
      if (pc.current.signalingState !== 'have-local-offer') {
        console.warn(`Cannot set answer in ${pc.current.signalingState} state. Waiting...`);
        // Wait a moment and try again
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      let remoteDesc: RTCSessionDescriptionInit;
      if (typeof signal.sdp === 'object' && signal.sdp.sdp) {
        remoteDesc = signal.sdp;
      } else {
        // Normalize line endings to CRLF for WebRTC
        const sdpStr = typeof signal.sdp === 'string' ? signal.sdp : signal.sdp.toString();
        const normalizedSdp = sdpStr.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n');
        
        if (normalizedSdp.trim().startsWith('{')) {
          remoteDesc = JSON.parse(normalizedSdp);
        } else {
          remoteDesc = { type: 'answer', sdp: normalizedSdp };
        }
      }
      
      console.log("Setting remote description with type:", remoteDesc.type);
      await pc.current.setRemoteDescription(remoteDesc);
      setDebugInfo(prev => prev + `\n✅ Remote description set\n🔌 Signaling: ${pc.current.signalingState}\n⏳ Waiting for ICE...`);
      console.log("Remote description set successfully. Signaling state:", pc.current.signalingState);
      // Connection should establish automatically via ICE now
    } catch (err) {
      console.error("Error setting final answer", err);
      setError(`Handshake failed: ${(err as Error).message}`);
    }
  };

  /**
   * Waits for ICE candidates to be gathered.
   * Crucial for local network where we need the IP address in the SDP.
   */
  const waitForIceGathering = (peer: RTCPeerConnection) => {
    return new Promise<void>(resolve => {
      if (peer.iceGatheringState === 'complete') {
        resolve();
      } else {
        const timeoutId = setTimeout(() => {
            console.warn("ICE Gathering timed out.");
            setWarning("Network discovery is taking longer than expected...");
            resolve();
        }, ICE_GATHERING_TIMEOUT);
        
        const checkInterval = setInterval(() => {
             if (peer.iceGatheringState === 'complete') {
                clearInterval(checkInterval);
                clearTimeout(timeoutId);
                resolve();
             }
        }, 100);
      }
    });
  };

  const generateQR = async (text: string) => {
    try {
      console.log(`Generating QR code with data size: ${text.length} characters`);
      
      // Use L error correction for maximum data capacity
      const url = await QRCode.toDataURL(text, { 
          width: 512, 
          margin: 1, 
          color: { dark: '#000000', light: '#ffffff' },
          errorCorrectionLevel: 'L'
      });
      console.log("QR code generated successfully");
      setQrCodeData(url);
    } catch (err) {
      console.error("QR Generation error:", err);
      setError(`Failed to generate QR code. Data too large (${text.length} chars). Try using manual code input.`);
    }
  };

  const endCall = () => {
    if (localStream.current) {
      localStream.current.getTracks().forEach(t => t.stop());
      localStream.current = null;
    }
    if (pc.current) {
      pc.current.oniceconnectionstatechange = null;
      pc.current.onconnectionstatechange = null;
      pc.current.close();
      pc.current = null;
    }
    setRemoteStream(null);
    setAppState(AppState.HOME);
    setRole(null);
    setSignalString('');
    setManualInputVal('');
    setFacingMode('user');
  };

  const handleRetry = () => {
      endCall();
      setError(null);
      setWarning(null);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(signalString);
    setWarning("Code copied to clipboard!");
  };

  const handlePasteFromClipboard = async () => {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            setManualInputVal(text);
            handleManualInput(text);
        }
    } catch (err) {
        setError("Could not access clipboard. Please paste manually.");
    }
  };

  const handleInstallApp = async () => {
    if (!installPrompt) return;
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setWarning('Installing app...');
      }
      setInstallPrompt(null);
    } catch (err) {
      console.error('Install prompt failed:', err);
    }
  };

  // Render Logic
  
  // 1. Error Modal
  if (error) {
      return (
        <div className="min-h-screen bg-background text-white font-sans flex items-center justify-center p-6 relative overflow-hidden">
             <div className="absolute inset-0 bg-red-900/10 pointer-events-none"></div>
             
             <div className="glass-panel p-8 rounded-3xl w-full max-w-sm text-center shadow-neon-pink border border-red-500/30 flex flex-col items-center animate-in fade-in zoom-in duration-300">
                <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mb-6 shadow-[0_0_20px_rgba(239,68,68,0.4)]">
                    <span className="material-symbols-outlined text-4xl text-red-500">signal_disconnected</span>
                </div>
                <h2 className="text-2xl font-bold mb-2">Connection Failed</h2>
                <p className="text-gray-300 mb-8">{error}</p>
                
                <button 
                    onClick={handleRetry}
                    className="w-full py-4 rounded-xl bg-white text-black font-bold tracking-wider hover:bg-gray-200 transition-colors shadow-lg active:scale-95"
                >
                    RETRY
                </button>
             </div>
        </div>
      );
  }

  // 2. Connected State (Video Call)
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
                <div className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] bg-yellow-500/90 text-black px-6 py-3 rounded-full font-bold shadow-lg animate-in slide-in-from-top-4 fade-in">
                    {warning}
                </div>
            )}
        </>
    );
  }

  const isSetup = appState !== AppState.HOME;

  // 3. Setup / Signaling UI
  return (
    <div className="min-h-screen bg-background text-white font-sans overflow-hidden flex flex-col selection:bg-primary/30 relative">
      
      {/* Global Warning Toast */}
      {warning && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] bg-yellow-500/90 text-black px-6 py-3 rounded-full font-bold shadow-lg text-sm whitespace-nowrap animate-in slide-in-from-top-4 fade-in">
            {warning}
        </div>
      )}

      {/* Background Preview (Blurred) */}
      {isSetup && (
        <div className="absolute inset-0 z-0 opacity-20 pointer-events-none overflow-hidden">
            <video ref={bgVideoRef} autoPlay muted playsInline className="w-full h-full object-cover blur-md scale-110" />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-transparent"></div>
        </div>
      )}

      {/* HEADER */}
      <header className="sticky top-0 z-20 flex items-center justify-between px-6 py-4 glass-panel border-b-0 border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center shadow-neon-cyan">
            <span className="material-symbols-outlined text-[18px] text-white">leak_add</span>
          </div>
          <div>
            <h1 className="text-lg font-bold leading-none tracking-wide text-white drop-shadow-md">LuringTalk</h1>
            <span className="text-[10px] font-bold text-primary uppercase tracking-[0.2em]">P2P Secure</span>
          </div>
        </div>
        
        {isSetup && (
            <button onClick={endCall} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center hover:bg-red-500/20 transition-colors">
                <span className="material-symbols-outlined text-sm">close</span>
            </button>
        )}
      </header>

      <main className="flex-1 flex flex-col w-full max-w-md mx-auto p-6 gap-6 z-10 relative">

        {/* STATE: HOME */}
        {appState === AppState.HOME && (
          <div className="flex flex-col h-full justify-center">

            {installPrompt && !isInstalled && (
              <div className="glass-panel rounded-2xl p-4 mb-6 border border-white/10 shadow-neon-cyan">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-white">Install LuringTalk</p>
                    <p className="text-xs text-gray-400">Add to Home Screen for better performance & offline access.</p>
                  </div>
                  <button
                    onClick={handleInstallApp}
                    className="bg-primary text-black font-bold px-4 py-2 rounded-lg shadow-neon-cyan active:scale-95"
                  >
                    Install App
                  </button>
                </div>
              </div>
            )}
            
            <div className="relative mb-12 flex flex-col items-center justify-center">
              {/* Animated Rings */}
              <div className="absolute w-64 h-64 rounded-full border border-primary/20 animate-[spin_10s_linear_infinite]"></div>
              <div className="absolute w-48 h-48 rounded-full border border-secondary/20 animate-[spin_7s_linear_infinite_reverse]"></div>
              
              <div className="w-32 h-32 rounded-full bg-surface border border-white/10 shadow-neon-cyan flex flex-col items-center justify-center relative z-10 glass-panel">
                <span className="material-symbols-outlined text-5xl text-primary animate-pulse">wifi_tethering</span>
              </div>

              <div className="mt-8 text-center">
                 <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Your Local IP</p>
                 <div className="inline-block px-6 py-2 rounded-full bg-white/5 border border-white/10 font-mono text-xl text-primary shadow-neon-cyan">
                    {localIP}
                 </div>
              </div>
            </div>

            <div className="flex flex-col gap-4 mt-auto mb-8">
              <button 
                onClick={startCall}
                className="relative group w-full h-16 rounded-2xl bg-gradient-to-r from-primary to-blue-500 p-[1px] shadow-neon-cyan transition-transform active:scale-95"
              >
                <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl"></div>
                <div className="h-full w-full rounded-2xl bg-black/50 backdrop-blur-sm flex items-center justify-center gap-3">
                  <span className="material-symbols-outlined text-primary group-hover:text-white transition-colors">add_call</span>
                  <span className="text-lg font-bold tracking-wider">START CALL</span>
                </div>
              </button>

              <button 
                onClick={joinCall}
                className="relative group w-full h-16 rounded-2xl bg-gradient-to-r from-secondary to-pink-600 p-[1px] shadow-neon-pink transition-transform active:scale-95"
              >
                <div className="h-full w-full rounded-2xl bg-black/50 backdrop-blur-sm flex items-center justify-center gap-3">
                   <span className="material-symbols-outlined text-secondary">qr_code_scanner</span>
                   <span className="text-lg font-bold tracking-wider">JOIN CALL</span>
                </div>
              </button>
            </div>
            
            <p className="text-center text-[10px] text-gray-600 uppercase tracking-widest">
                Wi-Fi LAN Only • No Internet Needed
            </p>
          </div>
        )}

        {/* STATE: GENERATING (Loading) */}
        {(appState === AppState.GENERATING_OFFER || appState === AppState.GENERATING_ANSWER) && (
            <div className="flex flex-col items-center justify-center flex-1">
                <div className="w-20 h-20 border-4 border-white/10 border-t-primary rounded-full animate-spin mb-8"></div>
                <h2 className="text-xl font-bold text-white tracking-wide animate-pulse">Establishing Link...</h2>
                <p className="text-sm text-gray-400 mt-2">Gathering local candidates</p>
            </div>
        )}

        {/* STATE: SHOW QR CODE */}
        {(appState === AppState.SHOWING_OFFER || appState === AppState.SHOWING_ANSWER) && qrCodeData && (
          <div className="flex flex-col items-center flex-1 animate-in fade-in slide-in-from-bottom-4 duration-500">
            
            <div className="w-full glass-panel rounded-3xl p-6 flex flex-col items-center shadow-2xl relative">
                <div className="absolute -top-3 px-4 py-1 rounded-full bg-primary text-black text-xs font-bold uppercase tracking-wider shadow-neon-cyan">
                    {appState === AppState.SHOWING_OFFER ? "Step 1: Scan Me" : "Step 2: Show Host"}
                </div>
                
                <div className="bg-white p-2 rounded-xl mb-6 mt-2 shadow-[0_0_20px_rgba(255,255,255,0.2)]">
                    <img src={qrCodeData} alt="Signaling QR" className="w-64 h-64 object-contain" />
                </div>

                <div className="w-full flex flex-col gap-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Or copy code manually</label>
                    <div className="flex gap-2">
                        <input 
                            type="text" 
                            readOnly 
                            value={signalString} 
                            className="flex-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 focus:outline-none focus:border-primary truncate"
                        />
                        <button onClick={copyToClipboard} className="bg-white/10 hover:bg-primary hover:text-black transition-colors rounded-lg px-3 py-2 flex items-center justify-center">
                            <span className="material-symbols-outlined text-sm">content_copy</span>
                        </button>
                    </div>
                </div>
            </div>

            <p className="mt-6 text-center text-gray-400 text-sm max-w-[260px]">
                {appState === AppState.SHOWING_OFFER 
                  ? "Waiting for Device B to scan this code..."
                  : "Share this answer with caller (Device A) to start."}
            </p>

            {appState === AppState.SHOWING_OFFER && (
                 <div className="mt-auto w-full">
                    <button 
                        onClick={() => setAppState(AppState.SCANNING_ANSWER)} 
                        className="w-full py-4 rounded-xl bg-gradient-to-r from-accent to-green-600 text-black font-bold shadow-neon-green transition-transform active:scale-95 flex items-center justify-center gap-2"
                    >
                        <span>I Scanned Device B</span>
                        <span className="material-symbols-outlined">arrow_forward</span>
                    </button>
                    <p className="text-center text-[10px] text-gray-500 mt-3 uppercase tracking-wider">
                        Tap only after you have scanned their code
                    </p>
                 </div>
            )}
            
            {appState === AppState.SHOWING_ANSWER && (
                <div className="mt-auto flex flex-col items-center justify-center gap-2 text-primary animate-pulse">
                    <span className="w-2 h-2 bg-primary rounded-full"></span>
                    <span className="text-xs font-bold uppercase tracking-wider">Waiting for Host to Connect</span>
                    <span className="text-[8px] text-primary/60 font-mono">({appState} / {pc.current?.signalingState || 'N/A'})</span>
                    {pc.current && (
                        <span className="text-[8px] text-yellow-400 font-mono mt-2">
                            Conn: {pc.current.connectionState} | ICE: {pc.current.iceConnectionState}
                        </span>
                    )}
                </div>
            )}
          </div>
        )}

        {/* STATE: SCANNER */}
        {(appState === AppState.SCANNING_OFFER || appState === AppState.SCANNING_ANSWER) && (
            <div className="fixed inset-0 z-50 bg-black">
                <QRScanner 
                    instruction={appState === AppState.SCANNING_OFFER ? "Scan Host's QR Code" : "Scan Guest's QR Code"}
                    onScan={(data) => {
                        console.log("QRScanner detected code:", data.substring(0, 50));
                        if (appState === AppState.SCANNING_OFFER) {
                            handleScanOffer(data);
                        } else {
                            handleScanAnswer(data);
                        }
                    }}
                    onClose={endCall}
                />
                
                {/* Debug Info Panel - Visible only when DEBUG_MODE is true */}
                {DEBUG_MODE && (
                  <div className="absolute top-20 left-4 right-4 z-[65] bg-black/90 border border-primary/50 rounded-lg p-4 font-mono text-xs text-primary whitespace-pre-wrap max-h-40 overflow-y-auto shadow-neon-cyan">
                    {debugInfo || '🔄 Waiting for QR code scan or manual input...'}
                    <div className="mt-2 text-[9px] text-cyan-400 font-bold">DEBUG MODE ON</div>
                  </div>
                )}
                
                {/* Manual Input Fallback Overlay */}
                <div className="absolute bottom-8 left-6 right-6 z-[60]">
                    <div className="glass-panel p-4 rounded-2xl flex flex-col gap-2 shadow-neon-pink border border-secondary/20 bg-black/80">
                        <label className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">Or Paste Code</label>
                        <div className="flex flex-col gap-3">
                            <div className="flex gap-2">
                                <input 
                                    type="text" 
                                    placeholder="Paste Base64 code here..."
                                    value={manualInputVal}
                                    className="flex-1 bg-black/50 border border-white/10 rounded-lg px-3 py-3 text-sm text-white focus:outline-none focus:border-secondary transition-colors"
                                    onPaste={(e) => {
                                        const val = e.clipboardData.getData('text');
                                        if(val) {
                                            setManualInputVal(val);
                                            handleManualInput(val);
                                        }
                                    }}
                                    onChange={(e) => {
                                        setManualInputVal(e.target.value);
                                        if(e.target.value.length > 50) handleManualInput(e.target.value);
                                    }}
                                />
                            </div>
                            <button 
                                onClick={handlePasteFromClipboard}
                                className="w-full bg-secondary hover:bg-secondary/90 text-black font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                                <span className="material-symbols-outlined">content_paste</span>
                                Paste Code from Clipboard
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}

      </main>
    </div>
  );
}

export default App;
