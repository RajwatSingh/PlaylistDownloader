import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { resolveSpotifyUrl, downloadTracks, DOWNLOAD_DIR } from './lib/downloader.js';

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

app.get('/api/health', (req, res) => {
    res.json({
        configured: Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET),
        downloadDir: DOWNLOAD_DIR,
    });
});

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
    const { url, format = 'mp3', indices, mode = 'auto' } = req.body || {};
    try {
        const data = await resolveSpotifyUrl(String(url || '').trim(), mode);
        const selected = Array.isArray(indices) && indices.length
            ? indices.map((i) => data.tracks[i]).filter(Boolean)
            : data.tracks;
        if (!selected.length) return res.status(400).json({ error: 'No tracks selected.' });

        const id = randomUUID();
        const job = {
            id,
            title: data.title,
            total: selected.length,
            tracks: selected,
            status: 'running',
            events: [],
            listeners: new Set(),
            cancelled: false,
        };
        jobs.set(id, job);
        res.json({ id, title: data.title, tracks: selected, total: selected.length });

        downloadTracks(selected, {
            format,
            onEvent: (e) => emit(job, e),
            shouldStop: () => job.cancelled,
        })
            .then((results) => {
                job.status = job.cancelled ? 'cancelled' : 'finished';
                emit(job, {
                    type: 'finished',
                    status: job.status,
                    completed: results.filter((r) => r.status === 'done').length,
                    failed: results.filter((r) => r.status === 'failed').length,
                });
            })
            .catch((err) => {
                job.status = 'error';
                emit(job, { type: 'error', error: err.message });
            });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
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

app.get('/api/files', (req, res) => {
    if (!fs.existsSync(DOWNLOAD_DIR)) return res.json({ dir: DOWNLOAD_DIR, files: [] });
    const files = fs
        .readdirSync(DOWNLOAD_DIR)
        .filter((f) => !f.startsWith('.'))
        .map((f) => {
            const stat = fs.statSync(path.join(DOWNLOAD_DIR, f));
            return { name: f, size: stat.size, modified: stat.mtimeMs };
        })
        .sort((a, b) => b.modified - a.modified);
    res.json({ dir: DOWNLOAD_DIR, files });
});

app.get('/api/files/:name', (req, res) => {
    // resolve then re-check the parent, so "../" in the name cannot escape the folder
    const target = path.resolve(DOWNLOAD_DIR, req.params.name);
    if (path.dirname(target) !== DOWNLOAD_DIR || !fs.existsSync(target)) {
        return res.status(404).end();
    }
    res.download(target);
});

app.listen(PORT, () => {
    console.log(`🎧 Playlist Downloader UI → http://localhost:${PORT}`);
});
