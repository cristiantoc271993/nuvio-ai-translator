var __async = (__this, __arguments, generator) => {
return new Promise((resolve, reject) => {
var fulfilled = (value) => {
try {
step(generator.next(value));
} catch (e) {
reject(e);
}
};
var rejected = (value) => {
try {
step(generator.throw(value));
} catch (e) {
reject(e);
}
};
var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
step((generator = generator.apply(__this, __arguments)).next());
});
};

// src/ai-translator/index.js
var SERVER_URL = "https://nuvio-ai-translator.onrender.com";
var STREAM_SOURCE = “https://vidsrc.xyz/embed”;
function getVideoStreamUrl(tmdbId, mediaType, season, episode) {
return __async(this, null, function* () {
let embedUrl;
if (mediaType === “tv”) {
embedUrl = `${STREAM_SOURCE}/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`;
} else {
embedUrl = `${STREAM_SOURCE}/movie?tmdb=${tmdbId}`;
}
const html = yield fetch(embedUrl, {
headers: { “User-Agent”: “Mozilla/5.0 (Windows NT 10.0; Win64; x64)” }
}).then((r) => r.text());
const m3u8Match = html.match(/https?://[^”’\s]+.m3u8[^”’\s]*/);
if (m3u8Match)
return m3u8Match[0];
const fileMatch = html.match(/“file”\s*:\s*”(https?://[^”]+.m3u8[^”]*)”/);
if (fileMatch)
return fileMatch[1].replace(/\/g, “”);
return null;
});
}
function getStreams(tmdbId, mediaType, season, episode) {
return __async(this, null, function* () {
console.log(`[AI-Translator] Getting streams for TMDB:${tmdbId} (${mediaType})`);
try {
yield fetch(`${SERVER_URL}/health`).then((r) => r.json());
} catch (e) {
console.error(”[AI-Translator] Companion server not reachable at”, SERVER_URL);
return [
{
name: “AI Translator”,
title: “\u26A0\uFE0F Start companion server (server.js)”,
url: “”,
quality: “N/A”
}
];
}
let streamUrl;
try {
streamUrl = yield getVideoStreamUrl(tmdbId, mediaType, season, episode);
} catch (e) {
console.error(”[AI-Translator] Could not get stream URL:”, e.message);
}
if (!streamUrl) {
return [
{
name: “AI Translator”,
title: “No stream found \u2014 try another provider”,
url: “”,
quality: “N/A”
}
];
}
const proxyUrl = `${SERVER_URL}/proxy-m3u8?streamUrl=${encodeURIComponent(streamUrl)}&tmdbId=${tmdbId}&type=${mediaType}`;
console.log(”[AI-Translator] Returning proxy stream:”, proxyUrl);
return [
{
name: “AI Translator \u{1F310}”,
title: “AI-Translated English Subtitles”,
url: proxyUrl,
quality: “Auto”
}
];
});
}
module.exports = { getStreams };
