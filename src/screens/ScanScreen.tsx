import type { ClipboardEventHandler } from 'react';
import QRScanner from '../../components/QRScanner';

interface ScanScreenProps {
  instruction: string;
  onScan: (data: string) => void;
  onClose: () => void;
  debugMode: boolean;
  debugInfo: string;
  manualInputValue: string;
  onManualInputChange: (value: string) => void;
  onManualPaste: ClipboardEventHandler<HTMLInputElement>;
  onPasteFromClipboard: () => void;
  onConnect: () => void;
  isProcessingManualInput: boolean;
}

export default function ScanScreen({
  instruction,
  onScan,
  onClose,
  debugMode,
  debugInfo,
  manualInputValue,
  onManualInputChange,
  onManualPaste,
  onPasteFromClipboard,
  onConnect,
  isProcessingManualInput,
}: ScanScreenProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black">
      <QRScanner instruction={instruction} onScan={onScan} onClose={onClose} />
      {debugMode && <div className="absolute top-20 left-4 right-4 z-[65] bg-black/90 border border-primary/50 rounded-lg p-4 font-mono text-xs text-primary whitespace-pre-wrap max-h-40 overflow-y-auto">{debugInfo || 'Waiting for QR code scan…'}</div>}
      <div className="absolute bottom-8 left-6 right-6 z-[60]">
        <div className="glass-panel p-4 rounded-2xl flex flex-col gap-3 shadow-neon-pink border border-secondary/20 bg-black/80">
          <label htmlFor="compact-signal-input" className="text-[10px] text-gray-400 uppercase tracking-widest font-bold">Or paste compact code</label>
          <input id="compact-signal-input" type="text" placeholder="v1|o/a|ufrag|pwd|fingerprint|ip:port" value={manualInputValue} onChange={(event) => onManualInputChange(event.target.value)} onPaste={onManualPaste} disabled={isProcessingManualInput} className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-3 text-sm text-white disabled:opacity-50" />
          <div className="flex gap-2"><button onClick={onPasteFromClipboard} disabled={isProcessingManualInput} className="flex-1 bg-white/10 text-white font-bold py-3 rounded-lg disabled:opacity-50"><span className="material-symbols-outlined align-middle">content_paste</span> Paste</button><button onClick={onConnect} disabled={isProcessingManualInput || !manualInputValue.trim()} className="flex-1 bg-secondary text-black font-bold py-3 rounded-lg disabled:opacity-50">{isProcessingManualInput ? 'Connecting…' : 'Connect'}</button></div>
        </div>
      </div>
    </div>
  );
}
