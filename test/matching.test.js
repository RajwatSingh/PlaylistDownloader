import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLength, scoreCandidate, safeName, detectKind } from '../lib/downloader.js';

const song = { name: 'Bohemian Rhapsody', artist: 'Queen', durationMs: 354_000 }; // 5:54

const candidate = (over = {}) => ({
    id: 'abc',
    title: 'Bohemian Rhapsody',
    channelTitle: 'Queen - Topic',
    length: { simpleText: '5:54' },
    isLive: false,
    ...over,
});

test('parseLength handles m:ss and h:mm:ss', () => {
    assert.equal(parseLength({ simpleText: '3:52' }), 232);
    assert.equal(parseLength({ simpleText: '1:02:03' }), 3723);
    assert.equal(parseLength('0:45'), 45);
    assert.equal(parseLength({ simpleText: 'LIVE' }), null);
    assert.equal(parseLength(undefined), null);
});

test('accepts an exact-duration official audio match', () => {
    assert.ok(scoreCandidate(candidate(), song) > 100);
});

test('rejects live streams and live titles', () => {
    assert.equal(scoreCandidate(candidate({ isLive: true }), song), null);
    assert.equal(scoreCandidate(candidate({ title: 'Bohemian Rhapsody (Live at Wembley)' }), song), null);
});

test('rejects covers, remixes and other variants', () => {
    for (const title of [
        'Bohemian Rhapsody - Cover',
        'Bohemian Rhapsody (Remix)',
        'Bohemian Rhapsody sped up',
        'Bohemian Rhapsody KARAOKE',
        'Bohemian Rhapsody 8D Audio',
    ]) {
        assert.equal(scoreCandidate(candidate({ title }), song), null, title);
    }
});

test('keeps a variant when the Spotify track is itself that variant', () => {
    const liveSong = { ...song, name: 'Bohemian Rhapsody - Live Aid' };
    assert.ok(scoreCandidate(candidate({ title: 'Bohemian Rhapsody (Live Aid)' }), liveSong) !== null);
});

test('rejects durations that are far off', () => {
    assert.equal(scoreCandidate(candidate({ length: { simpleText: '10:00:00' } }), song), null);
    assert.equal(scoreCandidate(candidate({ length: { simpleText: '0:31' } }), song), null);
    // just inside the 45s tolerance
    assert.ok(scoreCandidate(candidate({ length: { simpleText: '6:30' } }), song) !== null);
});

test('rejects an unparseable duration when the target is known', () => {
    assert.equal(scoreCandidate(candidate({ length: null }), song), null);
});

test('prefers the closest duration', () => {
    const exact = scoreCandidate(candidate(), song);
    const off = scoreCandidate(candidate({ length: { simpleText: '6:10' } }), song);
    assert.ok(exact > off);
});

test('prefers a Topic channel over an unrelated uploader', () => {
    const topic = scoreCandidate(candidate(), song);
    const random = scoreCandidate(candidate({ channelTitle: 'somerandomuploader' }), song);
    assert.ok(topic > random);
});

test('safeName strips path separators and other unsafe characters', () => {
    assert.equal(safeName('AC/DC: Back "In" Black?'), 'AC-DC- Back -In- Black-');
    assert.equal(safeName('   '), 'Untitled');
    assert.ok(safeName('x'.repeat(400)).length <= 120);
});

test('detectKind recognises each Spotify link type', () => {
    assert.equal(detectKind('https://open.spotify.com/playlist/abc'), 'playlist');
    assert.equal(detectKind('https://open.spotify.com/album/abc'), 'album');
    assert.equal(detectKind('https://open.spotify.com/track/abc'), 'track');
    assert.equal(detectKind('https://open.spotify.com/collection/tracks'), 'liked');
    assert.equal(detectKind('not a link'), null);
});
