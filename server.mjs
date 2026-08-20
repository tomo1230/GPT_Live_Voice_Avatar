import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const configPath = path.join(ROOT, "config.json");
const config = JSON.parse(
  await readFile(existsSync(configPath) ? configPath : path.join(ROOT, "config.example.json"), "utf8")
);

const clients = new Set();
let activeModel = config.models?.[0]?.id ?? "balanced";
let conversation = [];

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".wav": "audio/wav"
};

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function body(req, max = 30 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new Error("payload too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function emit(type, data = {}) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) client.write(payload);
}

async function requestJson(url, options, label) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    const hint = label === "Whisper"
      ? " start-whisper.ps1 を起動してください。"
      : "";
    throw new Error(`${label}に接続できません。${hint} (${error.message})`);
  }
  if (!response.ok) throw new Error(`${label} error ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response;
}

async function transcribe(audio, contentType) {
  if (!config.stt?.url) throw new Error("STT URLが未設定です");
  const form = new FormData();
  form.append("file", new Blob([audio], { type: contentType || "audio/webm" }), "speech.webm");
  form.append("language", config.stt.language || "ja");
  form.append("response_format", "json");
  const response = await requestJson(config.stt.url, { method: "POST", body: form }, "Whisper");
  const result = await response.json();
  return (result.text ?? result.transcription ?? "").trim();
}

function selectedModel() {
  return config.models?.find((item) => item.id === activeModel) ?? config.models?.[0] ?? {};
}

async function chat(text) {
  const chosen = selectedModel();
  conversation.push({ role: "user", content: text });
  conversation = conversation.slice(-12);
  const response = await requestJson(`${config.llm.baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: chosen.llmModel || config.llm.model,
      messages: [
        { role: "system", content: config.llm.systemPrompt },
        ...conversation
      ],
      temperature: config.llm.temperature,
      max_tokens: config.llm.maxTokens,
      reasoning_effort: config.llm.reasoningEffort ?? "none",
      stream: false
    })
  }, "llama.cpp");
  const result = await response.json();
  const reply = result.choices?.[0]?.message?.content?.trim();
  if (!reply) throw new Error("LLMから空の応答が返りました");
  conversation.push({ role: "assistant", content: reply });
  return reply;
}

async function synthesize(text) {
  if (!config.tts?.url) return null;
  try {
    const response = await requestJson(config.tts.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        voice: config.tts.voice,
        format: config.tts.format || "wav"
      })
    }, "Qwen3-TTS");
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    console.warn(`${error.message} ブラウザ音声合成へフォールバックします。`);
    return null;
  }
}

async function runTurn(audio, contentType) {
  emit("state", { state: "thinking", label: "音声を認識中" });
  const text = await transcribe(audio, contentType);
  if (!text) {
    emit("state", { state: "idle", label: "待機中" });
    return;
  }
  emit("transcript", { role: "user", text });
  emit("state", { state: "thinking", label: "返答を考え中" });
  const reply = await chat(text);
  emit("transcript", { role: "assistant", text: reply });
  emit("state", { state: "speaking", label: "発話中" });
  const wave = await synthesize(reply);
  if (wave) emit("audio", { mime: "audio/wav", base64: wave.toString("base64"), text: reply });
  else emit("speak-browser", { text: reply });
  emit("state", { state: "idle", label: "待機中" });
}

async function serveFile(req, res) {
  const requested = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
  const full = path.resolve(PUBLIC, relative);
  if (!full.startsWith(PUBLIC + path.sep) && full !== path.join(PUBLIC, "index.html")) return json(res, 403, { error: "forbidden" });
  try {
    const info = await stat(full);
    if (!info.isFile()) throw new Error("not file");
    const data = await readFile(full);
    res.writeHead(200, {
      "content-type": mime[path.extname(full)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  } catch {
    json(res, 404, { error: "not found" });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/api/config") {
      return json(res, 200, {
        models: config.models ?? [],
        activeModel,
        adapters: { stt: Boolean(config.stt?.url), llm: Boolean(config.llm?.baseUrl), tts: Boolean(config.tts?.url) }
      });
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      res.write(`event: state\ndata: ${JSON.stringify({ state: "idle", label: "待機中" })}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/audio") {
      const audio = await body(req);
      json(res, 202, { accepted: true, bytes: audio.length });
      runTurn(audio, req.headers["content-type"]).catch((error) => {
        console.error(error);
        emit("error", { message: error.message });
        emit("state", { state: "idle", label: "待機中" });
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      const input = JSON.parse((await body(req)).toString("utf8"));
      json(res, 202, { accepted: true });
      (async () => {
        emit("transcript", { role: "user", text: input.text });
        emit("state", { state: "thinking", label: "返答を考え中" });
        const reply = await chat(input.text);
        emit("transcript", { role: "assistant", text: reply });
        emit("state", { state: "speaking", label: "発話中" });
        const wave = await synthesize(reply);
        if (wave) emit("audio", { mime: "audio/wav", base64: wave.toString("base64"), text: reply });
        else emit("speak-browser", { text: reply });
        emit("state", { state: "idle", label: "待機中" });
      })().catch((error) => emit("error", { message: error.message }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/model") {
      const input = JSON.parse((await body(req)).toString("utf8"));
      if (!config.models?.some((model) => model.id === input.id)) return json(res, 400, { error: "unknown model" });
      activeModel = input.id;
      conversation = [];
      emit("model", { id: activeModel });
      return json(res, 200, { activeModel });
    }
    if (req.method === "POST" && url.pathname === "/api/reset") {
      conversation = [];
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET") return serveFile(req, res);
    json(res, 404, { error: "not found" });
  } catch (error) {
    console.error(error);
    json(res, 500, { error: error.message });
  }
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`Local Virtual Human: http://127.0.0.1:${config.port}`);
});
