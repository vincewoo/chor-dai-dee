import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildGameCard,
    buildGameCards,
    compactMetaLine,
    describeStanding,
    formatDuration,
    ordinalSuffix,
    pluralize,
    shouldLoadReview,
} from '../src/utils/gameSummary.js';

// Fixed "now" so the relative labels are deterministic.
const NOW = Date.parse('2026-07-30T12:00:00.000Z');
const minutesAgo = (m) => new Date(NOW - m * 60000).toISOString();

const completed = {
    game_id: 'g1',
    game_mode: 'short',
    status: 'completed',
    is_public: 1,
    end_time: minutesAgo(7),
    duration_seconds: 740,
    total_rounds: 8,
    event_count: 3,
    max_bots: true,
    winner_username: 'julo',
    participants: [
        { username: 'Bot 3', isBot: true, placement: 2, score: 17, roundsWon: 2 },
        { username: 'julo', isBot: false, placement: 1, score: 13, roundsWon: 4 },
        { username: 'Bot 2', isBot: true, placement: 4, score: 55, roundsWon: 0 },
        { username: 'Bot 4', isBot: true, placement: 3, score: 24, roundsWon: 2 },
    ],
};

test('a completed game is ordered by placement', () => {
    const card = buildGameCard(completed, { username: 'julo', nowTs: NOW });
    assert.deepEqual(card.participants.map((p) => p.username), ['julo', 'Bot 3', 'Bot 4', 'Bot 2']);
    assert.equal(card.winnerName, 'julo');
    assert.equal(card.winnerIsMe, true);
    assert.equal(card.hasMe, true);
    assert.equal(card.abandoned, false);
});

test('every field the card draws survives the derivation', () => {
    const card = buildGameCard(completed, { username: 'julo', nowTs: NOW });
    assert.equal(card.id, 'g1');
    assert.equal(card.mode, 'short');
    assert.equal(card.rounds, 8);
    assert.equal(card.duration, '12m');
    assert.equal(card.when, '7m ago');
    assert.equal(card.highlights, 3);
    assert.equal(card.maxBots, true);
    assert.equal(card.isPrivate, false);
    // roundsWon rides along on the participants, and used to be dropped by the
    // home screen's remap into the legacy score dialog.
    assert.equal(card.participants[0].roundsWon, 4);
});

test('an abandoned game orders by score and has no winner', () => {
    const card = buildGameCard(
        { ...completed, status: 'abandoned', winner_username: null,
          participants: completed.participants.map((p) => ({ ...p, placement: null })) },
        { username: 'julo', nowTs: NOW }
    );
    assert.equal(card.abandoned, true);
    assert.equal(card.winnerName, null);
    assert.equal(card.winnerIsMe, false);
    assert.deepEqual(card.participants.map((p) => p.score), [13, 17, 24, 55]);
});

test('a private game is flagged from is_public', () => {
    assert.equal(buildGameCard({ ...completed, is_public: 0 }, {}).isPrivate, true);
    assert.equal(buildGameCard({ ...completed, is_public: 1 }, {}).isPrivate, false);
});

test('a review is offered only to a non-guest who actually sat at the table', () => {
    const forUser = (username, isGuest) =>
        buildGameCard(completed, { username, isGuest, nowTs: NOW }).canReview;

    assert.equal(forUser('julo', false), true);
    // Watched it, did not play it.
    assert.equal(forUser('someone-else', false), false);
    // A guest has no account for the review to be scoped to.
    assert.equal(forUser('julo', true), false);
    // A bot seat sharing a viewer's name is still a bot seat.
    assert.equal(forUser('Bot 3', false), false);
});

test('a game with no id cannot be reviewed', () => {
    const card = buildGameCard({ ...completed, game_id: null }, { username: 'julo' });
    assert.equal(card.canReview, false);
});

test('a game swept from the in_progress backlog has no participants and survives', () => {
    const card = buildGameCard({ game_id: 'g2', participants: null }, { username: 'julo', nowTs: NOW });
    assert.deepEqual(card.participants, []);
    assert.equal(card.winnerName, null);
    assert.equal(card.hasMe, false);
    assert.equal(card.canReview, false);
});

test('buildGameCards maps a page and tolerates an empty one', () => {
    assert.equal(buildGameCards([completed], { username: 'julo', nowTs: NOW }).length, 1);
    assert.deepEqual(buildGameCards(undefined, {}), []);
});

// --- describeStanding: the sub-line under a name in the expanded standings ---

const won = { username: 'julo', placement: 1, score: 13, roundsWon: 4 };
const third = { username: 'Bot 4', placement: 3, score: 24, roundsWon: 2 };

test('placement is not repeated when the deal strength has arrived', () => {
    // The gutter already prints the number; with a deal recorded, the line
    // spends itself on what the deal was worth instead.
    assert.equal(
        describeStanding(third, { abandoned: false }, { dealRank: 2, avgPercentile: 71 }),
        '2 rounds won · Deal strength: 2nd (71st pct)'
    );
});

test('with no deal recorded it falls back to the placement rather than an empty line', () => {
    assert.equal(describeStanding(third, { abandoned: false }, null), '3rd place · 2 rounds won');
    assert.equal(describeStanding(won, { abandoned: false }, null), 'Winner · 4 rounds won');
});

test('a deal entry without a rank still counts as no deal', () => {
    // The review row exists but predates deal recording — must not swallow the
    // placement fallback and leave the line blank.
    assert.equal(describeStanding(third, { abandoned: false }, { avgPercentile: 71 }), '3rd place · 2 rounds won');
});

test('no placement is labelled, and the label depends on why', () => {
    const seat = { username: 'julo', placement: null, score: 13, roundsWon: 0 };
    assert.equal(describeStanding(seat, { abandoned: true }, null), 'Score when abandoned');
    assert.equal(describeStanding(seat, { abandoned: false }, null), 'Unranked');
});

test('zero rounds won is omitted, one round is singular', () => {
    assert.equal(describeStanding({ ...third, roundsWon: 0 }, {}, null), '3rd place');
    assert.equal(describeStanding({ ...third, roundsWon: 1 }, {}, null), '3rd place · 1 round won');
});

// --- compactMetaLine: the home header's meta line ---

test('the compact meta line names the opponents', () => {
    const card = buildGameCard(completed, { username: 'julo', nowTs: NOW });
    assert.equal(compactMetaLine(card), 'Short · 8 rounds · beat Bot 3, Bot 4, Bot 2');
});

test('a one-participant game emits no dangling "beat"', () => {
    // The home row this replaced guarded on `ranked.length` (truthy, so >= 1)
    // and left a bare "beat " fragment that survived filter(Boolean).
    const card = buildGameCard(
        { ...completed, participants: [completed.participants[1]] },
        { username: 'julo', nowTs: NOW }
    );
    assert.equal(compactMetaLine(card), 'Short · 8 rounds');
});

test('a game with no participants or rounds degrades to the mode alone', () => {
    const card = buildGameCard({ game_id: 'g3', game_mode: 'standard' }, { nowTs: NOW });
    assert.equal(compactMetaLine(card), 'Standard');
});

// --- shouldLoadReview: the fetch gate ---

test('a review is fetched once and only once', () => {
    const inFlight = new Set();
    const loaded = new Set();

    assert.equal(shouldLoadReview('g1', { inFlight, loaded }), true);

    // A second toggle while the first request is open must not fetch again.
    inFlight.add('g1');
    assert.equal(shouldLoadReview('g1', { inFlight, loaded }), false);
    // A different card is unaffected by it.
    assert.equal(shouldLoadReview('g2', { inFlight, loaded }), true);

    // Resolved: released from in-flight, recorded as loaded, never refetched.
    inFlight.delete('g1');
    loaded.add('g1');
    assert.equal(shouldLoadReview('g1', { inFlight, loaded }), false);
});

test('a failed fetch stays retryable', () => {
    const inFlight = new Set();
    const loaded = new Set();
    // The hook adds to inFlight, then releases it in `finally` without marking
    // it loaded — which is what makes reopening the card retry.
    inFlight.add('g1');
    inFlight.delete('g1');
    assert.equal(shouldLoadReview('g1', { inFlight, loaded }), true);
});

test('a game with no id is never fetched', () => {
    const sets = { inFlight: new Set(), loaded: new Set() };
    assert.equal(shouldLoadReview(null, sets), false);
    assert.equal(shouldLoadReview(undefined, sets), false);
    assert.equal(shouldLoadReview('', sets), false);
});

test('formatDuration rolls into hours and never prints 0m', () => {
    assert.equal(formatDuration(0), null);
    assert.equal(formatDuration(null), null);
    assert.equal(formatDuration(20), '1m');
    assert.equal(formatDuration(59), '1m');
    assert.equal(formatDuration(600), '10m');
    assert.equal(formatDuration(3600), '1h 0m');
    assert.equal(formatDuration(3600 * 2 + 300), '2h 5m');
});

test('an omitted nowTs yields no timestamp rather than "NaNy ago"', () => {
    // timeAgo against an undefined "now" computes NaN through every branch and
    // falls out the bottom as a literal string, which would render on the card.
    assert.equal(buildGameCard(completed, { username: 'julo' }).when, null);
});

test('pluralize agrees with the card copy', () => {
    assert.equal(pluralize(1, 'round'), '1 round');
    assert.equal(pluralize(0, 'round'), '0 rounds');
    assert.equal(pluralize(8, 'round'), '8 rounds');
});

test('ordinalSuffix handles the teens', () => {
    assert.equal(ordinalSuffix(1), 'st');
    assert.equal(ordinalSuffix(2), 'nd');
    assert.equal(ordinalSuffix(3), 'rd');
    assert.equal(ordinalSuffix(4), 'th');
    assert.equal(ordinalSuffix(11), 'th');
    assert.equal(ordinalSuffix(12), 'th');
    assert.equal(ordinalSuffix(13), 'th');
    assert.equal(ordinalSuffix(21), 'st');
    assert.equal(ordinalSuffix(71), 'st');
});
