import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const BotDebugPanel = ({ reasoning, isVisible, onClose }) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [showHistory, setShowHistory] = useState(false);
    const [reasoningHistory, setReasoningHistory] = useState([]);

    // Add to history when new reasoning comes in
    useEffect(() => {
        if (reasoning && reasoning.timestamp) {
            // Append to history when a new reasoning prop arrives (functional
            // update from an external prop change, not a render cascade).
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setReasoningHistory(prev => {
                const newHistory = [reasoning, ...prev].slice(0, 20); // Keep last 20
                return newHistory;
            });
        }
    }, [reasoning]);

    if (!isVisible) return null;

    const currentReasoning = showHistory ? reasoningHistory : (reasoning ? [reasoning] : []);

    const formatCards = (cardsStr) => {
        if (!cardsStr) return '';
        return cardsStr.split(' ').map(card => {
            const suit = card.slice(-1);
            const rank = card.slice(0, -1);
            const suitSymbol = { D: '♦', C: '♣', H: '♥', S: '♠' }[suit] || suit;
            const suitColor = suit === 'D' || suit === 'H' ? 'text-red-500' : 'text-gray-800';
            return (
                <span key={card} className={`inline-block px-1 py-0.5 mx-0.5 bg-white rounded shadow-sm ${suitColor} font-mono text-sm`}>
                    {rank}{suitSymbol}
                </span>
            );
        });
    };

    const getActionColor = (action) => {
        switch (action) {
            case 'play': return 'text-green-400';
            case 'pass': return 'text-yellow-400';
            case 'strategic_pass': return 'text-orange-400';
            default: return 'text-white';
        }
    };

    return (
        <motion.div
            initial={{ x: 300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 300, opacity: 0 }}
            className="fixed right-0 top-0 h-full w-80 bg-gray-900/95 text-white shadow-2xl z-50 flex flex-col"
        >
            {/* Header */}
            <div className="flex items-center justify-between p-3 bg-gray-800 border-b border-gray-700">
                <div className="flex items-center gap-2">
                    <span className="text-lg">🤖</span>
                    <h2 className="font-bold">Bot Debug Panel</h2>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="text-gray-400 hover:text-white p-1"
                    >
                        {isExpanded ? '▼' : '▲'}
                    </button>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-red-400 p-1"
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Toggle History */}
            <div className="flex border-b border-gray-700">
                <button
                    onClick={() => setShowHistory(false)}
                    className={`flex-1 py-2 text-sm font-medium ${!showHistory ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'}`}
                >
                    Latest
                </button>
                <button
                    onClick={() => setShowHistory(true)}
                    className={`flex-1 py-2 text-sm font-medium ${showHistory ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'}`}
                >
                    History ({reasoningHistory.length})
                </button>
            </div>

            {/* Content */}
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        className="flex-1 overflow-y-auto"
                    >
                        {currentReasoning.length === 0 ? (
                            <div className="p-4 text-gray-400 text-center">
                                <div className="text-4xl mb-2">🎯</div>
                                <p>Waiting for bot decisions...</p>
                                <p className="text-sm mt-2">Bot reasoning will appear here when bots make moves.</p>
                            </div>
                        ) : (
                            <div className="divide-y divide-gray-700">
                                {currentReasoning.map((r, idx) => (
                                    <ReasoningCard key={r.timestamp || idx} reasoning={r} formatCards={formatCards} getActionColor={getActionColor} />
                                ))}
                            </div>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

const ReasoningCard = ({ reasoning, formatCards, getActionColor }) => {
    const [showDetails, setShowDetails] = useState(false);

    if (!reasoning) return null;

    const { botName, decision, situation, candidatesConsidered, strategicFactors } = reasoning;

    return (
        <div className="p-3 hover:bg-gray-800/50 transition-colors">
            {/* Bot Name & Action */}
            <div className="flex items-center justify-between mb-2">
                <span className="font-bold text-blue-400">{botName}</span>
                <span className={`font-mono text-sm ${getActionColor(decision?.action)}`}>
                    {decision?.action?.toUpperCase()}
                </span>
            </div>

            {/* Decision Summary */}
            {decision && (
                <div className="mb-2 p-2 bg-gray-800 rounded">
                    {decision.cards && (
                        <div className="mb-1">
                            <span className="text-gray-400 text-xs">Played: </span>
                            {formatCards(decision.cards)}
                        </div>
                    )}
                    <div className="text-sm text-gray-300">
                        <span className="text-gray-500">Reason: </span>
                        {decision.reason}
                    </div>
                    {decision.score && (
                        <div className="text-xs text-gray-500 mt-1">
                            Score: {decision.score}
                        </div>
                    )}
                </div>
            )}

            {/* Situation Info */}
            {situation && (
                <div className="mb-2 text-xs grid grid-cols-2 gap-1">
                    <div className="bg-gray-800 p-1 rounded">
                        <span className="text-gray-500">Hand: </span>
                        <span className="text-white">{situation.handSize} cards</span>
                    </div>
                    <div className="bg-gray-800 p-1 rounded">
                        <span className="text-gray-500">2s: </span>
                        <span className="text-white">{situation.twosInHand} in hand, {situation.twosOutstanding} out</span>
                    </div>
                    <div className="bg-gray-800 p-1 rounded">
                        <span className="text-gray-500">Free play: </span>
                        <span className={situation.isFreePlay ? 'text-green-400' : 'text-gray-400'}>
                            {situation.isFreePlay ? 'Yes' : 'No'}
                        </span>
                    </div>
                    <div className="bg-gray-800 p-1 rounded">
                        <span className="text-gray-500">Has highest: </span>
                        <span className={situation.weHaveHighest ? 'text-green-400' : 'text-gray-400'}>
                            {situation.weHaveHighest ? 'Yes' : 'No'}
                        </span>
                    </div>
                </div>
            )}

            {/* Strategic Factors */}
            {strategicFactors && strategicFactors.length > 0 && (
                <div className="mb-2">
                    <div className="text-xs text-gray-500 mb-1">Strategic Factors:</div>
                    <div className="flex flex-wrap gap-1">
                        {strategicFactors.map((f, i) => (
                            <span key={i} className="text-xs bg-purple-900/50 text-purple-300 px-2 py-0.5 rounded">
                                {f}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {/* Show/Hide Details */}
            <button
                onClick={() => setShowDetails(!showDetails)}
                className="text-xs text-blue-400 hover:text-blue-300"
            >
                {showDetails ? '▼ Hide alternatives' : '▶ Show alternatives'}
            </button>

            {/* Alternative Candidates */}
            <AnimatePresence>
                {showDetails && candidatesConsidered && candidatesConsidered.length > 0 && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="mt-2 overflow-hidden"
                    >
                        <div className="text-xs text-gray-500 mb-1">Top Alternatives Considered:</div>
                        <div className="space-y-1">
                            {candidatesConsidered.slice(0, 5).map((c, i) => (
                                <div key={i} className={`text-xs p-2 rounded ${i === 0 ? 'bg-green-900/30 border border-green-700' : 'bg-gray-800'}`}>
                                    <div className="flex justify-between items-center">
                                        <div>
                                            {formatCards(c.cards)}
                                            <span className="text-gray-500 ml-2">{c.type}</span>
                                        </div>
                                        <span className={`font-mono ${c.score > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                            {c.score > 0 ? '+' : ''}{c.score}
                                        </span>
                                    </div>
                                    {c.factors && c.factors.length > 0 && (
                                        <div className="mt-1 text-gray-500">
                                            {c.factors.slice(0, 3).map((f, fi) => (
                                                <div key={fi} className="flex justify-between">
                                                    <span className="truncate">{f.factor}</span>
                                                    <span className={f.points > 0 ? 'text-green-500' : 'text-red-500'}>
                                                        {f.points > 0 ? '+' : ''}{f.points}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default BotDebugPanel;
