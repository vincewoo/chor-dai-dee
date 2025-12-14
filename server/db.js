// server/db.js
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');

// Use /data directory in production (Fly.io volume mount), local directory otherwise
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
            // Initialize stats
            db.run(`INSERT INTO stats (user_id) VALUES (?)`, [userId], (err) => {
                if (err) return reject(err);
                resolve({ id: userId, username });
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
                SUM(plays_count) as total_plays,
                SUM(passes_count) as total_passes,
                SUM(leads_won) as leads_won,
                AVG(CAST(plays_count AS REAL) / NULLIF(plays_count + passes_count, 0)) as play_rate,
                SUM(CASE WHEN penalty_multiplier = 2 THEN 1 ELSE 0 END) as penalty_2x,
                SUM(CASE WHEN penalty_multiplier = 3 THEN 1 ELSE 0 END) as penalty_3x
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
    getHeadToHeadStats
};
