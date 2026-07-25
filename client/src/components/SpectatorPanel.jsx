/**
 * Roster of everyone watching the game, with host mute controls.
 *
 * Mute here is SOFT: the server tells the spectator's client to disable its mic
 * and locks the button. Media is peer-to-peer, so a modified client could ignore
 * it. The copy below says "muted" and nothing stronger for that reason.
 *
 * Self-contained overlay rather than the shared Modal, which is an alert/prompt
 * component with a fixed body and no children slot.
 */
function SpectatorPanel({ show, onClose, spectators = [], mutedAll, isHost, onMuteAll, onMuteOne }) {
    if (!show) return null;

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-[400]"
            onClick={onClose}
        >
            <div
                className="bg-gray-900 border border-gray-700 rounded-2xl max-w-sm w-full shadow-2xl p-5"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-bold text-white">
                        👁 Watching ({spectators.length})
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white text-2xl leading-none"
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>

                {spectators.length === 0 ? (
                    <div className="text-gray-400 text-sm">Nobody is watching this game.</div>
                ) : (
                    <div className="space-y-3">
                        {isHost && (
                            <label className="flex items-center justify-between gap-3 bg-gray-800 rounded-lg px-3 py-2 cursor-pointer">
                                <span className="text-sm text-gray-200 font-medium">Mute all spectators</span>
                                <input
                                    type="checkbox"
                                    checked={!!mutedAll}
                                    onChange={(e) => onMuteAll(e.target.checked)}
                                    className="w-4 h-4 accent-red-500"
                                />
                            </label>
                        )}

                        <div className="space-y-2 max-h-56 overflow-y-auto">
                            {spectators.map(s => {
                                const effectivelyMuted = mutedAll || s.forcedMute;
                                return (
                                    <div key={s.username} className="flex items-center justify-between gap-3 bg-gray-800/60 rounded-lg px-3 py-2">
                                        <span className="text-sm text-gray-200 truncate">
                                            {s.username}
                                            {s.isGuest && <span className="text-gray-500 text-xs ml-1">(guest)</span>}
                                            {effectivelyMuted && <span className="text-red-400 text-xs ml-2">muted</span>}
                                        </span>
                                        {isHost && (
                                            <button
                                                onClick={() => onMuteOne(s.username, !s.forcedMute)}
                                                disabled={mutedAll}
                                                title={mutedAll ? 'All spectators are muted' : undefined}
                                                className={`shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg transition ${mutedAll
                                                    ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                                    : s.forcedMute
                                                        ? 'bg-red-700 hover:bg-red-600 text-white'
                                                        : 'bg-gray-600 hover:bg-gray-500 text-white'
                                                    }`}
                                            >
                                                {s.forcedMute ? 'Unmute' : 'Mute'}
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {isHost && (
                            <p className="text-xs text-gray-500 leading-snug">
                                Muting disables a spectator&apos;s microphone. They can still hear the game.
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default SpectatorPanel;
