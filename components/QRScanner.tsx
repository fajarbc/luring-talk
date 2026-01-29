import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

interface QRScannerProps {
  onScan: (data: string) => void;
  onClose: () => void;
  instruction: string;
}

const QRScanner: React.FC<QRScannerProps> = ({ onScan, onClose, instruction }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const frameCallbackRef = useRef<number | null>(null);
  const scannedRef = useRef<boolean>(false);
  const [error, setError] = useState<string>('');
  const [isStarting, setIsStarting] = useState<boolean>(true);
  const [statusText, setStatusText] = useState<string>('Initializing camera...');
  const [videoInfo, setVideoInfo] = useState<string>('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchSupported, setTorchSupported] = useState<boolean>(false);
  const [torchOn, setTorchOn] = useState<boolean>(false);
  const [restartCounter, setRestartCounter] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stopCamera = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (frameCallbackRef.current && videoRef.current?.cancelVideoFrameCallback) {
        videoRef.current.cancelVideoFrameCallback(frameCallbackRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };

    const applyTorch = async (enabled: boolean) => {
      const track = streamRef.current?.getVideoTracks()[0];
      if (!track) return;
      const caps = track.getCapabilities?.();
      if (caps && 'torch' in caps) {
        try {
          await track.applyConstraints({ advanced: [{ torch: enabled }] });
          setTorchOn(enabled);
        } catch (err) {
          console.error('Torch apply error:', err);
        }
      }
    };

    const startCamera = async (mode: 'environment' | 'user') => {
      setIsStarting(true);
      setStatusText('Starting camera...');
      setError('');
      scannedRef.current = false;
      stopCamera();

      const constraintsList: MediaStreamConstraints[] = [
        { video: { facingMode: { exact: mode }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: { width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: true }
      ];

      let stream: MediaStream | null = null;
      for (const constraints of constraintsList) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err) {
          console.warn('getUserMedia failed with constraints:', constraints, err);
        }
      }

      if (!stream) {
        setError('Camera access denied or unavailable. Try switching camera or upload an image.');
        setStatusText('Camera unavailable');
        setIsStarting(false);
        return;
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        try {
          await videoRef.current.play();
        } catch (err) {
          console.error('Video play error:', err);
        }
      }

      const track = stream.getVideoTracks()[0];
      const caps = track?.getCapabilities?.();
      setTorchSupported(Boolean(caps && 'torch' in caps));
      if (caps && 'torch' in caps) {
        await applyTorch(torchOn);
      }

      setIsStarting(false);
      setStatusText('Scanning...');
      console.log('Camera started, beginning QR scan...');
      scheduleNextFrame();
    };

    const scanFrame = () => {
      if (scannedRef.current) return;
      if (document.visibilityState !== 'visible') {
        scheduleNextFrame();
        return;
      }
      if (videoRef.current && canvasRef.current && videoRef.current.readyState >= videoRef.current.HAVE_CURRENT_DATA) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        if (ctx) {
          const maxW = 960;
          const scale = Math.min(1, maxW / video.videoWidth);
          const width = Math.floor(video.videoWidth * scale);
          const height = Math.floor(video.videoHeight * scale);
          canvas.width = width;
          canvas.height = height;

          ctx.drawImage(video, 0, 0, width, height);
          const imageData = ctx.getImageData(0, 0, width, height);

          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'attemptBoth',
          });

          if (code) {
            console.log('QR code detected!');
            scannedRef.current = true;
            stopCamera();
            onScan(code.data);
            return;
          }
        }
        if (video.videoWidth && video.videoHeight) {
          setVideoInfo(`${video.videoWidth}x${video.videoHeight} • readyState ${video.readyState}`);
        }
        setStatusText('Scanning...');
      }
      scheduleNextFrame();
    };

    const scheduleNextFrame = () => {
      if (!videoRef.current) return;
      if (videoRef.current.requestVideoFrameCallback) {
        frameCallbackRef.current = videoRef.current.requestVideoFrameCallback(() => scanFrame());
      } else {
        rafRef.current = requestAnimationFrame(scanFrame);
      }
    };

    startCamera(facingMode);

    return () => {
      stopCamera();
    };
  }, [facingMode, torchOn, restartCounter]);

  const handleImageUpload = (file: File) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: 'attemptBoth',
      });

      URL.revokeObjectURL(url);

      if (code) {
        console.log('QR code detected from image!');
        onScan(code.data);
      } else {
        setError('No QR code found in the image. Try a clearer screenshot.');
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError('Failed to load image.');
    };
    img.src = url;
  };

  return (
    <div className="absolute inset-0 z-50 bg-black flex flex-col">
      <div className="absolute top-4 right-4 z-50 flex items-center gap-2">
        {torchSupported && (
          <button
            onClick={() => setTorchOn(!torchOn)}
            className="bg-black/40 backdrop-blur-md border border-white/10 text-white p-3 rounded-full hover:bg-white/10 transition-colors"
          >
            <span className="material-symbols-outlined">{torchOn ? 'flash_on' : 'flash_off'}</span>
          </button>
        )}
        <button
          onClick={() => setFacingMode(facingMode === 'environment' ? 'user' : 'environment')}
          className="bg-black/40 backdrop-blur-md border border-white/10 text-white p-3 rounded-full hover:bg-white/10 transition-colors"
        >
          <span className="material-symbols-outlined">flip_camera_android</span>
        </button>
        <button
          onClick={() => setRestartCounter((v) => v + 1)}
          className="bg-black/40 backdrop-blur-md border border-white/10 text-white p-3 rounded-full hover:bg-white/10 transition-colors"
          title="Restart camera"
        >
          <span className="material-symbols-outlined">restart_alt</span>
        </button>
        <button 
          onClick={onClose}
          className="bg-black/40 backdrop-blur-md border border-white/10 text-white p-3 rounded-full hover:bg-white/10 transition-colors"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
      
      <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
        {error ? (
          <div className="text-white text-center p-6">
            <span className="material-symbols-outlined text-4xl mb-2 text-red-500">error</span>
            <p>{error}</p>
          </div>
        ) : (
          <>
            <video 
              ref={videoRef} 
              className="absolute inset-0 w-full h-full object-cover opacity-70" 
              playsInline 
              muted
              autoPlay
            />
            <canvas ref={canvasRef} className="hidden" />
            
            {/* Scanner Overlay Neon */}
            <div className="relative w-72 h-72 z-10">
              <div className="absolute inset-0 border-2 border-primary/30 rounded-3xl animate-pulse"></div>
              
              {/* Corners */}
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-primary -mt-1 -ml-1 rounded-tl-xl shadow-[0_0_10px_rgba(0,240,255,0.8)]"></div>
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-primary -mt-1 -mr-1 rounded-tr-xl shadow-[0_0_10px_rgba(0,240,255,0.8)]"></div>
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-primary -mb-1 -ml-1 rounded-bl-xl shadow-[0_0_10px_rgba(0,240,255,0.8)]"></div>
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-primary -mb-1 -mr-1 rounded-br-xl shadow-[0_0_10px_rgba(0,240,255,0.8)]"></div>
              
              {/* Scan Line */}
              <div className="absolute top-0 left-2 right-2 h-1 bg-primary shadow-[0_0_15px_rgba(0,240,255,1)] animate-[scan_2s_linear_infinite]"></div>
            </div>
            
            <style>{`
                @keyframes scan {
                    0% { top: 2%; opacity: 0; }
                    10% { opacity: 1; }
                    90% { opacity: 1; }
                    100% { top: 98%; opacity: 0; }
                }
            `}</style>
          </>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/90 to-transparent pt-12 pb-8 px-6 text-center">
        <p className="text-white font-bold text-lg mb-1 tracking-wide shadow-black drop-shadow-md">
          {isStarting ? 'STARTING CAMERA...' : 'SCAN QR CODE'}
        </p>
        <p className="text-primary text-sm font-medium uppercase tracking-widest">{instruction}</p>
        <div className="mt-4 flex flex-col items-center gap-2 text-xs text-gray-300">
          <span>{statusText}</span>
          {videoInfo && <span className="text-[10px] text-gray-400 font-mono">{videoInfo}</span>}
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-white/10 hover:bg-white/20 text-white text-xs px-3 py-2 rounded-lg"
            >
              Upload QR Image
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageUpload(file);
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default QRScanner;