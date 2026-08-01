const $ = (id) => document.getElementById(id);

const el = {
    form: $('resolve-form'),
    modes: document.querySelectorAll('.mode'),
    hint: $('hint'),
    url: $('url'),
    format: $('format'),
    concurrency: $('concurrency'),
    overwrite: $('overwrite'),
    picker: $('picker'),
    quick: $('quick'),
    likedBtn: $('liked-btn'),
    myPlaylistsBtn: $('my-playlists-btn'),
    loginBtn: $('login-btn'),
    accountUser: $('account-user'),
    accountName: $('account-name'),
    logoutBtn: $('logout-btn'),
    resolveBtn: $('resolve-btn'),
    error: $('error'),
    warning: $('config-warning'),
    toolsWarning: $('tools-warning'),
    result: $('result'),
    art: $('release-art'),
    kind: $('release-kind'),
    title: $('release-title'),
    sub: $('release-sub'),
    toggleAll: $('toggle-all'),
    downloadBtn: $('download-btn'),
    retryBtn: $('retry-btn'),
    cancelBtn: $('cancel-btn'),
    progress: $('progress'),
    progressFill: $('progress-fill'),
    progressText: $('progress-text'),
    tracks: $('tracks'),
    files: $('files'),
    libraryPath: $('library-path'),
    refreshFiles: $('refresh-files'),
};

const LIKED_URL = 'https://open.spotify.com/collection/tracks';

const MODES = {
    playlist: {
        placeholder: 'Search playlists, or paste a Spotify link…',
        hint: 'Public playlists and albums. Log in for your own private ones.',
        button: 'Download all',
        searchType: 'playlist',
    },
    track: {
        placeholder: 'Search songs, or paste a Spotify link…',
        hint: 'A single Spotify song.',
        button: 'Download song',
        searchType: 'track',
    },
};

let mode = 'playlist';
let current = null; // { url, tracks }
let stream = null;
let jobId = null;
let searchTimer = null;

function showError(message) {
    el.error.textContent = message;
    el.error.hidden = !message;
}

function isUrl(value) {
    return /^https?:\/\//i.test(value.trim());
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
    hidePicker();
    current = null;
    showError('');
}

/* ------------------------------ search ------------------------------ */

function hidePicker() {
    el.picker.hidden = true;
    el.picker.replaceChildren();
}

function renderPicker(results) {
    el.picker.replaceChildren();
    if (!results.length) {
        hidePicker();
        return;
    }
    for (const item of results) {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'picker__item';

        if (item.art) {
            const img = document.createElement('img');
            img.src = item.art;
            img.alt = '';
            button.append(img);
        }

        const body = document.createElement('span');
        body.className = 'picker__body';
        const name = document.createElement('span');
        name.className = 'picker__name';
        name.textContent = item.name;
        const sub = document.createElement('span');
        sub.className = 'picker__sub';
        sub.textContent = [item.subtitle, item.detail].filter(Boolean).join(' · ');
        body.append(name, sub);
        button.append(body);

        // choosing a result just fills in its link and runs the normal resolve path
        button.addEventListener('click', () => {
            el.url.value = item.url;
            hidePicker();
            resolveCurrentInput();
        });

        li.append(button);
        el.picker.append(li);
    }
    el.picker.hidden = false;
}

async function runSearch(query) {
    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&type=${MODES[mode].searchType}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Search failed.');
        renderPicker(data.results);
    } catch (err) {
        showError(err.message);
    }
}

/* ----------------------------- resolving ----------------------------- */

function renderTracks(tracks) {
    el.tracks.replaceChildren();
    tracks.forEach((track) => {
        const li = document.createElement('li');
        li.className = 'track';

        const fill = document.createElement('span');
        fill.className = 'track__fill';

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

        li.append(fill, check, body, status);
        el.tracks.append(li);
    });
    el.toggleAll.textContent = 'Deselect all';
    // picking a subset is meaningless for one song
    el.toggleAll.hidden = tracks.length < 2;
}

function showRelease(data) {
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
    el.retryBtn.hidden = true;
    el.result.hidden = false;
}

async function resolveCurrentInput() {
    const value = el.url.value.trim();
    if (!value) return;

    showError('');
    el.resolveBtn.disabled = true;
    el.resolveBtn.textContent = 'Looking up…';

    try {
        const res = await fetch('/api/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: value, mode }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Lookup failed.');

        current = { url: value, tracks: data.tracks };
        showRelease(data);
    } catch (err) {
        showError(err.message);
    } finally {
        el.resolveBtn.disabled = false;
        el.resolveBtn.textContent = 'Look up';
    }
}

// a link resolves directly; anything else is treated as a search query
async function onSubmit(event) {
    event.preventDefault();
    const value = el.url.value.trim();
    if (!value) return;
    hidePicker();
    if (isUrl(value)) return resolveCurrentInput();
    return runSearch(value);
}

/* ----------------------------- downloads ----------------------------- */

function setRunning(running) {
    el.downloadBtn.disabled = running;
    el.resolveBtn.disabled = running;
    el.toggleAll.disabled = running;
    el.retryBtn.disabled = running;
    el.cancelBtn.hidden = !running;
    el.downloadBtn.textContent = running ? 'Downloading…' : MODES[mode].button;
    el.modes.forEach((btn) => (btn.disabled = running));
}

function selectedIndices() {
    return [...el.tracks.querySelectorAll('input[type="checkbox"]')]
        .map((cb, i) => (cb.checked ? i : -1))
        .filter((i) => i >= 0);
}

function rowAt(index) {
    return el.tracks.children[index];
}

function setStatus(row, text) {
    if (row) row.querySelector('.track__status').textContent = text;
}

/**
 * Tracks per-track completion as fractions so the overall bar moves smoothly
 * while several downloads run at once.
 */
function makeTracker(total) {
    const fractions = new Array(total).fill(0);
    return {
        set(index, value) {
            fractions[index] = value;
            const sum = fractions.reduce((a, b) => a + b, 0);
            el.progressFill.style.width = `${total ? (sum / total) * 100 : 0}%`;
        },
    };
}

function handleEvent(event, jobTracks, counters, tracker) {
    const row = rowAt(event.index);
    switch (event.type) {
        case 'track-start':
            if (row) {
                row.className = 'track track--active';
                setStatus(row, 'Searching…');
                row.scrollIntoView({ block: 'nearest' });
            }
            counters.started++;
            el.progressText.textContent = `${counters.started} of ${jobTracks.length} — ${event.song.name}`;
            break;
        case 'track-match':
            if (row) row.title = `Matched: ${event.match.title} — ${event.match.channel}`;
            setStatus(row, 'Starting…');
            break;
        case 'track-progress':
            if (row) {
                row.querySelector('.track__fill').style.width = `${event.percent}%`;
                setStatus(row, `${Math.round(event.percent)}%`);
            }
            tracker.set(event.index, event.percent / 100);
            break;
        case 'track-warning':
            if (row) row.title = `${row.title}\n${event.message}`;
            break;
        case 'track-done':
            counters.done++;
            if (row) {
                row.className = 'track track--done';
                row.querySelector('.track__fill').style.width = '100%';
                setStatus(row, 'Saved');
            }
            tracker.set(event.index, 1);
            break;
        case 'track-skipped':
            counters.skipped++;
            if (row) {
                row.className = 'track track--skipped';
                setStatus(row, 'Already saved');
            }
            tracker.set(event.index, 1);
            break;
        case 'track-failed':
            counters.failed++;
            if (row) {
                row.className = 'track track--failed';
                setStatus(row, event.error);
            }
            tracker.set(event.index, 1);
            break;
        case 'cancelled':
            el.progressText.textContent = 'Stopping…';
            break;
        case 'error':
            showError(event.error);
            break;
        case 'finished': {
            const parts = [`${event.completed} saved`];
            if (event.skipped) parts.push(`${event.skipped} already had`);
            if (event.failed) parts.push(`${event.failed} failed`);
            el.progressText.textContent =
                (event.status === 'cancelled' ? 'Stopped — ' : 'Done — ') + parts.join(', ') + '.';
            el.retryBtn.hidden = !event.failed;
            el.retryBtn.textContent = `Retry ${event.failed} failed`;
            stream?.close();
            stream = null;
            setRunning(false);
            loadFiles();
            break;
        }
    }
}

function attachStream(data) {
    jobId = data.id;
    // the job list is the selection, so re-render to keep row indices aligned with events
    renderTracks(data.tracks);
    el.tracks.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.disabled = true));
    el.toggleAll.hidden = true;

    const counters = { started: 0, done: 0, skipped: 0, failed: 0 };
    const tracker = makeTracker(data.tracks.length);
    stream = new EventSource(`/api/jobs/${data.id}/stream`);
    stream.onmessage = (msg) => handleEvent(JSON.parse(msg.data), data.tracks, counters, tracker);
    stream.onerror = () => {
        // the browser retries on its own; replayed events keep the view correct
    };
}

async function startJob(request) {
    showError('');
    setRunning(true);
    el.progress.hidden = false;
    el.retryBtn.hidden = true;
    el.progressText.textContent = 'Starting…';
    el.progressFill.style.width = '0%';

    try {
        const res = await fetch(request.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: request.body ? JSON.stringify(request.body) : undefined,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not start the download.');
        attachStream(data);
    } catch (err) {
        showError(err.message);
        setRunning(false);
    }
}

function startDownload() {
    if (!current) return;
    const indices = selectedIndices();
    if (!indices.length) return showError('Select at least one track.');

    return startJob({
        url: '/api/jobs',
        body: {
            url: current.url,
            format: el.format.value,
            concurrency: Number(el.concurrency.value),
            overwrite: el.overwrite.checked,
            indices,
            mode,
        },
    });
}

function retryFailed() {
    if (!jobId) return;
    return startJob({ url: `/api/jobs/${jobId}/retry` });
}

async function cancelJob() {
    if (!jobId) return;
    el.cancelBtn.disabled = true;
    await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
    el.progressText.textContent = 'Stopping after in-flight tracks…';
    el.cancelBtn.disabled = false;
}

/* ------------------------------ library ------------------------------ */

async function loadFiles() {
    const res = await fetch('/api/files');
    const data = await res.json();
    el.libraryPath.textContent = data.dir;
    el.files.replaceChildren();

    if (!data.files.length) {
        const empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'Nothing downloaded yet.';
        el.files.append(empty);
        return;
    }

    // group by playlist folder so the list mirrors what is on disk
    const groups = new Map();
    for (const file of data.files) {
        if (!groups.has(file.folder)) groups.set(file.folder, []);
        groups.get(file.folder).push(file);
    }

    for (const [folder, files] of groups) {
        const section = document.createElement('div');
        section.className = 'file-group';

        const heading = document.createElement('h3');
        heading.textContent = folder === '.' ? 'Downloads' : folder;
        section.append(heading);

        const list = document.createElement('ul');
        for (const file of files) {
            const li = document.createElement('li');
            const link = document.createElement('a');
            link.href = `/api/files/${file.path.split('/').map(encodeURIComponent).join('/')}`;
            link.textContent = file.name;
            const size = document.createElement('span');
            size.className = 'muted mono';
            size.textContent = formatSize(file.size);
            li.append(link, size);
            list.append(li);
        }
        section.append(list);
        el.files.append(section);
    }
}

/* ------------------------------ account ------------------------------ */

async function loadHealth() {
    const res = await fetch('/api/health');
    const data = await res.json();

    el.warning.hidden = data.configured;

    const missing = Object.entries(data.tools || {}).filter(([, tool]) => !tool.present);
    if (missing.length) {
        el.toolsWarning.replaceChildren();
        const strong = document.createElement('strong');
        strong.textContent = `Missing: ${missing.map(([name]) => name).join(', ')}.`;
        const span = document.createElement('span');
        span.textContent = `Downloads will fail until installed — ${missing
            .map(([, tool]) => tool.install)
            .join(' && ')}`;
        el.toolsWarning.append(strong, span);
        el.toolsWarning.hidden = false;
    } else {
        el.toolsWarning.hidden = true;
    }

    el.loginBtn.hidden = data.loggedIn || !data.configured;
    el.accountUser.hidden = !data.loggedIn;
    el.quick.hidden = !data.loggedIn;
    if (data.user) el.accountName.textContent = data.user.name;
}

async function loadMyPlaylists() {
    showError('');
    try {
        const res = await fetch('/api/me/playlists');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load your playlists.');
        renderPicker(data.playlists);
    } catch (err) {
        showError(err.message);
    }
}

/* ------------------------------- wiring ------------------------------ */

el.modes.forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
el.form.addEventListener('submit', onSubmit);
el.downloadBtn.addEventListener('click', startDownload);
el.retryBtn.addEventListener('click', retryFailed);
el.cancelBtn.addEventListener('click', cancelJob);
el.refreshFiles.addEventListener('click', loadFiles);
el.myPlaylistsBtn.addEventListener('click', loadMyPlaylists);

el.likedBtn.addEventListener('click', () => {
    el.url.value = LIKED_URL;
    hidePicker();
    resolveCurrentInput();
});

el.logoutBtn.addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    loadHealth();
});

// type-ahead search, debounced; links are left alone
el.url.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const value = el.url.value.trim();
    if (value.length < 3 || isUrl(value)) return hidePicker();
    searchTimer = setTimeout(() => runSearch(value), 300);
});

el.toggleAll.addEventListener('click', () => {
    const boxes = [...el.tracks.querySelectorAll('input[type="checkbox"]')];
    const next = !boxes.every((cb) => cb.checked);
    boxes.forEach((cb) => (cb.checked = next));
    el.toggleAll.textContent = next ? 'Deselect all' : 'Select all';
});

setMode('playlist');
loadHealth();
loadFiles();
