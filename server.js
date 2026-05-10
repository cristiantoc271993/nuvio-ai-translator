const http = require("http");
const https = require("https");
const url = require("url");
const PORT = process.env.PORT || 3001;

const LIBRE_URL = "https://libretranslate.com/translate";
const OPENSUB_API = "https://api.opensubtitles.com/api/v1";
const OPENSUB_KEY = "eMgJTGCdgpmGEWInuEVJg71vRHq7MBZP";
const cache = {};

function get(targetUrl, headers) {
  return new Promise((resolve, reject) => {
    const p = new URL(targetUrl);
    const lib = p.protocol === "https:" ? https : http;
    lib.get({ hostname: p.hostname, path: p.pathname + p.search, headers: headers || {} }, (res) => {
      let d = "";
      res.on("data", (c) => d += c);
      res.on("end", () => resolve(d));
    }).on("error", reject);
  });
}

function post(targetUrl, body) {
  return new Promise((resolve, reject) => {
    const p = new URL(targetUrl);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: p.hostname, path: p.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
    }, (res) => {
      let d = "";
      res.on("data", (c) => d += c);
      res.on("end", () => resolve(JSON.parse(d)));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function getSubtitles(tmdbId, type) {
  const key = tmdbId + type;
  if (cache[key]) return cache[key];
  const search = await get(
    OPENSUB_API + "/subtitles?tmdb_id=" + tmdbId + "&type=" + (type || "movie"),
    { "Api-Key": OPENSUB_KEY, "User-Agent": "NuvioAI v1" }
  );
  const data = JSON.parse(search);
  if (!data.data || !data.data.length) throw new Error("No subtitles found");
  const item = data.data.find(s => s.attributes.language !== "en") || data.data[0];
  const lang = item.attributes.language;
  const fileId = item.attributes.files[0].file_id;
  const dlRes = await post(OPENSUB_API + "/download",
    { file_id: fileId },
  );
  const srt = await get(dlRes.link);
  const blocks = srt.trim().split(/\n\n+/).map(b => {
    const lines = b.split("\n");
    return { i: lines[0], t: lines[1], text: lines.slice(2).join(" ") };
  }).filter(b => b.t && b.text);

  let vtt = "WEBVTT\n\n";
  if (lang !== "en") {
    for (let i = 0; i < blocks.length; i += 10) {
      const chunk = blocks.slice(i, i + 10);
      const res = await post(LIBRE_URL, { q: chunk.map(b => b.text), source: lang, target: "en", format: "text" });
      const translated = res.translatedText || chunk.map(b => b.text);
      chunk.forEach((b, j) => {
        vtt += b.i + "\n" + b.t.replace(/,/g, ".") + "\n" + (translated[j] || b.text) + "\n\n";
      });
    }
  } else {
    blocks.forEach(b => { vtt += b.i + "\n" + b.t.replace(/,/g, ".") + "\n" + b.text + "\n\n"; });
  }
  cache[key] = vtt;
  return vtt;
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (parsed.pathname === "/health") {
    res.writeHead(200);
    return res.end(JSON.stringify({ status: "ok" }));
  }
  if (parsed.pathname === "/subtitles") {
    const { tmdbId, type } = parsed.query;
    getSubtitles(tmdbId, type).then(vtt => {
      res.writeHead(200, { "Content-Type": "text/vtt" });
      res.end(vtt);
    }).catch(e => { res.writeHead(500); res.end(e.message); });
    return;
  }
  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => console.log("Server running on port " + PORT));
