import dotenv from 'dotenv';
import SpotifyWebApi from 'spotify-web-api-node';
import * as ytSearch from 'youtube-search-api';
import { exec } from 'child_process';

dotenv.config();

// first we need to initialize the spotify api
const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

// this function will help me extract the track id from the spotify url
function extractTrackId(spotifyUrl) {
    try{
        const url = new URL(spotifyUrl);
        const parts = url.pathname.split('/');
        return parts.includes("track") ? parts[parts.indexOf("track") + 1] : null;
    }
    catch(err) {
        console.error("🚨 Error: Invalid Spotify URL!");
    }
}

async function getSpotifySong(spotifyUrl) {
    try{
        const trackID = extractTrackId(spotifyUrl);
        if(!trackID) {
            console.error("🚨 Error: Could not extract track ID!");
            return null;
        }
        const track = await spotifyApi.getTrack(trackID);
        return {
            name: track.body.name,
            artist: track.body.artists[0].name
        }
    }
    catch(err) {
        console.error("🚨 Spotify API Error:", err);
        return null;
    }
}

async function searchYoutube(song){
    try{
        const query = `${song.name} ${song.artist} audio`;
        const results = await ytSearch.GetListByKeyword(query, false, 1);
        return `https://www.youtube.com/watch?v=${results.items[0].id}`;
    }
    catch(err) {
        console.error("🚨 YouTube Search Error:", err);
    }
}

async function downloadSong(link, song) {
    try{
        const filename = `${song.name} ${song.artist}.mp3`;
        const command = `yt-dlp -x --audio-format mp3 --ffmpeg-location $(which ffmpeg) -o "${filename}" "${link}"`;
        console.log("⬇️ Downloading:", filename);
        exec(command, (err, stdout, stderr) => {
            if(err) {
                console.error("🚨 Download Error:", err);
                return;
            }
            console.log("✅ Download Complete:", filename);
        });
    }
    catch(err) {
        console.error("🚨 Error in Download:", err);
    }   
}

// from here i will write the function that will get the id of the playlist
function extractPlaylistId(spotifyUrl) {
    try {
        const url = new URL(spotifyUrl);
        const parts = url.pathname.split('/');
        return parts.includes("playlist") ? parts[parts.indexOf("playlist") + 1] : null;
    } catch (err) {
        console.error("🚨 Error: Invalid Spotify Playlist URL!");
    }
}

await spotifyApi.clientCredentialsGrant().then(
    function(data) {
        spotifyApi.setAccessToken(data.body['access_token']);
    },
    function(err) {
        console.error('🚨 Failed to retrieve access token', err);
        process.exit(1);
    }
);

async function getSpotifyPlaylist(spotifyUrl) {
    try {
        const playlistID = extractPlaylistId(spotifyUrl);
        if (!playlistID) {
            console.error("🚨 Error: Could not extract playlist ID!");
            return null;
        }
        const playlist = await spotifyApi.getPlaylist(playlistID);
        return playlist.body.tracks.items.map(item => ({
            name: item.track.name,
            artist: item.track.artists[0].name,
            url: item.track.external_urls.spotify
        }));
    } catch (err) {
        console.error("🚨 Spotify API Error:", err);
        return null;
    }
}

// writing the main funtion that will download the playlist
(async () => {
    await spotifyApi.clientCredentialsGrant().then(
        function(data) {
            spotifyApi.setAccessToken(data.body['access_token']);
        },
        function(err) {
            console.error('🚨 Failed to retrieve access token', err);
            process.exit(1);
        }
    );

    const spotifyUrl = process.argv[2]; // Get the Spotify playlist URL from command line arguments
    if (!spotifyUrl) {
        console.error("🚨 Error: Please provide a Spotify playlist URL!");
        return;
    }

    const songs = await getSpotifyPlaylist(spotifyUrl);
    if (!songs || songs.length === 0) {
        console.error("🚨 Error: No songs found in the playlist!");
        return;
    }

    for (const song of songs) {
        const youtubeLink = await searchYoutube(song);
        if (youtubeLink) {
            await downloadSong(youtubeLink, song);
        } else {
            console.error(`🚨 Error: Could not find YouTube link for ${song.name} by ${song.artist}`);
        }
    }
}
)();
