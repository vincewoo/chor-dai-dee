#!/usr/bin/env node
// server/scripts/archive-gamelog.js
//
// Archival and retention for the game log.
//
// Two jobs that have to happen together:
//
//   - Keep gamelog.sqlite small enough to stay on the volume. At ~20 KB per
//     game and 1,000 games a day this outgrows a 1 GB volume in under two
//     months, so archival is a requirement rather than a nicety.
//   - Enforce the retention window. Raw tapes record what cards real people
//     held and how long they took to act. Exported shards are pseudonymized;
//     the raw rows are not, and should not live forever.
//
// Order matters: export first, verify the shard exists, then delete. A crash
// between the two costs disk, not data.
//
// Usage:
//   GAMELOG_ENABLED=1 GAMELOG_EXPORT_SECRET=... \
//     node scripts/archive-gamelog.js --out archive/ [--older-than DAYS]
//     [--retention DAYS] [--dry-run]

const fs = require('fs');
const path = require('path');

const gamelog = require('../gamelog');
const q = require('./gamelogQuery');
const { main: exportMain } = require('./export-training-data');

// Games older than this are archived out of the live database.
const DEFAULT_ARCHIVE_DAYS = 30;

// Raw tapes are deleted at this age whether or not they were archived. Follows
// the precedent set by DECISION_TRACKING_RETENTION_DAYS in db.js.
const DEFAULT_RETENTION_DAYS = 180;

function parseArgs(argv) {
    const args = {
        out: 'archive',
        olderThan: DEFAULT_ARCHIVE_DAYS,
        retention: DEFAULT_RETENTION_DAYS,
        dryRun: false
    };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === '--out') args.out = argv[++i];
        else if (argv[i] === '--older-than') args.olderThan = Number(argv[++i]);
        else if (argv[i] === '--retention') args.retention = Number(argv[++i]);
        else if (argv[i] === '--dry-run') args.dryRun = true;
        else if (argv[i] === '--help') args.help = true;
    }
    return args;
}

const USAGE = `
Usage: archive-gamelog.js --out DIR [options]

  --older-than DAYS   archive games older than this (default ${DEFAULT_ARCHIVE_DAYS})
  --retention DAYS    delete raw tapes older than this (default ${DEFAULT_RETENTION_DAYS})
  --dry-run           report what would happen, change nothing

Archival exports to pseudonymized shards, then deletes the raw rows. Retention
deletes raw rows past the window regardless -- so a game that was never
exported is still removed on schedule. Privacy does not wait on tooling.
`;

/** Deletes a set of games and everything hanging off them. */
async function deleteGames(db, gameKeys) {
    if (gameKeys.length === 0) return 0;
    // Chunked: SQLite's default parameter limit is 999.
    const CHUNK = 500;
    let deleted = 0;
    for (let i = 0; i < gameKeys.length; i += CHUNK) {
        const chunk = gameKeys.slice(i, i + CHUNK);
        const marks = chunk.map(() => '?').join(',');
        await db.withTransaction(async () => {
            // Children first: an interrupted delete should never leave actions
            // pointing at a game that no longer exists.
            await db.run(`DELETE FROM mlog_action WHERE game_key IN (${marks})`, chunk);
            await db.run(`DELETE FROM mlog_round  WHERE game_key IN (${marks})`, chunk);
            await db.run(`DELETE FROM mlog_seat   WHERE game_key IN (${marks})`, chunk);
            await db.run(`DELETE FROM mlog_game   WHERE game_key IN (${marks})`, chunk);
        });
        deleted += chunk.length;
    }
    return deleted;
}

async function main() {
    const args = parseArgs(process.argv);
    if (args.help) { console.log(USAGE); return 0; }

    const db = await q.connect();
    const now = Date.now();
    const archiveBefore = now - args.olderThan * 24 * 60 * 60 * 1000;
    const retentionBefore = now - args.retention * 24 * 60 * 60 * 1000;

    // --- 1. archive ---------------------------------------------------------
    // Only closed games: an open game may still be written to.
    const archivable = await db.all(
        `SELECT game_key, game_id FROM mlog_game
          WHERE started_at < ? AND ended_at IS NOT NULL
          ORDER BY game_key`,
        [archiveBefore]
    );

    console.log(`archivable   ${archivable.length} game(s) older than ${args.olderThan}d`);

    if (archivable.length > 0 && !args.dryRun) {
        if (!process.env.GAMELOG_EXPORT_SECRET) {
            console.error('GAMELOG_EXPORT_SECRET must be set: archives are pseudonymized.');
            return 2;
        }

        const stamp = new Date(now).toISOString().slice(0, 10);
        const outDir = path.join(args.out, stamp);
        const first = archivable[0].game_key;
        const last = archivable[archivable.length - 1].game_key;

        process.argv = [
            'node', 'export',
            '--out', outDir,
            '--since', String(first),
            '--limit', String(archivable.length),
            '--include-abandoned'   // archives are complete; filtering is the reader's job
        ];
        const code = await exportMain();
        if (code !== 0) {
            console.error('export failed; nothing deleted');
            return code;
        }

        // Only delete once a shard provably exists on disk.
        const shards = fs.existsSync(outDir)
            ? fs.readdirSync(outDir).filter(f => f.endsWith('.jsonl.gz'))
            : [];
        if (shards.length === 0) {
            console.error(`no shards written to ${outDir}; nothing deleted`);
            return 2;
        }

        const removed = await deleteGames(db, archivable.map(g => g.game_key));
        console.log(`archived     ${removed} game(s) (keys ${first}-${last}) to ${outDir}/`);
        console.log(`shards       ${shards.length}`);
    }

    // --- 2. retention -------------------------------------------------------
    // Independent of archival on purpose: a game that was never exported is
    // still deleted on schedule. The privacy commitment is about how long raw
    // hands are kept, not about whether the tooling got to them.
    const expired = await db.all(
        'SELECT game_key FROM mlog_game WHERE started_at < ?', [retentionBefore]
    );
    console.log(`expired      ${expired.length} game(s) past the ${args.retention}d window`);

    if (expired.length > 0 && !args.dryRun) {
        const removed = await deleteGames(db, expired.map(g => g.game_key));
        console.log(`deleted      ${removed} game(s)`);
    }

    // --- 3. reclaim ---------------------------------------------------------
    // SQLite does not return freed pages to the filesystem on its own, so
    // without this the file never shrinks and the whole exercise is pointless.
    if (!args.dryRun && (archivable.length > 0 || expired.length > 0)) {
        console.log('vacuuming...');
        await db.run('VACUUM');
        const { size } = fs.statSync(gamelog.dbPath);
        console.log(`database     ${(size / 1024 / 1024).toFixed(1)} MB after vacuum`);
    }

    if (args.dryRun) console.log('\n(dry run: nothing changed)');
    return 0;
}

if (require.main === module) {
    main()
        .then(code => process.exit(code))
        .catch(err => { console.error(err); process.exit(2); });
}

module.exports = { main, deleteGames, DEFAULT_ARCHIVE_DAYS, DEFAULT_RETENTION_DAYS };
