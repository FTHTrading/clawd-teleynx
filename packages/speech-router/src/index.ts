/**
 * NVIDIA Speech Router — Port 8200
 * Routes ASR → Riva ASR NIM, TTS → Riva TTS NIM
 * Fallback: Whisper (local) for ASR, Piper (local) for TTS
 * Premium: PersonaPlex voice service on port 9070
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";

const PORT = Number(process.env.PORT ?? 8200);
const RIVA_ASR_URL = process.env.RIVA_ASR_URL ?? "http://localhost:9010";
const RIVA_TTS_URL = process.env.RIVA_TTS_URL ?? "http://localhost:9011";
const WHISPER_URL = process.env.WHISPER_URL ?? "http://localhost:7700";
const PIPER_URL = process.env.PIPER_URL ?? "http://localhost:7700";
const PERSONAPLEX_URL = process.env.PERSONAPLEX_URL ?? "http://localhost:9070";

const app = Fastify({ logger: true, bodyLimit: 50 * 1024 * 1024 });

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Health ───
app.get("/health", async () => {
  const checks: Record<string, string> = {};
  for (const [name, url] of [
    ["riva_asr", `${RIVA_ASR_URL}/v1/health/ready`],
    ["riva_tts", `${RIVA_TTS_URL}/v1/health/ready`],
  ] as const) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      checks[name] = r.ok ? "up" : "down";
    } catch {
      checks[name] = "down";
    }
  }
  return { status: "ok", backends: checks, port: PORT };
});

// ─── Metrics ───
let totalASR = 0;
let totalTTS = 0;
let rivaASRHits = 0;
let rivaTTSHits = 0;
let fallbackASRHits = 0;
let fallbackTTSHits = 0;
let personaplexTTSHits = 0;

app.get("/metrics", async () => ({
  total_asr: totalASR,
  total_tts: totalTTS,
  riva_asr_hits: rivaASRHits,
  riva_tts_hits: rivaTTSHits,
  fallback_asr_hits: fallbackASRHits,
  fallback_tts_hits: fallbackTTSHits,
  personaplex_tts_hits: personaplexTTSHits,
}));

// ─── POST /v1/asr — Speech-to-Text ───
app.post("/v1/asr", async (req, reply) => {
  totalASR++;

  let audioBuffer: Buffer;
  const contentType = req.headers["content-type"] ?? "";

  if (contentType.includes("multipart")) {
    const file = await req.file();
    if (!file) {
      reply.code(400);
      return { error: "No audio file provided" };
    }
    audioBuffer = await file.toBuffer();
  } else {
    audioBuffer = Buffer.from(req.body as Buffer);
  }

  // Try Riva ASR first
  try {
    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(audioBuffer)], { type: "audio/wav" }), "audio.wav");

    const rivaResp = await fetch(`${RIVA_ASR_URL}/v1/audio/transcriptions`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (rivaResp.ok) {
      rivaASRHits++;
      const data = await rivaResp.json();
      return {
        text: data.text ?? data.transcript ?? "",
        backend: "riva",
        confidence: data.confidence ?? 1.0,
        language: data.language ?? "en",
      };
    }
  } catch {
    req.log.warn("Riva ASR unavailable, falling back to Whisper");
  }

  // Fallback: local Whisper via Finn
  try {
    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(audioBuffer)], { type: "audio/wav" }), "audio.wav");

    const whisperResp = await fetch(`${WHISPER_URL}/v1/voice/transcribe`, {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(30000),
    });

    if (whisperResp.ok) {
      fallbackASRHits++;
      const data = await whisperResp.json();
      return {
        text: data.text ?? "",
        backend: "whisper-local",
        confidence: data.confidence ?? 0.9,
        language: "en",
      };
    }
  } catch {
    req.log.error("Whisper fallback also unavailable");
  }

  reply.code(503);
  return { error: "No ASR backend available" };
});

// ─── POST /v1/tts — Text-to-Speech ───
interface TTSRequest {
  text: string;
  voice?: string;
  speed?: number;
  format?: "wav" | "mp3" | "opus";
}

app.post<{ Body: TTSRequest }>("/v1/tts", async (req, reply) => {
  totalTTS++;
  const { text, voice, speed, format } = req.body;

  if (!text) {
    reply.code(400);
    return { error: "text is required" };
  }

  // Route premium voices to PersonaPlex if available
  const personaplexVoices = ["premium_f", "premium_m", "formal", "casual"];
  if (voice && personaplexVoices.includes(voice.toLowerCase())) {
    try {
      const personaplexResp = await fetch(`${PERSONAPLEX_URL}/v1/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice: voice.toLowerCase(),
          speed: speed ?? 1.0,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (personaplexResp.ok) {
        personaplexTTSHits++;
        const audioData = await personaplexResp.arrayBuffer();
        reply.header("Content-Type", "audio/wav");
        reply.header("X-Backend", "personaplex");
        return reply.send(Buffer.from(audioData));
      }
    } catch {
      req.log.warn(`PersonaPlex unavailable for voice '${voice}', falling back to Riva/Piper`);
    }
  }

  // Try Riva TTS next
  try {
    const rivaResp = await fetch(`${RIVA_TTS_URL}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: text,
        voice: voice ?? "English-US.Female-1",
        response_format: format ?? "wav",
        speed: speed ?? 1.0,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (rivaResp.ok) {
      rivaTTSHits++;
      const audioData = await rivaResp.arrayBuffer();
      reply.header("Content-Type", `audio/${format ?? "wav"}`);
      reply.header("X-Backend", "riva");
      return reply.send(Buffer.from(audioData));
    }
  } catch {
    req.log.warn("Riva TTS unavailable, falling back to Piper");
  }

  // Fallback: local Piper via Finn
  try {
    const piperResp = await fetch(`${PIPER_URL}/v1/voice/synthesize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: voice ?? "finn" }),
      signal: AbortSignal.timeout(30000),
    });

    if (piperResp.ok) {
      fallbackTTSHits++;
      const audioData = await piperResp.arrayBuffer();
      reply.header("Content-Type", "audio/wav");
      reply.header("X-Backend", "piper-local");
      return reply.send(Buffer.from(audioData));
    }
  } catch {
    req.log.error("Piper fallback also unavailable");
  }

  reply.code(503);
  return { error: "No TTS backend available" };
});

// ─── POST /v1/voice/pipeline — Full voice pipeline (ASR → process → TTS) ───
app.post("/v1/voice/pipeline", async (req, reply) => {
  let audioBuffer: Buffer;
  const contentType = req.headers["content-type"] ?? "";

  if (contentType.includes("multipart")) {
    const file = await req.file();
    if (!file) {
      reply.code(400);
      return { error: "No audio file provided" };
    }
    audioBuffer = await file.toBuffer();
  } else {
    audioBuffer = Buffer.from(req.body as Buffer);
  }

  // Step 1: ASR
  const asrResp = await app.inject({
    method: "POST",
    url: "/v1/asr",
    headers: { "content-type": "audio/wav" },
    payload: audioBuffer,
  });

  if (asrResp.statusCode !== 200) {
    reply.code(503);
    return { error: "ASR failed", detail: asrResp.json() };
  }

  const asrResult = asrResp.json();
  return {
    transcript: asrResult.text,
    asr_backend: asrResult.backend,
    confidence: asrResult.confidence,
  };
});

// ─── Start ───
try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`🎙️  Speech Router running on :${PORT}`);
  console.log(`   Riva ASR: ${RIVA_ASR_URL}`);
  console.log(`   Riva TTS: ${RIVA_TTS_URL}`);
  console.log(`   Whisper:  ${WHISPER_URL}`);
  console.log(`   Piper:    ${PIPER_URL}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
