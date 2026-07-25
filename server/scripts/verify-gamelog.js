#!/usr/bin/env node
// server/scripts/verify-gamelog.js
//
// Replay-completeness sweep.
//
// Replays every logged round and reports the ones that do not reconstruct. Run
// this BEFORE writing any training code, and regularly after: it is the single
// best corruption detector available, and it is far cheaper to discover a
// broken writer while there are a hundred games to discard than a million.
//
// Two things are checked per round:
//   1. Replay runs to completion without a rules violation.
//   2. The reconstructed hand sizes match the cards_left recorded at round end.
//
// The second matters more than it looks. A tape can replay cleanly and still be
// wrong -- if plies were dropped, every remaining ply is still legal, and only
// the final hand sizes reveal it.
//
// Usage:
//   GAMELOG_ENABLED=1 node scripts/verify-gamelog.js [--since KEY] [--limit N] [--verbose]

const { replayRound } = require('../game/Replayer');
const q = require('./gamelogQuery');

function parseArgs(argv) {
    const args = { since: null, limit: null, verbose: false };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--since') args.since = Number(argv[++i]);
        else if (argv[i] === '--limit') args.limit = Number(argv[++i]);
        else if (argv[i] === '--verbose') args.verbose = true;
        else if (argv[i] === '--help') args.help = true;
    }
    return args;
}

async function main() {
    const args = parseArgs(process.argv);
    if (args.help) {
        console.log('Usage: verify-gamelog.js [--since KEY] [--limit N] [--verbose]');
        return 0;
    }

    const db = await q.connect();
    const games = await q.listGames(db, { since: args.since, limit: args.limit });

    let rounds = 0;
    let plies = 0;
    const failures = [];
    const skipped = { partial: 0, dragon: 0 };

    for (const game of games) {
        for (const round of await q.roundsFor(db, game.game_key)) {
            // A dragon round has no plies by construction; a partial round was
            // truncated mid-play, so its cards_left is unknown. Neither is
            // corrupt, and neither can be checked the same way.
            if (round.end_reason === 'dragon') { skipped.dragon++; continue; }

            const actions = await q.actionsFor(db, game.game_key, round.round_number);
            const result = replayRound(round, actions, { strict: false });

            rounds++;
            plies += actions.length;

            if (!result.complete) {
                failures.push({
                    game: game.game_id, round: round.round_number,
                    reason: result.error.message
                });
                continue;
            }

            if (round.end_reason === 'partial') { skipped.partial++; continue; }

            const recorded = round.cards_left ? JSON.parse(round.cards_left) : null;
            if (recorded && !sameArray(recorded, result.cardsLeft)) {
                failures.push({
                    game: game.game_id, round: round.round_number,
                    reason: `cards_left ${JSON.stringify(recorded)} but replay produced ` +
                            `${JSON.stringify(result.cardsLeft)} -- plies are probably missing`
                });
                continue;
            }

            if (round.winner_seat !== null && result.winnerSeat !== round.winner_seat) {
                failures.push({
                    game: game.game_id, round: round.round_number,
                    reason: `winner_seat ${round.winner_seat} but replay produced ${result.winnerSeat}`
                });
            }
        }
    }

    console.log(`games      ${games.length}`);
    console.log(`rounds     ${rounds} replayed (${skipped.dragon} dragon, ${skipped.partial} partial)`);
    console.log(`plies      ${plies}`);
    console.log(`failures   ${failures.length}`);

    if (failures.length) {
        console.log('');
        const show = args.verbose ? failures : failures.slice(0, 20);
        for (const f of show) {
            console.log(`  ${f.game} round ${f.round}: ${f.reason}`);
        }
        if (!args.verbose && failures.length > show.length) {
            console.log(`  ... and ${failures.length - show.length} more (--verbose for all)`);
        }
        return 1;
    }

    console.log('\nEvery round replays to the state it recorded.');
    return 0;
}

const sameArray = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

if (require.main === module) {
    main()
        .then(code => process.exit(code))
        .catch(err => { console.error(err); process.exit(2); });
}

module.exports = { main };
