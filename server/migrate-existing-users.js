// Migration script to initialize mode-specific stats for existing users
// Run this once after deploying the fix to backfill existing user data

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Use /data directory in production (Fly.io volume mount), local directory otherwise
const isProduction = process.env.NODE_ENV === 'production';
const dbPath = isProduction
    ? '/data/database.sqlite'
    : path.join(__dirname, 'database.sqlite');

console.log(`Connecting to database at: ${dbPath}`);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    } else {
        console.log('Connected to SQLite database');
        runMigration();
    }
});

function runMigration() {
    db.serialize(() => {
        // Get all users
        db.all('SELECT id, username FROM users', [], (err, users) => {
            if (err) {
                console.error('Error fetching users:', err);
                db.close();
                process.exit(1);
            }

            if (users.length === 0) {
                console.log('No users found in database');
                db.close();
                process.exit(0);
            }

            console.log(`Found ${users.length} user(s) to migrate`);

            let migratedCount = 0;
            let errorCount = 0;

            users.forEach((user) => {
                // Insert into stats_standard (if not exists)
                db.run(
                    'INSERT OR IGNORE INTO stats_standard (user_id) VALUES (?)',
                    [user.id],
                    function(err) {
                        if (err) {
                            console.error(`Error creating stats_standard for user ${user.username}:`, err);
                            errorCount++;
                        } else if (this.changes > 0) {
                            console.log(`✓ Created stats_standard for user: ${user.username}`);
                            migratedCount++;
                        } else {
                            console.log(`- stats_standard already exists for user: ${user.username}`);
                        }
                    }
                );

                // Insert into stats_short (if not exists)
                db.run(
                    'INSERT OR IGNORE INTO stats_short (user_id) VALUES (?)',
                    [user.id],
                    function(err) {
                        if (err) {
                            console.error(`Error creating stats_short for user ${user.username}:`, err);
                            errorCount++;
                        } else if (this.changes > 0) {
                            console.log(`✓ Created stats_short for user: ${user.username}`);
                            migratedCount++;
                        } else {
                            console.log(`- stats_short already exists for user: ${user.username}`);
                        }
                    }
                );
            });

            // Wait a bit for all async operations to complete
            setTimeout(() => {
                console.log('\n=== Migration Complete ===');
                console.log(`Total users processed: ${users.length}`);
                console.log(`Stats rows created: ${migratedCount}`);
                console.log(`Errors encountered: ${errorCount}`);
                db.close(() => {
                    console.log('Database connection closed');
                    process.exit(errorCount > 0 ? 1 : 0);
                });
            }, 1000);
        });
    });
}
