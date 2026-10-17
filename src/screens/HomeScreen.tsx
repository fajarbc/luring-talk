interface HomeScreenProps {
  localIP: string;
  showInstallPrompt: boolean;
  onInstall: () => void;
  onStartCall: () => void;
  onJoinCall: () => void;
}

export default function HomeScreen({
  localIP,
  showInstallPrompt,
  onInstall,
  onStartCall,
  onJoinCall,
}: HomeScreenProps) {
  return (
    <div className="flex flex-col h-full justify-center">
      {showInstallPrompt && (
        <div className="glass-panel rounded-2xl p-4 mb-6 border border-white/10 shadow-neon-cyan">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-white">Install LuringTalk</p>
              <p className="text-xs text-gray-400">Add to Home Screen for offline access.</p>
            </div>
            <button onClick={onInstall} className="min-h-11 bg-primary text-black font-bold px-4 py-2 rounded-lg">Install</button>
          </div>
        </div>
      )}
      <div className="relative mb-12 flex flex-col items-center justify-center">
        <div aria-hidden="true" className="absolute w-64 h-64 rounded-full border border-primary/20 animate-[spin_10s_linear_infinite]" />
        <div aria-hidden="true" className="absolute w-48 h-48 rounded-full border border-secondary/20 animate-[spin_7s_linear_infinite_reverse]" />
        <div className="w-32 h-32 rounded-full bg-surface border border-white/10 shadow-neon-cyan flex items-center justify-center relative z-10 glass-panel">
          <span className="material-symbols-outlined text-5xl text-primary animate-pulse" aria-hidden="true">wifi_tethering</span>
        </div>
        <div className="mt-8 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Signaling mode</p>
          <div className="inline-block px-6 py-2 rounded-full bg-white/5 border border-white/10 font-mono text-sm text-primary shadow-neon-cyan">{localIP}</div>
        </div>
      </div>
      <div className="flex flex-col gap-4 mt-auto mb-8">
        <button onClick={onStartCall} className="relative group w-full h-16 rounded-2xl bg-gradient-to-r from-primary to-blue-500 p-[1px] shadow-neon-cyan">
          <div className="h-full w-full rounded-2xl bg-black/50 backdrop-blur-sm flex items-center justify-center gap-3"><span className="material-symbols-outlined text-primary">add_call</span><span className="text-lg font-bold tracking-wider">START CALL</span></div>
        </button>
        <button onClick={onJoinCall} className="relative group w-full h-16 rounded-2xl bg-gradient-to-r from-secondary to-pink-600 p-[1px] shadow-neon-pink">
          <div className="h-full w-full rounded-2xl bg-black/50 backdrop-blur-sm flex items-center justify-center gap-3"><span className="material-symbols-outlined text-secondary">qr_code_scanner</span><span className="text-lg font-bold tracking-wider">JOIN CALL</span></div>
        </button>
      </div>
      <p className="text-center text-xs text-gray-400 uppercase tracking-widest">Wi-Fi LAN Only • No Internet Needed</p>
    </div>
  );
}
