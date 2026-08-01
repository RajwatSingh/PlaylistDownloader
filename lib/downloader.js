import * as ytSearch from 'youtube-search-api';
import { spawn, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { spotifyApi, ensureAccessToken, hasCredentials, isLoggedIn } from './auth.js';
import { tagFile, fetchCover, cleanupCover } from './tagger.js';

export { hasCredentials, isLoggedIn };

export const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || 'downloads');

// Spotify's own URL for Liked Songs — treated as a resolvable source so it can be
// pasted like any other link (it just requires being logged in)
const LIKED_PATH = '/collection/tracks';

/* ------------------------------------------------------------------ *
 * Link parsing
 * ------------------------------------------------------------------ */

function extractId(spotifyUrl, kind) {
    try {
        const url = new URL(spotifyUrl);
        const parts = url.pathname.split('/');
        return parts.includes(kind) ? parts[parts.indexOf(kind) + 1] : null;
    } catch (err) {
        return null;
    }
}

export const extractTrackId = (url) => extractId(url, 'track');
export const extractPlaylistId = (url) => extractId(url, 'playlist');
export const extractAlbumId = (url) => extractId(url, 'album');

export function isLikedUrl(spotifyUrl) {
    try {
        return new URL(spotifyUrl).pathname === LIKED_PATH;
    } catch {
        return false;
    }
}

export function detectKind(spotifyUrl) {
    if (isLikedUrl(spotifyUrl)) return 'liked';
    if (extractPlaylistId(spotifyUrl)) return 'playlist';
    if (extractAlbumId(spotifyUrl)) return 'album';
    if (extractTrackId(spotifyUrl)) return 'track';
    return null;
}

/* ------------------------------------------------------------------ *
 * Spotify lookups
 * ------------------------------------------------------------------ */

function toTrack(track) {
    const images = track.album?.images ?? [];
    return {
        name: track.name,
        artist: track.artists[0].name,
        album: track.album?.name ?? null,
        durationMs: track.duration_ms ?? null,
        trackNumber: track.track_number ?? null,
        releaseDate: track.album?.release_date ?? null,
        // smallest image for the list UI, largest for embedding as cover art
        art: images.slice(-1)[0]?.url ?? null,
        artLarge: images[0]?.url ?? null,
        url: track.external_urls?.spotify ?? null,
    };
}

export async function getSpotifySong(spotifyUrl) {
    await ensureAccessToken();
    const trackID = extractTrackId(spotifyUrl);
    if (!trackID) throw new Error('Could not extract a track ID from that URL.');
    const track = await spotifyApi.getTrack(trackID);
    return toTrack(track.body);
}

// walks every page so playlists over 100 tracks come back complete
export async function getSpotifyPlaylist(spotifyUrl) {
    await ensureAccessToken();
    const playlistID = extractPlaylistId(spotifyUrl);
    if (!playlistID) throw new Error('Could not extract a playlist ID from that URL.');

    const meta = await spotifyApi.getPlaylist(playlistID, { fields: 'name,owner.display_name,images,tracks.total' });
    const tracks = [];
    let offset = 0;
    while (true) {
        const page = await spotifyApi.getPlaylistTracks(playlistID, { offset, limit: 100 });
        for (const item of page.body.items) {
            if (item.track && item.track.type === 'track') tracks.push(toTrack(item.track));
        }
        offset += page.body.items.length;
        if (offset >= page.body.total || page.body.items.length === 0) break;
    }

    return {
        title: meta.body.name,
        owner: meta.body.owner?.display_name ?? null,
        art: meta.body.images?.[0]?.url ?? null,
        tracks,
    };
}

export async function getSpotifyAlbum(spotifyUrl) {
    await ensureAccessToken();
    const albumID = extractAlbumId(spotifyUrl);
    if (!albumID) throw new Error('Could not extract an album ID from that URL.');
    const album = await spotifyApi.getAlbum(albumID);
    // album track objects carry no nested album, so graft it on for tagging
    const shell = { name: album.body.name, images: album.body.images, release_date: album.body.release_date };
    return {
        title: album.body.name,
        owner: album.body.artists?.[0]?.name ?? null,
        art: album.body.images?.[0]?.url ?? null,
        tracks: album.body.tracks.items.map((t) => toTrack({ ...t, album: shell })),
    };
}

// requires a logged-in user; paginated like playlists
export async function getLikedSongs() {
    await ensureAccessToken({ requireUser: true });
    const tracks = [];
    let offset = 0;
    while (true) {
        const page = await spotifyApi.getMySavedTracks({ offset, limit: 50 });
        for (const item of page.body.items) {
            if (item.track) tracks.push(toTrack(item.track));
        }
        offset += page.body.items.length;
        if (offset >= page.body.total || page.body.items.length === 0) break;
    }
    return { title: 'Liked Songs', owner: 'You', art: tracks[0]?.artLarge ?? null, tracks };
}

/* ------------------------------------------------------------------ *
 * Mode gate + resolution
 * ------------------------------------------------------------------ */

// which link kinds each user-facing mode will accept
const MODE_KINDS = {
    playlist: ['playlist', 'album', 'liked'],
    track: ['track'],
};

const KIND_ARTICLE = (kind) => (kind === 'album' ? 'an' : 'a');

/**
 * One entry point for any Spotify link the user pastes.
 * `mode` ('playlist' | 'track' | 'auto') rejects links that do not match what the
 * user asked for, so a track link pasted in playlist mode fails with a clear message
 * instead of quietly downloading one song.
 */
export async function resolveSpotifyUrl(spotifyUrl, mode = 'auto') {
    const kind = detectKind(spotifyUrl);
    if (!kind) throw new Error('That does not look like a Spotify track, album or playlist link.');

    // checked up front so a mismatch costs no API call
    const allowed = MODE_KINDS[mode];
    if (allowed && !allowed.includes(kind)) {
        throw new Error(
            mode === 'track'
                ? `That is ${KIND_ARTICLE(kind)} ${kind} link — switch to Playlist mode, or paste a single song link.`
                : 'That is a track link — switch to Single song mode, or paste a playlist or album link.'
        );
    }

    if (kind === 'liked') return { kind, ...(await getLikedSongs()) };
    if (kind === 'playlist') return { kind, ...(await getSpotifyPlaylist(spotifyUrl)) };
    if (kind === 'album') return { kind, ...(await getSpotifyAlbum(spotifyUrl)) };
    const track = await getSpotifySong(spotifyUrl);
    return { kind, title: track.name, owner: track.artist, art: track.art, tracks: [track] };
}

/**
 * Free-text search, so a link is never strictly required.
 * Works on the app token — logging in is not needed.
 */
export async function searchSpotify(query, type = 'track', limit = 10) {
    await ensureAccessToken();
    if (type === 'playlist') {
        const res = await spotifyApi.searchPlaylists(query, { limit });
        return (res.body.playlists?.items ?? []).filter(Boolean).map((p) => ({
            kind: 'playlist',
            name: p.name,
            subtitle: p.owner?.display_name ?? '',
            detail: `${p.tracks?.total ?? 0} tracks`,
            art: p.images?.slice(-1)[0]?.url ?? null,
            url: p.external_urls?.spotify ?? null,
        }));
    }
    const res = await spotifyApi.searchTracks(query, { limit });
    return (res.body.tracks?.items ?? []).filter(Boolean).map((t) => ({
        kind: 'track',
        name: t.name,
        subtitle: t.artists?.[0]?.name ?? '',
        detail: t.album?.name ?? '',
        art: t.album?.images?.slice(-1)[0]?.url ?? null,
        url: t.external_urls?.spotify ?? null,
    }));
}

/* ------------------------------------------------------------------ *
 * YouTube matching
 * ------------------------------------------------------------------ */

// variant markers that almost always mean "not the track you asked for"
const VARIANT_WORDS = [
    'live', 'cover', 'remix', 'sped up', 'slowed', 'reverb', 'reaction',
    '8d', 'karaoke', 'instrumental', 'nightcore', 'mashup', 'tutorial', 'lesson',
];

const MAX_DURATION_DELTA = 45; // seconds

/** Parses YouTube's "m:ss" / "h:mm:ss" length into seconds. */
export function parseLength(length) {
    const text =
        typeof length === 'string'
            ? length
            : length?.simpleText ?? length?.accessibility?.accessibilityData?.label ?? '';
    const match = String(text).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const [, hours, minutes, seconds] = match;
    return Number(hours || 0) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/**
 * Scores one YouTube result against the Spotify track.
 * Returns null to reject outright — a clear failure beats downloading the wrong song.
 */
export function scoreCandidate(candidate, song) {
    if (candidate?.isLive) return null;

    const title = String(candidate?.title ?? '');
    const songTitle = String(song?.name ?? '');
    for (const word of VARIANT_WORDS) {
        const pattern = new RegExp(`\\b${word}\\b`, 'i');
        // only a problem if the Spotify track itself is not that variant
        if (pattern.test(title) && !pattern.test(songTitle)) return null;
    }

    const seconds = parseLength(candidate?.length);
    const target = song?.durationMs ? Math.round(song.durationMs / 1000) : null;

    let score;
    if (target !== null) {
        // an unknown length cannot be verified against a known target, so reject it
        if (seconds === null) return null;
        const delta = Math.abs(seconds - target);
        if (delta > MAX_DURATION_DELTA) return null;
        score = 100 - delta * 2;
    } else {
        score = 50;
    }

    const channel = String(candidate?.channelTitle ?? '').trim();
    const artist = String(song?.artist ?? '').toLowerCase();
    // "<Artist> - Topic" channels are YouTube's auto-generated official audio
    if (/-\s*topic$/i.test(channel)) score += 30;
    else if (artist && channel.toLowerCase().includes(artist)) score += 20;

    if (/\bofficial\s+(audio|video|music video)\b/i.test(title)) score += 10;
    if (artist && title.toLowerCase().includes(artist)) score += 5;

    return score;
}

export async function searchYoutube(song, { limit = 5 } = {}) {
    const query = `${song.name} ${song.artist} audio`;
    const results = await ytSearch.GetListByKeyword(query, false, limit, [{ type: 'video' }]);
    const items = (results?.items ?? []).filter((item) => item && item.id);

    let best = null;
    for (const item of items) {
        const score = scoreCandidate(item, song);
        if (score === null) continue;
        if (!best || score > best.score) best = { score, item };
    }
    if (!best) return null;

    return {
        url: `https://www.youtube.com/watch?v=${best.item.id}`,
        title: best.item.title,
        channel: best.item.channelTitle,
        seconds: parseLength(best.item.length),
        score: best.score,
    };
}

/* ------------------------------------------------------------------ *
 * Downloading
 * ------------------------------------------------------------------ */

/** Strips characters that are unsafe or awkward in file and folder names. */
export function safeName(value) {
    return String(value)
        .replace(/[/\\?%*:|"<>]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || 'Untitled';
}

/** Where a release's files belong: downloads/<name>/, with loose tracks in Singles/. */
export function releaseDir(release, base = DOWNLOAD_DIR) {
    if (!release || release.kind === 'track') return path.join(base, 'Singles');
    return path.join(base, safeName(release.title));
}

const ANSI = /\[[0-9;]*[a-zA-Z]/g;

export function downloadSong(link, song, { format = 'mp3', dir = DOWNLOAD_DIR, overwrite = false, onProgress } = {}) {
    fs.mkdirSync(dir, { recursive: true });
    const base = safeName(`${song.name} - ${song.artist}`);
    const target = path.join(dir, `${base}.${format}`);
    const relative = path.relative(DOWNLOAD_DIR, target);

    // the output path is deterministic, so an existing file means we already have this track
    if (!overwrite && fs.existsSync(target)) {
        return Promise.resolve({ file: relative, absolute: target, skipped: true });
    }

    const args = [
        '-x',
        '--audio-format', format,
        '--no-playlist',
        '--newline',
        '--progress-template', 'download:%(progress._percent_str)s',
        '-o', path.join(dir, `${base}.%(ext)s`),
    ];
    if (overwrite) args.push('--force-overwrites');
    args.push(link);

    return new Promise((resolve, reject) => {
        // an argument array means no shell, so quotes in track names cannot inject
        const child = spawn('yt-dlp', args);
        let stderr = '';

        child.stdout.on('data', (chunk) => {
            if (!onProgress) return;
            const match = String(chunk).replace(ANSI, '').match(/(\d+(?:\.\d+)?)%\s*$/m);
            if (match) onProgress(Number(match[1]));
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk;
        });
        child.on('error', (err) => {
            reject(err.code === 'ENOENT' ? new Error('yt-dlp is not installed or not on PATH.') : err);
        });
        child.on('close', (code) => {
            if (code === 0) return resolve({ file: relative, absolute: target, skipped: false });
            const last = stderr.trim().split('\n').filter(Boolean).slice(-1)[0];
            reject(new Error(last || `yt-dlp exited with code ${code}`));
        });
    });
}

/**
 * Downloads every track, reporting progress through `onEvent`.
 *
 * Runs `concurrency` tracks at once; every event carries its track `index`, so
 * consumers can handle out-of-order completion. `shouldStop()` is checked before
 * each track is claimed, so cancelling takes effect once in-flight work drains.
 */
export async function downloadTracks(
    tracks,
    {
        format = 'mp3',
        dir = DOWNLOAD_DIR,
        concurrency = 3,
        overwrite = false,
        release = null,
        onEvent = () => {},
        shouldStop = () => false,
    } = {}
) {
    // filled, not sparse: map() skips holes, which would silently drop cancelled tracks
    const results = new Array(tracks.length).fill(null);
    let cursor = 0;
    let stopped = false;

    // one cover fetch for the whole release rather than one per track
    const coverUrl = release?.art ?? tracks.find((t) => t.artLarge)?.artLarge ?? null;
    const cover = await fetchCover(coverUrl);

    async function worker() {
        while (true) {
            if (shouldStop()) {
                stopped = true;
                return;
            }
            const index = cursor++;
            if (index >= tracks.length) return;

            const song = tracks[index];
            onEvent({ type: 'track-start', index, song });
            try {
                const match = await searchYoutube(song);
                if (!match) throw new Error('No confident YouTube match found.');
                onEvent({ type: 'track-match', index, match });

                const { file, absolute, skipped } = await downloadSong(match.url, song, {
                    format,
                    dir,
                    overwrite,
                    onProgress: (percent) => onEvent({ type: 'track-progress', index, percent }),
                });

                if (skipped) {
                    results[index] = { song, file, status: 'skipped' };
                    onEvent({ type: 'track-skipped', index, file });
                    continue;
                }

                // the audio is already on disk, so a tagging failure is a warning, not a failure
                try {
                    await tagFile(absolute, song, { cover, format });
                } catch (err) {
                    onEvent({ type: 'track-warning', index, message: `Tagging failed: ${err.message}` });
                }

                results[index] = { song, file, status: 'done' };
                onEvent({ type: 'track-done', index, file });
            } catch (err) {
                results[index] = { song, status: 'failed', error: err.message };
                onEvent({ type: 'track-failed', index, error: err.message });
            }
        }
    }

    const workers = Math.max(1, Math.min(Number(concurrency) || 1, tracks.length || 1));
    try {
        await Promise.all(Array.from({ length: workers }, worker));
    } finally {
        cleanupCover(cover);
    }

    if (stopped) onEvent({ type: 'cancelled' });
    // cancelled runs leave holes; report them so counts stay honest
    return results.map((result, index) => result ?? { song: tracks[index], status: 'cancelled' });
}

/* ------------------------------------------------------------------ *
 * Environment preflight
 * ------------------------------------------------------------------ */

function probe(cmd, args) {
    return new Promise((resolve) => {
        execFile(cmd, args, (err) => resolve(!err));
    });
}

let toolCache = null;

/** Checks the external binaries once, so a missing one is reported before a run starts. */
export async function checkTools({ refresh = false } = {}) {
    if (toolCache && !refresh) return toolCache;
    const [ytdlp, ffmpeg] = await Promise.all([
        probe('yt-dlp', ['--version']),
        probe('ffmpeg', ['-version']),
    ]);
    toolCache = {
        ytdlp: { present: ytdlp, install: 'brew install yt-dlp' },
        ffmpeg: { present: ffmpeg, install: 'brew install ffmpeg' },
    };
    return toolCache;
}
