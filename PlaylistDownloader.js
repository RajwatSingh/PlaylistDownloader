import { parseArgs } from 'util';
import { resolveSpotifyUrl, downloadTracks, releaseDir, checkTools } from './lib/downloader.js';

const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        format: { type: 'string', short: 'f', default: 'mp3' },
        concurrency: { type: 'string', short: 'c', default: '3' },
        overwrite: { type: 'boolean', default: false },
    },
});

const spotifyUrl = positionals[0];
if (!spotifyUrl) {
    console.error('🚨 Usage: npm run cli -- <spotify-url> [--format mp3] [--concurrency 3] [--overwrite]');
    process.exit(1);
}

try {
    const tools = await checkTools();
    for (const [name, tool] of Object.entries(tools)) {
        if (!tool.present) {
            console.error(`🚨 ${name} is not installed — ${tool.install}`);
            process.exit(1);
        }
    }

    const release = await resolveSpotifyUrl(spotifyUrl);
    const dir = releaseDir(release);
    console.log(`🎧 ${release.title} — ${release.tracks.length} track(s) → ${dir}`);

    const results = await downloadTracks(release.tracks, {
        format: values.format,
        concurrency: Number(values.concurrency),
        overwrite: values.overwrite,
        release,
        dir,
        onEvent: (e) => {
            if (e.type === 'track-start') console.log(`⬇️  ${e.song.name} — ${e.song.artist}`);
            if (e.type === 'track-done') console.log(`✅ ${e.file}`);
            if (e.type === 'track-skipped') console.log(`⏭️  already have ${e.file}`);
            if (e.type === 'track-warning') console.warn(`⚠️  ${e.message}`);
            if (e.type === 'track-failed') console.error(`🚨 ${e.error}`);
        },
    });

    const count = (status) => results.filter((r) => r.status === status).length;
    console.log(`\n✨ Done — ${count('done')} saved, ${count('skipped')} already had, ${count('failed')} failed.`);
} catch (err) {
    console.error('🚨', err.message);
    process.exit(1);
}
