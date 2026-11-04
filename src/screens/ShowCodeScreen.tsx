interface ShowCodeScreenProps {
  qrCodeData: string;
  signalString: string;
  isOffer: boolean;
  onCopyCode: () => void;
  onContinue: () => void;
}

export default function ShowCodeScreen({
  qrCodeData,
  signalString,
  isOffer,
  onCopyCode,
  onContinue,
}: ShowCodeScreenProps) {
  return (
    <div className="flex flex-col items-center flex-1">
      <div className="w-full glass-panel rounded-3xl p-6 flex flex-col items-center shadow-2xl relative">
        <div className="absolute -top-3 px-4 py-1 rounded-full bg-primary text-black text-xs font-bold uppercase tracking-wider shadow-neon-cyan">
          {isOffer ? 'Step 1: Scan Me' : 'Step 2: Show Host'}
        </div>
        <div className="bg-white p-2 rounded-xl mb-6 mt-2"><img src={qrCodeData} alt="Compact signaling QR" className="w-64 h-64 object-contain" /></div>
        <div className="w-full flex flex-col gap-2">
          <label htmlFor="compact-signal-code" className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Or copy code manually</label>
          <div className="flex gap-2"><input id="compact-signal-code" type="text" readOnly value={signalString} className="flex-1 bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 truncate" /><button onClick={onCopyCode} aria-label="Copy code to clipboard" className="min-w-11 min-h-11 bg-white/10 rounded-lg px-3 py-2"><span className="material-symbols-outlined text-sm" aria-hidden="true">content_copy</span></button></div>
          <p className="text-[10px] text-center text-primary">{signalString.length} characters</p>
        </div>
      </div>
      <p className="mt-6 text-center text-gray-400 text-sm max-w-[260px]">{isOffer ? 'Waiting for Device B to scan this code…' : 'Share this answer with caller to open the data channel.'}</p>
      {isOffer && <button onClick={onContinue} className="mt-auto w-full py-4 rounded-xl bg-gradient-to-r from-accent to-green-600 text-black font-bold shadow-neon-green flex items-center justify-center gap-2"><span>I Scanned Device B</span><span className="material-symbols-outlined">arrow_forward</span></button>}
      {!isOffer && <div className="mt-auto flex flex-col items-center justify-center gap-2 text-primary animate-pulse"><span className="w-2 h-2 bg-primary rounded-full" /><span className="text-xs font-bold uppercase tracking-wider">Waiting for Host to Connect</span></div>}
    </div>
  );
}
