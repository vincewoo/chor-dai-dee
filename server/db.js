// server/db.js
const sqlite3 = require('sqlite3').verbose();
const { DecisionAnalyzer } = require('./game/DecisionAnalyzer');
const {
    defaultCalibration,
    normalizeCalibration
} = require('./game/AdaptiveBotController');
const {
    PUBLIC_RANKS,
    PLACEMENT_RANK_CAP,
    updatePublicRank,
    publicRankPayload
} = require('./game/PublicRank');
const {
    DEFAULT_MU,
    DEFAULT_SIGMA
} = require('./game/RatingSystem');
const bcrypt = require('bcrypt');
const path = require('path');

// Use /data directory in production (Docker volume mount), local directory otherwise.
// DATABASE_PATH overrides both, so a test can point this module at a scratch file
// instead of the developer's real database -- requiring db.js has always created
// and migrated whatever path it resolved, which is why nothing here had tests.
const isProduction = process.env.NODE_ENV === 'production';
const dbPath = process.env.DATABASE_PATH
    || (isProduction ? '/data/database.sqlite' : path.join(__dirname, 'database.sqlite'));

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

        // Skill estimate used only for selecting a complete Adaptive bot game.
        // Separate from shadow rating: calibration measures decision quality
        // to choose a challenge, while OpenSkill rates the completed result
        // against the frozen bots' independently modelled strength.
        db.run(`CREATE TABLE IF NOT EXISTS bot_calibration (
            user_id INTEGER PRIMARY KEY,
            skill_mu REAL NOT NULL,
            skill_sigma REAL NOT NULL,
            completed_games INTEGER NOT NULL DEFAULT 0,
            meaningful_decisions INTEGER NOT NULL DEFAULT 0,
            completed_rounds INTEGER NOT NULL DEFAULT 0,
            last_temperature REAL NOT NULL,
            calibration_complete INTEGER NOT NULL DEFAULT 0,
            controller_version INTEGER NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

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
            -- Fewest plays the dealt hand could have gone out in. Against
            -- plays_count on a round the player won, this is how much of the
            -- hand's shape survived contact.
            deal_plays_needed INTEGER,
            -- Control economy: aces and 2s dealt, how many were committed, and
            -- how many of those actually took the trick. Cards never played are
            -- dealt minus played.
            controls_dealt INTEGER,
            controls_played INTEGER,
            controls_won INTEGER,
            -- Fewest cards held at any point in the round. Reaching the endgame
            -- and not converting is a different failure from never reaching it.
            min_hand_size INTEGER,
            -- Position in the GAME after this round, by cumulative score.
            -- round_stats holds one player's own score and never the table's,
            -- so without this there is no way to ask who was ahead when.
            standing INTEGER,
            bot_difficulty TEXT,
            bot_temperature REAL,
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
            bot_difficulty TEXT,
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
            -- How the move ranked among the legal alternatives, and how much of
            -- the gap between the best and worst option it gave up (0-1).
            -- move_rank is NULL on a forced move, which is not graded.
            move_rank INTEGER,
            option_count INTEGER,
            loss_fraction REAL,
            forced INTEGER DEFAULT 0,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);

        // Migration for decision_tracking on existing databases
        db.all("PRAGMA table_info(decision_tracking)", (err, columns) => {
            if (err) {
                console.error("Error checking decision_tracking schema", err);
                return;
            }
            if (columns.length > 0) {
                const addColumn = (name, ddl) => {
                    if (!columns.some(c => c.name === name)) {
                        db.run(`ALTER TABLE decision_tracking ADD COLUMN ${ddl}`, (err) => {
                            if (err && !err.message.includes('duplicate column')) {
                                console.error(`Error adding ${name} to decision_tracking:`, err.message);
                            }
                        });
                    }
                };
                addColumn('move_rank', 'move_rank INTEGER');
                addColumn('option_count', 'option_count INTEGER');
                addColumn('loss_fraction', 'loss_fraction REAL');
                addColumn('forced', 'forced INTEGER DEFAULT 0');
            }
        });

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
            -- Moves with no alternative, tracked apart from graded decisions so
            -- they cannot pad an accuracy figure.
            forced_decisions INTEGER DEFAULT 0,
            -- Summed normalized loss across graded decisions. Accuracy is
            -- 1 - total_loss / total_decisions.
            total_loss REAL DEFAULT 0.0,
            -- Passes with nothing that beats the pile vs passes with a legal
            -- answer in hand. The split is what separates bad cards from a
            -- patient style.
            forced_passes INTEGER DEFAULT 0,
            voluntary_passes INTEGER DEFAULT 0,
            -- Decisions taken with an opponent two cards or fewer from going
            -- out, and how many contested the trick instead of conceding it.
            danger_decisions INTEGER DEFAULT 0,
            danger_contested INTEGER DEFAULT 0,
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
                addColumn('forced_decisions', 'forced_decisions INTEGER DEFAULT 0');
                addColumn('total_loss', 'total_loss REAL DEFAULT 0.0');
                addColumn('forced_passes', 'forced_passes INTEGER DEFAULT 0');
                addColumn('voluntary_passes', 'voluntary_passes INTEGER DEFAULT 0');
                addColumn('danger_decisions', 'danger_decisions INTEGER DEFAULT 0');
                addColumn('danger_contested', 'danger_contested INTEGER DEFAULT 0');
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

        // Every rename this account has been through. `renameUser` rewrites the
        // two denormalized username columns so history reads under the new name,
        // which means the old name leaves no trace anywhere else -- and once it
        // is free, somebody else can register it. This is the record that says
        // which account a retired name used to belong to.
        db.run(`CREATE TABLE IF NOT EXISTS username_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            old_username TEXT NOT NULL,
            new_username TEXT NOT NULL,
            changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_username_history_user
                ON username_history(user_id)`);

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
                // Display-only Pusoy Dos suit lens; never affects card values.
                addColumn('pusoy_mode', 'pusoy_mode INTEGER DEFAULT 0');
                // The owl coach: hint-on-request plus a note on your own
                // mistakes. Off by default - it is an assist, and an unasked-for
                // one would change how the table plays for everyone already
                // using it.
                addColumn('coach_enabled', 'coach_enabled INTEGER DEFAULT 0');
                // Avatar chosen in the Avatar Picker. NULL means "never chose
                // one", which is what tells clients to fall back to the
                // deterministic name-derived avatar.
                // The host's remembered bot-difficulty choice. Only ever
                // pre-fills a new room; the room's own value is authoritative
                // once set, since bots are shared by the whole table.
                addColumn('bot_difficulty', "bot_difficulty TEXT DEFAULT 'adaptive'");
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
                // NULL on older rows for the same reason as the deal columns:
                // these were not measured, which is not the same as zero.
                addColumn('deal_plays_needed', 'deal_plays_needed INTEGER');
                addColumn('controls_dealt', 'controls_dealt INTEGER');
                addColumn('controls_played', 'controls_played INTEGER');
                addColumn('controls_won', 'controls_won INTEGER');
                addColumn('min_hand_size', 'min_hand_size INTEGER');
                addColumn('standing', 'standing INTEGER');
                // How hard this round's bots were trying. NULL on rows written
                // before difficulty tiers existed, which reads as full strength
                // - the only thing that existed then. The "vs bots" deal
                // strength scope splits on it so that farming casual bots does
                // not read as beating the real thing.
                addColumn('bot_difficulty', 'bot_difficulty TEXT');
                addColumn('bot_temperature', 'bot_temperature REAL');
            }
        });

        // Migrations for game_history on existing databases.
        //
        // Which policy the room's bots ran for this game, snapshotted from
        // `room.botPolicy.difficulty` -- the same value round_stats records per
        // round, and named identically so the two read as one vocabulary. The
        // activity feed derives its "Max bots" badge from it.
        //
        // NULL means unknown and is deliberately never backfilled. Rows written
        // before difficulty tiers existed were all full-strength argmax, so
        // reconstructing them from round_stats would mark almost the entire
        // archive as max-difficulty and make the badge meaningless. Unknown is
        // the honest label, and the badge simply does not appear.
        //
        // Nothing continuous belongs in this table: getActivityFeed selects
        // `page.*`, so every column here is shipped to every client. The
        // Adaptive temperature is hidden state (docs/BOT-DIFFICULTY.md) and
        // putting it here would publish it by accident.
        // Issued unconditionally from the serialize() body rather than from a
        // PRAGMA table_info callback, which is how the four blocks above do it.
        // Deliberate, and the difference matters here: a callback-scheduled
        // ALTER lands at the *back* of sqlite3's queue, after whatever the
        // server has already started accepting -- and server.listen() does not
        // wait for initDb() to drain. Every other migrated column degrades to a
        // missing value if it loses that race; this one is named unconditionally
        // by saveGameHistory's INSERT, so losing it throws and takes the
        // surrounding transaction's game_participants rows down with it. Queued
        // inline, it is ordered against the CREATE TABLE above and against every
        // later write by serialize() itself.
        //
        // On a fresh database the CREATE TABLE already declares the column, so
        // this is expected to fail with "duplicate column name" and that error
        // alone is swallowed.
        db.run(`ALTER TABLE game_history ADD COLUMN bot_difficulty TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column')) {
                console.error('Error adding bot_difficulty to game_history:', err.message);
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
                ensurePublicRankColumns();
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
const RESET_INCOMPLETE_RANKS = 'reset_incomplete_rank_placements_v1';

// Public ranks used to be backfilled from shadow ratings earned against older,
// materially weaker bots. Preserve players who completed Adaptive placement,
// but cap that initial result at Platinum. Everyone else becomes Unranked with a
// neutral shadow-rating seed and a fresh placement calibration.
function resetIncompletePlacementRanks(done) {
    const tables = ['stats', 'stats_short', 'stats_standard'];
    const calibrationDefaults = defaultCalibration();
    const run = (sql) => new Promise((resolve, reject) => {
        db.run(sql, (err) => err ? reject(err) : resolve());
    });

    tables.reduce((chain, table) => chain
        .then(() => run(
            `UPDATE ${table}
             SET rating_mu = ${DEFAULT_MU},
                 rating_sigma = ${DEFAULT_SIGMA},
                 public_rank = 0,
                 promotion_progress = 0,
                 demotion_progress = 0,
                 rank_placement_complete = 0
             WHERE NOT EXISTS (
                 SELECT 1
                 FROM bot_calibration calibration
                 WHERE calibration.user_id = ${table}.user_id
                   AND calibration.calibration_complete = 1
             )`
        ))
        .then(() => run(
            `UPDATE ${table}
             SET public_rank = MIN(public_rank, ${PLACEMENT_RANK_CAP}),
                 promotion_progress = 0,
                 demotion_progress = 0,
                 rank_placement_complete = 1
             WHERE EXISTS (
                 SELECT 1
                 FROM bot_calibration calibration
                 WHERE calibration.user_id = ${table}.user_id
                   AND calibration.calibration_complete = 1
             )`
        )),
    Promise.resolve())
        .then(() => run(
            `UPDATE bot_calibration
             SET skill_mu = ${calibrationDefaults.skillMu},
                 skill_sigma = ${calibrationDefaults.skillSigma},
                 completed_games = 0,
                 meaningful_decisions = 0,
                 completed_rounds = 0,
                 last_temperature = ${calibrationDefaults.lastTemperature},
                 calibration_complete = 0,
                 controller_version = ${calibrationDefaults.controllerVersion},
                 updated_at = CURRENT_TIMESTAMP
             WHERE calibration_complete = 0`
        ))
        .then(() => done(null), done);
}

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
            public_rank INTEGER NOT NULL DEFAULT 0,
            promotion_progress INTEGER NOT NULL DEFAULT 0,
            demotion_progress INTEGER NOT NULL DEFAULT 0,
            rank_placement_complete INTEGER NOT NULL DEFAULT 0,
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
            public_rank INTEGER NOT NULL DEFAULT 0,
            promotion_progress INTEGER NOT NULL DEFAULT 0,
            demotion_progress INTEGER NOT NULL DEFAULT 0,
            rank_placement_complete INTEGER NOT NULL DEFAULT 0,
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
            public_rank INTEGER NOT NULL DEFAULT 0,
            promotion_progress INTEGER NOT NULL DEFAULT 0,
            demotion_progress INTEGER NOT NULL DEFAULT 0,
            rank_placement_complete INTEGER NOT NULL DEFAULT 0,
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
        // A fresh schema has nothing historical to reset, but recording the
        // migration now prevents a later restart from capping ranks that were
        // legitimately earned during this database's first lifetime.
        db.run('SELECT 1', (err) => {
            if (!err) {
                runOnce(
                    RESET_INCOMPLETE_RANKS,
                    done => done(null)
                );
            }
        });
    });
}

// Add the coarse public-rank state without replacing the existing OpenSkill
// columns. Existing continuous values become the initial visible rank once;
// after that, promotion/demotion series own the public value.
function ensurePublicRankColumns() {
    const ranked = [...PUBLIC_RANKS]
        .map((rank, index) => ({ ...rank, index }))
        .filter(rank => Number.isFinite(rank.entryScore))
        .sort((left, right) => right.entryScore - left.entryScore);
    const initialRankCase = ranked.reduce(
        (sql, rank) =>
            `${sql} WHEN (1200 + (rating_mu - 3 * rating_sigma) * 40) ` +
            `>= ${rank.entryScore} THEN ${rank.index}`,
        'CASE'
    ) + ' ELSE 0 END';

    const tables = ['stats', 'stats_short', 'stats_standard'];
    let remainingTables = tables.length;
    const tableComplete = () => {
        remainingTables--;
        if (remainingTables === 0) {
            runOnce(
                RESET_INCOMPLETE_RANKS,
                resetIncompletePlacementRanks
            );
        }
    };

    for (const table of tables) {
        db.all(`PRAGMA table_info(${table})`, (err, columns) => {
            if (err || columns.length === 0) {
                if (err) {
                    console.error(
                        `Error checking public rank columns on ${table}:`,
                        err.message);
                }
                tableComplete();
                return;
            }

            const names = new Set(columns.map(column => column.name));
            const additions = [
                ['public_rank',
                    'public_rank INTEGER NOT NULL DEFAULT 0'],
                ['promotion_progress',
                    'promotion_progress INTEGER NOT NULL DEFAULT 0'],
                ['demotion_progress',
                    'demotion_progress INTEGER NOT NULL DEFAULT 0'],
                ['rank_placement_complete',
                    'rank_placement_complete INTEGER NOT NULL DEFAULT 0']
            ].filter(([name]) => !names.has(name));

            const runNext = (index = 0) => {
                if (index >= additions.length) {
                    tableComplete();
                    return;
                }
                const [name, definition] = additions[index];
                db.run(
                    `ALTER TABLE ${table} ADD COLUMN ${definition}`,
                    (addErr) => {
                        if (addErr &&
                            !addErr.message.includes('duplicate column')) {
                            console.error(
                                `Error adding ${name} to ${table}:`,
                                addErr.message);
                            return runNext(index + 1);
                        }
                        if (name === 'public_rank') {
                            db.run(
                                `UPDATE ${table}
                                 SET public_rank = ${initialRankCase}`,
                                (updateErr) => {
                                    if (updateErr) {
                                        console.error(
                                            `Error initializing ranks on ${table}:`,
                                            updateErr.message);
                                    }
                                    runNext(index + 1);
                                }
                            );
                        } else {
                            runNext(index + 1);
                        }
                    }
                );
            };
            runNext();
        });
    }
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
                public_rank INTEGER NOT NULL DEFAULT 0,
                promotion_progress INTEGER NOT NULL DEFAULT 0,
                demotion_progress INTEGER NOT NULL DEFAULT 0,
                rank_placement_complete INTEGER NOT NULL DEFAULT 0,
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

                db.run(
                    `INSERT INTO user_preferences (user_id, bot_difficulty)
                     VALUES (?, 'adaptive')`,
                    [userId], (err) => {
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
            // A Google-created account has no password_hash, and bcrypt.compare
            // rejects on a null hash. That rejection used to escape this async
            // callback without settling the promise, so /api/login simply hung
            // for anyone who typed a Google user's name. No password on the row
            // means password login is not available for it -- that is a failed
            // login, not an error.
            if (!row.password_hash) return resolve(null);
            try {
                const match = await bcrypt.compare(password, row.password_hash);
                resolve(match ? { id: row.id, username: row.username } : null);
            } catch (compareErr) {
                reject(compareErr);
            }
        });
    });
};

// Same check keyed on the account id, for callers that already know who they
// are and are proving it (the profile page) rather than looking themselves up.
const verifyUserById = async (userId, password) => {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM users WHERE id = ?`, [userId], async (err, row) => {
            if (err) return reject(err);
            if (!row || !row.password_hash) return resolve(null);
            try {
                const match = await bcrypt.compare(password, row.password_hash);
                resolve(match ? { id: row.id, username: row.username } : null);
            } catch (compareErr) {
                reject(compareErr);
            }
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
const updateUserStatsByMode = (
    username,
    gameMode,
    isWin,
    pointsDelta,
    newMu = null,
    newSigma = null,
    placement = null
) => {
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

                db.get(
                    `SELECT stats.rating_mu, stats.rating_sigma,
                            stats.public_rank, stats.promotion_progress,
                            stats.demotion_progress,
                            stats.rank_placement_complete,
                            COALESCE(calibration.calibration_complete, 0)
                                AS placement_matches_complete
                     FROM ${tableName} stats
                     LEFT JOIN bot_calibration calibration
                       ON calibration.user_id = stats.user_id
                     WHERE stats.user_id = ?`,
                    [userId],
                    (stateErr, current) => {
                        if (stateErr) return reject(stateErr);

                        // Build update query. The continuous values are shadow
                        // state; only the coarse rank computed here is public.
                        let query = `UPDATE ${tableName} SET
                            wins = wins + ?,
                            losses = losses + ?,
                            points = points + ?,
                            games_played = games_played + 1`;
                        const params = [winInc, lossInc, pointsDelta];
                        let rankState = null;

                        if (newMu !== null && newSigma !== null) {
                            rankState = updatePublicRank(current, {
                                mu: newMu,
                                sigma: newSigma,
                                placement,
                                placementMatchesComplete: Boolean(
                                    current.placement_matches_complete)
                            });
                            query += `, rating_mu = ?, rating_sigma = ?,
                                public_rank = ?,
                                promotion_progress = ?,
                                demotion_progress = ?,
                                rank_placement_complete = ?`;
                            params.push(
                                newMu,
                                newSigma,
                                rankState.publicRank,
                                rankState.promotionProgress,
                                rankState.demotionProgress,
                                rankState.rankPlacementComplete ? 1 : 0
                            );
                        }

                        query += ` WHERE user_id = ?`;
                        params.push(userId);

                        db.run(query, params, (updateErr) => {
                            if (updateErr) return reject(updateErr);
                            resolve(rankState);
                        });
                    }
                );
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
            deal_baseline_version, human_opponents,
            deal_plays_needed, controls_dealt, controls_played, controls_won,
            min_hand_size, standing, bot_difficulty, bot_temperature
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
            roundData.dealStrength ? roundData.dealStrength.humanOpponents : null,
            // Tied to the deal being scored: without it there is no baseline to
            // compare the plays used against, and no dealt control count.
            roundData.dealStrength ? roundData.dealStrength.playsNeeded : null,
            roundData.dealStrength ? roundData.dealStrength.controls : null,
            roundData.dealStrength ? (roundData.controlsPlayed || 0) : null,
            roundData.dealStrength ? (roundData.controlsWon || 0) : null,
            roundData.minHandSize ?? null,
            roundData.standing ?? null,
            roundData.dealStrength
                ? (roundData.dealStrength.botDifficulty ?? null)
                : null,
            roundData.dealStrength
                ? (roundData.dealStrength.botTemperature ?? null)
                : null
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
                SUM(CASE WHEN penalty_multiplier = 3 THEN 1 ELSE 0 END) as penalty_3x_rounds,
                -- Shedding efficiency, over won rounds only: a round you did
                -- not finish says nothing about how many plays the hand needed,
                -- because you never got to the end of it.
                SUM(CASE WHEN deal_plays_needed IS NOT NULL AND placement = 1 THEN deal_plays_needed END) as won_min_plays,
                SUM(CASE WHEN deal_plays_needed IS NOT NULL AND placement = 1 THEN plays_count END) as won_plays,
                SUM(CASE WHEN deal_plays_needed IS NOT NULL AND placement = 1 THEN 1 ELSE 0 END) as shed_rounds,
                -- Control economy. Cards never played are dealt minus played.
                SUM(controls_dealt) as controls_dealt,
                SUM(controls_played) as controls_played,
                SUM(controls_won) as controls_won,
                SUM(CASE WHEN controls_dealt IS NOT NULL THEN 1 ELSE 0 END) as control_rounds,
                -- Endgame conversion: rounds where the player got within three
                -- cards of going out, and how many of those they finished.
                SUM(CASE WHEN min_hand_size IS NOT NULL AND min_hand_size <= 3 THEN 1 ELSE 0 END) as endgame_rounds,
                SUM(CASE WHEN min_hand_size IS NOT NULL AND min_hand_size <= 3 AND placement = 1 THEN 1 ELSE 0 END) as endgame_wins
            FROM round_stats
            WHERE user_id = ? AND game_mode = ?
        `;

        db.get(query, [userId, gameMode], (err, row) => {
            if (err) reject(err);
            else resolve(row || {});
        });
    });
};

/**
 * Comebacks and collapses: how a player's position at the halfway point of a
 * game relates to where they finished.
 *
 * The midpoint standing comes from round_stats, the final placement from
 * game_participants. Abandoned games are excluded on final_placement IS NOT
 * NULL: they now carry participant rows too (scores at the moment the game
 * died), but no placements, because an unfinished game has no standings. This
 * used to fall out on its own because nothing wrote participants for abandoned
 * games at all - relying on that again would count every walkout as a game the
 * player led at halfway and then failed to convert.
 *
 * Games shorter than three rounds are excluded: with one or two rounds the
 * "midpoint" is the finish, and every game would score as a held lead.
 */
const getComebackStats = (userId, gameMode) => {
    return new Promise((resolve, reject) => {
        const query = `
            WITH game_rounds AS (
                SELECT game_id, MAX(round_number) AS last_round
                FROM round_stats
                WHERE user_id = ? AND game_mode = ? AND standing IS NOT NULL
                GROUP BY game_id
                HAVING MAX(round_number) >= 3
            ),
            midpoint AS (
                SELECT rs.game_id, rs.standing
                FROM round_stats rs
                JOIN game_rounds gr ON gr.game_id = rs.game_id
                WHERE rs.user_id = ? AND rs.game_mode = ?
                  AND rs.round_number = (gr.last_round + 1) / 2
            )
            SELECT
                COUNT(*) AS games,
                SUM(CASE WHEN m.standing >= 3 THEN 1 ELSE 0 END) AS behind_at_half,
                SUM(CASE WHEN m.standing >= 3 AND gp.final_placement = 1 THEN 1 ELSE 0 END) AS comebacks,
                SUM(CASE WHEN m.standing = 1 THEN 1 ELSE 0 END) AS led_at_half,
                SUM(CASE WHEN m.standing = 1 AND gp.final_placement >= 3 THEN 1 ELSE 0 END) AS collapses
            FROM midpoint m
            JOIN game_participants gp
              ON gp.game_id = m.game_id AND gp.user_id = ? AND gp.final_placement IS NOT NULL
        `;

        db.get(query, [userId, gameMode, userId, gameMode, userId], (err, row) => {
            if (err) reject(err);
            else resolve(row || { games: 0, behind_at_half: 0, comebacks: 0, led_at_half: 0, collapses: 0 });
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
const COLUMNS_PER_DECISION = 14;
const MAX_DECISIONS_PER_INSERT = 70; // 980 bound params, just under the 999 default

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
            (game_id, user_id, round_number, turn_number, action, hand_size, cards_remaining_in_deck, current_pile_strength, hand_strength, decision_quality, move_rank, option_count, loss_fraction, forced)
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
                d.quality,
                // Null rather than 0 on a forced move: it has no rank among
                // alternatives because there were none.
                d.rank ?? null,
                d.optionCount ?? null,
                d.lossFraction ?? null,
                d.forced ? 1 : 0
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
        // A game of nothing but forced moves still happened, and the forced
        // count is the denominator that makes accuracy honest.
        if (total === 0 && !(summary?.forced)) return resolve();

        const optimal = summary.optimal || 0;
        const suboptimal = summary.suboptimal || 0;
        const riskySuccess = summary.riskySucceeded || 0;
        const riskyFail = summary.riskyFailed || 0;
        const lateTotal = summary.lateTotal || 0;
        const lateOptimal = summary.lateOptimal || 0;
        const forced = summary.forced || 0;
        const loss = summary.totalLoss || 0;
        const forcedPasses = summary.forcedPasses || 0;
        const voluntaryPasses = summary.voluntaryPasses || 0;
        const dangerDecisions = summary.dangerDecisions || 0;
        const dangerContested = summary.dangerContested || 0;

        const values = [total, optimal, suboptimal, riskySuccess, riskyFail, lateTotal, lateOptimal,
            forced, loss, forcedPasses, voluntaryPasses, dangerDecisions, dangerContested];

        const query = `INSERT INTO card_awareness_stats
            (user_id, game_mode, total_decisions, optimal_decisions, suboptimal_decisions, risky_plays_successful, risky_plays_failed, late_game_decisions, late_game_optimal, forced_decisions, total_loss, forced_passes, voluntary_passes, danger_decisions, danger_contested)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, game_mode) DO UPDATE SET
                total_decisions = total_decisions + ?,
                optimal_decisions = optimal_decisions + ?,
                suboptimal_decisions = suboptimal_decisions + ?,
                risky_plays_successful = risky_plays_successful + ?,
                risky_plays_failed = risky_plays_failed + ?,
                late_game_decisions = late_game_decisions + ?,
                late_game_optimal = late_game_optimal + ?,
                forced_decisions = forced_decisions + ?,
                total_loss = total_loss + ?,
                forced_passes = forced_passes + ?,
                voluntary_passes = voluntary_passes + ?,
                danger_decisions = danger_decisions + ?,
                danger_contested = danger_contested + ?`;

        db.run(query, [userId, gameMode, ...values, ...values], (err) => {
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
            const graded = row.total_decisions || 0;
            resolve({
                ...row,
                late_game_accuracy: lateDecisions > 0
                    ? (row.late_game_optimal || 0) / lateDecisions
                    : null,
                // How close to the best available move the player stays, on
                // average. 1 means always the top-scored option; 0 means
                // always the worst one on the table.
                accuracy: graded > 0
                    ? Math.max(0, 1 - (row.total_loss || 0) / graded)
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

// Update behavioral classification.
//
// The stored scores are an exponential moving average, but the archetype used
// to be derived from the incoming raw scores instead - so the label could
// contradict the meters shown directly beneath it. Blend first, then classify
// the blended values, so the label always describes the bars.
//
// early_game_style / late_game_style are no longer written. The late one could
// not vary: late in a round players play whatever they legally can, so its
// input sat at a median of 1.000 and the tile read the same for everyone. The
// early one is now the aggression axis itself, so a separate label restated it.
const updateBehavioralStats = (userId, gameMode, aggressionScore, riskScore, formScore) => {
    const SMOOTHING = 0.8; // weight kept on history

    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM behavioral_stats WHERE user_id = ? AND game_mode = ?`, [userId, gameMode], (err, row) => {
            if (err) return reject(err);

            const blend = (previous, incoming) => {
                // A NaN that reached the column would otherwise survive every
                // future blend, since NaN * 0.8 + x * 0.2 is NaN.
                const usable = Number.isFinite(previous);
                const value = Number.isFinite(incoming) ? incoming : 0.5;
                return row && usable ? previous * SMOOTHING + value * (1 - SMOOTHING) : value;
            };

            const aggression = blend(row?.aggression_score, aggressionScore);
            const risk = blend(row?.risk_score, riskScore);
            const form = blend(row?.adaptability_score, formScore);

            const archetype = DecisionAnalyzer.classifyArchetype(aggression, risk);

            const query = `INSERT INTO behavioral_stats
                (user_id, game_mode, aggression_score, risk_score, adaptability_score, player_archetype)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, game_mode) DO UPDATE SET
                    aggression_score = ?,
                    risk_score = ?,
                    adaptability_score = ?,
                    player_archetype = ?`;

            db.run(query, [
                userId, gameMode, aggression, risk, form, archetype,
                aggression, risk, form, archetype
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

// ========== ADAPTIVE BOT CALIBRATION ==========

const getBotCalibration = (userId) => new Promise((resolve, reject) => {
    db.get(
        `SELECT * FROM bot_calibration WHERE user_id = ?`,
        [userId],
        (err, row) => {
            if (err) return reject(err);
            resolve(normalizeCalibration(row || defaultCalibration()));
        }
    );
});

const saveBotCalibration = (userId, value) => {
    const calibration = normalizeCalibration(value);
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO bot_calibration
                (user_id, skill_mu, skill_sigma, completed_games,
                 meaningful_decisions, completed_rounds, last_temperature,
                 calibration_complete, controller_version, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id) DO UPDATE SET
                 skill_mu = excluded.skill_mu,
                 skill_sigma = excluded.skill_sigma,
                 completed_games = excluded.completed_games,
                 meaningful_decisions = excluded.meaningful_decisions,
                 completed_rounds = excluded.completed_rounds,
                 last_temperature = excluded.last_temperature,
                 calibration_complete = excluded.calibration_complete,
                 controller_version = excluded.controller_version,
                 updated_at = CURRENT_TIMESTAMP`,
            [
                userId,
                calibration.skillMu,
                calibration.skillSigma,
                calibration.completedGames,
                calibration.meaningfulDecisions,
                calibration.completedRounds,
                calibration.lastTemperature,
                calibration.calibrationComplete ? 1 : 0,
                calibration.controllerVersion
            ],
            (err) => {
                if (err) return reject(err);
                resolve(calibration);
            }
        );
    });
};

// ========== USER PREFERENCES FUNCTIONS ==========

// Get user preferences
// Valid bot-difficulty tiers. Deliberately a local copy rather than an import
// of BOT_DIFFICULTIES from game/BotPolicy.js, which would pull the whole bot
// stack into the database layer; botDifficulty.test.js asserts the two lists
// agree, so they cannot drift silently.
const BOT_DIFFICULTY_IDS = [
    'adaptive', 'competitive', 'balanced', 'casual'
];

// The strongest tier a room can pin itself to, mirroring BotPolicy's
// MAX_BOT_DIFFICULTY for the same reason as the list above -- and pinned by a
// sibling test. The activity feed compares against this rather than exporting
// the raw tier id to the client, so a future retune that moves the ceiling to a
// different tier moves the badge with it instead of stranding it.
const MAX_BOT_DIFFICULTY_ID = 'competitive';

const getUserPreferences = (userId) => {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM user_preferences WHERE user_id = ?`, [userId], (err, row) => {
            if (err) return reject(err);
            // If no preferences exist, return defaults
            if (!row) {
                return resolve({
                    user_id: userId,
                    four_color_mode: 0,
                    pusoy_mode: 0,
                    auto_pass: 0,
                    reduced_motion: 0,
                    sound_enabled: 1,
                    sound_volume: 0.6,
                    bot_difficulty: 'adaptive',
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
    const pusoyModeValue = toInt(pick(preferences.pusoyMode, existing.pusoy_mode));
    const autoPassValue = toInt(pick(preferences.autoPass, existing.auto_pass));
    // Coach defaults to OFF, so a missing column reads as off rather than on.
    const coachEnabledValue = toInt(pick(preferences.coachEnabled, existing.coach_enabled ?? 0));
    const reducedMotionValue = toInt(pick(preferences.reducedMotion, existing.reduced_motion));
    // Sound defaults to ON, so fall back to 1 when the column is absent/null
    // rather than letting toInt() read the missing value as "off".
    const soundEnabledValue = toInt(pick(preferences.soundEnabled, existing.sound_enabled ?? 1));
    const rawVolume = Number(pick(preferences.soundVolume, existing.sound_volume ?? 0.6));
    const soundVolumeValue = Number.isFinite(rawVolume) ? Math.max(0, Math.min(1, rawVolume)) : 0.6;
    // Validated against the whitelist rather than stored as sent: this value is
    // handed straight to the room policy factory, which throws on an unknown
    // tier, and an unrecognised setting must not become a way to get one.
    const rawDifficulty = pick(
        preferences.botDifficulty, existing.bot_difficulty ?? 'adaptive');
    const botDifficultyValue = BOT_DIFFICULTY_IDS.includes(rawDifficulty)
        ? rawDifficulty
        : 'adaptive';
    // Avatar stays NULL until the player picks one; callers validate the emoji
    // against the picker's set before it gets here.
    const avatarAnimalValue = pick(preferences.avatarAnimal, existing.avatar_animal ?? null) ?? null;
    const rawTile = pick(preferences.avatarTile, existing.avatar_tile);
    const avatarTileValue = Number.isInteger(rawTile) ? rawTile : null;

    return new Promise((resolve, reject) => {
        const query = `INSERT INTO user_preferences
                           (user_id, four_color_mode, pusoy_mode, auto_pass, coach_enabled, reduced_motion, sound_enabled, sound_volume, bot_difficulty, avatar_animal, avatar_tile)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(user_id) DO UPDATE SET
                           four_color_mode = ?,
                           pusoy_mode = ?,
                           auto_pass = ?,
                           coach_enabled = ?,
                           reduced_motion = ?,
                           sound_enabled = ?,
                           sound_volume = ?,
                           bot_difficulty = ?,
                           avatar_animal = ?,
                           avatar_tile = ?`;

        const values = [
            userId, fourColorValue, pusoyModeValue, autoPassValue, coachEnabledValue, reducedMotionValue, soundEnabledValue, soundVolumeValue, botDifficultyValue, avatarAnimalValue, avatarTileValue,
            fourColorValue, pusoyModeValue, autoPassValue, coachEnabledValue, reducedMotionValue, soundEnabledValue, soundVolumeValue, botDifficultyValue, avatarAnimalValue, avatarTileValue
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
                -- NULL means the round predates difficulty tiers, when every
                -- bot played at full strength - so it groups with competitive.
                CASE WHEN bot_difficulty IS NOT NULL
                          AND bot_difficulty <> 'competitive'
                     THEN 1 ELSE 0 END as weakened_bots,
                COUNT(*) as rounds,
                SUM(CASE WHEN placement = 1 THEN 1 ELSE 0 END) as wins,
                AVG(round_points) as avg_points,
                AVG(deal_strength_raw) as avg_raw
            FROM round_stats
            WHERE user_id = ? AND game_mode = ? AND deal_tier IS NOT NULL
            GROUP BY deal_tier, vs_humans, weakened_bots
        `;

        // Rank-based highlights. A "steal" is winning the round holding the
        // weakest deal at the table; a "squander" is finishing in the bottom
        // half holding the best one.
        const rankQuery = `
            SELECT
                CASE WHEN human_opponents > 0 THEN 1 ELSE 0 END as vs_humans,
                CASE WHEN bot_difficulty IS NOT NULL
                          AND bot_difficulty <> 'competitive'
                     THEN 1 ELSE 0 END as weakened_bots,
                COUNT(*) as rounds,
                SUM(CASE WHEN deal_rank = 4 THEN 1 ELSE 0 END) as worst_deals,
                SUM(CASE WHEN deal_rank = 4 AND placement = 1 THEN 1 ELSE 0 END) as steals,
                SUM(CASE WHEN deal_rank = 1 THEN 1 ELSE 0 END) as best_deals,
                SUM(CASE WHEN deal_rank = 1 AND placement >= 3 THEN 1 ELSE 0 END) as squanders,
                AVG(deal_strength_raw) as avg_raw,
                AVG(deal_rank) as avg_rank
            FROM round_stats
            WHERE user_id = ? AND game_mode = ? AND deal_tier IS NOT NULL
            GROUP BY vs_humans, weakened_bots
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
            maxPoints,
            botDifficulty = null
        } = gameData;

        // bot_difficulty is re-applied on conflict even though a room's policy
        // is frozen for the whole game and cannot disagree between the opening
        // 'in_progress' write and the terminal one. That makes the terminal
        // write heal a row opened by an older build, which would otherwise keep
        // a NULL for a game whose difficulty is perfectly well known.
        const query = `INSERT INTO game_history
            (game_id, room_name, game_mode, is_public, status, winner_id, winner_username,
             start_time, end_time, duration_seconds, total_rounds, max_points, bot_difficulty)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(game_id) DO UPDATE SET
                status = ?,
                winner_id = ?,
                winner_username = ?,
                end_time = ?,
                duration_seconds = ?,
                total_rounds = ?,
                max_points = ?,
                bot_difficulty = COALESCE(?, bot_difficulty)`;

        db.run(query, [
            gameId, roomName, gameMode, isPublic ? 1 : 0, status, winnerId, winnerUsername,
            startTime, endTime, durationSeconds, totalRounds, maxPoints, botDifficulty,
            status, winnerId, winnerUsername, endTime, durationSeconds, totalRounds, maxPoints,
            botDifficulty
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
                    // Derived here, not on the client, for two reasons: the
                    // client must not hardcode a tier id that a retune could
                    // move, and the "were there actually bots" half of the
                    // question has to be answered the same way on every surface
                    // that draws the badge. Max difficulty is a room setting, so
                    // a four-human table can carry it with nothing to apply it
                    // to; badging that game would be a lie.
                    // snake_case to match every other top-level key on this
                    // payload, including the one existing computed field
                    // (event_count). Nested participants[] are camelCase; that
                    // split is the convention, not an accident.
                    max_bots: row.bot_difficulty === MAX_BOT_DIFFICULTY_ID &&
                        participants.some(p => p.isBot),
                    participants_json: undefined,
                    // Dropped for the same reason participants_json is: the CTE
                    // selects page.*, and the raw tier is not this endpoint's
                    // output -- the derived boolean above is. Leaving it in
                    // would publish that a host had toggled Max Bots even for a
                    // four-human game the badge deliberately withholds, and
                    // would make the client's view of the tier vocabulary
                    // something a future retune has to stay compatible with.
                    bot_difficulty: undefined
                };
            });

            resolve(games);
        });
    });
};

/**
 * Marks games still reading 'in_progress' as abandoned.
 *
 * Rooms live in memory only, so a process restart destroys every game in flight
 * and nothing ever revisits its game_history row. Until the abandon path
 * existed, no writer ever set 'abandoned' at all: the status was in the CHECK
 * constraint and had its own index and activity-feed filter, but the "Rage
 * quits" tab was permanently empty, and abandoned games were invisible in the
 * feed entirely -- 'in_progress' appears in no filter's status list.
 *
 * Runs at boot, before connections are accepted, mirroring gamelog.sweepOrphans.
 * Safe at exactly that moment: no row in this database can legitimately be in
 * progress when the process has only just started.
 *
 * end_time is unknown for these rows -- nothing recorded when the game stopped
 * -- so it is recovered from the last round the game actually persisted, and
 * falls back to start_time for games that died before finishing a round. Using
 * "now" instead would stack every game ever abandoned on top of today's real
 * ones, since the feed pages on end_time DESC. total_rounds is recovered the
 * same way. duration_seconds is left alone rather than derived from a
 * reconstructed end, so a card shows no duration instead of a wrong one.
 *
 * round_stats.timestamp is SQLite's CURRENT_TIMESTAMP ('YYYY-MM-DD HH:MM:SS',
 * UTC), while every other time column here is an ISO-8601 string. It is
 * reformatted on the way in: JS parses the space-separated form as *local*
 * time, which would shift each recovered end_time by the viewer's UTC offset.
 */
const sweepAbandonedGames = () => {
    return new Promise((resolve, reject) => {
        // Only humans get round_stats rows, so an all-guest game recovers
        // nothing here and keeps its start_time. That is the fallback working,
        // not a failure.
        const lastRound = (column) => `
            (SELECT ${column} FROM round_stats rs WHERE rs.game_id = game_history.game_id)`;

        const query = `
            UPDATE game_history
               SET status = 'abandoned',
                   total_rounds = COALESCE(${lastRound('MAX(rs.round_number)')}, total_rounds),
                   end_time = COALESCE(
                       ${lastRound("strftime('%Y-%m-%dT%H:%M:%S.000Z', MAX(rs.timestamp))")},
                       start_time)
             WHERE status = 'in_progress'`;

        db.run(query, [], function (err) {
            if (err) return reject(err);
            resolve(this.changes);
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
                orderByClause = 'games_played DESC, public_rank DESC';
                break;
            case 'wins':
                orderByClause = 'wins DESC, public_rank DESC';
                break;
            case 'winRate':
                orderByClause = 'win_rate DESC, games_played DESC';
                break;
            case 'firstPlace':
                orderByClause = 'first_place DESC, public_rank DESC';
                break;
            case 'avgPlacement':
                orderByClause = 'avg_placement ASC, public_rank DESC';
                break;
            case 'rating':
            default:
                orderByClause = 'public_rank DESC, wins DESC';
                break;
        }

        const query = `
            SELECT
                u.username,
                s.games_played,
                s.wins,
                s.losses,
                s.public_rank,
                s.rank_placement_complete,
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
            resolve((rows || []).map(row => {
                const {
                    rank_placement_complete: placementComplete,
                    ...visible
                } = row;
                return {
                    ...visible,
                    public_rank: publicRankPayload(
                        row.public_rank,
                        Boolean(placementComplete)
                    )
                };
            }));
        });
    });
};

// Get player's rank on leaderboard
const getPlayerRank = (username, gameMode = 'standard', sortBy = 'rating') => {
    return new Promise((resolve, reject) => {
        const tableName = gameMode === 'short' ? 'stats_short' : 'stats_standard';

        const PUBLIC_RANK = 's.public_rank';
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
                primary = 's.games_played'; tiebreak = PUBLIC_RANK; betterCmp = '>';
                break;
            case 'wins':
                primary = 's.wins'; tiebreak = PUBLIC_RANK; betterCmp = '>';
                break;
            case 'winRate':
                primary = WIN_RATE; tiebreak = 's.games_played'; betterCmp = '>';
                break;
            case 'firstPlace':
                primary = 's.first_place'; tiebreak = PUBLIC_RANK; betterCmp = '>';
                break;
            case 'avgPlacement':
                primary = AVG_PLACEMENT; tiebreak = PUBLIC_RANK; betterCmp = '<';
                break;
            case 'rating':
            default:
                primary = PUBLIC_RANK; tiebreak = 's.wins'; betterCmp = '>';
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

                db.run(
                    `INSERT INTO user_preferences (user_id, bot_difficulty)
                     VALUES (?, 'adaptive')`,
                    [userId], (err) => {
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

// ========== ACCOUNT MANAGEMENT (profile page) ==========

// Promise wrappers scoped to this section. The callback style everywhere else
// predates these; account changes are multi-statement and read much better
// sequenced, especially inside a transaction.
const getRow = (sql, params) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});
const allRows = (sql, params) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
});
const runSql = (sql, params) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) { return err ? reject(err) : resolve(this); });
});

// The whole account row, for the profile page and for the ownership checks in
// front of every mutation. `password_hash` is returned so callers can ask
// whether one exists -- it must never leave the server.
const getAccountById = (userId) =>
    getRow('SELECT id, username, password_hash, google_id, google_email FROM users WHERE id = ?', [userId]);

// Rename an account, rewriting the history that stored the name rather than the
// id. Almost every table keys on user_id and follows a rename for free; these
// two denormalize the name and would otherwise keep pointing at a string this
// account no longer owns -- and that somebody else may later register.
//
// All of it in one transaction, deliberately: a rename that lands in `users` but
// not in the activity feed is worse than one that does not happen, because the
// stale rows are then indistinguishable from another player's.
const renameUser = (userId, newUsername) => withTransaction(async () => {
    const user = await getRow('SELECT id, username FROM users WHERE id = ?', [userId]);
    if (!user) {
        throw Object.assign(new Error('Account not found'), { code: 'ACCOUNT_NOT_FOUND' });
    }
    if (user.username === newUsername) {
        return { id: user.id, username: user.username, changed: false };
    }

    // Matched exactly, the same way `isUsernameAvailable` and the UNIQUE index
    // match. Case-insensitive here would reject names that registration accepts.
    const taken = await getRow('SELECT id FROM users WHERE username = ? AND id != ?', [newUsername, userId]);
    if (taken) {
        throw Object.assign(new Error('Username already taken'), { code: 'USERNAME_TAKEN' });
    }

    await runSql('UPDATE users SET username = ? WHERE id = ?', [newUsername, userId]);
    await runSql('UPDATE game_history SET winner_username = ? WHERE winner_id = ?', [newUsername, userId]);
    // Can fail on UNIQUE(game_id, username) if a guest row in one of this
    // account's own games already carries the new name. Reserving the `Guest_`
    // prefix (server/username.js) is what makes that unreachable; the
    // transaction is what keeps it harmless if it ever becomes reachable again.
    await runSql('UPDATE game_participants SET username = ? WHERE user_id = ?', [newUsername, userId]);
    await runSql(
        'INSERT INTO username_history (user_id, old_username, new_username) VALUES (?, ?, ?)',
        [userId, user.username, newUsername]
    );

    return { id: userId, username: newUsername, changed: true };
});

const getUsernameHistory = (userId) =>
    allRows(
        'SELECT old_username, new_username, changed_at FROM username_history WHERE user_id = ? ORDER BY changed_at DESC, id DESC',
        [userId]
    );

// Set or replace the password. Also the way a Google-only account gains one, so
// linking Google is not a one-way trip into an account you cannot unlink.
const setUserPassword = async (userId, password) => {
    const hash = await bcrypt.hash(password, 10);
    const result = await runSql('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
    return { success: result.changes > 0 };
};

// Detach Google from an account. The caller is responsible for refusing this
// when no password is set -- clearing the only credential locks the account out.
const unlinkGoogleAccount = async (userId) => {
    const result = await runSql('UPDATE users SET google_id = NULL, google_email = NULL WHERE id = ?', [userId]);
    return { success: result.changes > 0 };
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
    getComebackStats,
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
    getBotCalibration,
    saveBotCalibration,
    BOT_DIFFICULTY_IDS,
    MAX_BOT_DIFFICULTY_ID,
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
    sweepAbandonedGames,
    // Google OAuth
    getUserByGoogleId,
    createGoogleUser,
    linkGoogleAccount,
    isUsernameAvailable,
    // Account management
    verifyUserById,
    getAccountById,
    renameUser,
    getUsernameHistory,
    setUserPassword,
    unlinkGoogleAccount
};
