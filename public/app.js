const $ = (id) => document.getElementById(id);

const el = {
    form: $('resolve-form'),
    modes: document.querySelectorAll('.mode'),
    hint: $('hint'),
    url: $('url'),
    format: $('format'),
    resolveBtn: $('resolve-btn'),
    error: $('error'),
    warning: $('config-warning'),
    result: $('result'),
    art: $('release-art'),
    kind: $('release-kind'),
    title: $('release-title'),
    sub: $('release-sub'),
    toggleAll: $('toggle-all'),
    downloadBtn: $('download-btn'),
    cancelBtn: $('cancel-btn'),
    progress: $('progress'),
    progressFill: $('progress-fill'),
    progressText: $('progress-text'),
    tracks: $('tracks'),
    files: $('files'),
    libraryPath: $('library-path'),
    refreshFiles: $('refresh-files'),
};

const MODES = {
    playlist: {
        placeholder: 'https://open.spotify.com/playlist/…',
        hint: 'Public playlists and albums.',
        button: 'Download all',
    },
    track: {
        placeholder: 'https://open.spotify.com/track/…',
        hint: 'A single Spotify song link.',
        button: 'Download song',
    },
};

let mode = 'playlist';
let current = null; // { url, tracks }
let stream = null;
let jobId = null;

function setMode(next) {
    mode = next;
    el.modes.forEach((btn) => {
        const active = btn.dataset.mode === next;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-checked', String(active));
    });
    el.url.placeholder = MODES[next].placeholder;
    el.hint.textContent = MODES[next].hint;
    el.downloadBtn.textContent = MODES[next].button;
    // the old result belongs to the other mode, so clear it rather than leave it stale
    el.result.hidden = true;
    current = null;
    showError('');
}

function showError(message) {
    el.error.textContent = message;
    el.error.hidden = !message;
}

function formatDuration(ms) {
    if (!ms) return '';
    const total = Math.round(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function formatSize(bytes) {
    const mb = bytes / 1024 / 1024;
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function selectedIndices() {
    return [...el.tracks.querySelectorAll('input[type="checkbox"]')]
        .map((cb, i) => (cb.checked ? i : -1))
        .filter((i) => i >= 0);
}

function renderTracks(tracks) {
    el.tracks.replaceChildren();
    tracks.forEach((track) => {
        const li = document.createElement('li');
        li.className = 'track';

        const check = document.createElement('input');
        check.type = 'checkbox';
        check.checked = true;

        const body = document.createElement('div');
        body.className = 'track__body';
        const name = document.createElement('span');
        name.className = 'track__name';
        name.textContent = track.name;
        const artist = document.createElement('span');
        artist.className = 'track__artist';
        artist.textContent = track.artist;
        body.append(name, artist);

        const status = document.createElement('span');
        status.className = 'track__status';
        status.textContent = formatDuration(track.durationMs);

        li.append(check, body, status);
        el.tracks.append(li);
    });
    el.toggleAll.textContent = 'Deselect all';
    // picking a subset is meaningless for one song
    el.toggleAll.hidden = tracks.length < 2;
}

async function resolveUrl(event) {
    event.preventDefault();
    showError('');
    el.resolveBtn.disabled = true;
    el.resolveBtn.textContent = 'Looking up…';

    try {
        const res = await fetch('/api/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: el.url.value, mode }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Lookup failed.');

        current = { url: el.url.value, tracks: data.tracks };
        el.kind.textContent = data.kind;
        el.title.textContent = data.title;
        el.sub.textContent = [data.owner, `${data.tracks.length} track${data.tracks.length === 1 ? '' : 's'}`]
            .filter(Boolean)
            .join(' · ');
        if (data.art) {
            el.art.src = data.art;
            el.art.hidden = false;
        } else {
            el.art.hidden = true;
        }
        renderTracks(data.tracks);
        el.progress.hidden = true;
        el.result.hidden = false;
    } catch (err) {
        showError(err.message);
    } finally {
        el.resolveBtn.disabled = false;
        el.resolveBtn.textContent = 'Look up';
    }
}

function setRunning(running) {
    el.downloadBtn.disabled = running;
    el.resolveBtn.disabled = running;
    el.toggleAll.disabled = running;
    el.cancelBtn.hidden = !running;
    el.downloadBtn.textContent = running ? 'Downloading…' : MODES[mode].button;
    el.modes.forEach((btn) => (btn.disabled = running));
}

function updateProgress(done, total) {
    el.progressFill.style.width = `${total ? (done / total) * 100 : 0}%`;
}

function rowAt(index) {
    return el.tracks.children[index];
}

function handleEvent(event, jobTracks, counters) {
    const row = rowAt(event.index);
    switch (event.type) {
        case 'track-start':
            if (row) {
                row.className = 'track track--active';
                row.lastChild.innerHTML = '<span class="spinner"></span>Downloading';
                row.scrollIntoView({ block: 'nearest' });
            }
            el.progressText.textContent = `${event.index + 1} of ${jobTracks.length} — ${event.song.name}`;
            break;
        case 'track-done':
            counters.done++;
            if (row) {
                row.className = 'track track--done';
                row.lastChild.textContent = 'Saved';
            }
            updateProgress(counters.done + counters.failed, jobTracks.length);
            break;
        case 'track-failed':
            counters.failed++;
            if (row) {
                row.className = 'track track--failed';
                row.lastChild.textContent = event.error;
            }
            updateProgress(counters.done + counters.failed, jobTracks.length);
            break;
        case 'cancelled':
            el.progressText.textContent = 'Stopped.';
            break;
        case 'error':
            showError(event.error);
            break;
        case 'finished':
            el.progressText.textContent =
                event.status === 'cancelled'
                    ? `Stopped — ${event.completed} saved.`
                    : `Done — ${event.completed} saved${event.failed ? `, ${event.failed} failed` : ''}.`;
            updateProgress(1, 1);
            stream?.close();
            stream = null;
            setRunning(false);
            loadFiles();
            break;
    }
}

async function startDownload() {
    if (!current) return;
    const indices = selectedIndices();
    if (!indices.length) return showError('Select at least one track.');

    showError('');
    setRunning(true);
    el.progress.hidden = false;
    el.progressText.textContent = 'Starting…';
    updateProgress(0, 1);

    try {
        const res = await fetch('/api/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: current.url, format: el.format.value, indices, mode }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not start the download.');

        jobId = data.id;
        // the job list is the selection, so re-render to keep row indices aligned with events
        renderTracks(data.tracks);
        el.tracks.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.disabled = true));

        const counters = { done: 0, failed: 0 };
        stream = new EventSource(`/api/jobs/${data.id}/stream`);
        stream.onmessage = (msg) => handleEvent(JSON.parse(msg.data), data.tracks, counters);
        stream.onerror = () => {
            // the browser retries on its own; replayed events keep the view correct
        };
    } catch (err) {
        showError(err.message);
        setRunning(false);
    }
}

async function cancelJob() {
    if (!jobId) return;
    el.cancelBtn.disabled = true;
    await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
    el.progressText.textContent = 'Stopping after the current track…';
    el.cancelBtn.disabled = false;
}

async function loadFiles() {
    const res = await fetch('/api/files');
    const data = await res.json();
    el.libraryPath.textContent = data.dir;
    el.files.replaceChildren();

    if (!data.files.length) {
        const empty = document.createElement('li');
        empty.className = 'empty';
        empty.textContent = 'Nothing downloaded yet.';
        el.files.append(empty);
        return;
    }

    for (const file of data.files) {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = `/api/files/${encodeURIComponent(file.name)}`;
        link.textContent = file.name;
        const size = document.createElement('span');
        size.className = 'muted mono';
        size.textContent = formatSize(file.size);
        li.append(link, size);
        el.files.append(li);
    }
}

async function loadHealth() {
    const res = await fetch('/api/health');
    const data = await res.json();
    el.warning.hidden = data.configured;
}

el.modes.forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
el.form.addEventListener('submit', resolveUrl);
el.downloadBtn.addEventListener('click', startDownload);
el.cancelBtn.addEventListener('click', cancelJob);
el.refreshFiles.addEventListener('click', loadFiles);
el.toggleAll.addEventListener('click', () => {
    const boxes = [...el.tracks.querySelectorAll('input[type="checkbox"]')];
    const next = !boxes.every((cb) => cb.checked);
    boxes.forEach((cb) => (cb.checked = next));
    el.toggleAll.textContent = next ? 'Deselect all' : 'Select all';
});

setMode('playlist');
loadHealth();
loadFiles();
