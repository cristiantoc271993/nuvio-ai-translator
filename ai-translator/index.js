/**

- ai-translator/index.js
- 
- Nuvio Provider — AI Subtitle Translator
- 
- This provider wraps any .m3u8 stream URL through the companion server,
- which injects AI-translated English subtitles on the fly.
- 
- Requires the companion server (server.js) to be running on port 3001.
- 
- Supported: Movies & TV shows with subtitles available on OpenSubtitles.
  */

// ─── Config ──────────────────────────────────────────────────────────────────
// Change this to your PC’s local IP if accessing from a phone on the same Wi-Fi
// e.g. “http://192.168.1.50:3001”
const SERVER_URL = “http://localhost:3001”;

// Source to grab the actual video stream from.
// We use vidsrc.xyz which aggregates free streams.
const STREAM_SOURCE = “https://vidsrc.xyz/embed”;
// ─────────────────────────────────────────────────────────────────────────────

async function getVideoStreamUrl(tmdbId, mediaType, season, episode) {
let embedUrl;
if (mediaType === “tv”) {
embedUrl = `${STREAM_SOURCE}/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`;
} else {
embedUrl = `${STREAM_SOURCE}/movie?tmdb=${tmdbId}`;
}

// Fetch the embed page and scrape the m3u8 URL
const html = await fetch(embedUrl, {
headers: { “User-Agent”: “Mozilla/5.0 (Windows NT 10.0; Win64; x64)” },
}).then((r) => r.text());

// Look for an m3u8 URL in the page source
const m3u8Match = html.match(/https?://[^”’\s]+.m3u8[^”’\s]*/);
if (m3u8Match) return m3u8Match[0];

// Fallback: look for a JSON blob with a file property
const fileMatch = html.match(/“file”\s*:\s*”(https?://[^”]+.m3u8[^”]*)”/);
if (fileMatch) return fileMatch[1].replace(/\/g, “”);

return null;
}

async function getStreams(tmdbId, mediaType, season, episode) {
console.log(`[AI-Translator] Getting streams for TMDB:${tmdbId} (${mediaType})`);

// 1. Check the companion server is alive
try {
await fetch(`${SERVER_URL}/health`).then((r) => r.json());
} catch (e) {
console.error(”[AI-Translator] Companion server not reachable at”, SERVER_URL);
return [
{
name: “AI Translator”,
title: “⚠️ Start companion server (server.js)”,
url: “”,
quality: “N/A”,
},
];
}

// 2. Get the raw video stream URL
let streamUrl;
try {
streamUrl = await getVideoStreamUrl(tmdbId, mediaType, season, episode);
} catch (e) {
console.error(”[AI-Translator] Could not get stream URL:”, e.message);
}

if (!streamUrl) {
return [
{
name: “AI Translator”,
title: “No stream found — try another provider”,
url: “”,
quality: “N/A”,
},
];
}

// 3. Build the proxy URL — the companion server wraps the stream and injects translated subs
const proxyUrl =
`${SERVER_URL}/proxy-m3u8` +
`?streamUrl=${encodeURIComponent(streamUrl)}` +
`&tmdbId=${tmdbId}` +
`&type=${mediaType}`;

console.log(”[AI-Translator] Returning proxy stream:”, proxyUrl);

return [
{
name: “AI Translator 🌐”,
title: “AI-Translated English Subtitles”,
url: proxyUrl,
quality: “Auto”,
},
];
}

module.exports = { getStreams };
