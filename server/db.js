// server/db.js
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

// Use /data directory in production (Docker volume mount), local directory otherwise
const isProduction = process.env.NODE_ENV === 'production';
const dbPath = isProduction
    ? '/data/database.sqlite'
    : path.join(__dirname, 'database.sqlite');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database', err.message);
    } else {
        console.log(`Connected to SQLite database at ${dbPath}`);
        applyPragmas();
        initDb();
    }
});

// Connection tuning. SQLite defaults to journal_mode=delete + synchronous=FULL,
// which fsyncs on every statement -- the round-end stats path issues dozens of
// writes, so those fsyncs dominate. WAL + NORMAL keeps durability across process
// crashes (only an OS-level crash can lose the last commits) at a fraction of the
// I/O, and busy_timeout stops concurrent writers from failing outright.
function applyPragmas() {
    db.serialize(() => {
        db.run(`PRAGMA journal_mode = WAL`, (err) => {
            if (err) console.error('Error setting journal_mode:', err.message);
        });
        db.run(`PRAGMA synchronous = NORMAL`, (err) => {
            if (err) console.error('Error setting synchronous:', err.message);
        });
        db.run(`PRAGMA busy_timeout = 5000`, (err) => {
            if (err) console.error('Error setting busy_timeout:', err.message);
        });
    });
}

// Runs `fn` inside a single SQLite transaction so a burst of related writes
// costs one commit instead of one per statement.
//
// Transactions are serialized through a promise chain: node-sqlite3 uses one
// connection, so two overlapping BEGINs would fail with "cannot start a
// transaction within a transaction". Queueing means a second game ending while
// the first is still writing waits its turn rather than erroring.
//
// Caveat: writes issued elsewhere while a transaction is open ride along in that
// transaction and would be lost on rollback. That is acceptable here -- callers
// are stats/history persistence, and a rollback only happens on an error path
// that would have lost the writes anyway.
let transactionQueue = Promise.resolve();

const withTransaction = (fn) => {
    const run = (sql) => new Promise((resolve, reject) => {
        db.run(sql, (err) => (err ? reject(err) : resolve()));
    });

    const result = transactionQueue.then(async () => {
        await run('BEGIN IMMEDIATE');
        try {
            const value = await fn();
            await run('COMMIT');
            return value;
        } catch (err) {
            try {
                await run('ROLLBACK');
            } catch (rollbackErr) {
                console.error('Rollback failed:', rollbackErr.message);
            }
            throw err;
        }
    });

    // Keep the queue alive regardless of this transaction's outcome.
    transactionQueue = result.then(() => {}, () => {});

    return result;
};

function initDb() {
    db.serialize(() => {
        // Users Table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT
        )`);

        // User Preferences Table
        db.run(`CREATE TABLE IF NOT EXISTS user_preferences (
            user_id INTEGER PRIMARY KEY,
            four_color_mode INTEGER DEFAULT 0,
            auto_pass INTEGER DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`, (err) => {
            if (err) {
                console.error('Error creating user_preferences table:', err);
            } else {
                // Initialize preferences for any existing users who don't have them
                db.run(`INSERT OR IGNORE INTO user_preferences (user_id)
                        SELECT id FROM users`, (err) => {
                    if (err) {
                        console.error('Error initializing user preferences:', err);
                    }
                });
            }
        });

        // Create round_stats table for per-round tracking
        db.run(`CREATE TABLE IF NOT EXISTS round_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            game_mode TEXT NOT NULL,
            round_number INTEGER NOT NULL,
            placement INTEGER NOT NULL,
            cards_remaining INTEGER NOT NULL,
            penalty_multiplier INTEGER NOT NULL,
            round_points INTEGER NOT NULL,
            cumulative_score INTEGER NOT NULL,
            plays_count INTEGER DEFAULT 0,
            passes_count INTEGER DEFAULT 0,
            leads_won INTEGER DEFAULT 0,
            -- Tricks the player played into at least once. leads_won is a
            -- share of these; it used to be reported as a share of every play.
            lead_attempts INTEGER DEFAULT 0,
            singles_played INTEGER DEFAULT 0,
            pairs_played INTEGER DEFAULT 0,
            triples_played INTEGER DEFAULT 0,
            straights_played INTEGER DEFAULT 0,
            flushes_played INTEGER DEFAULT 0,
            full_houses_played INTEGER DEFAULT 0,
            quads_played INTEGER DEFAULT 0,
            straight_flushes_played INTEGER DEFAULT 0,
            -- Deal strength: how good the 13 cards were before anything was
            -- played. Stored raw rather than only as a tier so the outcome
            -- baseline can be recalibrated later without a backfill we could
            -- not perform. NULL on rows written before the feature existed.
            deal_strength_raw REAL,
            deal_tier INTEGER,
            deal_rank INTEGER,
            deal_baseline_version INTEGER,
            human_opponents INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // Create indexes for fast querying
        db.run(`CREATE INDEX IF NOT EXISTS idx_round_stats_user_mode
                ON round_stats(user_id, game_mode)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_round_stats_game
                ON round_stats(game_id)`);

        // Create head-to-head stats table for Tier 2
        db.run(`CREATE TABLE IF NOT EXISTS head_to_head_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER NOT NULL,
            opponent_id INTEGER NOT NULL,
            game_mode TEXT NOT NULL,
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            games_played INTEGER DEFAULT 0,
            total_placement_diff INTEGER DEFAULT 0,
            FOREIGN KEY(player_id) REFERENCES users(id),
            FOREIGN KEY(opponent_id) REFERENCES users(id),
            UNIQUE(player_id, opponent_id, game_mode)
        )`);

        // Create index for fast head-to-head queries
        db.run(`CREATE INDEX IF NOT EXISTS idx_h2h_player_mode
                ON head_to_head_stats(player_id, game_mode)`);

        // ========== ACTIVITY FEED / GAME HISTORY TABLES ==========

        // Game history table for activity feed
        db.run(`CREATE TABLE IF NOT EXISTS game_history (
            game_id TEXT PRIMARY KEY,
            room_name TEXT,
            game_mode TEXT NOT NULL,
            is_public INTEGER DEFAULT 1,
            status TEXT NOT NULL CHECK(status IN ('completed', 'abandoned', 'in_progress')),
            winner_id INTEGER,
            winner_username TEXT,
            start_time DATETIME NOT NULL,
            end_time DATETIME,
            duration_seconds INTEGER,
            total_rounds INTEGER DEFAULT 0,
            max_points INTEGER,
            FOREIGN KEY(winner_id) REFERENCES users(id)
        )`);

        // Game participants for tracking who was in each game
        db.run(`CREATE TABLE IF NOT EXISTS game_participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id TEXT NOT NULL,
            user_id INTEGER,
            username TEXT NOT NULL,
            is_bot INTEGER DEFAULT 0,
            final_placement INTEGER,
            final_score INTEGER,
            rounds_won INTEGER DEFAULT 0,
            FOREIGN KEY(game_id) REFERENCES game_history(game_id),
            FOREIGN KEY(user_id) REFERENCES users(id),
            UNIQUE(game_id, username)
        )`);

        // Notable events in games (for highlights)
        db.run(`CREATE TABLE IF NOT EXISTS game_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            event_data TEXT,
            round_number INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(game_id) REFERENCES game_history(game_id)
        )`);

        // Indexes for efficient activity feed queries
        db.run(`CREATE INDEX IF NOT EXISTS idx_game_history_end_time
                ON game_history(end_time DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_game_history_status
                ON game_history(status, end_time DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_game_participants_user
                ON game_participants(user_id, game_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_game_events_game
                ON game_events(game_id)`);
        // The activity feed pages by (status, game_mode) ordered by end_time; a
        // composite index lets that page be read straight off the index instead of
        // scanning and sorting game_history.
        db.run(`CREATE INDEX IF NOT EXISTS idx_game_history_status_mode_time
                ON game_history(status, game_mode, end_time DESC)`);
        // Joining participants onto the selected page, and the "my games" filter.
        db.run(`CREATE INDEX IF NOT EXISTS idx_game_participants_game
                ON game_participants(game_id)`);

        // Create Tier 3 advanced analytics tables

        // Decision Efficiency: Track each play decision for optimality analysis
        db.run(`CREATE TABLE IF NOT EXISTS decision_tracking (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            round_number INTEGER NOT NULL,
            turn_number INTEGER NOT NULL,
            action TEXT NOT NULL,
            hand_size INTEGER NOT NULL,
            cards_remaining_in_deck INTEGER NOT NULL,
            current_pile_strength REAL,
            hand_strength REAL,
            decision_quality TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        db.run(`CREATE INDEX IF NOT EXISTS idx_decision_tracking_user
                ON decision_tracking(user_id, game_id)`);
        // Lets the retention sweep delete by age as an index range scan instead of
        // a full table scan.
        db.run(`CREATE INDEX IF NOT EXISTS idx_decision_tracking_timestamp
                ON decision_tracking(timestamp)`);

        // Card Counting: Track prediction accuracy and deck awareness
        db.run(`CREATE TABLE IF NOT EXISTS card_awareness_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            game_mode TEXT NOT NULL,
            total_decisions INTEGER DEFAULT 0,
            optimal_decisions INTEGER DEFAULT 0,
            suboptimal_decisions INTEGER DEFAULT 0,
            risky_plays_successful INTEGER DEFAULT 0,
            risky_plays_failed INTEGER DEFAULT 0,
            -- Superseded by the two counters below. Kept so old rows still
            -- read, but no longer written: a stored running mean cannot be
            -- corrected after the fact, whereas counts can.
            late_game_accuracy REAL DEFAULT 0.0,
            late_game_decisions INTEGER DEFAULT 0,
            late_game_optimal INTEGER DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id),
            UNIQUE(user_id, game_mode)
        )`);

        // Migration for card_awareness_stats on existing databases
        db.all("PRAGMA table_info(card_awareness_stats)", (err, columns) => {
            if (err) {
                console.error("Error checking card_awareness_stats schema", err);
                return;
            }
            if (columns.length > 0) {
                const addColumn = (name, ddl) => {
                    if (!columns.some(c => c.name === name)) {
                        db.run(`ALTER TABLE card_awareness_stats ADD COLUMN ${ddl}`, (err) => {
                            if (err && !err.message.includes('duplicate column')) {
                                console.error(`Error adding ${name} to card_awareness_stats:`, err.message);
                            }
                        });
                    }
                };
                addColumn('late_game_decisions', 'late_game_decisions INTEGER DEFAULT 0');
                addColumn('late_game_optimal', 'late_game_optimal INTEGER DEFAULT 0');
            }
        });

        // Variance & Consistency: Track performance patterns over time
        db.run(`CREATE TABLE IF NOT EXISTS variance_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            game_mode TEXT NOT NULL,
            current_streak INTEGER DEFAULT 0,
            longest_win_streak INTEGER DEFAULT 0,
            longest_loss_streak INTEGER DEFAULT 0,
            total_sessions INTEGER DEFAULT 0,
            variance_score REAL DEFAULT 0.0,
            consistency_rating REAL DEFAULT 0.0,
            -- Retired. The luck-vs-skill question is answered by the
            -- deal-strength stats, per round and against a measured baseline.
            -- Kept so old rows still read; nothing writes them.
            lucky_wins INTEGER DEFAULT 0,
            skilled_wins INTEGER DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id),
            UNIQUE(user_id, game_mode)
        )`);

        // Behavioral Segmentation: Classify player styles
        db.run(`CREATE TABLE IF NOT EXISTS behavioral_stats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            game_mode TEXT NOT NULL,
            aggression_score REAL DEFAULT 0.0,
            risk_score REAL DEFAULT 0.0,
            adaptability_score REAL DEFAULT 0.0,
            player_archetype TEXT DEFAULT 'Balanced',
            early_game_style TEXT DEFAULT 'Neutral',
            late_game_style TEXT DEFAULT 'Neutral',
            FOREIGN KEY(user_id) REFERENCES users(id),
            UNIQUE(user_id, game_mode)
        )`);

        db.run(`CREATE INDEX IF NOT EXISTS idx_behavioral_user
                ON behavioral_stats(user_id, game_mode)`);

        // Placement History: Track game placements over time for adaptability calculation
        db.run(`CREATE TABLE IF NOT EXISTS placement_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            game_mode TEXT NOT NULL,
            game_id TEXT NOT NULL,
            placement INTEGER NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        db.run(`CREATE INDEX IF NOT EXISTS idx_placement_history_user
                ON placement_history(user_id, game_mode)`);

        // Check if users table needs google_id column (migration for Google OAuth)
        db.all("PRAGMA table_info(users)", (err, columns) => {
            if (err) {
                console.error("Error checking users schema", err);
                return;
            }

            if (columns.length > 0) {
                const hasGoogleId = columns.some(c => c.name === 'google_id');
                if (!hasGoogleId) {
                    console.log("Adding Google OAuth columns to users table");
                    // SQLite doesn't support adding UNIQUE columns directly via ALTER TABLE
                    // Add column without constraint, then create unique index
                    db.run(`ALTER TABLE users ADD COLUMN google_id TEXT`, (err) => {
                        if (err && !err.message.includes('duplicate column')) {
                            console.error("Error adding google_id:", err.message);
                        } else {
                            // Create unique index after column is added
                            db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)`, (err) => {
                                if (err) {
                                    console.error("Error creating google_id index:", err.message);
                                }
                            });
                        }
                    });
                    db.run(`ALTER TABLE users ADD COLUMN google_email TEXT`, (err) => {
                        if (err && !err.message.includes('duplicate column')) {
                            console.error("Error adding google_email:", err.message);
                        }
                    });
                }
            }
        });

        // Migration: add v2 table-theme preference columns to user_preferences
        db.all("PRAGMA table_info(user_preferences)", (err, columns) => {
            if (err) {
                console.error("Error checking user_preferences schema", err);
                return;
            }
            if (columns.length > 0) {
                const addColumn = (name, ddl) => {
                    if (!columns.some(c => c.name === name)) {
                        db.run(`ALTER TABLE user_preferences ADD COLUMN ${ddl}`, (err) => {
                            if (err && !err.message.includes('duplicate column')) {
                                console.error(`Error adding ${name} to user_preferences:`, err.message);
                            } else {
                                console.log(`Successfully added ${name} column to user_preferences`);
                            }
                        });
                    }
                };
                addColumn('table_theme', "table_theme TEXT DEFAULT 'felt'");
                addColumn('accent_color', "accent_color TEXT DEFAULT 'gold'");
                addColumn('reduced_motion', 'reduced_motion INTEGER DEFAULT 0');
                addColumn('sound_enabled', 'sound_enabled INTEGER DEFAULT 1');
                addColumn('sound_volume', 'sound_volume REAL DEFAULT 0.6');
                // Avatar chosen in the Avatar Picker. NULL means "never chose
                // one", which is what tells clients to fall back to the
                // deterministic name-derived avatar.
                addColumn('avatar_animal', 'avatar_animal TEXT');
                addColumn('avatar_tile', 'avatar_tile INTEGER');
            }
        });

        // Migrations for round_stats on existing databases
        db.all("PRAGMA table_info(round_stats)", (err, columns) => {
            if (err) {
                console.error("Error checking round_stats schema", err);
                return;
            }

            if (columns.length > 0) {
                const addColumn = (name, ddl) => {
                    if (!columns.some(c => c.name === name)) {
                        db.run(`ALTER TABLE round_stats ADD COLUMN ${ddl}`, (err) => {
                            if (err && !err.message.includes('duplicate column')) {
                                console.error(`Error adding ${name} to round_stats:`, err.message);
                            } else {
                                console.log(`Successfully added ${name} column to round_stats`);
                            }
                        });
                    }
                };
                addColumn('leads_won', 'leads_won INTEGER DEFAULT 0');
                // NULL, not 0, on rows written before tricks were counted: a
                // round with an unknown number of contested tricks is not a
                // round with none. Same reasoning as the deal columns below --
                // 0 here would divide a real leads_won by a fabricated zero.
                addColumn('lead_attempts', 'lead_attempts INTEGER');
                // Deal-strength columns default to NULL, not 0: a pre-existing
                // row has an *unknown* deal, and 0 is a real (average) score.
                // Every deal-strength query filters on NOT NULL for this reason.
                addColumn('deal_strength_raw', 'deal_strength_raw REAL');
                addColumn('deal_tier', 'deal_tier INTEGER');
                addColumn('deal_rank', 'deal_rank INTEGER');
                addColumn('deal_baseline_version', 'deal_baseline_version INTEGER');
                addColumn('human_opponents', 'human_opponents INTEGER');
            }
        });

        // Check stats table schema
        db.all("PRAGMA table_info(stats)", (err, columns) => {
            if (err) {
                console.error("Error getting stats schema", err);
                return;
            }

            if (columns.length === 0) {
                // Table does not exist. createStatsTable creates the indexes itself
                // once the CREATE TABLE statements have actually run.
                createStatsTable();
            } else {
                createStatsIndexes();
                const hasElo = columns.some(c => c.name === 'elo');
                const hasRatingMu = columns.some(c => c.name === 'rating_mu');
                const hasFirstPlace = columns.some(c => c.name === 'first_place');

                if (hasElo && !hasRatingMu) {
                    console.log("Migrating stats table: Removing elo, adding rating_mu/sigma");
                    migrateStatsTable();
                } else if (!hasRatingMu) {
                    // This case handles partially initialized tables or manual adjustments
                    console.log("Adding missing rating columns");
                    db.run(`ALTER TABLE stats ADD COLUMN rating_mu REAL DEFAULT 25.0`);
                    db.run(`ALTER TABLE stats ADD COLUMN rating_sigma REAL DEFAULT 8.333`);
                }

                // Add advanced stats columns if they don't exist
                if (!hasFirstPlace) {
                    console.log("Adding advanced stats columns to stats tables");
                    addAdvancedStatsColumns();
                }
            }
        });

        runOnce(RESET_PRE_DECISION_COUNTERS, resetPreDecisionCounters);
    });
}

// ---- One-time data migrations ---------------------------------------------
//
// Column additions are idempotent by inspection -- PRAGMA table_info says
// whether the work is already done. A data migration cannot be recognised that
// way (a zeroed counter is indistinguishable from a counter that has since been
// legitimately incremented), so applied migrations are recorded by key.
function runOnce(key, migration) {
    db.run(`CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error('Error creating schema_meta table:', err.message);
            return;
        }

        db.get(`SELECT key FROM schema_meta WHERE key = ?`, [key], (err, row) => {
            if (err) {
                console.error(`Error checking migration ${key}:`, err.message);
                return;
            }
            if (row) return; // already applied

            migration((err) => {
                if (err) {
                    // Deliberately not recorded, so the next start retries.
                    console.error(`Migration ${key} failed:`, err.message);
                    return;
                }
                db.run(`INSERT OR IGNORE INTO schema_meta (key) VALUES (?)`, [key], (err) => {
                    if (err) console.error(`Error recording migration ${key}:`, err.message);
                    else console.log(`Applied one-time migration: ${key}`);
                });
            });
        });
    });
}

const RESET_PRE_DECISION_COUNTERS = 'reset_pre_decision_counters_v1';

// Counters that were accumulated under a different meaning than they now carry.
//
// card_awareness_stats' decision counters were incremented once per GAME, and
// its risky counters at most once per game with success inferred from final
// placement; they now take real per-decision counts, which would otherwise be
// added on top of the old units. variance_stats' lucky/skilled split came from
// a test that was always true. stats_*.lead_attempts held a copy of total
// plays. All of them are cumulative, so there is no way to read them back
// apart -- zero is the only honest starting point.
//
// Not reset: behavioural scores, which are an exponential moving average and
// converge on their own within about ten games; streaks and placement history,
// which were never miscounted; and the legacy late_game_accuracy column, which
// is no longer read.
const PRE_DECISION_COUNTER_RESETS = [
    {
        table: 'card_awareness_stats',
        columns: ['total_decisions', 'optimal_decisions', 'suboptimal_decisions',
                  'risky_plays_successful', 'risky_plays_failed']
    },
    { table: 'variance_stats', columns: ['lucky_wins', 'skilled_wins'] },
    { table: 'stats', columns: ['lead_attempts'] },
    { table: 'stats_short', columns: ['lead_attempts'] },
    { table: 'stats_standard', columns: ['lead_attempts'] }
];

function resetPreDecisionCounters(done) {
    // A table or column that does not exist yet is about to be created with a
    // DEFAULT of 0, which is the state this migration is trying to reach --
    // so skipping is correct however the schema work interleaves with this.
    const columnsPresent = (table) => new Promise((resolve, reject) => {
        db.all(`PRAGMA table_info(${table})`, (err, columns) => {
            if (err) return reject(err);
            resolve((columns || []).map(c => c.name));
        });
    });

    const zero = (table, columns) => new Promise((resolve, reject) => {
        const assignments = columns.map(c => `${c} = 0`).join(', ');
        const guard = columns.map(c => `${c} != 0`).join(' OR ');
        db.run(`UPDATE ${table} SET ${assignments} WHERE ${guard}`, function (err) {
            if (err) return reject(err);
            if (this.changes > 0) {
                console.log(`Reset ${columns.join(', ')} on ${this.changes} row(s) of ${table}`);
            }
            resolve();
        });
    });

    PRE_DECISION_COUNTER_RESETS.reduce(
        (chain, { table, columns }) => chain.then(async () => {
            const present = await columnsPresent(table);
            const target = columns.filter(c => present.includes(c));
            if (target.length > 0) await zero(table, target);
        }),
        Promise.resolve()
    ).then(() => done(null), (err) => done(err));
}

// Leaderboard sort indexes. rating_display is a computed expression so it cannot
// be indexed directly, but games_played/wins/first_place are the other sort keys,
// and the minGames filter reads games_played on every leaderboard request.
//
// Called after the stats tables are known to exist -- the schema check that
// creates them runs inside an async callback, so queueing these alongside the
// other DDL would race on a fresh database.
function createStatsIndexes() {
    for (const table of ['stats_short', 'stats_standard']) {
        db.run(`CREATE INDEX IF NOT EXISTS idx_${table}_games ON ${table}(games_played DESC)`, (err) => {
            if (err) console.error(`Error creating games index on ${table}:`, err.message);
        });
        db.run(`CREATE INDEX IF NOT EXISTS idx_${table}_wins ON ${table}(wins DESC)`, (err) => {
            if (err) console.error(`Error creating wins index on ${table}:`, err.message);
        });
        db.run(`CREATE INDEX IF NOT EXISTS idx_${table}_first_place ON ${table}(first_place DESC)`, (err) => {
            if (err) console.error(`Error creating first_place index on ${table}:`, err.message);
        });
    }
}

function createStatsTable() {
    // serialize so the CREATE INDEX statements queued at the end cannot run before
    // the tables they target exist -- we are inside a query callback here, where
    // node-sqlite3 is back in parallel mode.
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS stats (
            user_id INTEGER PRIMARY KEY,
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            points INTEGER DEFAULT 0,
            games_played INTEGER DEFAULT 0,
            rating_mu REAL DEFAULT 25.0,
            rating_sigma REAL DEFAULT 8.333,
            first_place INTEGER DEFAULT 0,
            second_place INTEGER DEFAULT 0,
            third_place INTEGER DEFAULT 0,
            fourth_place INTEGER DEFAULT 0,
            penalty_2x_rounds INTEGER DEFAULT 0,
            penalty_3x_rounds INTEGER DEFAULT 0,
            total_plays INTEGER DEFAULT 0,
            total_passes INTEGER DEFAULT 0,
            total_rounds INTEGER DEFAULT 0,
            leads_won INTEGER DEFAULT 0,
            lead_attempts INTEGER DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // Create mode-specific stats tables
        db.run(`CREATE TABLE IF NOT EXISTS stats_short (
            user_id INTEGER PRIMARY KEY,
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            points INTEGER DEFAULT 0,
            games_played INTEGER DEFAULT 0,
            rating_mu REAL DEFAULT 25.0,
            rating_sigma REAL DEFAULT 8.333,
            first_place INTEGER DEFAULT 0,
            second_place INTEGER DEFAULT 0,
            third_place INTEGER DEFAULT 0,
            fourth_place INTEGER DEFAULT 0,
            penalty_2x_rounds INTEGER DEFAULT 0,
            penalty_3x_rounds INTEGER DEFAULT 0,
            total_plays INTEGER DEFAULT 0,
            total_passes INTEGER DEFAULT 0,
            total_rounds INTEGER DEFAULT 0,
            leads_won INTEGER DEFAULT 0,
            lead_attempts INTEGER DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS stats_standard (
            user_id INTEGER PRIMARY KEY,
            wins INTEGER DEFAULT 0,
            losses INTEGER DEFAULT 0,
            points INTEGER DEFAULT 0,
            games_played INTEGER DEFAULT 0,
            rating_mu REAL DEFAULT 25.0,
            rating_sigma REAL DEFAULT 8.333,
            first_place INTEGER DEFAULT 0,
            second_place INTEGER DEFAULT 0,
            third_place INTEGER DEFAULT 0,
            fourth_place INTEGER DEFAULT 0,
            penalty_2x_rounds INTEGER DEFAULT 0,
            penalty_3x_rounds INTEGER DEFAULT 0,
            total_plays INTEGER DEFAULT 0,
            total_passes INTEGER DEFAULT 0,
            total_rounds INTEGER DEFAULT 0,
            leads_won INTEGER DEFAULT 0,
            lead_attempts INTEGER DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // Safe now: queued after the CREATE TABLE statements inside serialize().
        createStatsIndexes();
    });
}

function addAdvancedStatsColumns() {
    const tables = ['stats', 'stats_short', 'stats_standard'];
    const columns = [
        'first_place INTEGER DEFAULT 0',
        'second_place INTEGER DEFAULT 0',
        'third_place INTEGER DEFAULT 0',
        'fourth_place INTEGER DEFAULT 0',
        'penalty_2x_rounds INTEGER DEFAULT 0',
        'penalty_3x_rounds INTEGER DEFAULT 0',
        'total_plays INTEGER DEFAULT 0',
        'total_passes INTEGER DEFAULT 0',
        'total_rounds INTEGER DEFAULT 0',
        'leads_won INTEGER DEFAULT 0',
        'lead_attempts INTEGER DEFAULT 0'
    ];

    tables.forEach(table => {
        columns.forEach(col => {
            db.run(`ALTER TABLE ${table} ADD COLUMN ${col}`, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    console.error(`Error adding column to ${table}:`, err.message);
                }
            });
        });
    });
}

function migrateStatsTable() {
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        try {
            // 1. Rename old table
            db.run("ALTER TABLE stats RENAME TO stats_old");

            // 2. Create new table
            db.run(`CREATE TABLE stats (
                user_id INTEGER PRIMARY KEY,
                wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0,
                points INTEGER DEFAULT 0,
                games_played INTEGER DEFAULT 0,
                rating_mu REAL DEFAULT 25.0,
                rating_sigma REAL DEFAULT 8.333,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )`);

            // 3. Copy data
            db.run(`INSERT INTO stats (user_id, wins, losses, points, games_played)
                    SELECT user_id, wins, losses, points, games_played FROM stats_old`);

            // 4. Drop old table
            db.run("DROP TABLE stats_old");

            db.run("COMMIT");
            console.log("Migration complete.");
        } catch (e) {
            console.error("Migration failed, rolling back", e);
            db.run("ROLLBACK");
        }
    });
}

const createUser = async (username, password) => {
    const hash = await bcrypt.hash(password, 10);
    return new Promise((resolve, reject) => {
        db.run(`INSERT INTO users (username, password_hash) VALUES (?, ?)`, [username, hash], function(err) {
            if (err) return reject(err);
            const userId = this.lastID;

            // Initialize stats for all tables (legacy stats + mode-specific tables + preferences)
            db.serialize(() => {
                db.run(`INSERT INTO stats (user_id) VALUES (?)`, [userId], (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                });

                db.run(`INSERT INTO stats_standard (user_id) VALUES (?)`, [userId], (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                });

                db.run(`INSERT INTO stats_short (user_id) VALUES (?)`, [userId], (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                });

                db.run(`INSERT INTO user_preferences (user_id) VALUES (?)`, [userId], (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    // All inserts successful
                    resolve({ id: userId, username });
                });
            });
        });
    });
};

const verifyUser = async (username, password) => {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(null);
            const match = await bcrypt.compare(password, row.password_hash);
            if (match) resolve({ id: row.id, username: row.username });
            else resolve(null);
        });
    });
};

const getUserStats = (username) => {
    return new Promise((resolve, reject) => {
        db.get(`SELECT s.*, u.username FROM stats s JOIN users u ON u.id = s.user_id WHERE u.username = ?`, [username], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
};

const updateUserStats = (userId, isWin, pointsDelta, newMu = null, newSigma = null) => {
    return new Promise((resolve, reject) => {
        const winInc = isWin ? 1 : 0;
        const lossInc = isWin ? 0 : 1;

        // Build query dynamically based on whether rating is updated
        let query = `UPDATE stats SET
            wins = wins + ?,
            losses = losses + ?,
            points = points + ?,
            games_played = games_played + 1`;

        const params = [winInc, lossInc, pointsDelta];

        if (newMu !== null && newSigma !== null) {
            query += `, rating_mu = ?, rating_sigma = ?`;
            params.push(newMu, newSigma);
        }

        query += ` WHERE user_id = ?`;
        params.push(userId);

        db.run(query, params, (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
};

const updateUserStatsByName = (username, isWin, pointsDelta, newMu = null, newSigma = null) => {
    return new Promise((resolve, reject) => {
        db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, row) => {
            if (err) return reject(err);
            if (!row) return reject('User not found');
            updateUserStats(row.id, isWin, pointsDelta, newMu, newSigma).then(resolve).catch(reject);
        });
    });
};

// Helper function to get stats table name based on game mode
const getStatsTableName = (gameMode) => {
    // Default to 'standard' if invalid mode
    const validModes = ['short', 'standard'];
    const mode = validModes.includes(gameMode) ? gameMode : 'standard';
    return `stats_${mode}`;
};

// Get user stats for a specific game mode
const getUserStatsByMode = (username, gameMode) => {
    return new Promise((resolve, reject) => {
        const tableName = getStatsTableName(gameMode);
        const query = `SELECT s.*, u.username FROM ${tableName} s JOIN users u ON u.id = s.user_id WHERE u.username = ?`;
        db.get(query, [username], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
};

// Update user stats for a specific game mode
const updateUserStatsByMode = (username, gameMode, isWin, pointsDelta, newMu = null, newSigma = null) => {
    return new Promise((resolve, reject) => {
        db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, row) => {
            if (err) return reject(err);
            if (!row) return reject('User not found');

            const userId = row.id;
            const tableName = getStatsTableName(gameMode);
            const winInc = isWin ? 1 : 0;
            const lossInc = isWin ? 0 : 1;

            // First, ensure user has a stats row in this mode's table
            const initQuery = `INSERT OR IGNORE INTO ${tableName} (user_id) VALUES (?)`;
            db.run(initQuery, [userId], (err) => {
                if (err) return reject(err);

                // Build update query
                let query = `UPDATE ${tableName} SET
                    wins = wins + ?,
                    losses = losses + ?,
                    points = points + ?,
                    games_played = games_played + 1`;

                const params = [winInc, lossInc, pointsDelta];

                if (newMu !== null && newSigma !== null) {
                    query += `, rating_mu = ?, rating_sigma = ?`;
                    params.push(newMu, newSigma);
                }

                query += ` WHERE user_id = ?`;
                params.push(userId);

                db.run(query, params, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        });
    });
};

// Get user by username (returns id and username)
const getUserByUsername = (username) => {
    return new Promise((resolve, reject) => {
        db.get('SELECT id, username FROM users WHERE username = ?', [username], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

// Save round stats to database
const saveRoundStats = (gameId, userId, gameMode, roundData) => {
    return new Promise((resolve, reject) => {
        const query = `INSERT INTO round_stats (
            game_id, user_id, game_mode, round_number, placement,
            cards_remaining, penalty_multiplier, round_points, cumulative_score,
            plays_count, passes_count, leads_won, lead_attempts,
            singles_played, pairs_played, triples_played,
            straights_played, flushes_played, full_houses_played,
            quads_played, straight_flushes_played,
            deal_strength_raw, deal_tier, deal_rank,
            deal_baseline_version, human_opponents
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const params = [
            gameId, userId, gameMode, roundData.roundNumber, roundData.placement,
            roundData.cardsLeft, roundData.penaltyMultiplier, roundData.roundPoints,
            roundData.cumulativeScore, roundData.plays, roundData.passes,
            roundData.leadsWon || 0, roundData.leadAttempts || 0,
            roundData.handTypes.SINGLE || 0,
            roundData.handTypes.PAIR || 0,
            roundData.handTypes.TRIPLE || 0,
            roundData.handTypes.STRAIGHT || 0,
            roundData.handTypes.FLUSH || 0,
            roundData.handTypes.FULL_HOUSE || 0,
            roundData.handTypes.QUADS || 0,
            roundData.handTypes.STRAIGHT_FLUSH || 0,
            // Null rather than 0 when the deal was not scored: 0 is a real
            // (average) raw score, so coercing would fabricate data.
            roundData.dealStrength ? roundData.dealStrength.raw : null,
            roundData.dealStrength ? roundData.dealStrength.tier : null,
            roundData.dealStrength ? roundData.dealStrength.rank : null,
            roundData.dealStrength ? roundData.dealStrength.baselineVersion : null,
            roundData.dealStrength ? roundData.dealStrength.humanOpponents : null
        ];

        db.run(query, params, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

// Get aggregated round statistics for a user
const getRoundAggregates = (userId, gameMode) => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT
                COUNT(*) as total_rounds,
                AVG(placement) as avg_placement,
                SUM(CASE WHEN placement = 1 THEN 1 ELSE 0 END) as round_wins,
                SUM(CASE WHEN placement = 1 THEN 1 ELSE 0 END) as first_place,
                SUM(CASE WHEN placement = 2 THEN 1 ELSE 0 END) as second_place,
                SUM(CASE WHEN placement = 3 THEN 1 ELSE 0 END) as third_place,
                SUM(CASE WHEN placement = 4 THEN 1 ELSE 0 END) as fourth_place,
                SUM(plays_count) as total_plays,
                SUM(passes_count) as total_passes,
                SUM(leads_won) as leads_won,
                SUM(lead_attempts) as lead_attempts,
                -- Lead control has to be a ratio over the same rounds. Rounds
                -- predating tricks-contested have leads_won but no attempts,
                -- and pairing the two would report a success rate above 100%.
                SUM(CASE WHEN lead_attempts IS NOT NULL THEN leads_won ELSE 0 END) as tracked_leads_won,
                SUM(CASE WHEN lead_attempts IS NOT NULL THEN plays_count + passes_count ELSE 0 END) as tracked_actions,
                AVG(CAST(plays_count AS REAL) / NULLIF(plays_count + passes_count, 0)) as play_rate,
                SUM(CASE WHEN penalty_multiplier = 2 THEN 1 ELSE 0 END) as penalty_2x,
                SUM(CASE WHEN penalty_multiplier = 3 THEN 1 ELSE 0 END) as penalty_3x,
                SUM(CASE WHEN penalty_multiplier = 2 THEN 1 ELSE 0 END) as penalty_2x_rounds,
                SUM(CASE WHEN penalty_multiplier = 3 THEN 1 ELSE 0 END) as penalty_3x_rounds
            FROM round_stats
            WHERE user_id = ? AND game_mode = ?
        `;

        db.get(query, [userId, gameMode], (err, row) => {
            if (err) reject(err);
            else resolve(row || {});
        });
    });
};

// Get combination type statistics for a user
const getCombinationStats = (userId, gameMode) => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT
                SUM(singles_played) as singles,
                SUM(pairs_played) as pairs,
                SUM(triples_played) as triples,
                SUM(straights_played) as straights,
                SUM(flushes_played) as flushes,
                SUM(full_houses_played) as full_houses,
                SUM(quads_played) as quads,
                SUM(straight_flushes_played) as straight_flushes
            FROM round_stats
            WHERE user_id = ? AND game_mode = ?
        `;

        db.get(query, [userId, gameMode], (err, row) => {
            if (err) reject(err);
            else resolve(row || {});
        });
    });
};

// Get recent rounds for a user
const getRecentRounds = (userId, gameMode, limit) => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT *
            FROM round_stats
            WHERE user_id = ? AND game_mode = ?
            ORDER BY timestamp DESC
            LIMIT ?
        `;

        db.all(query, [userId, gameMode, limit], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
};

// Update aggregate stats at game end (placement, plays, passes)
const updateAggregateStats = (username, gameMode, placement, gameId) => {
    return new Promise((resolve, reject) => {
        getUserByUsername(username).then(user => {
            if (!user) return reject('User not found');

            const tableName = getStatsTableName(gameMode);

            // Get play/pass totals for this game from round_stats
            const statsQuery = `
                SELECT
                    SUM(plays_count) as total_plays,
                    SUM(passes_count) as total_passes,
                    COUNT(*) as total_rounds,
                    SUM(leads_won) as leads_won,
                    SUM(lead_attempts) as lead_attempts,
                    SUM(CASE WHEN penalty_multiplier = 2 THEN 1 ELSE 0 END) as penalty_2x,
                    SUM(CASE WHEN penalty_multiplier = 3 THEN 1 ELSE 0 END) as penalty_3x
                FROM round_stats
                WHERE user_id = ? AND game_id = ? AND game_mode = ?
            `;

            db.get(statsQuery, [user.id, gameId, gameMode], (err, gameStats) => {
                if (err) return reject(err);

                // Build placement column name
                const placementCol =
                    placement === 1 ? 'first_place' :
                    placement === 2 ? 'second_place' :
                    placement === 3 ? 'third_place' : 'fourth_place';

                // Build update query
                const updateQuery = `UPDATE ${tableName} SET
                    ${placementCol} = ${placementCol} + 1,
                    total_plays = total_plays + ?,
                    total_passes = total_passes + ?,
                    total_rounds = total_rounds + ?,
                    leads_won = leads_won + ?,
                    lead_attempts = lead_attempts + ?,
                    penalty_2x_rounds = penalty_2x_rounds + ?,
                    penalty_3x_rounds = penalty_3x_rounds + ?
                    WHERE user_id = ?`;

                const params = [
                    gameStats?.total_plays || 0,
                    gameStats?.total_passes || 0,
                    gameStats?.total_rounds || 0,
                    gameStats?.leads_won || 0,
                    // Tricks contested, recorded per round. This used to be
                    // total_plays, which made "Lead attempts" a duplicate of
                    // "Plays" and the success rate a share of every card played.
                    gameStats?.lead_attempts || 0,
                    gameStats?.penalty_2x || 0,
                    gameStats?.penalty_3x || 0,
                    user.id
                ];

                db.run(updateQuery, params, (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }).catch(reject);
    });
};

// Save or update head-to-head stats
const updateHeadToHeadStats = (playerId, opponentId, gameMode, playerPlacement, opponentPlacement) => {
    return new Promise((resolve, reject) => {
        const placementDiff = opponentPlacement - playerPlacement; // Positive = player did better
        const isWin = playerPlacement < opponentPlacement ? 1 : 0;
        const isLoss = playerPlacement > opponentPlacement ? 1 : 0;

        // Insert or update
        const query = `INSERT INTO head_to_head_stats (player_id, opponent_id, game_mode, wins, losses, games_played, total_placement_diff)
                       VALUES (?, ?, ?, ?, ?, 1, ?)
                       ON CONFLICT(player_id, opponent_id, game_mode) DO UPDATE SET
                           wins = wins + ?,
                           losses = losses + ?,
                           games_played = games_played + 1,
                           total_placement_diff = total_placement_diff + ?`;

        db.run(query, [playerId, opponentId, gameMode, isWin, isLoss, placementDiff, isWin, isLoss, placementDiff], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

// Get head-to-head stats for a player
const getHeadToHeadStats = (playerId, gameMode) => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT
                h2h.opponent_id,
                u.username as opponent_name,
                h2h.wins,
                h2h.losses,
                h2h.games_played,
                h2h.total_placement_diff,
                CAST(h2h.wins AS REAL) / h2h.games_played as win_rate
            FROM head_to_head_stats h2h
            JOIN users u ON u.id = h2h.opponent_id
            WHERE h2h.player_id = ? AND h2h.game_mode = ?
            ORDER BY h2h.games_played DESC
        `;

        db.all(query, [playerId, gameMode], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
};

// ========== TIER 3 ADVANCED ANALYTICS FUNCTIONS ==========

// Track individual decision for efficiency analysis
const trackDecision = (gameId, userId, roundNumber, turnNumber, action, handSize, cardsInDeck, pileStrength, handStrength, quality) => {
    return new Promise((resolve, reject) => {
        const query = `INSERT INTO decision_tracking
            (game_id, user_id, round_number, turn_number, action, hand_size, cards_remaining_in_deck, current_pile_strength, hand_strength, decision_quality)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        db.run(query, [gameId, userId, roundNumber, turnNumber, action, handSize, cardsInDeck, pileStrength, handStrength, quality], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

// Batched form of trackDecision. A single game can produce hundreds of decisions
// per player; inserting them one awaited statement at a time was the largest
// write source in the app. One multi-row INSERT collapses that into one
// statement (chunked to stay under SQLITE_MAX_VARIABLE_NUMBER).
const COLUMNS_PER_DECISION = 10;
const MAX_DECISIONS_PER_INSERT = 90; // 900 bound params, well under the 999 default

const trackDecisionsBatch = (gameId, userId, roundNumber, decisions) => {
    if (!decisions || decisions.length === 0) return Promise.resolve();

    const chunks = [];
    for (let i = 0; i < decisions.length; i += MAX_DECISIONS_PER_INSERT) {
        chunks.push(decisions.slice(i, i + MAX_DECISIONS_PER_INSERT));
    }

    const insertChunk = (chunk) => new Promise((resolve, reject) => {
        const placeholders = chunk
            .map(() => `(${new Array(COLUMNS_PER_DECISION).fill('?').join(', ')})`)
            .join(', ');

        const query = `INSERT INTO decision_tracking
            (game_id, user_id, round_number, turn_number, action, hand_size, cards_remaining_in_deck, current_pile_strength, hand_strength, decision_quality)
            VALUES ${placeholders}`;

        const params = [];
        for (const d of chunk) {
            params.push(
                gameId,
                userId,
                // Each decision carries the round it was taken in. Stamping
                // them all with the caller's round number filed every decision
                // in the game under the last round played.
                d.round || roundNumber,
                d.turn,
                d.action,
                d.handSize || 0,
                d.cardsInDeck || 0,
                d.pileStrength || 0,
                d.handStrength || 0,
                d.quality
            );
        }

        db.run(query, params, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });

    return chunks.reduce(
        (chain, chunk) => chain.then(() => insertChunk(chunk)),
        Promise.resolve()
    );
};

// Delete decision_tracking rows older than the retention window.
//
// decision_tracking is append-only detail behind the Tier 3 aggregates, at
// roughly 20-90 rows per player per game. Nothing reads it back today, so without
// a sweep it grows without bound on the Fly volume that also holds the live
// database. Aggregates (card_awareness_stats, variance_stats, behavioral_stats)
// are computed at game end and stored separately, so pruning the raw rows loses
// no stat the app currently shows.
//
// Resolves to the number of rows removed.
const DECISION_TRACKING_RETENTION_DAYS = 30;

const pruneDecisionTracking = (retentionDays = DECISION_TRACKING_RETENTION_DAYS) => {
    return new Promise((resolve, reject) => {
        const query = `DELETE FROM decision_tracking
                       WHERE timestamp < datetime('now', ?)`;

        db.run(query, [`-${retentionDays} days`], function (err) {
            if (err) return reject(err);
            resolve(this.changes || 0);
        });
    });
};

// Add one game's worth of decision counts to a player's card awareness totals.
//
// Takes a summary from DecisionAnalyzer.summarizeDecisions, i.e. actual counts
// of decisions. This used to take booleans and increment total_decisions by
// exactly 1 per game, so "total_decisions" was a count of games and
// "optimal_decisions" a count of games in which more than half the moves
// happened to be rated optimal.
//
// Late-game accuracy is stored as its two counts rather than as a running
// mean, so it stays a plain ratio of things that actually happened.
const updateCardAwarenessStats = (userId, gameMode, summary) => {
    return new Promise((resolve, reject) => {
        const total = summary?.total || 0;
        if (total === 0) return resolve();

        const optimal = summary.optimal || 0;
        const suboptimal = summary.suboptimal || 0;
        const riskySuccess = summary.riskySucceeded || 0;
        const riskyFail = summary.riskyFailed || 0;
        const lateTotal = summary.lateTotal || 0;
        const lateOptimal = summary.lateOptimal || 0;

        const query = `INSERT INTO card_awareness_stats
            (user_id, game_mode, total_decisions, optimal_decisions, suboptimal_decisions, risky_plays_successful, risky_plays_failed, late_game_decisions, late_game_optimal)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, game_mode) DO UPDATE SET
                total_decisions = total_decisions + ?,
                optimal_decisions = optimal_decisions + ?,
                suboptimal_decisions = suboptimal_decisions + ?,
                risky_plays_successful = risky_plays_successful + ?,
                risky_plays_failed = risky_plays_failed + ?,
                late_game_decisions = late_game_decisions + ?,
                late_game_optimal = late_game_optimal + ?`;

        db.run(query, [
            userId, gameMode, total, optimal, suboptimal, riskySuccess, riskyFail, lateTotal, lateOptimal,
            total, optimal, suboptimal, riskySuccess, riskyFail, lateTotal, lateOptimal
        ], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

// Get card awareness stats.
//
// late_game_accuracy is derived from the counts rather than read from the
// legacy column, and is null when the player has taken no late-game decisions
// - which is not the same as having scored zero on them.
const getCardAwarenessStats = (userId, gameMode) => {
    return new Promise((resolve, reject) => {
        const query = `SELECT * FROM card_awareness_stats WHERE user_id = ? AND game_mode = ?`;
        db.get(query, [userId, gameMode], (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(null);

            const lateDecisions = row.late_game_decisions || 0;
            resolve({
                ...row,
                late_game_accuracy: lateDecisions > 0
                    ? (row.late_game_optimal || 0) / lateDecisions
                    : null
            });
        });
    });
};

// Update variance and streak stats.
//
// lucky_wins / skilled_wins are no longer maintained. The luck-vs-skill
// question belongs to the deal-strength stats, which answer it per round
// against a measured baseline and with a confidence interval, rather than as a
// threshold applied to game wins only. The columns stay for old rows; nothing
// reads or writes them.
const updateVarianceStats = (userId, gameMode, isWin) => {
    return new Promise((resolve, reject) => {
        // First get current stats
        db.get(`SELECT * FROM variance_stats WHERE user_id = ? AND game_mode = ?`, [userId, gameMode], (err, row) => {
            if (err) {
                reject(err);
                return;
            }

            const currentStreak = row ? row.current_streak : 0;
            const longestWin = row ? row.longest_win_streak : 0;
            const longestLoss = row ? row.longest_loss_streak : 0;

            // Calculate new streak
            let newStreak;
            if (isWin) {
                newStreak = currentStreak >= 0 ? currentStreak + 1 : 1;
            } else {
                newStreak = currentStreak <= 0 ? currentStreak - 1 : -1;
            }

            const newLongestWin = isWin && newStreak > longestWin ? newStreak : longestWin;
            const newLongestLoss = !isWin && Math.abs(newStreak) > longestLoss ? Math.abs(newStreak) : longestLoss;

            const query = `INSERT INTO variance_stats
                (user_id, game_mode, current_streak, longest_win_streak, longest_loss_streak, total_sessions)
                VALUES (?, ?, ?, ?, ?, 1)
                ON CONFLICT(user_id, game_mode) DO UPDATE SET
                    current_streak = ?,
                    longest_win_streak = ?,
                    longest_loss_streak = ?,
                    total_sessions = total_sessions + 1`;

            db.run(query, [
                userId, gameMode, newStreak, newLongestWin, newLongestLoss,
                newStreak, newLongestWin, newLongestLoss
            ], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
};

// Get variance stats
const getVarianceStats = (userId, gameMode) => {
    return new Promise((resolve, reject) => {
        const query = `SELECT * FROM variance_stats WHERE user_id = ? AND game_mode = ?`;
        db.get(query, [userId, gameMode], (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
};

// Update behavioral classification with optional early/late game phase data.
//
// The stored scores are an exponential moving average, but the archetype used
// to be derived from the incoming raw scores instead - so the label could
// contradict the three meters shown directly beneath it. Blend first, then
// classify the blended values, so the label always describes the bars.
const updateBehavioralStats = (userId, gameMode, aggressionScore, riskScore, adaptabilityScore, earlyGameAggression = null, lateGameRisk = null) => {
    const SMOOTHING = 0.8; // weight kept on history

    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM behavioral_stats WHERE user_id = ? AND game_mode = ?`, [userId, gameMode], (err, row) => {
            if (err) return reject(err);

            const blend = (previous, incoming) => (
                row && previous !== null && previous !== undefined
                    ? previous * SMOOTHING + incoming * (1 - SMOOTHING)
                    : incoming
            );

            const aggression = blend(row?.aggression_score, aggressionScore);
            const risk = blend(row?.risk_score, riskScore);
            const adaptability = blend(row?.adaptability_score, adaptabilityScore);

            // Determine archetype from the values that will actually be stored
            let archetype = 'Balanced';
            if (aggression > 0.7 && risk > 0.6) {
                archetype = 'Aggressive';
            } else if (aggression < 0.4 && risk < 0.4) {
                archetype = 'Conservative';
            } else if (adaptability > 0.75) {
                archetype = 'Adaptive';
            }

            // Determine early/late game styles
            // Use phase-specific data if available, otherwise use overall scores
            const earlyAggressionScore = earlyGameAggression !== null ? earlyGameAggression : aggression;
            const lateRiskScore = lateGameRisk !== null ? lateGameRisk : risk;

            const earlyStyle = earlyAggressionScore > 0.6 ? 'Aggressive' : earlyAggressionScore < 0.4 ? 'Passive' : 'Neutral';
            const lateStyle = lateRiskScore > 0.6 ? 'Risky' : lateRiskScore < 0.4 ? 'Safe' : 'Neutral';

            const query = `INSERT INTO behavioral_stats
                (user_id, game_mode, aggression_score, risk_score, adaptability_score, player_archetype, early_game_style, late_game_style)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, game_mode) DO UPDATE SET
                    aggression_score = ?,
                    risk_score = ?,
                    adaptability_score = ?,
                    player_archetype = ?,
                    early_game_style = ?,
                    late_game_style = ?`;

            db.run(query, [
                userId, gameMode, aggression, risk, adaptability, archetype, earlyStyle, lateStyle,
                aggression, risk, adaptability, archetype, earlyStyle, lateStyle
            ], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
};

/**
 * One game's round_stats rolled up for a single player.
 *
 * Behavioural scores describe how someone played *this* game and are then
 * smoothed by updateBehavioralStats; feeding them lifetime totals (as the
 * game-end path used to) meant averaging an average, and the result could
 * never move.
 */
const getGameRoundSummary = (userId, gameId, gameMode) => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT
                COUNT(*) as rounds,
                COALESCE(SUM(plays_count), 0) as plays,
                COALESCE(SUM(passes_count), 0) as passes,
                COALESCE(SUM(leads_won), 0) as leads_won
            FROM round_stats
            WHERE user_id = ? AND game_id = ? AND game_mode = ?
        `;

        db.get(query, [userId, gameId, gameMode], (err, row) => {
            if (err) reject(err);
            else resolve(row || { rounds: 0, plays: 0, passes: 0, leads_won: 0 });
        });
    });
};

// Get behavioral stats
const getBehavioralStats = (userId, gameMode) => {
    return new Promise((resolve, reject) => {
        const query = `SELECT * FROM behavioral_stats WHERE user_id = ? AND game_mode = ?`;
        db.get(query, [userId, gameMode], (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
};

// Save placement history for adaptability tracking
const savePlacementHistory = (userId, gameMode, gameId, placement) => {
    return new Promise((resolve, reject) => {
        const query = `INSERT INTO placement_history (user_id, game_mode, game_id, placement)
            VALUES (?, ?, ?, ?)`;

        db.run(query, [userId, gameMode, gameId, placement], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

// Get recent placement history for adaptability calculation
const getPlacementHistory = (userId, gameMode, limit = 20) => {
    return new Promise((resolve, reject) => {
        const query = `SELECT placement FROM placement_history
            WHERE user_id = ? AND game_mode = ?
            ORDER BY timestamp DESC
            LIMIT ?`;

        db.all(query, [userId, gameMode, limit], (err, rows) => {
            if (err) reject(err);
            else resolve(rows ? rows.map(r => r.placement) : []);
        });
    });
};

// Calculate and update variance/consistency scores
const updateVarianceScores = async (userId, gameMode) => {
    try {
        const placements = await getPlacementHistory(userId, gameMode, 20);

        if (placements.length < 3) {
            // Not enough data yet
            return;
        }

        // Calculate variance score
        const avg = placements.reduce((a, b) => a + b, 0) / placements.length;
        const variance = placements.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / placements.length;
        const stdDev = Math.sqrt(variance);

        // Normalize variance score (0-1, lower is better)
        const varianceScore = Math.min(1, stdDev / 1.5);

        // Consistency rating (inverse of variance - higher is better)
        const consistencyRating = Math.max(0, 1 - varianceScore);

        // Update variance_stats table
        const query = `UPDATE variance_stats
            SET variance_score = ?, consistency_rating = ?
            WHERE user_id = ? AND game_mode = ?`;

        return new Promise((resolve, reject) => {
            db.run(query, [varianceScore, consistencyRating, userId, gameMode], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    } catch (err) {
        console.error('Error updating variance scores:', err);
        throw err;
    }
};

// ========== USER PREFERENCES FUNCTIONS ==========

// Get user preferences
const getUserPreferences = (userId) => {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM user_preferences WHERE user_id = ?`, [userId], (err, row) => {
            if (err) return reject(err);
            // If no preferences exist, return defaults
            if (!row) {
                return resolve({
                    user_id: userId,
                    four_color_mode: 0,
                    auto_pass: 0,
                    table_theme: 'felt',
                    accent_color: 'gold',
                    reduced_motion: 0,
                    sound_enabled: 1,
                    sound_volume: 0.6,
                    avatar_animal: null,
                    avatar_tile: null
                });
            }
            resolve(row);
        });
    });
};

// Update user preferences (creates if doesn't exist).
// Merges provided fields onto existing values so a partial POST doesn't wipe others.
const updateUserPreferences = async (userId, preferences) => {
    const existing = await getUserPreferences(userId);

    const pick = (incoming, fallback) => (incoming === undefined ? fallback : incoming);
    const toInt = (v) => (v ? 1 : 0);

    const fourColorValue = toInt(pick(preferences.fourColorMode, existing.four_color_mode));
    const autoPassValue = toInt(pick(preferences.autoPass, existing.auto_pass));
    const tableThemeValue = pick(preferences.tableTheme, existing.table_theme ?? 'felt');
    const accentColorValue = pick(preferences.accentColor, existing.accent_color ?? 'gold');
    const reducedMotionValue = toInt(pick(preferences.reducedMotion, existing.reduced_motion));
    // Sound defaults to ON, so fall back to 1 when the column is absent/null
    // rather than letting toInt() read the missing value as "off".
    const soundEnabledValue = toInt(pick(preferences.soundEnabled, existing.sound_enabled ?? 1));
    const rawVolume = Number(pick(preferences.soundVolume, existing.sound_volume ?? 0.6));
    const soundVolumeValue = Number.isFinite(rawVolume) ? Math.max(0, Math.min(1, rawVolume)) : 0.6;
    // Avatar stays NULL until the player picks one; callers validate the emoji
    // against the picker's set before it gets here.
    const avatarAnimalValue = pick(preferences.avatarAnimal, existing.avatar_animal ?? null) ?? null;
    const rawTile = pick(preferences.avatarTile, existing.avatar_tile);
    const avatarTileValue = Number.isInteger(rawTile) ? rawTile : null;

    return new Promise((resolve, reject) => {
        const query = `INSERT INTO user_preferences
                           (user_id, four_color_mode, auto_pass, table_theme, accent_color, reduced_motion, sound_enabled, sound_volume, avatar_animal, avatar_tile)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(user_id) DO UPDATE SET
                           four_color_mode = ?,
                           auto_pass = ?,
                           table_theme = ?,
                           accent_color = ?,
                           reduced_motion = ?,
                           sound_enabled = ?,
                           sound_volume = ?,
                           avatar_animal = ?,
                           avatar_tile = ?`;

        const values = [
            userId, fourColorValue, autoPassValue, tableThemeValue, accentColorValue, reducedMotionValue, soundEnabledValue, soundVolumeValue, avatarAnimalValue, avatarTileValue,
            fourColorValue, autoPassValue, tableThemeValue, accentColorValue, reducedMotionValue, soundEnabledValue, soundVolumeValue, avatarAnimalValue, avatarTileValue
        ];

        db.run(query, values, (err) => {
            if (err) return reject(err);
            resolve();
        });
    });
};

// Look up the chosen avatars for a set of usernames. Everyone at a table needs
// to render everyone else's avatar, and the only identifier a client has for
// another player is their name, so this is keyed on username rather than id.
// Names with no chosen avatar are simply absent from the result — clients fall
// back to the deterministic name-derived avatar for those (bots included).
const getAvatarsByUsernames = (usernames) => {
    const names = (usernames || []).filter(n => typeof n === 'string' && n.length > 0);
    if (names.length === 0) return Promise.resolve([]);

    const placeholders = names.map(() => '?').join(',');
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT u.username, p.avatar_animal, p.avatar_tile
             FROM users u
             JOIN user_preferences p ON p.user_id = u.id
             WHERE u.username IN (${placeholders})
               AND p.avatar_animal IS NOT NULL`,
            names,
            (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            }
        );
    });
};

// Get all Tier 3 stats for a user
const getTier3Stats = (userId, gameMode) => {
    return new Promise((resolve, reject) => {
        Promise.all([
            getCardAwarenessStats(userId, gameMode),
            getVarianceStats(userId, gameMode),
            getBehavioralStats(userId, gameMode)
        ]).then(([awareness, variance, behavioral]) => {
            resolve({
                cardAwareness: awareness,
                variance: variance,
                behavioral: behavioral
            });
        }).catch(reject);
    });
};

/**
 * Raw material for the deal-strength stats: how the player actually did from
 * each tier of starting hand, split by whether there were humans at the table.
 *
 * The split is not decoration. A round against three bots is a different test
 * from a round against three humans, and bot rounds are the bulk of play - so
 * they are reported alongside rather than folded together or thrown away.
 *
 * Rows predating the feature have NULL deal columns and are excluded outright;
 * they are unknown deals, not average ones.
 */
const getDealStrengthStats = (userId, gameMode) => {
    return new Promise((resolve, reject) => {
        const byTierQuery = `
            SELECT
                deal_tier,
                CASE WHEN human_opponents > 0 THEN 1 ELSE 0 END as vs_humans,
                COUNT(*) as rounds,
                SUM(CASE WHEN placement = 1 THEN 1 ELSE 0 END) as wins,
                AVG(round_points) as avg_points,
                AVG(deal_strength_raw) as avg_raw
            FROM round_stats
            WHERE user_id = ? AND game_mode = ? AND deal_tier IS NOT NULL
            GROUP BY deal_tier, vs_humans
        `;

        // Rank-based highlights. A "steal" is winning the round holding the
        // weakest deal at the table; a "squander" is finishing in the bottom
        // half holding the best one.
        const rankQuery = `
            SELECT
                CASE WHEN human_opponents > 0 THEN 1 ELSE 0 END as vs_humans,
                COUNT(*) as rounds,
                SUM(CASE WHEN deal_rank = 4 THEN 1 ELSE 0 END) as worst_deals,
                SUM(CASE WHEN deal_rank = 4 AND placement = 1 THEN 1 ELSE 0 END) as steals,
                SUM(CASE WHEN deal_rank = 1 THEN 1 ELSE 0 END) as best_deals,
                SUM(CASE WHEN deal_rank = 1 AND placement >= 3 THEN 1 ELSE 0 END) as squanders,
                AVG(deal_strength_raw) as avg_raw,
                AVG(deal_rank) as avg_rank
            FROM round_stats
            WHERE user_id = ? AND game_mode = ? AND deal_tier IS NOT NULL
            GROUP BY vs_humans
        `;

        const run = (query) => new Promise((res, rej) => {
            db.all(query, [userId, gameMode], (err, rows) => err ? rej(err) : res(rows || []));
        });

        Promise.all([run(byTierQuery), run(rankQuery)])
            .then(([byTier, byRank]) => resolve({ byTier, byRank }))
            .catch(reject);
    });
};

// ========== GAME HISTORY / ACTIVITY FEED FUNCTIONS ==========

// Create or update game history entry
const saveGameHistory = (gameData) => {
    return new Promise((resolve, reject) => {
        const {
            gameId,
            roomName,
            gameMode,
            isPublic,
            status,
            winnerId,
            winnerUsername,
            startTime,
            endTime,
            durationSeconds,
            totalRounds,
            maxPoints
        } = gameData;

        const query = `INSERT INTO game_history
            (game_id, room_name, game_mode, is_public, status, winner_id, winner_username,
             start_time, end_time, duration_seconds, total_rounds, max_points)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(game_id) DO UPDATE SET
                status = ?,
                winner_id = ?,
                winner_username = ?,
                end_time = ?,
                duration_seconds = ?,
                total_rounds = ?,
                max_points = ?`;

        db.run(query, [
            gameId, roomName, gameMode, isPublic ? 1 : 0, status, winnerId, winnerUsername,
            startTime, endTime, durationSeconds, totalRounds, maxPoints,
            status, winnerId, winnerUsername, endTime, durationSeconds, totalRounds, maxPoints
        ], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

// Save game participant
const saveGameParticipant = (participantData) => {
    return new Promise((resolve, reject) => {
        const {
            gameId,
            userId,
            username,
            isBot,
            finalPlacement,
            finalScore,
            roundsWon
        } = participantData;

        const query = `INSERT INTO game_participants
            (game_id, user_id, username, is_bot, final_placement, final_score, rounds_won)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(game_id, username) DO UPDATE SET
                final_placement = ?,
                final_score = ?,
                rounds_won = ?`;

        db.run(query, [
            gameId, userId, username, isBot ? 1 : 0, finalPlacement, finalScore, roundsWon,
            finalPlacement, finalScore, roundsWon
        ], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

// Save notable game event
const saveGameEvent = (gameId, eventType, eventData, roundNumber = null) => {
    return new Promise((resolve, reject) => {
        const query = `INSERT INTO game_events (game_id, event_type, event_data, round_number)
            VALUES (?, ?, ?, ?)`;

        db.run(query, [gameId, eventType, JSON.stringify(eventData), roundNumber], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

// Get activity feed games
const getActivityFeed = (options = {}) => {
    const {
        userId = null,
        includeStatus = ['completed'],
        gameMode = null,
        limit = 20,
        offset = 0
    } = options;

    return new Promise((resolve, reject) => {
        // Build WHERE clause
        let whereClauses = [];
        let params = [];

        // Filter by status
        if (includeStatus.length > 0) {
            const statusPlaceholders = includeStatus.map(() => '?').join(',');
            whereClauses.push(`status IN (${statusPlaceholders})`);
            params.push(...includeStatus);
        }

        // Filter by game mode
        if (gameMode) {
            whereClauses.push('game_mode = ?');
            params.push(gameMode);
        }

        // Restrict to games a specific user took part in.
        if (userId) {
            whereClauses.push(`game_id IN (SELECT game_id FROM game_participants WHERE user_id = ?)`);
            params.push(userId);
        }

        // Show ALL games for now (full transparency approach)
        // We can add privacy filters later based on user feedback
        // No filtering by is_public for now

        const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        // Select the page from game_history FIRST, then join participants onto just
        // those rows. Joining and grouping before the LIMIT forced SQLite to
        // aggregate every matching game on every request, so cost grew with total
        // history rather than page size; this way idx_game_history_status can drive
        // the ordering and only `limit` rows are ever aggregated.
        const query = `
            WITH page AS (
                SELECT *
                FROM game_history
                ${whereClause}
                ORDER BY end_time DESC, start_time DESC, game_id DESC
                LIMIT ? OFFSET ?
            )
            SELECT
                page.*,
                GROUP_CONCAT(
                    json_object(
                        'username', gp.username,
                        'isBot', gp.is_bot,
                        'placement', gp.final_placement,
                        'score', gp.final_score,
                        'roundsWon', gp.rounds_won
                    )
                ) as participants_json,
                (SELECT COUNT(*) FROM game_events ge WHERE ge.game_id = page.game_id) as event_count
            FROM page
            LEFT JOIN game_participants gp ON gp.game_id = page.game_id
            GROUP BY page.game_id
            ORDER BY page.end_time DESC, page.start_time DESC, page.game_id DESC
        `;

        params.push(limit, offset);

        db.all(query, params, (err, rows) => {
            if (err) return reject(err);

            // Parse participants JSON
            const games = (rows || []).map(row => {
                let participants = [];
                if (row.participants_json) {
                    try {
                        // The GROUP_CONCAT creates a comma-separated list of JSON objects
                        // We need to wrap it in an array and parse it
                        participants = JSON.parse(`[${row.participants_json}]`);
                    } catch (e) {
                        console.error('Failed to parse participants JSON:', e, row.participants_json);
                        participants = [];
                    }
                }

                return {
                    ...row,
                    participants,
                    participants_json: undefined
                };
            });

            resolve(games);
        });
    });
};

// Get game events for a specific game
const getGameEvents = (gameId) => {
    return new Promise((resolve, reject) => {
        const query = `SELECT * FROM game_events WHERE game_id = ? ORDER BY timestamp ASC`;

        db.all(query, [gameId], (err, rows) => {
            if (err) return reject(err);

            // Parse event_data JSON
            const events = (rows || []).map(row => ({
                ...row,
                event_data: row.event_data ? JSON.parse(row.event_data) : null
            }));

            resolve(events);
        });
    });
};

// Get total count for pagination
const getActivityFeedCount = (options = {}) => {
    const {
        userId = null,
        includeStatus = ['completed'],
        gameMode = null
    } = options;

    return new Promise((resolve, reject) => {
        let whereClauses = [];
        let params = [];

        if (includeStatus.length > 0) {
            const statusPlaceholders = includeStatus.map(() => '?').join(',');
            whereClauses.push(`status IN (${statusPlaceholders})`);
            params.push(...includeStatus);
        }

        if (gameMode) {
            whereClauses.push('game_mode = ?');
            params.push(gameMode);
        }

        // Must mirror getActivityFeed's filters or the pagination total disagrees
        // with the rows actually returned.
        if (userId) {
            whereClauses.push(`game_id IN (SELECT game_id FROM game_participants WHERE user_id = ?)`);
            params.push(userId);
        }

        // Show ALL games for now (full transparency approach)
        // No filtering by is_public for now

        const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const query = `SELECT COUNT(*) as count FROM game_history ${whereClause}`;

        db.get(query, params, (err, row) => {
            if (err) return reject(err);
            resolve(row ? row.count : 0);
        });
    });
};

// ========== LEADERBOARD FUNCTIONS ==========

// Get leaderboard data
const getLeaderboard = (options = {}) => {
    const {
        gameMode = 'standard',
        sortBy = 'rating',
        limit = 100,
        offset = 0,
        minGames = 0
    } = options;

    return new Promise((resolve, reject) => {
        const tableName = gameMode === 'short' ? 'stats_short' : 'stats_standard';

        // Build ORDER BY clause based on sortBy parameter
        let orderByClause;
        switch (sortBy) {
            case 'games':
                orderByClause = 'games_played DESC, rating_display DESC';
                break;
            case 'wins':
                orderByClause = 'wins DESC, rating_display DESC';
                break;
            case 'winRate':
                orderByClause = 'win_rate DESC, games_played DESC';
                break;
            case 'firstPlace':
                orderByClause = 'first_place DESC, rating_display DESC';
                break;
            case 'avgPlacement':
                orderByClause = 'avg_placement ASC, rating_display DESC';
                break;
            case 'rating':
            default:
                orderByClause = 'rating_display DESC, games_played DESC';
                break;
        }

        const query = `
            SELECT
                u.username,
                s.games_played,
                s.wins,
                s.losses,
                s.rating_mu,
                s.rating_sigma,
                (1200 + (s.rating_mu - 3 * s.rating_sigma) * 40) as rating_display,
                s.first_place,
                s.second_place,
                s.third_place,
                s.fourth_place,
                CASE WHEN s.games_played > 0
                    THEN CAST(s.wins AS REAL) / s.games_played
                    ELSE 0
                END as win_rate,
                -- Placement counters are incremented once per GAME, so the
                -- divisor has to be games too. Dividing by total_rounds (the
                -- sum of rounds across all games) made this read ~0.4 instead
                -- of ~2.5. Summing the counters rather than using games_played
                -- keeps numerator and denominator from the same writes.
                CASE WHEN (s.first_place + s.second_place + s.third_place + s.fourth_place) > 0
                    THEN (s.first_place * 1 + s.second_place * 2 + s.third_place * 3 + s.fourth_place * 4)
                         / CAST(s.first_place + s.second_place + s.third_place + s.fourth_place AS REAL)
                    ELSE 0
                END as avg_placement,
                s.leads_won,
                b.player_archetype as archetype
            FROM ${tableName} s
            INNER JOIN users u ON s.user_id = u.id
            LEFT JOIN behavioral_stats b ON b.user_id = s.user_id AND b.game_mode = ?
            WHERE s.games_played >= ?
            ORDER BY ${orderByClause}
            LIMIT ? OFFSET ?
        `;

        db.all(query, [gameMode, minGames, limit, offset], (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
};

// Get player's rank on leaderboard
const getPlayerRank = (username, gameMode = 'standard', sortBy = 'rating') => {
    return new Promise((resolve, reject) => {
        const tableName = gameMode === 'short' ? 'stats_short' : 'stats_standard';

        const RATING = '(1200 + (s.rating_mu - 3 * s.rating_sigma) * 40)';
        const WIN_RATE = 'CASE WHEN s.games_played > 0 THEN CAST(s.wins AS REAL) / s.games_played ELSE 0 END';
        // Must match getLeaderboard's expression exactly, or a player's rank
        // disagrees with the list they are ranked in. Games, not rounds -- see
        // the comment there.
        const AVG_PLACEMENT = 'CASE WHEN (s.first_place + s.second_place + s.third_place + s.fourth_place) > 0 THEN (s.first_place * 1 + s.second_place * 2 + s.third_place * 3 + s.fourth_place * 4) / CAST(s.first_place + s.second_place + s.third_place + s.fourth_place AS REAL) ELSE 0 END';

        // Primary metric plus its tiebreaker, matching the leaderboard's ORDER BY.
        // `betterCmp` is the comparison that means "ahead of me" for the primary
        // metric -- '>' for the DESC sorts, '<' for avg placement where lower wins.
        let primary, tiebreak, betterCmp;
        switch (sortBy) {
            case 'games':
                primary = 's.games_played'; tiebreak = RATING; betterCmp = '>';
                break;
            case 'wins':
                primary = 's.wins'; tiebreak = RATING; betterCmp = '>';
                break;
            case 'winRate':
                primary = WIN_RATE; tiebreak = 's.games_played'; betterCmp = '>';
                break;
            case 'firstPlace':
                primary = 's.first_place'; tiebreak = RATING; betterCmp = '>';
                break;
            case 'avgPlacement':
                primary = AVG_PLACEMENT; tiebreak = RATING; betterCmp = '<';
                break;
            case 'rating':
            default:
                primary = RATING; tiebreak = 's.games_played'; betterCmp = '>';
                break;
        }

        // Counting beats ranking: the previous version built a ROW_NUMBER window
        // over every player on the leaderboard and then threw away all but one row,
        // on every Stats and Leaderboard page load. Counting how many players are
        // strictly ahead gives the same rank without materialising the ordering.
        const query = `
            WITH me AS (
                SELECT ${primary} AS primary_metric, ${tiebreak} AS tiebreak_metric
                FROM ${tableName} s
                INNER JOIN users u ON s.user_id = u.id
                WHERE u.username = ?
            )
            SELECT COUNT(*) + 1 AS rank
            FROM ${tableName} s
            INNER JOIN users u ON s.user_id = u.id
            CROSS JOIN me
            WHERE ${primary} ${betterCmp} me.primary_metric
               OR (${primary} = me.primary_metric AND ${tiebreak} > me.tiebreak_metric)
        `;

        // The COUNT always returns a row, so the user's own presence has to be
        // checked separately -- otherwise an unknown username would report rank 1.
        const existsQuery = `
            SELECT 1 FROM ${tableName} s
            INNER JOIN users u ON s.user_id = u.id
            WHERE u.username = ?
        `;

        db.get(existsQuery, [username], (existsErr, existsRow) => {
            if (existsErr) return reject(existsErr);
            if (!existsRow) return resolve(null);

            db.get(query, [username], (err, row) => {
                if (err) return reject(err);
                resolve(row ? row.rank : null);
            });
        });
    });
};

// ========== GOOGLE OAUTH FUNCTIONS ==========

// Find user by Google ID
const getUserByGoogleId = (googleId) => {
    return new Promise((resolve, reject) => {
        db.get('SELECT id, username, google_id, google_email FROM users WHERE google_id = ?',
            [googleId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
};

// Create user with Google OAuth (no password)
const createGoogleUser = async (username, googleId, googleEmail) => {
    return new Promise((resolve, reject) => {
        db.run(`INSERT INTO users (username, google_id, google_email) VALUES (?, ?, ?)`,
            [username, googleId, googleEmail], function(err) {
            if (err) return reject(err);
            const userId = this.lastID;

            // Initialize stats tables (same as createUser)
            db.serialize(() => {
                db.run(`INSERT INTO stats (user_id) VALUES (?)`, [userId], (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                });

                db.run(`INSERT INTO stats_standard (user_id) VALUES (?)`, [userId], (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                });

                db.run(`INSERT INTO stats_short (user_id) VALUES (?)`, [userId], (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                });

                db.run(`INSERT INTO user_preferences (user_id) VALUES (?)`, [userId], (err) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    // All inserts successful
                    resolve({ id: userId, username, googleId, googleEmail });
                });
            });
        });
    });
};

// Link Google account to existing user
const linkGoogleAccount = (userId, googleId, googleEmail) => {
    return new Promise((resolve, reject) => {
        db.run(`UPDATE users SET google_id = ?, google_email = ? WHERE id = ?`,
            [googleId, googleEmail, userId], function(err) {
            if (err) reject(err);
            else resolve({ success: true });
        });
    });
};

// Check if username is available
const isUsernameAvailable = (username) => {
    return new Promise((resolve, reject) => {
        db.get('SELECT id FROM users WHERE username = ?', [username], (err, row) => {
            if (err) reject(err);
            else resolve(!row);
        });
    });
};

module.exports = {
    db,
    createUser,
    verifyUser,
    getUserStats,
    updateUserStats,
    updateUserStatsByName,
    getUserStatsByMode,
    updateUserStatsByMode,
    getUserByUsername,
    saveRoundStats,
    getRoundAggregates,
    getCombinationStats,
    getRecentRounds,
    updateAggregateStats,
    updateHeadToHeadStats,
    getHeadToHeadStats,
    // Tier 3 functions
    trackDecision,
    trackDecisionsBatch,
    pruneDecisionTracking,
    DECISION_TRACKING_RETENTION_DAYS,
    withTransaction,
    updateCardAwarenessStats,
    getCardAwarenessStats,
    updateVarianceStats,
    getVarianceStats,
    updateBehavioralStats,
    getBehavioralStats,
    getTier3Stats,
    getDealStrengthStats,
    getGameRoundSummary,
    savePlacementHistory,
    getPlacementHistory,
    updateVarianceScores,
    // User preferences
    getUserPreferences,
    updateUserPreferences,
    getAvatarsByUsernames,
    // Leaderboard
    getLeaderboard,
    getPlayerRank,
    // Activity Feed / Game History
    saveGameHistory,
    saveGameParticipant,
    saveGameEvent,
    getActivityFeed,
    getGameEvents,
    getActivityFeedCount,
    // Google OAuth
    getUserByGoogleId,
    createGoogleUser,
    linkGoogleAccount,
    isUsernameAvailable
};
