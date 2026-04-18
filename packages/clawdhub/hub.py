"""
ClawdHub — Operator Shell & Control Surface
Port 8099 — Live status dashboard, backend health, operator API
"""
import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI
from fastapi.responses import HTMLResponse

# ─── Config ───
PORT = int(os.getenv("CLAWDHUB_PORT", "8099"))
NIM_URL          = os.getenv("NIM_URL",           "http://localhost:8800")
CLAWDBOT_URL     = os.getenv("CLAWDBOT_URL",      "http://localhost:8089")
FINN_URL         = os.getenv("FINN_URL",           "http://localhost:7700")
APOSTLE_URL      = os.getenv("APOSTLE_URL",        "http://localhost:7332")
INF_ROUTER_URL   = os.getenv("INFERENCE_ROUTER_URL","http://localhost:8100")
SPEECH_ROUTER_URL= os.getenv("SPEECH_ROUTER_URL",  "http://localhost:8200")
GUARDRAILS_URL   = os.getenv("GUARDRAILS_URL",      "http://localhost:8105")
MEMORY_URL       = os.getenv("MEMORY_URL",          "http://localhost:8106")
VOICE_URL        = os.getenv("VOICE_URL",           "http://localhost:8202")
NIM_HEAVY_URL    = os.getenv("NIM_HEAVY_URL",        "http://localhost:8803")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [ClawdHub] %(levelname)s %(message)s",
)
logger = logging.getLogger("clawdhub")

# ─── Backend registry ─── (name, url, health_path, description)
BACKENDS: list[tuple[str, str, str, str]] = [
    ("NIM Fast (Nano 8B)",   NIM_URL,           "/v1/models",   "llama-3.1-nemotron-nano-8b"),
    ("NIM Heavy (30B A3B)",  NIM_HEAVY_URL,     "/v1/models",   "nemotron-3-nano-30b"),
    ("Inference Router",     INF_ROUTER_URL,    "/health",      "port 8100"),
    ("Speech Router",        SPEECH_ROUTER_URL, "/health",      "port 8200"),
    ("ClawdBot Runner",      CLAWDBOT_URL,      "/health",      "port 8089"),
    ("Finn",                 FINN_URL,          "/health",      "port 7700"),
    ("Apostle Chain",        APOSTLE_URL,       "/health",      "port 7332"),
    ("Guardrails",           GUARDRAILS_URL,    "/health",      "port 8105"),
    ("Memory / RAG",         MEMORY_URL,        "/health",      "port 8106"),
    ("Voice / PersonaPlex",  VOICE_URL,         "/health",      "port 8202"),
]

_start_time = time.monotonic()
http_client: httpx.AsyncClient | None = None


async def probe(url: str, path: str, timeout: float = 3.0) -> tuple[str, float]:
    assert http_client is not None
    t0 = time.monotonic()
    try:
        r = await http_client.get(f"{url}{path}", timeout=timeout)
        ms = round((time.monotonic() - t0) * 1000, 1)
        return ("up" if r.status_code < 400 else "degraded"), ms
    except Exception:
        ms = round((time.monotonic() - t0) * 1000, 1)
        return "down", ms


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global http_client
    http_client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0))

    logger.info("=" * 60)
    logger.info("ClawdHub starting — operator control surface")
    logger.info(f"  NIM Fast:         {NIM_URL}")
    logger.info(f"  NIM Heavy:        {NIM_HEAVY_URL}")
    logger.info(f"  Inference Router: {INF_ROUTER_URL}")
    logger.info(f"  Speech Router:    {SPEECH_ROUTER_URL}")
    logger.info(f"  ClawdBot:         {CLAWDBOT_URL}")
    logger.info(f"  Finn:             {FINN_URL}")
    logger.info(f"  Apostle Chain:    {APOSTLE_URL}")
    logger.info(f"  Guardrails:       {GUARDRAILS_URL}")
    logger.info(f"  Memory / RAG:     {MEMORY_URL}")
    logger.info(f"  Voice:            {VOICE_URL}")
    logger.info("Probing backends at startup ...")

    results = await asyncio.gather(
        *[probe(url, path) for _, url, path, _ in BACKENDS],
        return_exceptions=True,
    )
    for (name, url, _, desc), result in zip(BACKENDS, results):
        status, ms = result if isinstance(result, tuple) else ("error", 0.0)
        icon = "✓" if status == "up" else "✗"
        logger.info(f"  {icon} {name:<28} {status:<10} {ms:>6.0f}ms  ({url})")

    logger.info("=" * 60)
    yield
    await http_client.aclose()
    logger.info("ClawdHub shutdown")


app = FastAPI(
    title="ClawdHub",
    description="Operator shell and control surface for the 5090 stack",
    version="1.0.0",
    lifespan=lifespan,
)


# ─── /health ───
@app.get("/health")
async def health():
    uptime = round(time.monotonic() - _start_time, 1)
    checks: dict[str, Any] = {}
    tasks = [probe(url, path) for _, url, path, _ in BACKENDS]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for (name, _, _, _), result in zip(BACKENDS, results):
        status, ms = result if isinstance(result, tuple) else ("error", 0.0)
        checks[name] = {"status": status, "latency_ms": ms}
    overall = "ok" if any(v["status"] == "up" for v in checks.values()) else "degraded"
    return {
        "status": overall,
        "uptime_seconds": uptime,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "backends": checks,
    }


# ─── /dashboard ───
DASHBOARD_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ClawdHub — 5090 Stack</title>
<style>
  :root {{
    --bg: #0d1117; --card: #161b22; --border: #30363d;
    --green: #3fb950; --red: #f85149; --yellow: #d29922;
    --text: #e6edf3; --muted: #8b949e; --blue: #58a6ff;
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", monospace;
  }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ background: var(--bg); color: var(--text); font-family: var(--font); padding: 24px; }}
  header {{ display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }}
  h1 {{ font-size: 1.4rem; font-weight: 700; letter-spacing: 0.04em; }}
  .subtitle {{ color: var(--muted); font-size: 0.8rem; }}
  .badge {{ background: var(--card); border: 1px solid var(--border);
            border-radius: 20px; padding: 4px 12px; font-size: 0.75rem; color: var(--muted); }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }}
  .card {{ background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }}
  .card-header {{ display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }}
  .card-name {{ font-weight: 600; font-size: 0.95rem; }}
  .card-desc {{ color: var(--muted); font-size: 0.75rem; margin-top: 2px; }}
  .dot {{ width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }}
  .dot.up      {{ background: var(--green); box-shadow: 0 0 6px var(--green); }}
  .dot.down    {{ background: var(--red);   box-shadow: 0 0 6px var(--red); }}
  .dot.degraded {{ background: var(--yellow); box-shadow: 0 0 6px var(--yellow); }}
  .dot.loading {{ background: var(--muted); animation: pulse 1s infinite; }}
  .latency {{ color: var(--muted); font-size: 0.75rem; margin-top: 6px; }}
  .status-text {{ font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }}
  .status-text.up      {{ color: var(--green); }}
  .status-text.down    {{ color: var(--red); }}
  .status-text.degraded {{ color: var(--yellow); }}
  .status-text.loading {{ color: var(--muted); }}
  .footer {{ margin-top: 24px; color: var(--muted); font-size: 0.75rem; display: flex;
             align-items: center; justify-content: space-between; }}
  .ticker {{ color: var(--blue); }}
  @keyframes pulse {{ 0%,100%{{opacity:1}} 50%{{opacity:0.3}} }}
</style>
</head>
<body>
<header>
  <div>
    <h1>ClawdHub</h1>
    <div class="subtitle">RTX 5090 Stack — Operator Control Surface</div>
  </div>
  <div class="badge" id="refresh-badge">auto-refresh 5s</div>
</header>

<div class="grid" id="grid">
  {card_placeholders}
</div>

<div class="footer">
  <span>ClawdHub v1.0 &nbsp;|&nbsp; <a href="/health" style="color:var(--blue)">JSON health</a>
    &nbsp;|&nbsp; <a href="/docs" style="color:var(--blue)">API docs</a></span>
  <span class="ticker" id="ts">—</span>
</div>

<script>
const BACKENDS = {backends_json};

function renderCards(data) {{
  const grid = document.getElementById('grid');
  grid.innerHTML = BACKENDS.map(b => {{
    const info = data && data.backends && data.backends[b.name];
    const status = info ? info.status : 'loading';
    const ms = info ? info.latency_ms + ' ms' : '—';
    return `<div class="card">
      <div class="card-header">
        <div>
          <div class="card-name">${{b.name}}</div>
          <div class="card-desc">${{b.desc}}</div>
        </div>
        <div class="dot ${{status}}"></div>
      </div>
      <div class="status-text ${{status}}">${{status}}</div>
      <div class="latency">latency: ${{ms}}</div>
    </div>`;
  }}).join('');
}}

async function refresh() {{
  try {{
    const r = await fetch('/health');
    const data = await r.json();
    renderCards(data);
    document.getElementById('ts').textContent = new Date().toLocaleTimeString();
  }} catch(e) {{
    renderCards(null);
  }}
}}

// Initial skeleton
renderCards(null);
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>
"""


@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard():
    import json
    backends_json = json.dumps([
        {"name": name, "desc": desc}
        for name, _, _, desc in BACKENDS
    ])
    # placeholder cards rendered by JS; just need the template
    card_placeholders = "\n".join(
        f'<div class="card" id="card-{i}"></div>' for i in range(len(BACKENDS))
    )
    html = DASHBOARD_HTML.format(
        backends_json=backends_json,
        card_placeholders=card_placeholders,
    )
    return HTMLResponse(content=html)


# ─── /v1/backends (JSON list for programmatic consumers) ───
@app.get("/v1/backends")
async def backends_status():
    tasks = [probe(url, path) for _, url, path, _ in BACKENDS]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    out = []
    for (name, url, path, desc), result in zip(BACKENDS, results):
        status, ms = result if isinstance(result, tuple) else ("error", 0.0)
        out.append({
            "name": name,
            "url": url,
            "description": desc,
            "status": status,
            "latency_ms": ms,
        })
    return out


# ─── /v1/stack (VRAM budget summary) ───
@app.get("/v1/stack")
async def stack_summary():
    nim_fast  = (await probe(NIM_URL,       "/v1/models"))[0]
    nim_heavy = (await probe(NIM_HEAVY_URL, "/v1/models"))[0]
    voice_svc = (await probe(VOICE_URL,     "/health"))[0]
    vram_used = 0
    lanes = []
    if nim_fast == "up":
        vram_used += 8
        lanes.append("fast (Nano 8B)")
    if nim_heavy == "up":
        vram_used += 20
        lanes.append("heavy (30B A3B)")
    if voice_svc == "up":
        vram_used += 14
        lanes.append("voice (PersonaPlex)")
    return {
        "active_lanes": lanes,
        "vram_used_gb": vram_used,
        "vram_total_gb": 24,
        "vram_free_gb": 24 - vram_used,
        "contention": vram_used > 24,
    }


if __name__ == "__main__":
    uvicorn.run("hub:app", host="0.0.0.0", port=PORT, log_level="info", reload=False)
