import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import {
    resolveSpotifyUrl,
    downloadTracks,
    searchSpotify,
    releaseDir,
    checkTools,
    hasCredentials,
    DOWNLOAD_DIR,
} from './lib/downloader.js';
import {
    spotifyApi,
    ensureAccessToken,
    createLoginUrl,
    handleCallback,
    logout,
    isLoggedIn,
    currentUser,
} from './lib/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// in-memory job registry: jobs only need to outlive the page that started them
const jobs = new Map();

function emit(job, event) {
    job.events.push(event);
    for (const res of job.listeners) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
}

/**
 * Creates a job and runs it in the background. Shared by a fresh download and by
 * a retry, so both paths behave identically.
 */
function startJob({ release, tracks, format, concurrency, overwrite }) {
    const id = randomUUID();
    const job = {
        id,
        title: release.title,
        release,
        tracks,
        total: tracks.length,
        format,
        concurrency,
        overwrite,
        status: 'running',
        results: null,
        events: [],
        listeners: new Set(),
        cancelled: false,
    };
    jobs.set(id, job);

    downloadTracks(tracks, {
        format,
        concurrency,
        overwrite,
        release,
        dir: releaseDir(release),
        onEvent: (event) => emit(job, event),
        shouldStop: () => job.cancelled,
    })
        .then((results) => {
            // kept so /retry knows exactly which tracks failed
            job.results = results;
            job.status = job.cancelled ? 'cancelled' : 'finished';
            emit(job, {
                type: 'finished',
                status: job.status,
                completed: results.filter((r) => r.status === 'done').length,
                skipped: results.filter((r) => r.status === 'skipped').length,
                failed: results.filter((r) => r.status === 'failed').length,
            });
        })
        .catch((err) => {
            job.status = 'error';
            emit(job, { type: 'error', error: err.message });
        });

    return job;
}

/* ------------------------------- status ------------------------------- */

app.get('/api/health', async (req, res) => {
    res.json({
        configured: hasCredentials(),
        loggedIn: isLoggedIn(),
        user: currentUser(),
        tools: await checkTools(),
        downloadDir: DOWNLOAD_DIR,
    });
});

/* -------------------------------- auth -------------------------------- */

app.get('/auth/login', (req, res) => {
    try {
        res.redirect(createLoginUrl());
    } catch (err) {
        res.status(400).send(err.message);
    }
});

app.get('/auth/callback', async (req, res) => {
    try {
        await handleCallback(req.query.code, req.query.state);
        res.redirect('/');
    } catch (err) {
        res.status(400).send(`Login failed: ${err.message}`);
    }
});

app.post('/auth/logout', (req, res) => {
    logout();
    res.json({ ok: true });
});

app.get('/api/me/playlists', async (req, res) => {
    try {
        await ensureAccessToken({ requireUser: true });
        const me = await spotifyApi.getMe();
        const page = await spotifyApi.getUserPlaylists(me.body.id, { limit: 50 });
        res.json({
            playlists: page.body.items.filter(Boolean).map((p) => ({
                name: p.name,
                subtitle: p.owner?.display_name ?? '',
                detail: `${p.tracks?.total ?? 0} tracks`,
                art: p.images?.slice(-1)[0]?.url ?? null,
                url: p.external_urls?.spotify ?? null,
            })),
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

/* ------------------------------- search ------------------------------- */

app.get('/api/search', async (req, res) => {
    const query = String(req.query.q || '').trim();
    if (!query) return res.json({ results: [] });
    try {
        const type = req.query.type === 'playlist' ? 'playlist' : 'track';
        res.json({ results: await searchSpotify(query, type) });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

/* -------------------------------- jobs -------------------------------- */

// step 1: look up the link so the user can review the tracklist before downloading
app.post('/api/resolve', async (req, res) => {
    try {
        const data = await resolveSpotifyUrl(String(req.body.url || '').trim(), req.body.mode || 'auto');
        res.json(data);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// step 2: kick off a background job and hand back an id to stream from
app.post('/api/jobs', async (req, res) => {
    const { url, format = 'mp3', indices, mode = 'auto', concurrency = 3, overwrite = false } = req.body || {};
    try {
        const release = await resolveSpotifyUrl(String(url || '').trim(), mode);
        const selected =
            Array.isArray(indices) && indices.length
                ? indices.map((i) => release.tracks[i]).filter(Boolean)
                : release.tracks;
        if (!selected.length) return res.status(400).json({ error: 'No tracks selected.' });

        const job = startJob({ release, tracks: selected, format, concurrency, overwrite });
        res.json({ id: job.id, title: job.title, tracks: selected, total: selected.length });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

/**
 * Retries only the failed tracks of a finished job.
 * Done server-side because the client's row indices are relative to its selected
 * subset, while the job's are relative to the full resolved list.
 */
app.post('/api/jobs/:id/retry', (req, res) => {
    const previous = jobs.get(req.params.id);
    if (!previous) return res.status(404).json({ error: 'Unknown job.' });
    if (!previous.results) return res.status(409).json({ error: 'That job has not finished yet.' });

    const failed = previous.results.filter((r) => r.status === 'failed').map((r) => r.song);
    if (!failed.length) return res.status(400).json({ error: 'Nothing failed in that job.' });

    const job = startJob({
        release: previous.release,
        tracks: failed,
        format: previous.format,
        concurrency: previous.concurrency,
        overwrite: previous.overwrite,
    });
    res.json({ id: job.id, title: job.title, tracks: failed, total: failed.length });
});

app.get('/api/jobs/:id/stream', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).end();

    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });
    res.flushHeaders();

    // replay what already happened so a reconnect never loses progress
    for (const event of job.events) res.write(`data: ${JSON.stringify(event)}\n\n`);
    job.listeners.add(res);
    req.on('close', () => job.listeners.delete(res));
});

app.post('/api/jobs/:id/cancel', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Unknown job.' });
    job.cancelled = true;
    res.json({ ok: true });
});

/* -------------------------------- files ------------------------------- */

function walk(dir, base = dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...walk(full, base));
        } else {
            const stat = fs.statSync(full);
            out.push({
                name: entry.name,
                path: path.relative(base, full),
                folder: path.relative(base, dir) || '.',
                size: stat.size,
                modified: stat.mtimeMs,
            });
        }
    }
    return out;
}

app.get('/api/files', (req, res) => {
    if (!fs.existsSync(DOWNLOAD_DIR)) return res.json({ dir: DOWNLOAD_DIR, files: [] });
    const files = walk(DOWNLOAD_DIR).sort((a, b) => b.modified - a.modified);
    res.json({ dir: DOWNLOAD_DIR, files });
});

// a regex route, because file paths now contain slashes
app.get(/^\/api\/files\/(.+)$/, (req, res) => {
    const requested = decodeURIComponent(req.params[0]);
    const target = path.resolve(DOWNLOAD_DIR, requested);
    // resolve first, then confirm the result is still inside the download folder,
    // so "../" cannot escape while nested playlist folders still work
    if (!target.startsWith(DOWNLOAD_DIR + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
        return res.status(404).end();
    }
    res.download(target);
});

app.listen(PORT, () => {
    console.log(`🎧 Playlist Downloader UI → http://localhost:${PORT}`);
});
