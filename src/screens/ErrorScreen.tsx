interface ErrorScreenProps {
  error: string;
  onRetry: () => void;
}

export default function ErrorScreen({ error, onRetry }: ErrorScreenProps) {
  return (
    <div className="min-h-screen bg-background text-white font-sans flex items-center justify-center p-6">
      <div className="glass-panel p-8 rounded-3xl w-full max-w-sm text-center shadow-neon-pink border border-red-500/30">
        <div className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-6">
          <span className="material-symbols-outlined text-4xl text-red-500">signal_disconnected</span>
        </div>
        <h2 className="text-2xl font-bold mb-2">Connection Failed</h2>
        <p className="text-gray-300 mb-8">{error}</p>
        <button onClick={onRetry} className="w-full py-4 rounded-xl bg-white text-black font-bold tracking-wider">
          RETRY
        </button>
      </div>
    </div>
  );
}
