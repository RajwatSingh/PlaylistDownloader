import dotenv from 'dotenv';
import crypto from 'crypto';
import SpotifyWebApi from 'spotify-web-api-node';

dotenv.config();

export const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:3000/auth/callback';

// one shared client; its access token is swapped between the app token and the
// logged-in user's token depending on who we are acting as
export const spotifyApi = new SpotifyWebApi({
    clientId: process.env.SPOTIFY_CLIENT_ID,
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri: REDIRECT_URI,
});

const SCOPES = ['playlist-read-private', 'playlist-read-collaborative', 'user-library-read'];

// tokens live in memory only — nothing sensitive is ever written to disk, at the
// cost of having to log in again after a server restart
let appToken = { value: null, expiresAt: 0 };
let user = null; // { access, refresh, expiresAt, name }
const pendingStates = new Set();

export function hasCredentials() {
    return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

function assertCredentials() {
    if (!hasCredentials()) {
        throw new Error('Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET — add them to a .env file.');
    }
}

export function isLoggedIn() {
    return Boolean(user);
}

export function currentUser() {
    return user ? { name: user.name } : null;
}

export function createLoginUrl() {
    assertCredentials();
    const state = crypto.randomBytes(16).toString('hex');
    pendingStates.add(state);
    return spotifyApi.createAuthorizeURL(SCOPES, state);
}

export async function handleCallback(code, state) {
    assertCredentials();
    // the state must be one we issued, otherwise this callback did not come from our login
    if (!state || !pendingStates.delete(state)) {
        throw new Error('Login state did not match. Start the login again from the app.');
    }
    const data = await spotifyApi.authorizationCodeGrant(code);
    user = {
        access: data.body.access_token,
        refresh: data.body.refresh_token,
        expiresAt: Date.now() + data.body.expires_in * 1000,
        name: null,
    };
    spotifyApi.setAccessToken(user.access);
    spotifyApi.setRefreshToken(user.refresh);
    const me = await spotifyApi.getMe();
    user.name = me.body.display_name || me.body.id;
    return currentUser();
}

export function logout() {
    user = null;
    spotifyApi.setRefreshToken(null);
    spotifyApi.setAccessToken(appToken.value);
}

/**
 * Points the shared client at a usable token.
 * Prefers the logged-in user (so private playlists and Liked Songs work) and falls
 * back to the app-level client-credentials token when logged out.
 */
export async function ensureAccessToken({ requireUser = false } = {}) {
    assertCredentials();

    if (user) {
        if (Date.now() > user.expiresAt - 60_000) {
            spotifyApi.setRefreshToken(user.refresh);
            const refreshed = await spotifyApi.refreshAccessToken();
            user.access = refreshed.body.access_token;
            user.expiresAt = Date.now() + refreshed.body.expires_in * 1000;
            // Spotify may hand back a new refresh token; keep whichever is current
            if (refreshed.body.refresh_token) user.refresh = refreshed.body.refresh_token;
        }
        spotifyApi.setAccessToken(user.access);
        return;
    }

    if (requireUser) throw new Error('Log in with Spotify to use this.');

    if (appToken.value && Date.now() < appToken.expiresAt - 60_000) {
        spotifyApi.setAccessToken(appToken.value);
        return;
    }
    const data = await spotifyApi.clientCredentialsGrant();
    appToken = { value: data.body.access_token, expiresAt: Date.now() + data.body.expires_in * 1000 };
    spotifyApi.setAccessToken(appToken.value);
}
