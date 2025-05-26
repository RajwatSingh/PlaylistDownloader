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

# 🎶 Command to run
```bash
node PlaylistDownloader.js "https://open.spotify.com/playlist/<playlist-id>"
```
.
├── PlaylistDownloader.js       # Main script
├── .env                        # Contains your Spotify credentials
├── package.json
└── README.md

## ⚠️ Limitations

- Only supports **public playlists**
- Only downloads the **first 100 tracks** (pagination not implemented yet)
- YouTube match quality depends on **keyword search** — may not always be perfect

---

## ✅ To-Do

- [ ] Add pagination for large playlists (100+ songs)
- [ ] Show progress bar for downloads
- [ ] Support downloading individual tracks
- [ ] Allow format selection (e.g., `mp3`, `m4a`, `wav`)

---

## 🤝 Contributing

Pull requests are welcome! If you find a bug or want to suggest an improvement, feel free to open an issue or submit a PR.

---

## 📫 Contact

**Rajwat Singh**  
📧 [singra01@gettysburg.edu](mailto:singra01@gettysburg.edu)  
🔗 [GitHub](https://github.com/RajwatSingh)