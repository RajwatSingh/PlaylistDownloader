import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// containers whose tags ffmpeg can write while stream-copying
const TAGGABLE = new Set(['mp3', 'm4a', 'opus', 'flac']);
// ...and the subset that can carry an embedded cover image
const COVER_CAPABLE = new Set(['mp3', 'm4a', 'flac']);

function run(cmd, args) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, (err, stdout, stderr) => {
            if (err) {
                if (err.code === 'ENOENT') return reject(new Error(`${cmd} is not installed or not on PATH.`));
                return reject(new Error((stderr || err.message).trim().split('\n').slice(-1)[0]));
            }
            resolve(stdout);
        });
    });
}

/**
 * Downloads cover art to a temp file once per release.
 * Returns null on any failure — artwork is a nicety, never a reason to fail a download.
 */
export async function fetchCover(url) {
    if (!url) return null;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const file = path.join(os.tmpdir(), `pldl-cover-${crypto.randomBytes(6).toString('hex')}.jpg`);
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        return file;
    } catch {
        return null;
    }
}

export function cleanupCover(file) {
    if (!file) return;
    try {
        fs.unlinkSync(file);
    } catch {
        /* already gone */
    }
}

/**
 * Writes real metadata (and cover art where the container supports it) onto a
 * finished download. `-c copy` means streams are remuxed, never re-encoded, so
 * this is fast and lossless.
 */
export async function tagFile(file, song, { cover = null, format = 'mp3' } = {}) {
    if (!TAGGABLE.has(format)) return false;

    const withCover = Boolean(cover) && COVER_CAPABLE.has(format);
    // ffmpeg cannot edit in place, so write beside the file and swap
    const tmp = file.replace(/\.([^.]+)$/, '.tagging.$1');

    const args = ['-y', '-i', file];
    if (withCover) args.push('-i', cover);

    args.push('-map', '0:a');
    if (withCover) args.push('-map', '1:v');
    args.push('-c', 'copy');

    if (format === 'mp3') args.push('-id3v2_version', '3');
    if (withCover) {
        args.push('-disposition:v:0', 'attached_pic');
        args.push('-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)');
    }

    args.push('-metadata', `title=${song.name}`, '-metadata', `artist=${song.artist}`);
    if (song.album) args.push('-metadata', `album=${song.album}`);
    if (song.releaseDate) args.push('-metadata', `date=${String(song.releaseDate).slice(0, 4)}`);
    if (song.trackNumber) args.push('-metadata', `track=${song.trackNumber}`);

    args.push(tmp);

    try {
        await run('ffmpeg', args);
        fs.renameSync(tmp, file);
        return true;
    } catch (err) {
        try {
            fs.unlinkSync(tmp);
        } catch {
            /* nothing to clean */
        }
        throw err;
    }
}
