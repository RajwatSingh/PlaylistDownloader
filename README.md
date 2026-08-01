# 🎧 Spotify Playlist to MP3 Downloader

**A simple Node.js tool that takes a Spotify playlist URL, searches for each track on YouTube, and downloads the best match as an MP3 file using `yt-dlp`.**

---

## 🚀 Features

- ✅ **Web UI** with live per-track progress, plus a CLI
- ✅ Download **playlists, albums or single songs** — by link *or* by searching names
- ✅ **Smart YouTube matching** — scores candidates by duration and channel, and rejects live
  versions, covers, remixes and sped-up edits instead of downloading the wrong song
- ✅ **Proper metadata** — title, artist, album, year and embedded album art
- ✅ **Organised output** — one folder per playlist/album
- ✅ **Parallel downloads**, resumable: already-downloaded tracks are skipped
- ✅ **Retry failed tracks** in one click
- ✅ **Log in with Spotify** for your private playlists and Liked Songs
- ✅ Format choice: `mp3`, `m4a`, `wav`, `opus`

---

## 🛠️ Built With

- **Node.js** + **Express**
- **Spotify Web API**
- **YouTube Search API**
- **yt-dlp** (YouTube downloader)
- **ffmpeg** (audio conversion + tagging)
- **dotenv** (for secure API credentials)

---

## ⚙️ Installation & Setup

### 1. 📦 Prerequisites

Ensure you have the following installed:

```bash
# Node.js
https://nodejs.org/

# yt-dlp (YouTube downloader)
pip install yt-dlp
# OR using Homebrew
brew install yt-dlp

# ffmpeg (for audio extraction)
brew install ffmpeg
# OR see https://ffmpeg.org/download.html for your platform
```

### 2. 🤟Project Setup
```bash 
# Clone the repo 
git clone https://github.com/<your-username>/spotify-playlist-downloader.git
cd spotify-playlist-downloader

# Install the dependencies
npm install

# Step 3: Configure Spotify API
# Create a .env file in the root directory and paste your Spotify developer credentials

#SPOTIFY_CLIENT_ID=your_spotify_client_id
#SPOTIFY_CLIENT_SECRET=your_spotify_client_secret

# Optional — only needed for "Log in with Spotify" (private playlists / Liked Songs).
# Register this exact URI in your Spotify dashboard. Spotify requires 127.0.0.1, not localhost.
#SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/auth/callback

# Optional — where files are saved (default ./downloads)
#DOWNLOAD_DIR=/path/to/music
```

# 🖥️ Web UI (recommended)
```bash
npm start
# → http://localhost:3000
```

Pick **Playlist** or **Single song**, then either paste a Spotify link or just **type a name to
search**. Review the tracklist, untick anything you don't want, choose a format and hit
**Download**. Progress streams live per track, and finished files are listed at the bottom of
the page, grouped by playlist, for download from the browser.

- **Playlist** mode accepts playlist *and* album links (and Liked Songs when logged in).
- **Single song** mode accepts one track link.
- Pasting the wrong kind of link is rejected immediately with a message telling you which
  mode to switch to.
- **At once** sets how many tracks download in parallel (default 3).
- Tracks you already have are skipped; tick **Re-download existing files** to force them.
- If any track fails, a **Retry failed** button re-runs just those.

## 🔐 Logging in (optional)

Click **Log in with Spotify** to reach your **private playlists** and **Liked Songs**. Requires
`SPOTIFY_REDIRECT_URI` above, registered in your Spotify developer dashboard. Tokens are held in
memory only and never written to disk, so you will need to log in again after restarting.

# 🎶 Command line
```bash
npm run cli -- "https://open.spotify.com/playlist/<playlist-id>"
npm run cli -- "<url>" --format m4a --concurrency 5 --overwrite
```

# 🧪 Tests
```bash
npm test
```

Files are written to `./downloads/<playlist name>/`, with single tracks in `./downloads/Singles/`.

```
.
├── server.js                   # Express server, jobs, SSE progress, files API
├── PlaylistDownloader.js       # CLI entry point
├── lib/
│   ├── downloader.js           # Spotify lookups, YouTube matching, yt-dlp downloads
│   ├── auth.js                 # Spotify tokens + OAuth login
│   └── tagger.js               # ffmpeg metadata + album art
├── public/                     # Frontend (index.html, styles.css, app.js)
├── test/                       # Matching / sanitising tests
├── .env                        # Contains your Spotify credentials
├── package.json
└── README.md
```

## ⚠️ Limitations

- Private playlists and Liked Songs require **logging in**; without it, public only
- YouTube matching is a **best-effort heuristic** — it prefers official-audio channels and
  duration matches, and fails a track rather than guessing when nothing looks right
- The server is meant for **local use** — it has no authentication
- Running jobs are **lost on server restart**
- Keep **yt-dlp up to date** (`brew upgrade yt-dlp`) — YouTube changes break older versions

---

## ✅ To-Do

- [x] Add pagination for large playlists (100+ songs)
- [x] Show progress for downloads
- [x] Support downloading individual tracks
- [x] Allow format selection (e.g., `mp3`, `m4a`, `wav`)
- [x] Parallel downloads with a configurable concurrency limit
- [x] Write ID3 tags (title / artist / album art) onto the saved files
- [x] Skip tracks that are already downloaded
- [x] Search by name instead of pasting links
- [x] Log in for private playlists and Liked Songs
- [ ] Download a whole playlist as a ZIP from the browser
- [ ] Paginate past the first 50 of your own playlists

---

## 🤝 Contributing

Pull requests are welcome! If you find a bug or want to suggest an improvement, feel free to open an issue or submit a PR.

---

## 📫 Contact

**Rajwat Singh**  
📧 [singra01@gettysburg.edu](mailto:singra01@gettysburg.edu)  
🔗 [GitHub](https://github.com/RajwatSingh)