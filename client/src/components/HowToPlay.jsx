import React, { useState } from 'react';
import PileCardGlyph from './tableV2/PileCardGlyph';
import { SUIT_SYMBOLS } from '../constants';
import { displaySuit } from '../utils/suitLens';

// Suit names and tiers, indexed by the underlying ascending order so the
// Pusoy Dos lens can relabel the whole table without a second copy of the copy.
const SUIT_NAMES = { D: 'Diamonds', C: 'Clubs', H: 'Hearts', S: 'Spades' };
const TIER_LABELS = ['Lowest', 'Low', 'High', 'Highest'];
const ASCENDING_SUITS = ['D', 'C', 'H', 'S'];
const suitClass = (suit) => (suit === 'D' || suit === 'H' ? 'text-[#ff8d96]' : 'text-black');

// Helper to render a row of example cards (stacked like in-game)
// Uses traditional red-black colors instead of 4-color mode
const CardRow = ({ cards, pusoyMode }) => (
    <div className="flex justify-center items-center my-2">
        <div className="flex">
            {cards.map((card, idx) => (
                <div
                    key={idx}
                    style={{
                        marginLeft: idx === 0 ? '0' : '-34px',
                        position: 'relative',
                        zIndex: idx
                    }}
                >
                    <PileCardGlyph rank={card.rank} suit={card.suit} pusoyMode={pusoyMode} size="pile" scale={1.15} />
                </div>
            ))}
        </div>
    </div>
);

const HowToPlay = React.memo(({ isOpen, onClose, pusoyMode }) => {
    const [activeTab, setActiveTab] = useState('overview');

    // Every suit glyph in the copy goes through the lens, so the examples match
    // the cards the reader actually sees at the table.
    const sym = (s) => SUIT_SYMBOLS[displaySuit(s, pusoyMode)];
    const ordered = ASCENDING_SUITS.map(s => displaySuit(s, pusoyMode));

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 font-sans" style={{ fontFamily: "'Outfit',sans-serif" }}>
            <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 shadow-2xl" style={{ background: 'linear-gradient(180deg,rgba(24,27,33,.98),rgba(13,15,19,.99))' }}>
                {/* Header */}
                <div className="flex items-center justify-between border-b border-white/10 p-6 text-[#f4f5f7]">
                    <h2 className="text-2xl font-bold">How to Play Big 2</h2>
                    <button
                        onClick={onClose}
                        className="text-[rgba(244,245,247,.7)] hover:text-[#f4f5f7] text-3xl leading-none"
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>

                {/* Tab Navigation */}
                <div className="flex border-b border-white/10">
                    <button
                        onClick={() => setActiveTab('overview')}
                        className={`flex-1 px-2 py-3 font-medium transition text-xs ${activeTab === 'overview'
                                ? 'text-[#ffc94d] border-b-2 border-[#ffc94d]'
                                : 'text-[rgba(244,245,247,.5)] hover:text-[#f4f5f7]'
                            }`}
                    >
                        Overview
                    </button>
                    <button
                        onClick={() => setActiveTab('rankings')}
                        className={`flex-1 px-2 py-3 font-medium transition text-xs ${activeTab === 'rankings'
                                ? 'text-[#ffc94d] border-b-2 border-[#ffc94d]'
                                : 'text-[rgba(244,245,247,.5)] hover:text-[#f4f5f7]'
                            }`}
                    >
                        Rankings
                    </button>
                    <button
                        onClick={() => setActiveTab('rules')}
                        className={`flex-1 px-2 py-3 font-medium transition text-xs ${activeTab === 'rules'
                                ? 'text-[#ffc94d] border-b-2 border-[#ffc94d]'
                                : 'text-[rgba(244,245,247,.5)] hover:text-[#f4f5f7]'
                            }`}
                    >
                        Rules
                    </button>
                    <button
                        onClick={() => setActiveTab('scoring')}
                        className={`flex-1 px-2 py-3 font-medium transition text-xs ${activeTab === 'scoring'
                                ? 'text-[#ffc94d] border-b-2 border-[#ffc94d]'
                                : 'text-[rgba(244,245,247,.5)] hover:text-[#f4f5f7]'
                            }`}
                    >
                        Scoring
                    </button>
                    <button
                        onClick={() => setActiveTab('features')}
                        className={`flex-1 px-2 py-3 font-medium transition text-xs ${activeTab === 'features'
                                ? 'text-[#ffc94d] border-b-2 border-[#ffc94d]'
                                : 'text-[rgba(244,245,247,.5)] hover:text-[#f4f5f7]'
                            }`}
                    >
                        Features
                    </button>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto p-6">
                    {activeTab === 'overview' && (
                        <div className="space-y-4">
                            <section>
                                <h3 className="text-xl font-bold text-[#f4f5f7] mb-2">What is Big 2?</h3>
                                <p className="text-[rgba(244,245,247,.75)] leading-relaxed">
                                    Big 2 (also known as Deuces or Chor Dai Dee) is a popular card game in East Asia.
                                    The objective is to be the first player to get rid of all your cards by playing higher-ranking
                                    hands than your opponents.
                                </p>
                                <p className="text-[rgba(244,245,247,.75)] leading-relaxed">
                                    Many variations exist, but this implementation follows the Hong Kong ruleset with some common house rules.
                                    See the <strong>Rules</strong> tab for detailed gameplay instructions.
                                </p>
                            </section>

                            <section>
                                <h3 className="text-xl font-bold text-[#f4f5f7] mb-2">Quick Start</h3>
                                <ol className="list-decimal list-inside space-y-2 text-[rgba(244,245,247,.75)]">
                                    <li>Each player receives 13 cards</li>
                                    <li>The player with 3{sym('D')} starts the first round</li>
                                    <li>Play cards that beat the current hand on the table</li>
                                    <li>If you can't or don't want to play, pass your turn</li>
                                    <li>When everyone passes, the last player to play gets "free control" and can play anything</li>
                                    <li>First player to empty their hand wins the round</li>
                                    <li>Game continues until someone reaches 50 (Short) or 100 (Standard) points</li>
                                    <li>Player with the LOWEST score wins the game</li>
                                </ol>
                            </section>

                            <section>
                                <h3 className="text-xl font-bold text-[#f4f5f7] mb-2">Game Modes</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="border border-white/10 rounded-lg p-4">
                                        <h4 className="font-bold text-[#6ee7a8] mb-2">Short Game (~30 min)</h4>
                                        <p className="text-[rgba(244,245,247,.75)]">First player to reach 50 points ends the game. Perfect for quick matches.</p>
                                    </div>
                                    <div className="border border-white/10 rounded-lg p-4">
                                        <h4 className="font-bold text-[#6ee7a8] mb-2">Standard Game (~60 min)</h4>
                                        <p className="text-[rgba(244,245,247,.75)]">First player to reach 100 points ends the game. Full competitive experience.</p>
                                    </div>
                                </div>
                            </section>
                        </div>
                    )}

                    {activeTab === 'rankings' && (
                        <div className="space-y-6">
                            <section>
                                <h3 className="text-xl font-bold text-[#f4f5f7] mb-3">Suit Rankings (Lowest to Highest)</h3>
                                {pusoyMode && (
                                    <p className="text-sm text-[rgba(244,245,247,.55)] mb-3">Pusoy Dos (Filipino) suit order</p>
                                )}
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                                    {ordered.map((suit, i) => (
                                        <div key={suit} className="border border-white/10 rounded-lg p-3 text-center">
                                            <div className={`text-4xl mb-2 ${suitClass(suit)}`}>{SUIT_SYMBOLS[suit]}</div>
                                            <div className="font-bold text-[#f4f5f7]">{SUIT_NAMES[suit]}</div>
                                            <div className="text-sm text-[rgba(244,245,247,.55)]">{TIER_LABELS[i]}</div>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <section>
                                <h3 className="text-xl font-bold text-[#f4f5f7] mb-3">Rank Rankings (Lowest to Highest)</h3>
                                <div className="bg-white/[.04] rounded-lg p-4">
                                    <div className="text-center text-[rgba(244,245,247,.75)] font-mono text-lg">
                                        3 &lt; 4 &lt; 5 &lt; 6 &lt; 7 &lt; 8 &lt; 9 &lt; 10 &lt; J &lt; Q &lt; K &lt; A &lt; <span className="font-bold text-[#ff8d96]">2</span>
                                    </div>
                                    <p className="text-sm text-[rgba(244,245,247,.55)] text-center mt-2">Note: 2 is the highest rank (hence "Big 2")</p>
                                </div>
                            </section>

                            <section>
                                <h3 className="text-xl font-bold text-[#f4f5f7] mb-3">Hand Types (Ranked from Weakest to Strongest)</h3>

                                {/* Single */}
                                <div className="border border-white/10 rounded-lg p-4 mb-3">
                                    <h4 className="font-bold text-[#f4f5f7] mb-2">1. Single Card</h4>
                                    <p className="text-[rgba(244,245,247,.75)] text-sm mb-2">Any single card. Compared by rank first, then suit.</p>
                                    <CardRow pusoyMode={pusoyMode} cards={[{ rank: '7', suit: 'H' }]} />
                                    <p className="text-xs text-[rgba(244,245,247,.55)] text-center mt-1">Example: 7{sym('H')} beats 7{sym('D')} but loses to 8{sym('D')}</p>
                                </div>

                                {/* Pair */}
                                <div className="border border-white/10 rounded-lg p-4 mb-3">
                                    <h4 className="font-bold text-[#f4f5f7] mb-2">2. Pair</h4>
                                    <p className="text-[rgba(244,245,247,.75)] text-sm mb-2">Two cards of the same rank. Compared by rank, then highest suit.</p>
                                    <CardRow pusoyMode={pusoyMode} cards={[{ rank: 'J', suit: 'S' }, { rank: 'J', suit: 'H' }]} />
                                    <p className="text-xs text-[rgba(244,245,247,.55)] text-center mt-1">Example: JJ with {sym('S')} as highest suit</p>
                                </div>

                                {/* Triple */}
                                <div className="border border-white/10 rounded-lg p-4 mb-3">
                                    <h4 className="font-bold text-[#f4f5f7] mb-2">3. Triple</h4>
                                    <p className="text-[rgba(244,245,247,.75)] text-sm mb-2">Three cards of the same rank. Compared by rank only.</p>
                                    <CardRow pusoyMode={pusoyMode} cards={[{ rank: '9', suit: 'S' }, { rank: '9', suit: 'H' }, { rank: '9', suit: 'C' }]} />
                                </div>

                                {/* 5-Card Hands */}
                                <div className="bg-[#ffc94d]/10 border-2 border-yellow-400 rounded-lg p-4 mb-3">
                                    <h4 className="font-bold text-[#f4f5f7] mb-2">5-Card Hands (Special)</h4>
                                    <p className="text-[rgba(244,245,247,.75)] text-sm mb-3">
                                        These hands consist of exactly 5 cards and can only beat other 5-card hands.
                                        They are ranked by hand type first, then by the highest card.
                                    </p>

                                    {/* Straight */}
                                    <div className="rounded bg-black/25 p-3 mb-2">
                                        <h5 className="font-semibold text-[#f4f5f7] mb-1">Straight (Weakest 5-card hand)</h5>
                                        <p className="text-xs text-[rgba(244,245,247,.55)] mb-2">Five consecutive ranks. Compared by highest card.</p>
                                        <CardRow pusoyMode={pusoyMode} cards={[
                                            { rank: '5', suit: 'D' },
                                            { rank: '6', suit: 'C' },
                                            { rank: '7', suit: 'H' },
                                            { rank: '8', suit: 'S' },
                                            { rank: '9', suit: 'D' }
                                        ]} />
                                    </div>

                                    {/* Flush */}
                                    <div className="rounded bg-black/25 p-3 mb-2">
                                        <h5 className="font-semibold text-[#f4f5f7] mb-1">Flush</h5>
                                        <p className="text-xs text-[rgba(244,245,247,.55)] mb-2">Five cards of the same suit. Compared by highest card, then suit.</p>
                                        <CardRow pusoyMode={pusoyMode} cards={[
                                            { rank: '3', suit: 'H' },
                                            { rank: '5', suit: 'H' },
                                            { rank: '8', suit: 'H' },
                                            { rank: 'J', suit: 'H' },
                                            { rank: 'K', suit: 'H' }
                                        ]} />
                                    </div>

                                    {/* Full House */}
                                    <div className="rounded bg-black/25 p-3 mb-2">
                                        <h5 className="font-semibold text-[#f4f5f7] mb-1">Full House</h5>
                                        <p className="text-xs text-[rgba(244,245,247,.55)] mb-2">Three of a kind + a pair. Compared by the triple's rank.</p>
                                        <CardRow pusoyMode={pusoyMode} cards={[
                                            { rank: 'Q', suit: 'S' },
                                            { rank: 'Q', suit: 'H' },
                                            { rank: 'Q', suit: 'C' },
                                            { rank: '4', suit: 'D' },
                                            { rank: '4', suit: 'S' }
                                        ]} />
                                        <p className="text-xs text-[rgba(244,245,247,.55)] text-center mt-1">Three Queens + Two 4s</p>
                                    </div>

                                    {/* Four of a Kind */}
                                    <div className="rounded bg-black/25 p-3 mb-2">
                                        <h5 className="font-semibold text-[#f4f5f7] mb-1">Four of a Kind (Quads)</h5>
                                        <p className="text-xs text-[rgba(244,245,247,.55)] mb-2">Four cards of the same rank + any fifth card. Compared by the quad's rank.</p>
                                        <CardRow pusoyMode={pusoyMode} cards={[
                                            { rank: '8', suit: 'S' },
                                            { rank: '8', suit: 'H' },
                                            { rank: '8', suit: 'D' },
                                            { rank: '8', suit: 'C' },
                                            { rank: 'K', suit: 'S' }
                                        ]} />
                                    </div>

                                    {/* Straight Flush */}
                                    <div className="rounded bg-black/25 p-3">
                                        <h5 className="font-semibold text-[#f4f5f7] mb-1">Straight Flush (Strongest hand!)</h5>
                                        <p className="text-xs text-[rgba(244,245,247,.55)] mb-2">Five consecutive ranks, all same suit. Compared by highest card, then suit.</p>
                                        <CardRow pusoyMode={pusoyMode} cards={[
                                            { rank: '9', suit: 'S' },
                                            { rank: '10', suit: 'S' },
                                            { rank: 'J', suit: 'S' },
                                            { rank: 'Q', suit: 'S' },
                                            { rank: 'K', suit: 'S' }
                                        ]} />
                                    </div>
                                </div>
                            </section>
                        </div>
                    )}

                    {activeTab === 'rules' && (
                        <div className="space-y-4">
                            <section>
                                <h3 className="text-xl font-bold text-[#f4f5f7] mb-3">Starting the Game</h3>
                                <ul className="list-disc list-inside space-y-2 text-[rgba(244,245,247,.75)]">
                                    <li><strong>First Round:</strong> The player with 3{sym('D')} must play it first (can be in a hand containing 3{sym('D')})</li>
                                    <li><strong>Subsequent Rounds:</strong> The winner of the previous round starts and can play any valid hand</li>
                                    <li>Each player receives 13 cards at the start of each round</li>
                                </ul>
                            </section>

                            <section>
                                <h3 className="text-xl font-bold text-[#f4f5f7] mb-3">Playing Your Turn</h3>
                                <ul className="list-disc list-inside space-y-2 text-[rgba(244,245,247,.75)]">
                                    <li>You must play the <strong>same number of cards</strong> as the current hand on the table</li>
                                    <li>Your hand must be <strong>higher-ranking</strong> than the current hand</li>
                                    <li>Singles beat singles, pairs beat pairs, trips beat trips, and 5-card hands beat 5-card hands (by type first, then value)</li>
                                    <li>If you cannot or choose not to play, you must <strong>pass</strong></li>
                                    <li>Once you pass, you cannot play again until someone else plays. This means that you could strategically pass and rejoin the game later in the round.</li>
                                </ul>
                            </section>

                            <section>
                                <h3 className="text-xl font-bold text-[#f4f5f7] mb-3">Free Control</h3>
                                <div className="bg-[#6ee7a8]/10 border border-green-300 rounded-lg p-4">
                                    <p className="text-[rgba(244,245,247,.75)] mb-2">
                                        When all other players pass consecutively, the last player who played a hand gains <strong>"free control"</strong>.
                                    </p>
                                    <ul className="list-disc list-inside space-y-1 text-[rgba(244,245,247,.75)]">
                                        <li>The table is cleared</li>
                                        <li>You can play any valid hand (single, pair, triple, or 5-card hand)</li>
                                        <li>This is your opportunity to start fresh with your strategy</li>
                                    </ul>
                                </div>
                            </section>

                            <section>
                                <h3 className="text-xl font-bold text-[#f4f5f7] mb-3">Winning a Round</h3>
                                <ul className="list-disc list-inside space-y-2 text-[rgba(244,245,247,.75)]">
                                    <li>The first player to play all their cards wins the round</li>
                                    <li>The round ends immediately when someone empties their hand</li>
                                    <li>The winner scores 0 points; other players score penalty points based on remaining cards</li>
                                </ul>
                            </section>

                            <section>
                                <h3 className="text-xl font-bold text-[#f4f5f7] mb-3">Special Rules</h3>
                                <ul className="list-disc list-inside space-y-2 text-[rgba(244,245,247,.75)]">
                                    <li><strong>5-Card Hands:</strong> Can only be beaten by stronger 5-card hands (e.g., a straight flush beats a flush)</li>
                                    <li><strong>2 is Highest:</strong> The rank "2" is the strongest card, higher than Ace</li>
                                    <li><strong>Suit Breaking Ties:</strong> When ranks are equal, suit determines the winner (
                                        {[...ordered].reverse().map((suit, i) => (
                                            <React.Fragment key={suit}>
                                                {i > 0 && ' > '}
                                                <span className={suitClass(suit)}>{SUIT_SYMBOLS[suit]}</span> {SUIT_NAMES[suit]}
                                            </React.Fragment>
                                        ))}
                                        )</li>
                                </ul>
                                <div className="mt-4 border-l-4 border-blue-500 bg-[#7fb2ff]/10 p-4 rounded-r-lg">
                                    <h4 className="font-bold text-[#f4f5f7] mb-2">Hong Kong Variant: Straights with 2s</h4>
                                    <p className="text-[rgba(244,245,247,.75)] mb-2">
                                        This game follows Hong Kong Big 2 rules for straights containing 2s:
                                    </p>
                                    <ul className="list-disc list-inside space-y-1 text-[rgba(244,245,247,.75)] ml-4">
                                        <li><strong>A-2-3-4-5 (Highest Straight):</strong> The strongest possible straight, valued by the 2</li>
                                        <li><strong>2-3-4-5-6 (Second Highest):</strong> Second strongest straight, also valued by the 2</li>
                                        <li><strong>Invalid: J-Q-K-A-2:</strong> The 2 cannot be used as the high end of a straight</li>
                                        <li><strong>Invalid: Any other combinations with 2:</strong> Only A-2-3-4-5 and 2-3-4-5-6 are valid</li>
                                    </ul>
                                    <p className="text-sm text-[rgba(244,245,247,.55)] mt-2">
                                        💡 The same rules apply to straight flushes: A-2-3-4-5 flush is the highest straight flush.
                                    </p>
                                </div>
                                <div className="mt-4 border-l-4 border-yellow-500 bg-[#ffc94d]/10 p-4 rounded-r-lg">
                                    <h4 className="font-bold text-[#f4f5f7] mb-2">🐉 Hong Kong Variant: Dragon (Instant Win)</h4>
                                    <p className="text-[rgba(244,245,247,.75)] mb-2">
                                        If a player is dealt a <strong>Dragon</strong> (one card of each rank: 3-4-5-6-7-8-9-10-J-Q-K-A-2),
                                        they immediately win the entire game!
                                    </p>
                                    <ul className="list-disc list-inside space-y-1 text-[rgba(244,245,247,.75)] ml-4">
                                        <li><strong>Instant Victory:</strong> No playing required - the game ends immediately</li>
                                        <li><strong>Dragon Winner:</strong> Gets 0 points</li>
                                        <li><strong>All Other Players:</strong> Each receives 39 penalty points (13 cards × 3 multiplier)</li>
                                    </ul>
                                    <p className="text-sm text-[rgba(244,245,247,.55)] mt-2">
                                        💡 Dragons are extremely rare! The odds are approximately 1 in 158 million hands.
                                    </p>
                                </div>
                            </section>
                        </div>
                    )}

                    {activeTab === 'features' && (
                        <div className="space-y-4">
                            <section>
                                <h3 className="text-xl font-bold text-[#f4f5f7] mb-3">Game Features</h3>
                                <p className="text-[rgba(244,245,247,.75)] mb-4">
                                    This implementation includes several quality-of-life features to enhance your gameplay experience.
                                    Access most of these through the settings gear icon during gameplay.
                                </p>
                            </section>

                            <section>
                                <div className="border-l-4 border-green-500 bg-[#6ee7a8]/10 p-4 rounded-r-lg mb-3">
                                    <h4 className="font-bold text-[#f4f5f7] mb-2 flex items-center">
                                        <span className="text-xl mr-2">🎨</span>
                                        Four-Color Deck Mode
                                    </h4>
                                    <p className="text-[rgba(244,245,247,.75)] mb-2">
                                        Toggle between traditional 2-color (red/black) and colorblind-friendly 4-color deck modes.
                                    </p>
                                    <ul className="list-disc list-inside text-[rgba(244,245,247,.75)] text-sm ml-4">
                                        <li><strong>2-Color:</strong> Red (Hearts/Diamonds), Black (Spades/Clubs)</li>
                                        <li><strong>4-Color:</strong> Red (Hearts), Blue (Diamonds), Black (Spades), Green (Clubs)</li>
                                    </ul>
                                    <p className="text-xs text-[rgba(244,245,247,.55)] mt-2">💡 Access via settings gear icon in-game</p>
                                </div>

                                <div className="border-l-4 border-blue-500 bg-[#7fb2ff]/10 p-4 rounded-r-lg mb-3">
                                    <h4 className="font-bold text-[#f4f5f7] mb-2 flex items-center">
                                        <span className="text-xl mr-2">⚡</span>
                                        Auto-Pass
                                    </h4>
                                    <p className="text-[rgba(244,245,247,.75)] mb-2">
                                        Automatically pass your turn when you have no valid moves. Saves time and speeds up gameplay.
                                    </p>
                                    <p className="text-xs text-[rgba(244,245,247,.55)] mt-2">💡 Access via settings gear icon in-game</p>
                                </div>

                                <div className="border-l-4 border-purple-500 bg-[#a48fff]/10 p-4 rounded-r-lg mb-3">
                                    <h4 className="font-bold text-[#f4f5f7] mb-2 flex items-center">
                                        <span className="text-xl mr-2">🎯</span>
                                        Hand Helper / Quick Select
                                    </h4>
                                    <p className="text-[rgba(244,245,247,.75)] mb-2">
                                        Shows all valid hands you can play from your current cards. Highlights winning hands in green!
                                    </p>
                                    <ul className="list-disc list-inside text-[rgba(244,245,247,.75)] text-sm ml-4">
                                        <li>Auto-detects all playable combinations (singles, pairs, triples, 5-card hands)</li>
                                        <li>Green highlighting for hands that beat the current pile</li>
                                        <li>Click to select cards, cycle through alternatives with repeated clicks</li>
                                        <li>Shows counts and percentages for each hand type</li>
                                    </ul>
                                    <p className="text-xs text-[rgba(244,245,247,.55)] mt-2">💡 Always visible during your turn</p>
                                </div>

                                <div className="border-l-4 border-orange-500 bg-[#ffab6b]/10 p-4 rounded-r-lg mb-3">
                                    <h4 className="font-bold text-[#f4f5f7] mb-2 flex items-center">
                                        <span className="text-xl mr-2">👆</span>
                                        Swipe/Slide Selection
                                    </h4>
                                    <p className="text-[rgba(244,245,247,.75)] mb-2">
                                        Select multiple cards quickly by swiping across them. Works on both mobile and desktop.
                                    </p>
                                    <p className="text-xs text-[rgba(244,245,247,.55)] mt-2">💡 Click and drag across cards to select/deselect</p>
                                </div>

                                <div className="border-l-4 border-pink-500 bg-[#ff8fd0]/10 p-4 rounded-r-lg mb-3">
                                    <h4 className="font-bold text-[#f4f5f7] mb-2 flex items-center">
                                        <span className="text-xl mr-2">🔄</span>
                                        Card Reorganization & Sorting
                                    </h4>
                                    <p className="text-[rgba(244,245,247,.75)] mb-2">
                                        Drag and drop to reorder your hand cards. Organize them however you prefer!
                                    </p>
                                    <ul className="list-disc list-inside text-[rgba(244,245,247,.75)] text-sm ml-4">
                                        <li>Full touch and mouse support</li>
                                        <li>Reorder cards to group by rank or suit</li>
                                        <li>Position stays consistent throughout the round</li>
                                    </ul>
                                    <p className="text-xs text-[rgba(244,245,247,.55)] mt-2">💡 Click and drag cards to reorder</p>
                                </div>

                                {/* <div className="border-l-4 border-yellow-500 bg-[#ffc94d]/10 p-4 rounded-r-lg mb-3">
                                    <h4 className="font-bold text-[#f4f5f7] mb-2 flex items-center">
                                        <span className="text-xl mr-2">🤖</span>
                                        Advanced Bot AI
                                    </h4>
                                    <p className="text-[rgba(244,245,247,.75)] mb-2">
                                        Choose between simple and advanced bot difficulty. Advanced bots use sophisticated strategies.
                                    </p>
                                    <ul className="list-disc list-inside text-[rgba(244,245,247,.75)] text-sm ml-4">
                                        <li>"Poker First" strategy - preserves strong 5-card hands</li>
                                        <li>Card counting and strategic passing</li>
                                        <li>Combo-breaking heuristics</li>
                                        <li>Optional debug panel to see bot reasoning</li>
                                    </ul>
                                    <p className="text-xs text-[rgba(244,245,247,.55)] mt-2">💡 Access via settings gear icon in-game</p>
                                </div>  */}

                                <div className="border-l-4 border-yellow-500 bg-[#ffc94d]/10 p-4 rounded-r-lg mb-3">
                                    <h4 className="font-bold text-[#f4f5f7] mb-2 flex items-center">
                                        <span className="text-xl mr-2">👥</span>
                                        Multiplayer Support
                                    </h4>
                                    <p className="text-[rgba(244,245,247,.75)] mb-2">
                                        Play with friends online in real-time. Create a room and share the code!
                                    </p>
                                    <ul className="list-disc list-inside text-[rgba(244,245,247,.75)] text-sm ml-4">
                                        <li>Real-time multiplayer using WebSocket technology</li>
                                        <li>Create private rooms with shareable room codes</li>
                                        <li>Join existing games with a room code</li>
                                        <li>Automatic bot filling if fewer than 4 players</li>
                                        <li>Play with any combination of human players and bots</li>
                                    </ul>
                                    <p className="text-xs text-[rgba(244,245,247,.55)] mt-2">💡 Create a room in the lobby and share the code with friends</p>
                                </div>

                                <div className="border-l-4 border-rose-500 bg-[#ff8d96]/10 p-4 rounded-r-lg mb-3">
                                    <h4 className="font-bold text-[#f4f5f7] mb-2 flex items-center">
                                        <span className="text-xl mr-2">🎙️</span>
                                        Voice Chat
                                    </h4>
                                    <p className="text-[rgba(244,245,247,.75)] mb-2">
                                        Talk to other players in real-time with built-in voice chat.
                                    </p>
                                    <ul className="list-disc list-inside text-[rgba(244,245,247,.75)] text-sm ml-4">
                                        <li>Crystal clear WebRTC audio</li>
                                        <li>Toggle microphone on/off anytime</li>
                                        <li>See who is currently speaking</li>
                                    </ul>
                                    <p className="text-xs text-[rgba(244,245,247,.55)] mt-2">💡 Enable/Disable via settings gear icon</p>
                                </div>

                                <div className="border-l-4 border-cyan-500 bg-[#6ee0e7]/10 p-4 rounded-r-lg mb-3">
                                    <h4 className="font-bold text-[#f4f5f7] mb-2 flex items-center">
                                        <span className="text-xl mr-2">📱</span>
                                        Mobile Optimized
                                    </h4>
                                    <p className="text-[rgba(244,245,247,.75)] mb-2">
                                        Fully responsive design with mobile-specific optimizations for the best experience.
                                    </p>
                                    <ul className="list-disc list-inside text-[rgba(244,245,247,.75)] text-sm ml-4">
                                        <li>Dynamic card spacing based on screen size and card count</li>
                                        <li>Touch-friendly controls and swipe support</li>
                                        <li>Improved touch targets for buttons and cards</li>
                                        <li>Card count indicators for opponent hands</li>
                                    </ul>
                                </div>

                                <div className="border-l-4 border-indigo-500 bg-[#8f9cff]/10 p-4 rounded-r-lg">
                                    <h4 className="font-bold text-[#f4f5f7] mb-2 flex items-center">
                                        <span className="text-xl mr-2">🔌</span>
                                        Auto-Reconnection
                                    </h4>
                                    <p className="text-[rgba(244,245,247,.75)] mb-2">
                                        Automatically rejoin your game if you get disconnected. Your progress is saved!
                                    </p>
                                    <ul className="list-disc list-inside text-[rgba(244,245,247,.75)] text-sm ml-4">
                                        <li>Seamless reconnection to in-progress games</li>
                                        <li>Connection status indicators</li>
                                        <li>Game state fully restored on reconnect</li>
                                    </ul>
                                </div>
                            </section>
                        </div>
                    )}

                    {activeTab === 'scoring' && (
                        <div className="space-y-4">
                            <section>
                                <h3 className="text-xl font-bold text-[#f4f5f7] mb-3">How Scoring Works</h3>
                                <p className="text-[rgba(244,245,247,.75)] mb-3">
                                    Big 2 uses a penalty scoring system. The winner of each round gets 0 points,
                                    while other players receive penalty points based on their remaining cards.
                                </p>
                                <div className="bg-[#ffc94d]/10 border border-yellow-300 rounded-lg p-4">
                                    <p className="font-bold text-[#f4f5f7] mb-2">Important: Lowest score wins!</p>
                                    <p className="text-[rgba(244,245,247,.75)]">
                                        When a player reaches 50 points (Short) or 100 points (Standard), the game ends.
                                        The player with the LOWEST cumulative score is the winner.
                                    </p>
                                </div>
                            </section>

                            <section>
                                <h3 className="text-xl font-bold text-[#f4f5f7] mb-3">Penalty Points per Round</h3>
                                <p className="text-[rgba(244,245,247,.75)] mb-3">
                                    If you lose a round badly ({'>='} 10 cards remaining), you receive a higher penalty multiplier.
                                    The multiplier increases as the number of remaining cards increases.
                                </p>
                                <div className="space-y-3">
                                    <div className="border border-white/10 rounded-lg p-4">
                                        <h4 className="font-bold text-[#6ee7a8] mb-2">1-9 Cards Remaining: 1× Multiplier</h4>
                                        <p className="text-[rgba(244,245,247,.75)]">Points = Number of cards remaining</p>
                                        <p className="text-sm text-[rgba(244,245,247,.55)] mt-1">Example: 7 cards left = 7 points</p>
                                    </div>

                                    <div className="border border-white/10 rounded-lg p-4">
                                        <h4 className="font-bold text-[#ffab6b] mb-2">10-12 Cards Remaining: 2× Multiplier</h4>
                                        <p className="text-[rgba(244,245,247,.75)]">Points = (Number of cards remaining) × 2</p>
                                        <p className="text-sm text-[rgba(244,245,247,.55)] mt-1">Example: 11 cards left = 22 points</p>
                                    </div>

                                    <div className="border border-white/10 rounded-lg p-4">
                                        <h4 className="font-bold text-[#ff8d96] mb-2">13 Cards Remaining: 3× Multiplier</h4>
                                        <p className="text-[rgba(244,245,247,.75)]">Points = 13 × 3 = 39 points</p>
                                        <p className="text-sm text-[rgba(244,245,247,.55)] mt-1">Applies when you didn't play any cards (maximum penalty)</p>
                                    </div>
                                </div>
                            </section>

                            <section>
                                <h3 className="text-xl font-bold text-[#f4f5f7] mb-3">Scoring Example</h3>
                                <div className="bg-white/[.04] rounded-lg p-4">
                                    <p className="font-semibold text-[#f4f5f7] mb-2">Round Results:</p>
                                    <ul className="space-y-1 text-[rgba(244,245,247,.75)]">
                                        <li>• Player A: 0 cards (Winner) = <strong>0 points</strong></li>
                                        <li>• Player B: 5 cards = <strong>5 points</strong> (1× multiplier)</li>
                                        <li>• Player C: 11 cards = <strong>22 points</strong> (2× multiplier)</li>
                                        <li>• Player D: 13 cards = <strong>39 points</strong> (3× multiplier)</li>
                                    </ul>
                                </div>
                            </section>

                            <section>
                                <h3 className="text-xl font-bold text-[#f4f5f7] mb-3">Rating System</h3>
                                <p className="text-[rgba(244,245,247,.75)] mb-2">
                                    Players have a skill rating that updates after each game based on their final placement (1st, 2nd, 3rd, 4th).
                                </p>
                                <ul className="list-disc list-inside space-y-1 text-[rgba(244,245,247,.75)]">
                                    <li>Starting rating: ~1200</li>
                                    <li>Better placements increase your rating</li>
                                    <li>Worse placements decrease your rating</li>
                                    <li>The system uses OpenSkill (similar to TrueSkill) for fair matchmaking</li>
                                    <li>Only human players receive rating updates</li>
                                </ul>
                            </section>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="bg-white/[.04] px-6 py-4 border-t border-white/10">
                    <button
                        onClick={onClose}
                        className="w-full rounded-xl py-3 font-bold"
                        style={{ background: 'linear-gradient(135deg,#ffc94d,#e09a10)', color: '#0b0d10', border: 'none', cursor: 'pointer', fontFamily: "'Outfit',sans-serif", fontSize: 15 }}
                    >
                        Got it! Let's Play
                    </button>
                </div>
            </div>
        </div>
    );
});

HowToPlay.displayName = 'HowToPlay';

export default HowToPlay;
