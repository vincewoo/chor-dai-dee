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

/**
 * How close the seat that acts after us is to going out, in [0, 1].
 *
 * Deliberately NOT `opponent_at_one` / `opponent_at_two`. Those are a min over
 * all three opponents (RLValueBot.encodeCandidate), so a persona reading them
 * flips into endgame mode when the player across the table is on one card -
 * a seat our move cannot hand the lead to, because the seats between us and
 * them still act. That is exactly the "extend to any opponent" variant the
 * heuristic measured at -4.77pp before rejecting it
 * (docs/BOT-HEURISTICS-REVIEW.md section 15), and personas were amplifying it.
 *
 * Derived from `next_cards` rather than fixed by adding a feature, because
 * RLValueModel.load asserts an artifact's featureNames match FEATURE_NAMES
 * exactly: a new feature would invalidate the promoted generation-18
 * checkpoint and force a retrain to ship a bug fix. `next_cards` is that seat's
 * count over 13 and is already in the vector, so the information was never
 * missing - only the wiring was wrong.
 */
function nextPlayerUrgency(row) {
    const cards = feature(row, 'next_cards') * 13;
    // A seated player is never on zero cards - the round ends the instant a
    // hand empties - so a zero here is an unset feature vector, not a position.
    // Reading it as maximum urgency would make every synthetic row look like an
    // endgame, and would fail toward panic rather than toward neutral.
    if (cards < 0.5) return 0;
    if (cards <= 1) return 1;
    if (cards <= 2) return 0.55;
    if (cards <= 3) return 0.25;
    return 0;
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
        // Haste is the identity, but it was unconditional: nothing here read
        // opponent proximity, so a Sprinter would shed the widest, weakest
        // shape it could in front of a seat about to go out. Urgency damps the
        // volume terms and buys a little strength instead. `plays_out` is left
        // at full weight deliberately - emptying the hand ends the round, so
        // there is no position in which it should be discounted.
        score: row => {
            const haste = 1 - 0.5 * nextPlayerUrgency(row);
            return 0.50 * feature(row, 'plays_out') +
                haste * (
                    0.75 * feature(row, 'action_size') +
                    0.25 * feature(row, 'crosses_ten_card_tier') +
                    0.25 * feature(row, 'crosses_thirteen_card_tier') -
                    0.05 * feature(row, 'remaining_cards')
                ) -
                0.25 * feature(row, 'action_pass') +
                nextPlayerUrgency(row) * 0.45 * feature(row, 'action_strength');
        }
    }),
    keeper: Object.freeze({
        id: 'keeper',
        label: 'Keeper',
        description: 'Protects aces and twos until an opponent becomes dangerous.',
        score: row => {
            const urgency = nextPlayerUrgency(row);
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
            const urgency = nextPlayerUrgency(row);
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
        // Shape-hoarding is worth least exactly when the round is about to end
        // under it: a preserved flush scores nothing if the next seat goes out
        // first. Urgency trades the shape terms for enough strength to contest.
        score: row => {
            const urgency = nextPlayerUrgency(row);
            return (1 - urgency) * (
                1.20 * feature(row, 'remaining_pairs') +
                1.60 * feature(row, 'remaining_triples') +
                3.00 * feature(row, 'remaining_five_card_hands') -
                0.12 * feature(row, 'action_size')
            ) -
                0.05 * feature(row, 'action_pass') +
                urgency * 0.40 * feature(row, 'action_strength');
        }
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
