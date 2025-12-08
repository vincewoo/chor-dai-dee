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

        // Check if stats table exists and has rating_mu
        db.get("PRAGMA table_info(stats)", (err, rows) => {
            if (err) {
                console.error("Error checking table info:", err);
                return;
            }

            // If table doesn't exist, create it with new schema
            if (!rows) {
                createStatsTable();
            } else {
                // Check for existence of old 'elo' column or missing 'rating_mu'
                // rows is usually undefined if table doesn't exist? No, PRAGMA returns rows one by one in .each or array in .all?
                // Wait, db.get returns only the first row. We should use db.all for PRAGMA.
            }
        });

        // Let's redo the check properly using db.all
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

                if (hasElo && !hasRatingMu) {
                    console.log("Migrating stats table: Removing elo, adding rating_mu/sigma");
                    migrateStatsTable();
                } else if (!hasRatingMu) {
                    // This case shouldn't happen if we just created it, but maybe partial state?
                    console.log("Adding missing rating columns");
                    db.run(`ALTER TABLE stats ADD COLUMN rating_mu REAL DEFAULT 25.0`);
                    db.run(`ALTER TABLE stats ADD COLUMN rating_sigma REAL DEFAULT 8.333`);
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
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
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

module.exports = { db, createUser, verifyUser, getUserStats, updateUserStats, updateUserStatsByName };
