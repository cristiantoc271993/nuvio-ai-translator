/**

- Nuvio AI Subtitle Translator - Companion Server
- 
- Runs on your PC. Fetches foreign subtitles from OpenSubtitles,
- translates them to English via LibreTranslate (free), and serves
- a patched M3U8 stream with the translated subtitle track embedded.
- 
- Usage: node server.js
- Runs on: http://localhost:3001
  */

const http = require(“http”);
const https = require(“https”);
const url = require(“url”);
const PORT = 3001;

// ─── Config ─────────────────────────────────────────────────────────────────
// Public LibreTranslate instance (free, no key needed — may be rate-limited).
// For unlimited use, run your own: https://github.com/LibreTranslate/LibreTranslate
const LIBRE_TRANSLATE_URL = “https://libretranslate.com/translate”;
const LIBRE_TRANSLATE_API_KEY = “”; // Leave empty for public instance

// OpenSubtitles REST API (free, no account needed for basic search)
const OPENSUB_API = “https://api.opensubtitles.com/api/v1”;
const OPENSUB_APP = “NuvioAITranslator v1.0”;
// ────────────────────────────────────────────────────────────────────────────

// Simple in-memory cache so the same movie isn’t re-translated on every request
const subtitleCache = {};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fetchJson(targetUrl, options = {}) {
return new Promise((resolve, reject) => {
const parsed = new URL(targetUrl);
const lib = parsed.protocol === “https:” ? https : http;
const reqOptions = {
hostname: parsed.hostname,
port: parsed.port || (parsed.protocol === “https:” ? 443 : 80),
path: parsed.pathname + parsed.search,
method: options.method || “GET”,
headers: options.headers || {},
};
const req = lib.request(reqOptions, (res) => {
let data = “”;
res.on(“data”, (chunk) => (data += chunk));
res.on(“end”, () => {
try {
resolve(JSON.parse(data));
} catch (e) {
resolve(data); // Return raw string if not JSON
}
});
});
req.on(“error”, reject);
if (options.body) req.write(options.body);
req.end();
});
}

function fetchText(targetUrl, headers = {}) {
return new Promise((resolve, reject) => {
const parsed = new URL(targetUrl);
const lib = parsed.protocol === “https:” ? https : http;
const reqOptions = {
hostname: parsed.hostname,
port: parsed.port || (parsed.protocol === “https:” ? 443 : 80),
path: parsed.pathname + parsed.search,
method: “GET”,
headers,
};
const req = lib.request(reqOptions, (res) => {
// Follow redirects
if (res.statusCode === 301 || res.statusCode === 302) {
return fetchText(res.headers.location, headers).then(resolve).catch(reject);
}
let data = “”;
res.on(“data”, (chunk) => (data += chunk));
res.on(“end”, () => resolve(data));
});
req.on(“error”, reject);
req.end();
});
}

function proxyFetch(targetUrl, headers = {}) {
return new Promise((resolve, reject) => {
const parsed = new URL(targetUrl);
const lib = parsed.protocol === “https:” ? https : http;
const reqOptions = {
hostname: parsed.hostname,
port: parsed.port || (parsed.protocol === “https:” ? 443 : 80),
path: parsed.pathname + parsed.search,
method: “GET”,
headers,
};
const req = lib.request(reqOptions, (res) => {
if (res.statusCode === 301 || res.statusCode === 302) {
return proxyFetch(res.headers.location, headers).then(resolve).catch(reject);
}
resolve(res);
});
req.on(“error”, reject);
req.end();
});
}

// ─── OpenSubtitles ────────────────────────────────────────────────────────────

async function searchSubtitles(tmdbId, mediaType) {
const type = mediaType === “tv” ? “episode” : “movie”;
const searchUrl =
`${OPENSUB_API}/subtitles?tmdb_id=${tmdbId}&type=${type}` +
`&order_by=download_count&order_direction=desc`;

const data = await fetchJson(searchUrl, {
headers: {
“Api-Key”: “eMgJTGCdgpmGEWInuEVJg71vRHq7MBZP”, // Free public key from OpenSubtitles docs
“User-Agent”: OPENSUB_APP,
“Content-Type”: “application/json”,
},
});

if (!data.data || data.data.length === 0) {
throw new Error(“No subtitles found for this title.”);
}

// Prefer non-English subtitles so there’s something to translate
const nonEnglish = data.data.find(
(s) => s.attributes.language !== “en” && s.attributes.files && s.attributes.files[0]
);
const chosen = nonEnglish || data.data[0];
const fileId = chosen.attributes.files[0].file_id;
const lang = chosen.attributes.language;

console.log(`[OpenSubs] Found subtitle: language=${lang}, fileId=${fileId}`);
return { fileId, lang };
}

async function downloadSubtitle(fileId) {
const data = await fetchJson(`${OPENSUB_API}/download`, {
method: “POST”,
headers: {
“Api-Key”: “eMgJTGCdgpmGEWInuEVJg71vRHq7MBZP”,
“User-Agent”: OPENSUB_APP,
“Content-Type”: “application/json”,
},
body: JSON.stringify({ file_id: fileId }),
});

if (!data.link) throw new Error(“Could not get subtitle download link.”);

const srtContent = await fetchText(data.link);
return srtContent;
}

// ─── LibreTranslate ──────────────────────────────────────────────────────────

function parseSrt(srt) {
const blocks = srt.trim().split(/\n\n+/);
return blocks.map((block) => {
const lines = block.split(”\n”);
const index = lines[0].trim();
const timing = lines[1] ? lines[1].trim() : “”;
const text = lines.slice(2).join(”\n”).trim();
return { index, timing, text };
}).filter((b) => b.timing && b.text);
}

function srtTimingToVtt(timing) {
// SRT uses comma for milliseconds; VTT uses dot
return timing.replace(/,/g, “.”);
}

async function translateChunk(texts, sourceLang) {
const body = JSON.stringify({
q: texts,
source: sourceLang === “zho” ? “zh” : sourceLang,
target: “en”,
format: “text”,
api_key: LIBRE_TRANSLATE_API_KEY,
});

const result = await fetchJson(LIBRE_TRANSLATE_URL, {
method: “POST”,
headers: { “Content-Type”: “application/json” },
body,
});

if (result.error) {
console.warn(”[LibreTranslate] Error:”, result.error);
return texts; // Return originals on error
}

return Array.isArray(result.translatedText)
? result.translatedText
: [result.translatedText];
}

async function translateSubtitles(srtContent, sourceLang) {
const blocks = parseSrt(srtContent);
if (blocks.length === 0) throw new Error(“Could not parse subtitle file.”);

console.log(`[Translate] Translating ${blocks.length} subtitle blocks from ${sourceLang}...`);

// Batch into chunks of 20 to avoid hitting rate limits
const CHUNK_SIZE = 20;
const translated = [];

for (let i = 0; i < blocks.length; i += CHUNK_SIZE) {
const chunk = blocks.slice(i, i + CHUNK_SIZE);
const texts = chunk.map((b) => b.text);
const results = await translateChunk(texts, sourceLang);
for (let j = 0; j < chunk.length; j++) {
translated.push({ …chunk[j], text: results[j] || chunk[j].text });
}
// Small delay between chunks to be polite to the free API
if (i + CHUNK_SIZE < blocks.length) {
await new Promise((r) => setTimeout(r, 300));
}
}

// Build WebVTT
let vtt = “WEBVTT\n\n”;
for (const block of translated) {
vtt += `${block.index}\n`;
vtt += `${srtTimingToVtt(block.timing)}\n`;
vtt += `${block.text}\n\n`;
}

console.log(”[Translate] Translation complete.”);
return vtt;
}

// ─── M3U8 Proxy ──────────────────────────────────────────────────────────────

function buildM3U8WithSubtitles(originalM3u8, streamUrl, subtitleServingUrl) {
const base = streamUrl.substring(0, streamUrl.lastIndexOf(”/”) + 1);

// Make all relative URLs absolute in the original playlist
const patched = originalM3u8.replace(/(^|\n)((?!#)[^\s]+)/g, (match, newline, segment) => {
if (segment.startsWith(“http”)) return match;
return `${newline}${base}${segment}`;
});

// Inject subtitle track at the top of the playlist
const subtitleTrack =
`#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",` +
`NAME="English (AI Translated)",DEFAULT=YES,FORCED=NO,` +
`URI="${subtitleServingUrl}"\n`;

const withSubs = patched.replace(
/#EXT-X-STREAM-INF:/g,
`${subtitleTrack}#EXT-X-STREAM-INF:SUBTITLES="subs",`
);

return withSubs;
}

// ─── Route Handlers ──────────────────────────────────────────────────────────

async function handleGetSubtitles(query, res) {
const { tmdbId, type } = query;
if (!tmdbId) {
res.writeHead(400);
return res.end(JSON.stringify({ error: “tmdbId is required” }));
}

const cacheKey = `${tmdbId}-${type || "movie"}`;

try {
if (!subtitleCache[cacheKey]) {
console.log(`[Server] Fetching & translating subtitles for TMDB:${tmdbId}`);
const { fileId, lang } = await searchSubtitles(tmdbId, type || “movie”);
const srt = await downloadSubtitle(fileId);
const vtt = lang === “en”
? srt // Already English, just serve it
: await translateSubtitles(srt, lang);
subtitleCache[cacheKey] = vtt;
}

```
res.writeHead(200, {
  "Content-Type": "text/vtt; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=3600",
});
res.end(subtitleCache[cacheKey]);
```

} catch (err) {
console.error(”[Server] Subtitle error:”, err.message);
res.writeHead(500);
res.end(JSON.stringify({ error: err.message }));
}
}

async function handleProxyM3u8(query, reqHeaders, res) {
const { streamUrl, tmdbId, type } = query;
if (!streamUrl) {
res.writeHead(400);
return res.end(“streamUrl is required”);
}

try {
const m3u8 = await fetchText(decodeURIComponent(streamUrl), {
“User-Agent”: reqHeaders[“user-agent”] || “Mozilla/5.0”,
});

```
// Only patch master playlists (they contain #EXT-X-STREAM-INF)
if (m3u8.includes("#EXT-X-STREAM-INF") && tmdbId) {
  const host = reqHeaders.host || `localhost:${PORT}`;
  const subtitleUrl = `http://${host}/subtitles?tmdbId=${tmdbId}&type=${type || "movie"}`;
  const patched = buildM3U8WithSubtitles(m3u8, decodeURIComponent(streamUrl), subtitleUrl);

  res.writeHead(200, {
    "Content-Type": "application/x-mpegURL",
    "Access-Control-Allow-Origin": "*",
  });
  return res.end(patched);
}

// For media playlists, just proxy as-is with absolute URLs
const base = decodeURIComponent(streamUrl).substring(
  0, decodeURIComponent(streamUrl).lastIndexOf("/") + 1
);
const patched = m3u8.replace(/(^|\n)((?!#)[^\s]+)/g, (match, newline, seg) => {
  if (seg.startsWith("http")) return match;
  return `${newline}${base}${seg}`;
});

res.writeHead(200, {
  "Content-Type": "application/x-mpegURL",
  "Access-Control-Allow-Origin": "*",
});
res.end(patched);
```

} catch (err) {
console.error(”[Server] M3U8 proxy error:”, err.message);
res.writeHead(500);
res.end(err.message);
}
}

function handleHealth(res) {
res.writeHead(200, { “Content-Type”: “application/json” });
res.end(JSON.stringify({ status: “ok”, service: “Nuvio AI Subtitle Translator” }));
}

// ─── Server ──────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
const parsed = url.parse(req.url, true);
const { pathname, query } = parsed;

res.setHeader(“Access-Control-Allow-Origin”, “*”);

if (pathname === “/health”) return handleHealth(res);
if (pathname === “/subtitles”) return handleGetSubtitles(query, res);
if (pathname === “/proxy-m3u8”) return handleProxyM3u8(query, req.headers, res);

res.writeHead(404);
res.end(“Not found”);
});

server.listen(PORT, () => {
console.log(“╔══════════════════════════════════════════════════╗”);
console.log(“║    Nuvio AI Subtitle Translator - Server Ready    ║”);
console.log(`║    Running on http://localhost:${PORT}               ║`);
console.log(“╠══════════════════════════════════════════════════╣”);
console.log(“║  Endpoints:                                       ║”);
console.log(“║  GET /health              - Health check          ║”);
console.log(“║  GET /subtitles?tmdbId=.. - Get translated VTT    ║”);
console.log(“║  GET /proxy-m3u8?…      - Stream proxy with sub ║”);
console.log(“╚══════════════════════════════════════════════════╝”);
});
