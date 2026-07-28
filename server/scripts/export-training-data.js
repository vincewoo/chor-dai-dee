#!/usr/bin/env node
// server/scripts/export-training-data.js
//
// Turns logged games into gzipped JSONL, one object per decision.
//
// Everything the store deliberately did not materialize is computed here:
// observations, legal moves, and labels. That split is the point -- the store
// records what happened, the exporter decides what a training run wants to see,
// so changing your mind about features costs a re-export rather than a corpus.
//
// Usage:
//   GAMELOG_ENABLED=1 GAMELOG_EXPORT_SECRET=... \
//     node scripts/export-training-data.js --out data/ [--since KEY] [--limit N]
//     [--humans-only] [--include-abandoned] [--no-legal] [--competitive-only]

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { replayRound } = require('../game/Replayer');
const { decodeCards, ACTION, SOURCE, FLAG } = require('../game/TapeCodec');
const gamelog = require('../gamelog');
const q = require('./gamelogQuery');

const SHARD_SIZE = 5000;   // decisions per shard

function parseArgs(argv) {
    const args = {
        out: 'data', since: null, limit: null,
        humansOnly: false, includeAbandoned: false, legal: true,
        competitiveOnly: false
    };
    for (let i = 2; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--out') args.out = argv[++i];
        else if (flag === '--since') args.since = Number(argv[++i]);
        else if (flag === '--limit') args.limit = Number(argv[++i]);
        else if (flag === '--humans-only') args.humansOnly = true;
        else if (flag === '--include-abandoned') args.includeAbandoned = true;
        else if (flag === '--no-legal') args.legal = false;
        else if (flag === '--competitive-only') args.competitiveOnly = true;
        else if (flag === '--help') args.help = true;
    }
    return args;
}

const USAGE = `
Usage: export-training-data.js --out DIR [options]

  --since KEY           start at this game_key
  --limit N             at most N games
  --humans-only         only emit decisions made by humans
  --include-abandoned   include games that were abandoned (see below)
  --no-legal            skip legal-move enumeration (much faster, smaller)
  --competitive-only    drop games whose bots played below full strength

Games played against weakened bots are INCLUDED by default and tagged with
weakened_bots (per row) and difficulty (per seat). They are not junk: the human
moves in them are genuine human decisions, and the bot rows are valid league
opponents. What is biased is the outcome label -- round utility earned against
weak opposition overstates how good those actions were -- so condition on the
tag, reweight, or drop them at training time, where the trade-off is visible.
Labelling is the irreversible half; a filter can always be applied later, but
data exported without provenance can never be sorted out. Pass this flag when
fitting on outcome labels and you want the clean subset.

Abandoned games are EXCLUDED by default only because their game-level labels
are null; their completed rounds are fully usable and are the bulk of the
signal. Pass --include-abandoned and filter on abandon_reason rather than
dropping them wholesale. Note that abandonment is not random -- players leave
when losing -- so pooling them unweighted biases any value estimate.
`;

/**
 * Writes gzipped JSONL, rolling over to a new shard every SHARD_SIZE records.
 *
 * close() is async and MUST be awaited. Ending a gzip stream only starts the
 * flush; the bytes reach disk later. Exiting without waiting truncates the
 * final shard -- and a corrupt gzip trailer fails loudly, but a short last
 * record does not, which is the worse outcome.
 */
class ShardWriter {
    constructor(outDir, prefix) {
        this.outDir = outDir;
        this.prefix = prefix;
        this.index = 0;
        this.count = 0;
        this.total = 0;
        this.stream = null;
        this.pending = [];
        fs.mkdirSync(outDir, { recursive: true });
    }

    write(record) {
        if (!this.stream || this.count >= SHARD_SIZE) this.roll();
        this.stream.write(JSON.stringify(record) + '\n');
        this.count++;
        this.total++;
    }

    roll() {
        this.endCurrent();
        const name = `${this.prefix}-${String(this.index).padStart(5, '0')}.jsonl.gz`;
        const file = fs.createWriteStream(path.join(this.outDir, name));
        const gzip = zlib.createGzip();
        gzip.pipe(file);
        // Resolves when this shard is fully on disk, not when we stopped
        // writing to it.
        this.pending.push(new Promise((resolve, reject) => {
            file.on('finish', resolve);
            file.on('error', reject);
            gzip.on('error', reject);
        }));
        this.stream = gzip;
        this.index++;
        this.count = 0;
    }

    endCurrent() {
        if (this.stream) {
            this.stream.end();
            this.stream = null;
        }
    }

    async close() {
        this.endCurrent();
        await Promise.all(this.pending);
    }
}

/**
 * Per-seat outcome labels for a round, plus the game-level ones.
 *
 * Attached here rather than stored because return-to-go, placement, and
 * points-to-go all depend on the future of the game and on how you choose to
 * discount. They belong to the training run.
 */
function labelsFor(game, round, rounds, seat) {
    const roundPoints = round.round_points ? JSON.parse(round.round_points) : null;
    const scoreAfter = round.score_after ? JSON.parse(round.score_after) : null;

    // Final standings, when the game actually finished.
    let gamePlacement = null;
    if (game.end_reason === 'threshold' || game.end_reason === 'dragon') {
        const last = rounds[rounds.length - 1];
        const finals = last && last.score_after ? JSON.parse(last.score_after) : null;
        if (finals) {
            const ranked = finals
                .map((score, s) => ({ score, s }))
                .sort((a, b) => a.score - b.score);
            gamePlacement = ranked.findIndex(r => r.s === seat) + 1;
        }
    }

    return {
        round_points: roundPoints ? roundPoints[seat] : null,
        score_after: scoreAfter ? scoreAfter[seat] : null,
        won_round: round.winner_seat === null ? null : round.winner_seat === seat,
        game_placement: gamePlacement,
        // Null for abandoned games. A consumer that drops rows on a null here
        // silently discards every abandoned game, so this is emitted alongside
        // end_reason rather than on its own.
        game_won: gamePlacement === null ? null : gamePlacement === 1
    };
}

async function main() {
    const args = parseArgs(process.argv);
    if (args.help) { console.log(USAGE); return 0; }

    if (!process.env.GAMELOG_EXPORT_SECRET) {
        console.error('GAMELOG_EXPORT_SECRET must be set: user ids are never exported raw.');
        return 2;
    }

    const db = await q.connect();
    const games = await q.listGames(db, { since: args.since, limit: args.limit });
    const writer = new ShardWriter(args.out, 'big2');

    const stats = {
        games: 0, skippedAbandoned: 0, skippedWeakened: 0, rounds: 0,
        decisions: 0, emitted: 0, replayFailures: 0
    };

    for (const game of games) {
        if (game.end_reason === 'abandoned' && !args.includeAbandoned) {
            stats.skippedAbandoned++;
            continue;
        }
        if (game.weakened_bots && args.competitiveOnly) {
            stats.skippedWeakened++;
            continue;
        }
        stats.games++;

        const seatSegments = await q.seatsFor(db, game.game_key);
        const rounds = await q.roundsFor(db, game.game_key);

        for (const round of rounds) {
            if (round.end_reason === 'dragon') continue;   // no decisions to learn from

            const actions = await q.actionsFor(db, game.game_key, round.round_number);
            const result = replayRound(round, actions, { legalMoves: args.legal, strict: false });

            if (!result.complete) {
                stats.replayFailures++;
                continue;   // never emit from a round that does not reconstruct
            }
            stats.rounds++;

            for (const snapshot of result.snapshots) {
                stats.decisions++;
                const ply = snapshot.action;

                // Server-generated plies are not decisions. Emitting them would
                // teach a pass policy to imitate a house rule.
                if (ply.action === ACTION.AUTO_PASS) continue;

                const occupant = q.occupantAtRound(seatSegments[snapshot.seat], round.round_number);
                if (!occupant) continue;

                const isHuman = occupant.occupant === 'human' || occupant.occupant === 'guest';
                if (args.humansOnly && !isHuman) continue;

                writer.write({
                    game: game.game_id,
                    round: round.round_number,
                    ply: ply.ply,
                    seat: snapshot.seat,

                    // --- provenance -------------------------------------------
                    occupant: occupant.occupant,
                    // Branch on occupant type, never on whether user_id
                    // happens to be present. subject_key holds a bot's policy
                    // name (safe, and meaningful) but a human's username, so a
                    // fallback from a missing user_id would emit that username
                    // in plaintext. Humans get an HMAC or nothing.
                    subject: isHuman
                        ? (occupant.user_id === null || occupant.user_id === undefined
                            ? null
                            : gamelog.subjectKeyFor(occupant.user_id))
                        : occupant.subject_key,
                    policy_gen: occupant.policy_gen,
                    policy_ref: occupant.policy_ref,
                    // How hard this seat was trying. NULL for humans, and NULL
                    // on rows logged before difficulty tiers existed, which
                    // reads correctly as full strength.
                    difficulty: occupant.difficulty ?? null,
                    rating_mu: occupant.rating_mu,
                    rating_sigma: occupant.rating_sigma,
                    // Their hand was inherited, not chosen. Contaminated for
                    // imitation learning.
                    joined_mid_game: Boolean(occupant.joined_mid_game),
                    source: ply.source,
                    // A pass the player's preference made for them, not a choice.
                    forced_pass: ply.source === SOURCE.AUTO_PASS_PREF,
                    // The declared policy is not what answered this ply.
                    policy_fallback: ply.source === SOURCE.BOT_FALLBACK,

                    game_mode: game.game_mode,
                    // True when any bot seat in this game played below full
                    // strength. Every row of such a game carries it, human rows
                    // included: the round utility is zero-sum across all four
                    // seats, so a weakened bot biases everyone's outcome label,
                    // not just its own. Rows are emitted either way - see the
                    // note on --competitive-only below.
                    weakened_bots: Boolean(game.weakened_bots),
                    rules_version: game.rules_version,
                    schema_version: game.schema_version,
                    end_reason: game.end_reason,
                    abandon_reason: game.abandon_reason,

                    // --- observation ------------------------------------------
                    // Re-indexed relative to the acting seat by the same builder
                    // the live bot uses, so a policy trained here drops straight
                    // in without a translation layer.
                    obs: {
                        hand: snapshot.hands[snapshot.seat].map(c => c.value),
                        pile: snapshot.pile ? {
                            type: snapshot.pile.type,
                            value: snapshot.pile.value,
                            cards: snapshot.pile.cards.map(c => c.value)
                        } : null,
                        pile_owner_rel: snapshot.obs.lastPlayedByRelative,
                        counts_rel: snapshot.obs.playerCardCounts,
                        passed_rel: snapshot.obs.passedPlayers,
                        pass_count: snapshot.obs.passCount,
                        played: snapshot.playedCards.map(c => c.value),
                        history: snapshot.obs.playHistory.map(h => ({
                            rel: h.relative,
                            action: h.action,
                            type: h.hand ? h.hand.type : null,
                            value: h.hand ? h.hand.value : null
                        }))
                    },

                    // --- hidden state -----------------------------------------
                    // Absolute seat order, for a centralized critic. Kept in a
                    // separate key from `obs` on purpose: leaking perfect
                    // information into a policy is the classic way to train an
                    // agent that scores brilliantly offline and collapses in
                    // play, and it should take deliberate effort.
                    hidden: { hands: snapshot.hands.map(h => h.map(c => c.value)) },

                    legal: snapshot.legal || null,

                    // --- action -----------------------------------------------
                    action: ply.action === ACTION.PLAY
                        ? {
                            type: 'play',
                            cards: decodeCards(ply.cards_mask).map(c => c.value),
                            hand_type: ply.hand_type,
                            hand_value: ply.hand_value
                        }
                        : { type: 'pass' },

                    think_ms: ply.think_ms,
                    think_clamped: Boolean(ply.flags & FLAG.THINK_CLAMPED),
                    turn_disconnected: Boolean(ply.flags & FLAG.TURN_DISCONNECTED),

                    labels: labelsFor(game, round, rounds, snapshot.seat)
                });
                stats.emitted++;
            }
        }
    }

    // Await: the summary below must not claim success before the bytes exist.
    await writer.close();

    console.log(`games        ${stats.games} exported` +
        (stats.skippedAbandoned ? `, ${stats.skippedAbandoned} abandoned skipped` : '') +
        (stats.skippedWeakened ? `, ${stats.skippedWeakened} weakened-bot skipped` : ''));
    console.log(`rounds       ${stats.rounds}`);
    console.log(`decisions    ${stats.decisions} seen, ${stats.emitted} emitted`);
    if (stats.replayFailures) {
        console.log(`\nWARNING: ${stats.replayFailures} round(s) failed to replay and were ` +
                    `excluded. Run verify-gamelog.js to investigate.`);
    }
    console.log(`shards       ${writer.index} in ${args.out}/`);
    return 0;
}

if (require.main === module) {
    main()
        .then(code => process.exit(code))
        .catch(err => { console.error(err); process.exit(2); });
}

module.exports = { main, labelsFor };
