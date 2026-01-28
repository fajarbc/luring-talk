import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import { AppState, CallRole, SignalingData } from './types';
import { getLocalIP, formatSDPForQR, parseSDPFromQR } from './utils/network';
import QRScanner from './components/QRScanner';
import VideoCall from './components/VideoCall';

const ICE_GATHERING_TIMEOUT = 10000; // 10 seconds timeout for candidate gathering

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
  
  // WebRTC Refs
  const pc = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const bgVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    getLocalIP().then(setLocalIP);
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

  /**
   * Initializes the RTCPeerConnection and Local Media Stream.
   * This is called before generating an offer or an answer.
   */
  const initializePeerConnection = useCallback(async () => {
    const config: RTCConfiguration = {
      // No ICE servers needed for local LAN (Link-Local / Private IP)
      iceServers: [], 
      iceCandidatePoolSize: 10
    };
    
    const peer = new RTCPeerConnection(config);
    
    // Monitoring Connection State
    peer.onconnectionstatechange = () => {
        console.log("Connection State:", peer.connectionState);
        switch(peer.connectionState) {
            case 'disconnected':
            case 'failed':
            case 'closed':
                if (appState !== AppState.HOME) {
                    setError("Connection lost. Peer disconnected.");
                }
                break;
        }
    };

    // Monitoring ICE State
    peer.oniceconnectionstatechange = () => {
      console.log("ICE State:", peer.iceConnectionState);
      if (peer.iceConnectionState === 'connected') {
        setAppState(AppState.CONNECTED);
      }
      if (peer.iceConnectionState === 'disconnected' || peer.iceConnectionState === 'failed') {
        console.error("ICE Connection Failed");
        setError("Connection Failed - Network instability detected.");
      }
    };

    // Handle Remote Stream
    peer.ontrack = (event) => {
      console.log("Received remote track");
      setRemoteStream(event.streams[0]);
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
  }, [appState]);

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
        sdp: JSON.stringify(peer.localDescription)
        };
        
        const qrData = formatSDPForQR(payload);
        generateQR(qrData);
        setSignalString(btoa(qrData));
        
        setAppState(AppState.SHOWING_OFFER);
    } catch (err) {
        console.error("Start call error:", err);
        setError("Failed to generate offer. Please retry.");
    }
  };

  const joinCall = () => {
    setRole('peer');
    setError(null);
    setAppState(AppState.SCANNING_OFFER);
  };

  const handleScanOffer = async (data: string) => {
    const signal = parseSDPFromQR(data);
    if (!signal || signal.type !== 'offer') {
      setError("Invalid QR Code. Expected an Offer from the Caller.");
      return;
    }
    processOffer(signal);
  };

  const handleManualInput = (inputStr: string) => {
    const cleanStr = inputStr.trim();
    if (!cleanStr) return;

    // Dismiss keyboard logic
    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
    }

    let signal: any = null;

    try {
        const jsonStr = atob(cleanStr);
        signal = JSON.parse(jsonStr);
    } catch (e) {
        try {
            signal = JSON.parse(cleanStr);
        } catch (e2) {
             // Invalid format
        }
    }

    if (signal && signal.type && signal.sdp) {
        if (appState === AppState.SCANNING_OFFER || appState === AppState.HOME) {
            if (signal.type === 'offer') {
                processOffer(signal);
            } else {
                setError("Incorrect code. Expected an OFFER (from Caller).");
            }
        } else if (appState === AppState.SCANNING_ANSWER) {
            if (signal.type === 'answer') {
                 processAnswer(signal);
            } else {
                setError("Incorrect code. Expected an ANSWER (from Callee).");
            }
        }
    } else if (cleanStr.length > 20) {
        setError("Invalid code format. Please ensure you copied the entire string.");
    }
  };

  /**
   * Device B Flow: Process Offer & Create Answer
   */
  const processOffer = async (signal: SignalingData) => {
    setAppState(AppState.GENERATING_ANSWER);
    
    const peer = await initializePeerConnection();
    if (!peer) return;

    try {
      const remoteDesc = JSON.parse(signal.sdp);
      await peer.setRemoteDescription(remoteDesc);
      
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await waitForIceGathering(peer);

      const payload: SignalingData = {
        type: 'answer',
        sdp: JSON.stringify(peer.localDescription)
      };
      
      const qrData = formatSDPForQR(payload);
      generateQR(qrData);
      setSignalString(btoa(qrData));
      
      setAppState(AppState.SHOWING_ANSWER);
    } catch (err) {
      console.error("Error establishing answer", err);
      setError("Connection failed during negotiation. Ensure both devices are on same WiFi.");
      endCall(); 
    }
  };

  const handleScanAnswer = async (data: string) => {
    const signal = parseSDPFromQR(data);
    if (!signal || signal.type !== 'answer') {
      setError("Invalid QR Code. Expected an Answer from the Callee.");
      return;
    }
    processAnswer(signal);
  };

  /**
   * Device A Flow: Process Answer
   * This completes the handshake.
   */
  const processAnswer = async (signal: SignalingData) => {
    if (!pc.current) return;
    try {
      const remoteDesc = JSON.parse(signal.sdp);
      await pc.current.setRemoteDescription(remoteDesc);
      // Connection should establish automatically via ICE now
    } catch (err) {
      console.error("Error setting final answer", err);
      setError("Handshake failed. Protocol mismatch.");
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
      // Use L error correction for maximum data capacity
      const url = await QRCode.toDataURL(text, { 
          width: 480, 
          margin: 1, 
          color: { dark: '#000000', light: '#ffffff' },
          errorCorrectionLevel: 'L'
      });
      setQrCodeData(url);
    } catch (err) {
      console.error(err);
      setError("Failed to generate QR code.");
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
                <div className="mt-auto flex items-center justify-center gap-2 text-primary animate-pulse">
                    <span className="w-2 h-2 bg-primary rounded-full"></span>
                    <span className="text-xs font-bold uppercase tracking-wider">Waiting for Host to Connect</span>
                </div>
            )}
          </div>
        )}

        {/* STATE: SCANNER */}
        {(appState === AppState.SCANNING_OFFER || appState === AppState.SCANNING_ANSWER) && (
            <div className="fixed inset-0 z-50 bg-black">
                <QRScanner 
                    instruction={appState === AppState.SCANNING_OFFER ? "Scan Host's QR Code" : "Scan Guest's QR Code"}
                    onScan={appState === AppState.SCANNING_OFFER ? handleScanOffer : handleScanAnswer}
                    onClose={endCall}
                />
                
                {/* Manual Input Fallback Overlay */}
                <div className="absolute bottom-8 left-6 right-6 z-[60]">
                    <div className="glass-panel p-4 rounded-2xl flex flex-col gap-2 shadow-neon-pink border border-secondary/20 bg-black/80">
                        <label className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">Or Paste Code</label>
                        <div className="flex gap-2">
                            <div className="flex-1 relative">
                                <input 
                                    type="text" 
                                    placeholder="Paste Base64 code..."
                                    value={manualInputVal}
                                    className="w-full bg-black/50 border border-white/10 rounded-lg pl-3 pr-10 py-3 text-sm text-white focus:outline-none focus:border-secondary transition-colors"
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
                                <button 
                                    onClick={handlePasteFromClipboard}
                                    className="absolute right-2 top-2 bottom-2 aspect-square flex items-center justify-center text-gray-400 hover:text-white bg-white/5 rounded-md"
                                >
                                    <span className="material-symbols-outlined text-sm">content_paste</span>
                                </button>
                            </div>
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