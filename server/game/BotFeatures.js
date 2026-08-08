// Stable feature order shared by the value model, PPO policy, and browser
// practice runtime. Keeping this dependency free lets production inference run
// in either Node or a Web Worker; filesystem loading lives in ModelLoader.

const FEATURE_NAMES = [
    'bias',
    'own_cards',
    'next_cards',
    'across_cards',
    'previous_cards',
    'min_opponent_cards',
    'played_fraction',
    'pass_count',
    'has_control',
    'first_turn',
    'pile_by_next',
    'pile_by_across',
    'pile_by_previous',
    'action_pass',
    'action_size',
    'action_strength',
    'heuristic_score',
    'heuristic_rank',
    'heuristic_choice',
    'spends_king',
    'spends_ace',
    'spends_two',
    'remaining_cards',
    'remaining_pairs',
    'remaining_triples',
    'remaining_five_card_hands',
    'remaining_aces',
    'remaining_twos',
    'plays_out',
    'crosses_ten_card_tier',
    'crosses_thirteen_card_tier',
    'opponent_at_one',
    'opponent_at_two'
];

module.exports = { FEATURE_NAMES };
