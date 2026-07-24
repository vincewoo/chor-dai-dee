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
        initDb();
    }
});

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
            singles_played INTEGER DEFAULT 0,
            pairs_played INTEGER DEFAULT 0,
            triples_played INTEGER DEFAULT 0,
            straights_played INTEGER DEFAULT 0,
            flushes_played INTEGER DEFAULT 0,
            full_houses_played INTEGER DEFAULT 0,
            quads_played INTEGER DEFAULT 0,
            straight_flushes_played INTEGER DEFAULT 0,
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
            late_game_accuracy REAL DEFAULT 0.0,
            FOREIGN KEY(user_id) REFERENCES users(id),
            UNIQUE(user_id, game_mode)
        )`);

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
            }
        });

        // Check if round_stats table needs leads_won column (migration for existing databases)
        db.all("PRAGMA table_info(round_stats)", (err, columns) => {
            if (err) {
                console.error("Error checking round_stats schema", err);
                return;
            }

            if (columns.length > 0) {
                const hasLeadsWon = columns.some(c => c.name === 'leads_won');
                if (!hasLeadsWon) {
                    console.log("Adding leads_won column to round_stats table");
                    db.run(`ALTER TABLE round_stats ADD COLUMN leads_won INTEGER DEFAULT 0`, (err) => {
                        if (err && !err.message.includes('duplicate column')) {
                            console.error("Error adding leads_won to round_stats:", err.message);
                        } else {
                            console.log("Successfully added leads_won column to round_stats");
                        }
                    });
                }
            }
        });

        // Check stats table schema
        db.all("PRAGMA table_info(stats)", (err, columns) => {
            if (err) {
                console.error("Error getting stats schema", err);
                return;
            }

            if (columns.length === 0) {
                // Table does not exist
                createStatsTable();
            } else {
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
    });
}

function createStatsTable() {
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
            plays_count, passes_count, leads_won,
            singles_played, pairs_played, triples_played,
            straights_played, flushes_played, full_houses_played,
            quads_played, straight_flushes_played
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const params = [
            gameId, userId, gameMode, roundData.roundNumber, roundData.placement,
            roundData.cardsLeft, roundData.penaltyMultiplier, roundData.roundPoints,
            roundData.cumulativeScore, roundData.plays, roundData.passes, roundData.leadsWon || 0,
            roundData.handTypes.SINGLE || 0,
            roundData.handTypes.PAIR || 0,
            roundData.handTypes.TRIPLE || 0,
            roundData.handTypes.STRAIGHT || 0,
            roundData.handTypes.FLUSH || 0,
            roundData.handTypes.FULL_HOUSE || 0,
            roundData.handTypes.QUADS || 0,
            roundData.handTypes.STRAIGHT_FLUSH || 0
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
                    gameStats?.total_plays || 0, // lead_attempts = total plays
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

// Update card awareness stats
const updateCardAwarenessStats = (userId, gameMode, isOptimal, isRisky, riskSucceeded, lateGameAccuracy) => {
    return new Promise((resolve, reject) => {
        // Insert or update
        const query = `INSERT INTO card_awareness_stats
            (user_id, game_mode, total_decisions, optimal_decisions, suboptimal_decisions, risky_plays_successful, risky_plays_failed, late_game_accuracy)
            VALUES (?, ?, 1, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, game_mode) DO UPDATE SET
                total_decisions = total_decisions + 1,
                optimal_decisions = optimal_decisions + ?,
                suboptimal_decisions = suboptimal_decisions + ?,
                risky_plays_successful = risky_plays_successful + ?,
                risky_plays_failed = risky_plays_failed + ?,
                late_game_accuracy = (late_game_accuracy * (total_decisions - 1) + ?) / total_decisions`;

        const optimalVal = isOptimal ? 1 : 0;
        const suboptimalVal = !isOptimal ? 1 : 0;
        const riskySuccess = (isRisky && riskSucceeded) ? 1 : 0;
        const riskyFail = (isRisky && !riskSucceeded) ? 1 : 0;

        db.run(query, [
            userId, gameMode, optimalVal, suboptimalVal, riskySuccess, riskyFail, lateGameAccuracy,
            optimalVal, suboptimalVal, riskySuccess, riskyFail, lateGameAccuracy
        ], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};

// Get card awareness stats
const getCardAwarenessStats = (userId, gameMode) => {
    return new Promise((resolve, reject) => {
        const query = `SELECT * FROM card_awareness_stats WHERE user_id = ? AND game_mode = ?`;
        db.get(query, [userId, gameMode], (err, row) => {
            if (err) reject(err);
            else resolve(row || null);
        });
    });
};

// Update variance and streak stats
const updateVarianceStats = (userId, gameMode, isWin, isLucky) => {
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

            const luckyWinInc = (isWin && isLucky) ? 1 : 0;
            const skilledWinInc = (isWin && !isLucky) ? 1 : 0;

            const query = `INSERT INTO variance_stats
                (user_id, game_mode, current_streak, longest_win_streak, longest_loss_streak, total_sessions, lucky_wins, skilled_wins)
                VALUES (?, ?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT(user_id, game_mode) DO UPDATE SET
                    current_streak = ?,
                    longest_win_streak = ?,
                    longest_loss_streak = ?,
                    total_sessions = total_sessions + 1,
                    lucky_wins = lucky_wins + ?,
                    skilled_wins = skilled_wins + ?`;

            db.run(query, [
                userId, gameMode, newStreak, newLongestWin, newLongestLoss, luckyWinInc, skilledWinInc,
                newStreak, newLongestWin, newLongestLoss, luckyWinInc, skilledWinInc
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

// Update behavioral classification with optional early/late game phase data
const updateBehavioralStats = (userId, gameMode, aggressionScore, riskScore, adaptabilityScore, earlyGameAggression = null, lateGameRisk = null) => {
    return new Promise((resolve, reject) => {
        // Determine archetype based on scores
        let archetype = 'Balanced';
        if (aggressionScore > 0.7 && riskScore > 0.6) {
            archetype = 'Aggressive';
        } else if (aggressionScore < 0.4 && riskScore < 0.4) {
            archetype = 'Conservative';
        } else if (adaptabilityScore > 0.75) {
            archetype = 'Adaptive';
        }

        // Determine early/late game styles
        // Use phase-specific data if available, otherwise use overall scores
        const earlyAggressionScore = earlyGameAggression !== null ? earlyGameAggression : aggressionScore;
        const lateRiskScore = lateGameRisk !== null ? lateGameRisk : riskScore;

        const earlyStyle = earlyAggressionScore > 0.6 ? 'Aggressive' : earlyAggressionScore < 0.4 ? 'Passive' : 'Neutral';
        const lateStyle = lateRiskScore > 0.6 ? 'Risky' : lateRiskScore < 0.4 ? 'Safe' : 'Neutral';

        const query = `INSERT INTO behavioral_stats
            (user_id, game_mode, aggression_score, risk_score, adaptability_score, player_archetype, early_game_style, late_game_style)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, game_mode) DO UPDATE SET
                aggression_score = (aggression_score * 0.8 + ? * 0.2),
                risk_score = (risk_score * 0.8 + ? * 0.2),
                adaptability_score = (adaptability_score * 0.8 + ? * 0.2),
                player_archetype = ?,
                early_game_style = ?,
                late_game_style = ?`;

        db.run(query, [
            userId, gameMode, aggressionScore, riskScore, adaptabilityScore, archetype, earlyStyle, lateStyle,
            aggressionScore, riskScore, adaptabilityScore, archetype, earlyStyle, lateStyle
        ], (err) => {
            if (err) reject(err);
            else resolve();
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
                    sound_volume: 0.6
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

    return new Promise((resolve, reject) => {
        const query = `INSERT INTO user_preferences
                           (user_id, four_color_mode, auto_pass, table_theme, accent_color, reduced_motion, sound_enabled, sound_volume)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(user_id) DO UPDATE SET
                           four_color_mode = ?,
                           auto_pass = ?,
                           table_theme = ?,
                           accent_color = ?,
                           reduced_motion = ?,
                           sound_enabled = ?,
                           sound_volume = ?`;

        const values = [
            userId, fourColorValue, autoPassValue, tableThemeValue, accentColorValue, reducedMotionValue, soundEnabledValue, soundVolumeValue,
            fourColorValue, autoPassValue, tableThemeValue, accentColorValue, reducedMotionValue, soundEnabledValue, soundVolumeValue
        ];

        db.run(query, values, (err) => {
            if (err) return reject(err);
            resolve();
        });
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
            whereClauses.push(`gh.status IN (${statusPlaceholders})`);
            params.push(...includeStatus);
        }

        // Filter by game mode
        if (gameMode) {
            whereClauses.push('gh.game_mode = ?');
            params.push(gameMode);
        }

        // Show ALL games for now (full transparency approach)
        // We can add privacy filters later based on user feedback
        // No filtering by is_public for now

        const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const query = `
            SELECT
                gh.*,
                GROUP_CONCAT(
                    json_object(
                        'username', gp.username,
                        'isBot', gp.is_bot,
                        'placement', gp.final_placement,
                        'score', gp.final_score,
                        'roundsWon', gp.rounds_won
                    )
                ) as participants_json,
                (SELECT COUNT(*) FROM game_events ge WHERE ge.game_id = gh.game_id) as event_count
            FROM game_history gh
            LEFT JOIN game_participants gp ON gp.game_id = gh.game_id
            ${whereClause}
            GROUP BY gh.game_id
            ORDER BY gh.end_time DESC, gh.start_time DESC
            LIMIT ? OFFSET ?
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
                CASE WHEN s.total_rounds > 0
                    THEN (s.first_place * 1 + s.second_place * 2 + s.third_place * 3 + s.fourth_place * 4) / CAST(s.total_rounds AS REAL)
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

        let orderByClause;
        switch (sortBy) {
            case 'games':
                orderByClause = 's.games_played DESC, (1200 + (s.rating_mu - 3 * s.rating_sigma) * 40) DESC';
                break;
            case 'wins':
                orderByClause = 's.wins DESC, (1200 + (s.rating_mu - 3 * s.rating_sigma) * 40) DESC';
                break;
            case 'winRate':
                orderByClause = 'CASE WHEN s.games_played > 0 THEN CAST(s.wins AS REAL) / s.games_played ELSE 0 END DESC, s.games_played DESC';
                break;
            case 'firstPlace':
                orderByClause = 's.first_place DESC, (1200 + (s.rating_mu - 3 * s.rating_sigma) * 40) DESC';
                break;
            case 'avgPlacement':
                orderByClause = 'CASE WHEN s.total_rounds > 0 THEN (s.first_place * 1 + s.second_place * 2 + s.third_place * 3 + s.fourth_place * 4) / CAST(s.total_rounds AS REAL) ELSE 0 END ASC, (1200 + (s.rating_mu - 3 * s.rating_sigma) * 40) DESC';
                break;
            case 'rating':
            default:
                orderByClause = '(1200 + (s.rating_mu - 3 * s.rating_sigma) * 40) DESC, s.games_played DESC';
                break;
        }

        const query = `
            WITH RankedPlayers AS (
                SELECT
                    u.username,
                    ROW_NUMBER() OVER (ORDER BY ${orderByClause}) as rank
                FROM ${tableName} s
                INNER JOIN users u ON s.user_id = u.id
            )
            SELECT rank FROM RankedPlayers WHERE username = ?
        `;

        db.get(query, [username], (err, row) => {
            if (err) return reject(err);
            resolve(row ? row.rank : null);
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
    updateCardAwarenessStats,
    getCardAwarenessStats,
    updateVarianceStats,
    getVarianceStats,
    updateBehavioralStats,
    getBehavioralStats,
    getTier3Stats,
    savePlacementHistory,
    getPlacementHistory,
    updateVarianceScores,
    // User preferences
    getUserPreferences,
    updateUserPreferences,
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
