import React, { useEffect, useRef, useState } from 'react';

interface VideoCallProps {
  localStream: MediaStream;
  remoteStream: MediaStream | null;
  onEndCall: () => void;
  onSwitchCamera: () => void;
}

const VideoCall: React.FC<VideoCallProps> = ({ localStream, remoteStream, onEndCall, onSwitchCamera }) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [uiVisible, setUiVisible] = useState(true);
  const [duration, setDuration] = useState(0);

  // 1. Timer logic
  useEffect(() => {
    const startTime = Date.now();
    const timer = setInterval(() => {
      setDuration(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 2. Wake Lock logic to prevent screen sleep
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    const requestWakeLock = async () => {
        try {
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log('Wake Lock is active');
            }
        } catch (err) {
            console.error('Wake Lock error:', err);
        }
    };

    requestWakeLock();

    // Re-acquire lock if visibility changes (e.g. user switches tabs and comes back)
    const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            requestWakeLock();
        }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
        if (wakeLock) wakeLock.release();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    const pad = (n: number) => n.toString().padStart(2, '0');
    // Enforce HH:MM:SS format
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  };

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const toggleAudio = () => {
    localStream.getAudioTracks().forEach(track => {
      track.enabled = !track.enabled;
    });
    setIsAudioMuted(!isAudioMuted);
  };

  const toggleVideo = () => {
    localStream.getVideoTracks().forEach(track => {
      track.enabled = !track.enabled;
    });
    setIsVideoMuted(!isVideoMuted);
  };

  return (
    <div 
      className="fixed inset-0 bg-background z-50 flex flex-col overflow-hidden"
      onClick={() => setUiVisible(!uiVisible)}
    >
      {/* Remote Video (Fullscreen Background) */}
      <div className="absolute inset-0 z-0 bg-black">
        <video 
          ref={remoteVideoRef}
          autoPlay 
          playsInline 
          className={`w-full h-full object-cover transition-opacity duration-700 ease-in-out ${remoteStream ? 'opacity-100' : 'opacity-0'}`}
        />
        {!remoteStream && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/90 backdrop-blur-sm z-10 transition-opacity duration-500">
                <div className="relative">
                    <div className="absolute inset-0 rounded-full animate-ping bg-primary/20"></div>
                    <div className="w-20 h-20 rounded-full border-4 border-transparent border-t-primary animate-spin relative z-10"></div>
                </div>
                <p className="text-primary font-bold tracking-widest mt-6 animate-pulse text-sm">ESTABLISHING P2P LINK</p>
            </div>
        )}
      </div>

      {/* Local Video (Top Left PIP) */}
      <div className={`absolute top-4 left-4 z-20 w-[25%] min-w-[100px] max-w-[180px] aspect-[3/4] transition-all duration-300 ${uiVisible ? 'opacity-100 translate-y-0' : 'opacity-50 -translate-y-4'}`}>
        <div className="w-full h-full rounded-2xl overflow-hidden shadow-neon-cyan border border-primary/30 bg-black relative group">
          <video 
            ref={localVideoRef}
            autoPlay 
            playsInline 
            muted 
            className="w-full h-full object-cover transform -scale-x-100" 
          />
          {isVideoMuted && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 backdrop-blur-sm">
              <span className="material-symbols-outlined text-white/50 text-2xl">videocam_off</span>
            </div>
          )}
          {/* Subtle inner glow */}
          <div className="absolute inset-0 rounded-2xl shadow-[inset_0_0_10px_rgba(0,0,0,0.5)] pointer-events-none"></div>
        </div>
      </div>

      {/* Timer (Top Right) */}
      <div className={`absolute top-6 right-6 z-20 transition-all duration-300 ${uiVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`}>
        <div className="glass-panel px-4 py-2 rounded-full border border-white/10 shadow-lg flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.8)]"></span>
            <span className="font-mono text-sm font-bold text-white tracking-wider tabular-nums">
                {formatTime(duration)}
            </span>
        </div>
      </div>

      {/* Bottom Controls Bar */}
      <div className={`absolute bottom-0 left-0 right-0 p-6 pb-8 bg-gradient-to-t from-black via-black/90 to-transparent transition-transform duration-300 flex justify-center items-center gap-4 sm:gap-6 z-30 ${uiVisible ? 'translate-y-0' : 'translate-y-full'}`}>
        
        {/* Toggle Audio */}
        <button 
          onClick={(e) => { e.stopPropagation(); toggleAudio(); }}
          className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center backdrop-blur-md border transition-all active:scale-95 shadow-lg ${
            isAudioMuted 
              ? 'bg-red-500/20 text-red-500 border-red-500/50' 
              : 'bg-white/10 text-white border-white/20 hover:bg-white/20 hover:shadow-neon-cyan'
          }`}
        >
          <span className="material-symbols-outlined text-2xl">
            {isAudioMuted ? 'mic_off' : 'mic'}
          </span>
        </button>

        {/* Toggle Video */}
        <button 
          onClick={(e) => { e.stopPropagation(); toggleVideo(); }}
          className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center backdrop-blur-md border transition-all active:scale-95 shadow-lg ${
            isVideoMuted 
              ? 'bg-red-500/20 text-red-500 border-red-500/50' 
              : 'bg-white/10 text-white border-white/20 hover:bg-white/20 hover:shadow-neon-cyan'
          }`}
        >
          <span className="material-symbols-outlined text-2xl">
            {isVideoMuted ? 'videocam_off' : 'videocam'}
          </span>
        </button>

        {/* Switch Camera */}
        <button 
          onClick={(e) => { e.stopPropagation(); onSwitchCamera(); }}
          className="w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center backdrop-blur-md border border-white/20 bg-white/10 text-white transition-all active:scale-95 shadow-lg hover:bg-white/20 hover:shadow-neon-green"
        >
          <span className="material-symbols-outlined text-2xl">
            cameraswitch
          </span>
        </button>

        {/* End Call */}
        <button 
          onClick={(e) => { e.stopPropagation(); onEndCall(); }}
          className="w-16 h-16 sm:w-18 sm:h-18 rounded-full bg-red-600 text-white flex items-center justify-center shadow-neon-pink hover:bg-red-500 active:scale-90 transition-all border-4 border-red-500/20"
        >
          <span className="material-symbols-outlined text-3xl sm:text-4xl">call_end</span>
        </button>

      </div>
      
    </div>
  );
};

export default VideoCall;