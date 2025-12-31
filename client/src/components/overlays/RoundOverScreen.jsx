/**
 * Round Over Screen - Shows round results and scores
 */
const RoundOverScreen = ({
    roundResult,
    pointThreshold,
    onNextRound
}) => {
    if (!roundResult) return null;

    return (
        <div className="absolute inset-0 z-50 bg-black/90 flex flex-col items-center justify-center text-white p-8">
            <h2 className="text-5xl font-bold text-yellow-400 mb-2">Round {roundResult.roundNumber} Complete!</h2>
            <div className="text-xl mb-4 text-green-300">Round Winner: {roundResult.roundWinner.name}</div>

            <div className="bg-white/10 rounded-lg p-6 mb-6 w-full max-w-md">
                <h3 className="text-xl font-bold mb-4 border-b pb-2">Round Scores</h3>
                <div className="grid grid-cols-4 gap-2 text-sm font-semibold mb-2 text-gray-400">
                    <span>Player</span>
                    <span className="text-center">Cards</span>
                    <span className="text-center">Round</span>
                    <span className="text-center">Total</span>
                </div>
                {roundResult.scores && roundResult.scores.map(s => (
                    <div key={s.name} className="grid grid-cols-4 gap-2 mb-2 items-center">
                        <span className={s.isRoundWinner ? 'text-green-400 font-bold' : ''}>
                            {s.name} {s.isBot ? '(Bot)' : ''}
                        </span>
                        <span className="text-center text-gray-400">{s.cardsLeft}</span>
                        <span className={`text-center ${s.roundPoints === 0 ? 'text-green-400' : 'text-red-400'}`}>
                            +{s.roundPoints}
                        </span>
                        <span className={`text-center font-bold ${s.cumulativeScore >= 80 ? 'text-red-500' : s.cumulativeScore >= 50 ? 'text-yellow-400' : 'text-white'}`}>
                            {s.cumulativeScore}
                        </span>
                    </div>
                ))}
                <div className="mt-4 pt-2 border-t border-white/20 text-sm text-gray-400">
                    First to {pointThreshold || 100} points loses. Lowest score wins!
                </div>
            </div>

            <button onClick={onNextRound} className="bg-green-600 px-8 py-3 rounded-lg font-bold hover:bg-green-700 transition transform hover:scale-105 text-xl">
                Next Round
            </button>
        </div>
    );
};

export default RoundOverScreen;
