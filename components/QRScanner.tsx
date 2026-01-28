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
  const [error, setError] = useState<string>('');

  useEffect(() => {
    let animationFrameId: number;
    let stream: MediaStream | null = null;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'environment' } 
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", "true"); 
          videoRef.current.play().catch(e => console.error("Video play error:", e));
          
          requestAnimationFrame(tick);
        }
      } catch (err) {
        console.error("Error accessing camera:", err);
        setError("Could not access camera.");
      }
    };

    const tick = () => {
      if (videoRef.current && canvasRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');

        if (ctx) {
          canvas.height = video.videoHeight;
          canvas.width = video.videoWidth;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });

          if (code) {
            onScan(code.data);
            return; 
          }
        }
      }
      animationFrameId = requestAnimationFrame(tick);
    };

    startCamera();

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (stream) stream.getTracks().forEach(track => track.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="absolute inset-0 z-50 bg-black flex flex-col">
      <div className="absolute top-4 right-4 z-50">
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
              className="absolute inset-0 w-full h-full object-cover opacity-60" 
              playsInline 
              muted
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
        <p className="text-white font-bold text-lg mb-1 tracking-wide shadow-black drop-shadow-md">SCAN QR CODE</p>
        <p className="text-primary text-sm font-medium uppercase tracking-widest">{instruction}</p>
      </div>
    </div>
  );
};

export default QRScanner;