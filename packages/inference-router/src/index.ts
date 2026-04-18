/**
 * NVIDIA Inference Router — Port 8100
 * Routes embeddings → Triton (ONNX/TRT), completions → NIM/Ollama
 */
import Fastify from "fastify";
import cors from "@fastify/cors";

const PORT = Number(process.env.PORT ?? 8100);
const TRITON_URL = process.env.TRITON_URL ?? "http://localhost:8000";
const NIM_URL = process.env.NIM_URL ?? "http://localhost:8080";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";

const log = Fastify({ logger: true });

await log.register(cors, { origin: true });

// ─── Health ───
log.get("/health", async () => {
  const checks: Record<string, string> = {};
  for (const [name, url] of [
    ["triton", `${TRITON_URL.replace(':8001', ':8000')}/v2/health/ready`],
    ["nim",    `${NIM_URL}/v1/health/ready`],
    ["ollama", `${OLLAMA_URL}/api/tags`],
  ] as const) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      checks[name] = r.ok ? "up" : "down";
    } catch {
      checks[name] = "down";
    }
  }
  return { status: "ok", backends: checks, port: PORT, nim_model: "nvidia/llama-3.1-nemotron-nano-8b-v1" };
});

// ─── Backends ───
log.get("/v1/backends", async () => {
  const results: Record<string, { url: string; status: string; detail?: string }> = {};
  for (const [name, url, probe] of [
    ["triton",  TRITON_URL, `${TRITON_URL.replace(':8001', ':8000')}/v2/health/ready`],
    ["nim",     NIM_URL,    `${NIM_URL}/v1/health/ready`],
    ["ollama",  OLLAMA_URL, `${OLLAMA_URL}/api/tags`],
  ] as const) {
    try {
      const r = await fetch(probe, { signal: AbortSignal.timeout(5000) });
      results[name] = { url, status: r.ok ? "up" : `http_${r.status}` };
    } catch (e) {
      results[name] = { url, status: "down", detail: String(e) };
    }
  }
  return { backends: results, nim_model: "nvidia/llama-3.1-nemotron-nano-8b-v1" };
});

// ─── Metrics ───
let totalRequests = 0;
let tritonHits = 0;
let nimHits = 0;
let ollamaHits = 0;

log.get("/metrics", async () => ({
  total_requests: totalRequests,
  triton_hits: tritonHits,
  nim_hits: nimHits,
  ollama_hits: ollamaHits,
  nim_model: "nvidia/llama-3.1-nemotron-nano-8b-v1",
}));

// ─── POST /v1/embeddings ───
interface EmbedRequest {
  input: string | string[];
  model?: string;
}

log.post<{ Body: EmbedRequest }>("/v1/embeddings", async (req, reply) => {
  totalRequests++;
  const { input, model } = req.body;
  const texts = Array.isArray(input) ? input : [input];

  // Try Triton first (ONNX backend)
  try {
    const tritonModel = model?.includes("trt") ? "bge-small-trt" : "bge-small-onnx";
    const tritonResp = await fetch(
      `${TRITON_URL}/v2/models/${tritonModel}/infer`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inputs: [
            {
              name: "input_ids",
              shape: [texts.length, 512],
              datatype: "INT64",
              data: texts.map(() => new Array(512).fill(0)),
            },
            {
              name: "attention_mask",
              shape: [texts.length, 512],
              datatype: "INT64",
              data: texts.map(() => new Array(512).fill(1)),
            },
            {
              name: "token_type_ids",
              shape: [texts.length, 512],
              datatype: "INT64",
              data: texts.map(() => new Array(512).fill(0)),
            },
          ],
        }),
        signal: AbortSignal.timeout(10000),
      }
    );

    if (tritonResp.ok) {
      tritonHits++;
      const data = await tritonResp.json();
      const embeddings = data.outputs?.[0]?.data ?? [];
      return {
        object: "list",
        model: tritonModel,
        data: texts.map((_, i) => ({
          object: "embedding",
          index: i,
          embedding: embeddings.slice(i * 384, (i + 1) * 384),
        })),
        usage: { prompt_tokens: texts.join(" ").split(/\s+/).length, total_tokens: 0 },
        backend: "triton",
      };
    }
  } catch {
    req.log.warn("Triton unavailable, falling back to Ollama");
  }

  // Fallback: Ollama embeddings
  try {
    const ollamaResp = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "nomic-embed-text",
        input: texts,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (ollamaResp.ok) {
      ollamaHits++;
      const data = (await ollamaResp.json()) as { embeddings: number[][] };
      return {
        object: "list",
        model: "bge-small-en-v1.5",
        data: data.embeddings.map((emb: number[], i: number) => ({
          object: "embedding",
          index: i,
          embedding: emb,
        })),
        usage: { prompt_tokens: texts.join(" ").split(/\s+/).length, total_tokens: 0 },
        backend: "ollama",
      };
    }
  } catch {
    req.log.error("Ollama also unavailable");
  }

  reply.code(503);
  return { error: "No embedding backend available" };
});

// ─── POST /v1/completions ───
interface CompletionRequest {
  model?: string;
  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

log.post<{ Body: CompletionRequest }>("/v1/completions", async (req, reply) => {
  totalRequests++;
  const { model, prompt, messages, max_tokens, temperature, stream } = req.body;

  // Try NIM first (OpenAI-compatible API — NVIDIA Nemotron-Nano on local GPU)
  try {
    const nimModel = model ?? "nvidia/llama-3.1-nemotron-nano-8b-v1";
    const nimPayload = messages
      ? { model: nimModel, messages, max_tokens, temperature, stream: stream ?? false }
      : { model: nimModel, prompt, max_tokens, temperature, stream: stream ?? false };

    const endpoint = messages ? "chat/completions" : "completions";
    const nimResp = await fetch(`${NIM_URL}/v1/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nimPayload),
      signal: AbortSignal.timeout(120000),
    });

    if (nimResp.ok) {
      nimHits++;
      if (stream) {
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });
        const reader = nimResp.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            reply.raw.write(decoder.decode(value, { stream: true }));
          }
        }
        reply.raw.end();
        return;
      }
      return nimResp.json();
    }
  } catch {
    req.log.warn("NIM unavailable, falling back to Ollama");
  }

  // Fallback: Ollama
  try {
    const ollamaModel = model ?? "qwen2.5:3b";
    const ollamaPayload = messages
      ? { model: ollamaModel, messages, stream: false }
      : { model: ollamaModel, prompt, stream: false };

    const endpoint = messages ? "api/chat" : "api/generate";
    const ollamaResp = await fetch(`${OLLAMA_URL}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ollamaPayload),
      signal: AbortSignal.timeout(120000),
    });

    if (ollamaResp.ok) {
      ollamaHits++;
      const data = await ollamaResp.json();
      // Convert Ollama response to OpenAI format
      return {
        id: `chatcmpl-${Date.now()}`,
        object: messages ? "chat.completion" : "text_completion",
        model: ollamaModel,
        choices: [
          messages
            ? { index: 0, message: data.message, finish_reason: "stop" }
            : { index: 0, text: data.response, finish_reason: "stop" },
        ],
        usage: {
          prompt_tokens: data.prompt_eval_count ?? 0,
          completion_tokens: data.eval_count ?? 0,
          total_tokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
        },
        backend: "ollama",
      };
    }
  } catch {
    req.log.error("Ollama also unavailable for completions");
  }

  reply.code(503);
  return { error: "No completion backend available" };
});

// ─── POST /v1/nim/completions  (direct NIM, no Ollama fallback) ───
log.post<{ Body: CompletionRequest }>("/v1/nim/completions", async (req, reply) => {
  totalRequests++;
  const { model, prompt, messages, max_tokens, temperature, stream } = req.body;
  const nimModel = model ?? "nvidia/llama-3.1-nemotron-nano-8b-v1";
  try {
    const nimPayload = messages
      ? { model: nimModel, messages, max_tokens, temperature, stream: stream ?? false }
      : { model: nimModel, prompt, max_tokens, temperature, stream: stream ?? false };
    const endpoint = messages ? "chat/completions" : "completions";
    const nimResp = await fetch(`${NIM_URL}/v1/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nimPayload),
      signal: AbortSignal.timeout(120000),
    });
    if (nimResp.ok) {
      nimHits++;
      if (stream) {
        reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        const reader = nimResp.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          while (true) { const { done, value } = await reader.read(); if (done) break; reply.raw.write(decoder.decode(value, { stream: true })); }
        }
        reply.raw.end();
        return;
      }
      return nimResp.json();
    }
    reply.code(nimResp.status);
    return nimResp.json();
  } catch (e) {
    reply.code(503);
    return { error: `NIM unavailable: ${e}` };
  }
});

// ─── POST /v1/nim/chat/completions  (direct NIM chat, no fallback) ───
log.post<{ Body: CompletionRequest }>("/v1/nim/chat/completions", async (req, reply) => {
  totalRequests++;
  const { model, messages, max_tokens, temperature, stream } = req.body;
  const nimModel = model ?? "nvidia/llama-3.1-nemotron-nano-8b-v1";
  try {
    const nimPayload = { model: nimModel, messages: messages ?? [], max_tokens, temperature, stream: stream ?? false };
    const nimResp = await fetch(`${NIM_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nimPayload),
      signal: AbortSignal.timeout(120000),
    });
    if (nimResp.ok) {
      nimHits++;
      if (stream) {
        reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        const reader = nimResp.body?.getReader();
        if (reader) {
          const decoder = new TextDecoder();
          while (true) { const { done, value } = await reader.read(); if (done) break; reply.raw.write(decoder.decode(value, { stream: true })); }
        }
        reply.raw.end();
        return;
      }
      return nimResp.json();
    }
    reply.code(nimResp.status);
    return nimResp.json();
  } catch (e) {
    reply.code(503);
    return { error: `NIM unavailable: ${e}` };
  }
});

// ─── Start ───
try {
  await log.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`🚀 Inference Router running on :${PORT}`);
  console.log(`   Triton: ${TRITON_URL}`);
  console.log(`   NIM:    ${NIM_URL}`);
  console.log(`   Ollama: ${OLLAMA_URL}`);
} catch (err) {
  log.log.error(err);
  process.exit(1);
}
