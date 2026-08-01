# 🎧 Spotify Playlist to MP3 Downloader

**A simple Node.js tool that takes a Spotify playlist URL, searches for each track on YouTube, and downloads the best match as an MP3 file using `yt-dlp`.**

---

## 🚀 Features

- ✅ Download entire **Spotify playlists** as `.mp3` audio files
- ✅ Automatically finds YouTube matches for each track
- ✅ Minimal command-line usage — just pass a Spotify playlist URL
- ✅ Fully automated with YouTube Search API + yt-dlp + ffmpeg

---

## 🛠️ Built With

- **Node.js**
- **Spotify Web API**
- **YouTube Search API**
- **yt-dlp** (YouTube downloader)
- **ffmpeg** (for audio conversion)
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
```

# 🖥️ Web UI (recommended)
```bash
npm start
# → http://localhost:3000
```

Paste a Spotify **track, album or playlist** link, review the tracklist, untick anything
you don't want, pick a format and hit **Download**. Progress streams live per track, and
finished files are listed at the bottom of the page for download from the browser.

# 🎶 Command line
```bash
npm run cli -- "https://open.spotify.com/playlist/<playlist-id>"
```

Files are written to `./downloads` (override with `DOWNLOAD_DIR` in `.env`).

```
.
├── server.js                   # Express server + progress streaming
├── PlaylistDownloader.js       # CLI entry point
├── lib/downloader.js           # Shared Spotify → YouTube → yt-dlp logic
├── public/                     # Frontend (index.html, styles.css, app.js)
├── .env                        # Contains your Spotify credentials
├── package.json
└── README.md
```

## ⚠️ Limitations

- Only supports **public playlists**
- YouTube match quality depends on **keyword search** — may not always be perfect
- The server is meant for **local use** — it has no authentication

---

## ✅ To-Do

- [x] Add pagination for large playlists (100+ songs)
- [x] Show progress for downloads
- [x] Support downloading individual tracks
- [x] Allow format selection (e.g., `mp3`, `m4a`, `wav`)
- [ ] Parallel downloads with a configurable concurrency limit
- [ ] Write ID3 tags (title / artist / album art) onto the saved files

---

## 🤝 Contributing

Pull requests are welcome! If you find a bug or want to suggest an improvement, feel free to open an issue or submit a PR.

---

## 📫 Contact

**Rajwat Singh**  
📧 [singra01@gettysburg.edu](mailto:singra01@gettysburg.edu)  
🔗 [GitHub](https://github.com/RajwatSingh)