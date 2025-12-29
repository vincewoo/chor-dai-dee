import React from 'react';

export const archetypeDescriptions = {
    'Aggressive': {
        title: 'Aggressive Player',
        color: 'text-red-600',
        description: 'You play with high intensity and constantly apply pressure to opponents.',
        strengths: [
            'Quick to take control of the table',
            'Forces opponents to make difficult decisions',
            'Maintains strong momentum',
            'Excellent at capitalizing on weak opponents'
        ],
        improvements: [
            'May exhaust strong cards too early',
            'Can be predictable when always attacking',
            'Sometimes takes unnecessary risks',
            'Vulnerable to counter-plays from patient opponents'
        ],
        strategy: 'Your aggressive style can overwhelm opponents, but be careful not to exhaust your strong cards too early.'
    },
    'Conservative': {
        title: 'Conservative Player',
        color: 'text-blue-600',
        description: 'You prioritize safety and card preservation over aggressive plays.',
        strengths: [
            'Excellent hand management',
            'Strong endgame presence',
            'Minimizes penalty risk',
            'Hard to pressure into mistakes'
        ],
        improvements: [
            'May miss opportunities to take control',
            'Can appear passive or predictable',
            'Struggles when forced to lead',
            'Sometimes lets aggressive players dominate'
        ],
        strategy: 'Your patient approach often pays off in the endgame, but watch for opportunities to seize control when opponents are weak.'
    },
    'Balanced': {
        title: 'Balanced Player',
        color: 'text-green-600',
        description: 'You maintain equilibrium between aggressive and conservative strategies.',
        strengths: [
            'Adapts well to different situations',
            'Consistent decision-making',
            'Difficult to exploit',
            'Well-rounded skill set'
        ],
        improvements: [
            'Jack of all trades, master of none',
            'May lack a decisive edge in critical moments',
            'Can be indecisive when multiple options exist',
            'Sometimes too middle-of-the-road'
        ],
        strategy: 'Your versatility is your strength. Continue reading the game flow and adjusting your tactics accordingly.'
    },
    'Adaptive': {
        title: 'Adaptive Player',
        color: 'text-purple-600',
        description: 'You dynamically adjust your strategy based on opponents and game state.',
        strengths: [
            'Highly unpredictable',
            'Excellent at reading opponents',
            'Can counter any play style',
            'Thrives in complex situations'
        ],
        improvements: [
            'May overthink simple situations',
            'Can confuse allies in team variants',
            'Sometimes changes strategy too frequently',
            'Requires high mental energy to maintain'
        ],
        strategy: 'Your ability to shift strategies keeps opponents guessing. Use this unpredictability to maintain a psychological edge.'
    }
};

const ArchetypeDialog = ({ archetype, isOpen, onClose }) => {
    if (!isOpen || !archetype || !archetypeDescriptions[archetype]) {
        return null;
    }

    const details = archetypeDescriptions[archetype];

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                <div className="p-6">
                    <div className="flex justify-between items-start mb-4">
                        <h2 className={`text-3xl font-bold ${details.color}`}>
                            {details.title}
                        </h2>
                        <button
                            onClick={onClose}
                            className="text-gray-500 hover:text-gray-700 text-2xl"
                            aria-label="Close dialog"
                        >
                            ×
                        </button>
                    </div>

                    <p className="text-gray-700 text-lg mb-6">
                        {details.description}
                    </p>

                    <div className="mb-6">
                        <h3 className="text-xl font-semibold text-gray-800 mb-3">Strengths</h3>
                        <ul className="space-y-2 mb-6">
                            {details.strengths.map((strength, index) => (
                                <li key={index} className="flex items-start">
                                    <span className="text-green-500 mr-2">✓</span>
                                    <span className="text-gray-700">{strength}</span>
                                </li>
                            ))}
                        </ul>

                        <h3 className="text-xl font-semibold text-gray-800 mb-3">Areas for Improvement</h3>
                        <ul className="space-y-2">
                            {details.improvements.map((improvement, index) => (
                                <li key={index} className="flex items-start">
                                    <span className="text-amber-500 mr-2">•</span>
                                    <span className="text-gray-700">{improvement}</span>
                                </li>
                            ))}
                        </ul>
                    </div>

                    <div className="p-4 bg-blue-50 rounded-lg">
                        <h3 className="text-lg font-semibold text-blue-800 mb-2">Strategic Insight</h3>
                        <p className="text-blue-700">
                            {details.strategy}
                        </p>
                    </div>

                    <button
                        onClick={onClose}
                        className="mt-6 w-full bg-indigo-600 text-white py-2 px-4 rounded hover:bg-indigo-700 transition"
                    >
                        Got it!
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ArchetypeDialog;