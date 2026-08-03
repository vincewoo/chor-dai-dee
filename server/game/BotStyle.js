// Lightweight playstyle overlays for the promoted PPO actor.
//
// These are deliberately not separate policies. The generation-18 actor still
// supplies the strategic score for every legal action; a style may move that
// score only within MAX_STYLE_LOGIT_ADJUSTMENT. That keeps personality
// orthogonal to difficulty and lets Classic remain exactly the promoted model.

const { FEATURE_NAMES } = require('./RLValueModel');

const DEFAULT_BOT_STYLE = 'classic';
const STYLE_SCORE_SCALE = 6;
const MAX_STYLE_LOGIT_ADJUSTMENT = 2.5;

const FEATURE_INDEX = Object.fromEntries(
    FEATURE_NAMES.map((name, index) => [name, index]));

function feature(row, name) {
    return row[FEATURE_INDEX[name]];
}

const BOT_STYLES = Object.freeze({
    classic: Object.freeze({
        id: 'classic',
        label: 'Classic',
        description: 'Generation 18 with no style adjustment.',
        score: () => 0
    }),
    sprinter: Object.freeze({
        id: 'sprinter',
        label: 'Sprinter',
        description: 'Sheds cards quickly and dislikes giving up a playable turn.',
        score: row =>
            0.75 * feature(row, 'action_size') +
            0.50 * feature(row, 'plays_out') +
            0.25 * feature(row, 'crosses_ten_card_tier') +
            0.25 * feature(row, 'crosses_thirteen_card_tier') -
            0.25 * feature(row, 'action_pass') -
            0.05 * feature(row, 'remaining_cards')
    }),
    keeper: Object.freeze({
        id: 'keeper',
        label: 'Keeper',
        description: 'Protects aces and twos until an opponent becomes dangerous.',
        score: row => {
            const urgency = feature(row, 'opponent_at_one') ||
                0.55 * feature(row, 'opponent_at_two');
            const patience = 1 - urgency;
            return patience * (
                -0.10 * feature(row, 'spends_king') -
                0.22 * feature(row, 'spends_ace') -
                0.42 * feature(row, 'spends_two') +
                0.08 * feature(row, 'remaining_aces') +
                0.16 * feature(row, 'remaining_twos')
            ) + urgency * 0.12 * feature(row, 'action_strength');
        }
    }),
    pressure: Object.freeze({
        id: 'pressure',
        label: 'Pressure',
        description: 'Spends high cards freely to take and keep control.',
        score: row => {
            const urgency = feature(row, 'opponent_at_one') ||
                0.55 * feature(row, 'opponent_at_two');
            return 0.85 * feature(row, 'action_strength') -
                0.35 * feature(row, 'action_size') -
                0.15 * feature(row, 'action_pass') +
                (0.22 + 0.12 * urgency) * feature(row, 'spends_king') +
                (0.32 + 0.16 * urgency) * feature(row, 'spends_ace') +
                (0.45 + 0.20 * urgency) * feature(row, 'spends_two') +
                0.12 * feature(row, 'plays_out');
        }
    }),
    builder: Object.freeze({
        id: 'builder',
        label: 'Builder',
        description: 'Prefers moves that leave pairs, triples, and five-card shapes.',
        score: row =>
            1.20 * feature(row, 'remaining_pairs') +
            1.60 * feature(row, 'remaining_triples') +
            3.00 * feature(row, 'remaining_five_card_hands') -
            0.12 * feature(row, 'action_size') -
            0.05 * feature(row, 'action_pass')
    })
});

// Every bot samples independently from these at the start of a matchup, so
// duplicates are valid. Classic is the opt-out and compatibility path, not a
// persona dealt to a production bot.
const BOT_PERSONA_IDS = Object.freeze([
    'sprinter', 'keeper', 'pressure', 'builder'
]);

function resolveBotStyle(style = DEFAULT_BOT_STYLE) {
    const profile = BOT_STYLES[style];
    if (!profile) {
        throw new Error(
            `bot style must be one of ${Object.keys(BOT_STYLES).join(', ')}`);
    }
    return profile;
}

function styleAdjustment(features, style = DEFAULT_BOT_STYLE) {
    const profile = resolveBotStyle(style);
    const raw = profile.score(features) * STYLE_SCORE_SCALE;
    if (!Number.isFinite(raw)) {
        throw new Error(`bot style ${profile.id} produced a non-finite score`);
    }
    return Math.max(
        -MAX_STYLE_LOGIT_ADJUSTMENT,
        Math.min(MAX_STYLE_LOGIT_ADJUSTMENT, raw));
}

function applyBotStyle(featureRows, logits, style = DEFAULT_BOT_STYLE) {
    if (!Array.isArray(featureRows) || !Array.isArray(logits) ||
        featureRows.length !== logits.length) {
        throw new Error('style features and logits must have equal lengths');
    }
    const profile = resolveBotStyle(style);
    if (profile.id === DEFAULT_BOT_STYLE) {
        return {
            style: profile,
            logits,
            adjustments: logits.map(() => 0)
        };
    }
    const adjustments = featureRows.map(row =>
        styleAdjustment(row, profile.id));
    return {
        style: profile,
        logits: logits.map((logit, index) => logit + adjustments[index]),
        adjustments
    };
}

module.exports = {
    BOT_STYLES,
    BOT_PERSONA_IDS,
    DEFAULT_BOT_STYLE,
    STYLE_SCORE_SCALE,
    MAX_STYLE_LOGIT_ADJUSTMENT,
    resolveBotStyle,
    styleAdjustment,
    applyBotStyle
};
