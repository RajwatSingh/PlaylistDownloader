import { resolveSpotifyUrl, downloadTracks, DOWNLOAD_DIR } from './lib/downloader.js';

const spotifyUrl = process.argv[2];
if (!spotifyUrl) {
    console.error('🚨 Error: Please provide a Spotify track, album or playlist URL!');
    process.exit(1);
}

try {
    const data = await resolveSpotifyUrl(spotifyUrl);
    console.log(`🎧 ${data.title} — ${data.tracks.length} track(s) → ${DOWNLOAD_DIR}`);

    const results = await downloadTracks(data.tracks, {
        onEvent: (e) => {
            if (e.type === 'track-start') console.log(`⬇️  ${e.song.name} — ${e.song.artist}`);
            if (e.type === 'track-done') console.log(`✅ ${e.file}`);
            if (e.type === 'track-failed') console.error(`🚨 ${e.error}`);
        },
    });

    const failed = results.filter((r) => r.status === 'failed').length;
    console.log(`\n✨ Done — ${results.length - failed} saved${failed ? `, ${failed} failed` : ''}.`);
} catch (err) {
    console.error('🚨', err.message);
    process.exit(1);
}
