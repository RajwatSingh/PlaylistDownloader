import dotenv from 'dotenv';
import SpotifyWebApi from 'spotify-web-api-node';
import * as ytSearch from 'youtube-search-api';
import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';

dotenv.config();

const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

export const DOWNLOAD_DIR = path.resolve(process.env.DOWNLOAD_DIR || 'downloads');

// the client credentials token expires, so we only refresh it when it is stale
let tokenExpiresAt = 0;

export async function ensureAccessToken() {
    if (Date.now() < tokenExpiresAt - 60_000) return;
    if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
        throw new Error('Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET — add them to a .env file.');
    }
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body['access_token']);
    tokenExpiresAt = Date.now() + data.body['expires_in'] * 1000;
}

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

function toTrack(track) {
    return {
        name: track.name,
        artist: track.artists[0].name,
        album: track.album?.name ?? null,
        durationMs: track.duration_ms ?? null,
        art: track.album?.images?.slice(-1)[0]?.url ?? null,
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
    return {
        title: album.body.name,
        owner: album.body.artists?.[0]?.name ?? null,
        art: album.body.images?.[0]?.url ?? null,
        tracks: album.body.tracks.items.map((t) => ({
            ...toTrack(t),
            album: album.body.name,
            art: album.body.images?.slice(-1)[0]?.url ?? null,
        })),
    };
}

// which link kinds each user-facing mode will accept
const MODE_KINDS = {
    playlist: ['playlist', 'album'],
    track: ['track'],
};

/**
 * One entry point for any Spotify link the user pastes.
 * `mode` ('playlist' | 'track' | 'auto') rejects links that do not match what the
 * user asked for, so a track link pasted in playlist mode fails with a clear message
 * instead of quietly downloading one song.
 */
export function detectKind(spotifyUrl) {
    if (extractPlaylistId(spotifyUrl)) return 'playlist';
    if (extractAlbumId(spotifyUrl)) return 'album';
    if (extractTrackId(spotifyUrl)) return 'track';
    return null;
}

export async function resolveSpotifyUrl(spotifyUrl, mode = 'auto') {
    const kind = detectKind(spotifyUrl);
    if (!kind) throw new Error('That does not look like a Spotify track, album or playlist link.');

    // checked up front so a mismatch costs no API call
    const allowed = MODE_KINDS[mode];
    if (allowed && !allowed.includes(kind)) {
        throw new Error(
            mode === 'track'
                ? `That is ${kind === 'album' ? 'an' : 'a'} ${kind} link — switch to Playlist mode, or paste a single song link.`
                : 'That is a track link — switch to Single song mode, or paste a playlist or album link.'
        );
    }

    if (kind === 'playlist') return { kind, ...(await getSpotifyPlaylist(spotifyUrl)) };
    if (kind === 'album') return { kind, ...(await getSpotifyAlbum(spotifyUrl)) };
    const track = await getSpotifySong(spotifyUrl);
    return { kind, title: track.name, owner: track.artist, art: track.art, tracks: [track] };
}

export async function searchYoutube(song) {
    const query = `${song.name} ${song.artist} audio`;
    const results = await ytSearch.GetListByKeyword(query, false, 1);
    const item = results?.items?.[0];
    if (!item) return null;
    return `https://www.youtube.com/watch?v=${item.id}`;
}

function safeFilename(song) {
    return `${song.name} - ${song.artist}`.replace(/[/\\?%*:|"<>]/g, '-').trim();
}

export function downloadSong(link, song, { format = 'mp3', dir = DOWNLOAD_DIR } = {}) {
    fs.mkdirSync(dir, { recursive: true });
    const base = safeFilename(song);
    const output = path.join(dir, `${base}.%(ext)s`);
    const args = ['-x', '--audio-format', format, '--no-playlist', '-o', output, link];

    return new Promise((resolve, reject) => {
        // execFile avoids the shell, so track names with quotes cannot break the command
        execFile('yt-dlp', args, (err, stdout, stderr) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    return reject(new Error('yt-dlp is not installed or not on PATH.'));
                }
                return reject(new Error((stderr || err.message).trim().split('\n').slice(-1)[0]));
            }
            resolve(`${base}.${format}`);
        });
    });
}

/**
 * Downloads every track, reporting progress through `onEvent`.
 * `shouldStop()` is polled between tracks so the UI can cancel a run.
 */
export async function downloadTracks(tracks, { format = 'mp3', dir = DOWNLOAD_DIR, onEvent = () => {}, shouldStop = () => false } = {}) {
    const results = [];
    for (let i = 0; i < tracks.length; i++) {
        const song = tracks[i];
        if (shouldStop()) {
            onEvent({ type: 'cancelled', index: i });
            break;
        }
        onEvent({ type: 'track-start', index: i, song });
        try {
            const link = await searchYoutube(song);
            if (!link) throw new Error('No YouTube match found.');
            const file = await downloadSong(link, song, { format, dir });
            results.push({ song, file, status: 'done' });
            onEvent({ type: 'track-done', index: i, file });
        } catch (err) {
            results.push({ song, status: 'failed', error: err.message });
            onEvent({ type: 'track-failed', index: i, error: err.message });
        }
    }
    return results;
}
