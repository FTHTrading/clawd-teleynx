"""
ClawdBot v2 — NVIDIA-First Autonomous Executor
Port 8089 — Routes all AI workloads through NVIDIA stack first, Ollama fallback
"""
import hashlib
import logging
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from enum import Enum
from typing import Any

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# ─── Config ───
INFERENCE_ROUTER_URL = os.getenv("INFERENCE_ROUTER_URL", "http://localhost:8100")
SPEECH_ROUTER_URL = os.getenv("SPEECH_ROUTER_URL", "http://localhost:8200")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
CLAWDHUB_URL = os.getenv("CLAWDHUB_URL", "http://localhost:8099")
X402_GATEWAY_URL = os.getenv("X402_GATEWAY_URL", "http://localhost:8402")
PORT = int(os.getenv("PORT", "8089"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s %(message)s")
logger = logging.getLogger("clawdbot")


# ─── Models ───
class ActionType(str, Enum):
    EMBEDDING = "embedding"
    LLM_GENERATE = "llm_generate"
    LLM_CHAT = "llm_chat"
    SPEECH_TO_TEXT = "speech_to_text"
    TEXT_TO_SPEECH = "text_to_speech"
    MARKETING_CAMPAIGN = "marketing_campaign"
    CODE_GENERATE = "code_generate"
    CODE_REVIEW = "code_review"
    DEVOPS_DEPLOY = "devops_deploy"
    DEVOPS_MONITOR = "devops_monitor"
    ANALYSIS = "analysis"
    X402_REQUEST_PAYMENT = "x402_request_payment"
    X402_VERIFY_RECEIPT = "x402_verify_receipt"


class ActionRequest(BaseModel):
    action: ActionType
    payload: dict[str, Any] = Field(default_factory=dict)
    executor: str | None = None
    priority: int = Field(default=5, ge=1, le=10)
    payment_token: str | None = None
    request_id: str | None = None


class ActionResult(BaseModel):
    request_id: str
    action: str
    status: str
    result: Any = None
    error: str | None = None
    backend: str | None = None
    duration_ms: float = 0
    executor: str | None = None
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ExecutorInfo(BaseModel):
    name: str
    actions: list[str]
    status: str = "ready"


# ─── HTTP Client ───
http_client: httpx.AsyncClient | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global http_client
    http_client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))
    logger.info("ClawdBot v2 starting — NVIDIA-first executor")
    logger.info(f"  Inference Router: {INFERENCE_ROUTER_URL}")
    logger.info(f"  Speech Router:    {SPEECH_ROUTER_URL}")
    logger.info(f"  Ollama:           {OLLAMA_URL}")
    yield
    await http_client.aclose()
    logger.info("ClawdBot v2 shutdown")


app = FastAPI(
    title="ClawdBot v2",
    description="NVIDIA-first autonomous AI executor",
    version="2.0.0",
    lifespan=lifespan,
)


# ─── Executors Registry ───
EXECUTORS: dict[str, "BaseExecutor"] = {}


class BaseExecutor:
    name: str = "base"
    actions: list[ActionType] = []

    async def execute(self, action: ActionType, payload: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError


# ─── Core AI Actions (routed through NVIDIA stack) ───
class NVIDIACoreExecutor(BaseExecutor):
    name = "nvidia-core"
    actions = [
        ActionType.EMBEDDING,
        ActionType.LLM_GENERATE,
        ActionType.LLM_CHAT,
        ActionType.SPEECH_TO_TEXT,
        ActionType.TEXT_TO_SPEECH,
    ]

    async def execute(self, action: ActionType, payload: dict[str, Any]) -> dict[str, Any]:
        assert http_client is not None

        if action == ActionType.EMBEDDING:
            resp = await http_client.post(
                f"{INFERENCE_ROUTER_URL}/v1/embeddings",
                json={"input": payload.get("input", ""), "model": payload.get("model")},
            )
            resp.raise_for_status()
            return resp.json()

        if action in (ActionType.LLM_GENERATE, ActionType.LLM_CHAT):
            body: dict[str, Any] = {
                "max_tokens": payload.get("max_tokens", 1024),
                "temperature": payload.get("temperature", 0.7),
            }
            if "model" in payload:
                body["model"] = payload["model"]
            if action == ActionType.LLM_CHAT:
                body["messages"] = payload.get("messages", [{"role": "user", "content": payload.get("prompt", "")}])
            else:
                body["prompt"] = payload.get("prompt", "")

            resp = await http_client.post(f"{INFERENCE_ROUTER_URL}/v1/completions", json=body)
            resp.raise_for_status()
            return resp.json()

        if action == ActionType.SPEECH_TO_TEXT:
            audio_data = payload.get("audio")
            if not audio_data:
                return {"error": "No audio data provided"}
            resp = await http_client.post(
                f"{SPEECH_ROUTER_URL}/v1/asr",
                content=bytes.fromhex(audio_data) if isinstance(audio_data, str) else audio_data,
                headers={"Content-Type": "audio/wav"},
            )
            resp.raise_for_status()
            return resp.json()

        if action == ActionType.TEXT_TO_SPEECH:
            resp = await http_client.post(
                f"{SPEECH_ROUTER_URL}/v1/tts",
                json={
                    "text": payload.get("text", ""),
                    "voice": payload.get("voice"),
                    "speed": payload.get("speed", 1.0),
                },
            )
            resp.raise_for_status()
            return {"audio_hex": resp.content.hex(), "format": "wav", "backend": resp.headers.get("x-backend", "unknown")}

        return {"error": f"Unknown action: {action}"}


# ─── Marketing Executor ───
class MarketingExecutor(BaseExecutor):
    name = "marketing"
    actions = [ActionType.MARKETING_CAMPAIGN, ActionType.ANALYSIS]

    async def execute(self, action: ActionType, payload: dict[str, Any]) -> dict[str, Any]:
        nvidia_core = EXECUTORS.get("nvidia-core")
        if not nvidia_core:
            return {"error": "NVIDIA core executor not available"}

        if action == ActionType.MARKETING_CAMPAIGN:
            product = payload.get("product", "")
            audience = payload.get("audience", "general")
            channels = payload.get("channels", ["twitter", "email"])

            prompt = (
                f"Create a marketing campaign for: {product}\n"
                f"Target audience: {audience}\n"
                f"Channels: {', '.join(channels)}\n\n"
                f"Provide:\n1. Campaign name\n2. Tagline\n3. Key messages (3-5)\n"
                f"4. Content for each channel\n5. Call to action"
            )

            result = await nvidia_core.execute(
                ActionType.LLM_CHAT,
                {
                    "messages": [
                        {"role": "system", "content": "You are an expert marketing strategist."},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": 2048,
                    "temperature": 0.8,
                },
            )
            return {"campaign": result, "product": product, "audience": audience, "channels": channels}

        if action == ActionType.ANALYSIS:
            data = payload.get("data", "")
            prompt = f"Analyze the following market data and provide insights:\n\n{data}"
            result = await nvidia_core.execute(
                ActionType.LLM_CHAT,
                {
                    "messages": [
                        {"role": "system", "content": "You are a market analysis expert."},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": 2048,
                },
            )
            return {"analysis": result}

        return {"error": f"Marketing executor does not handle {action}"}


# ─── Coding Executor ───
class CodingExecutor(BaseExecutor):
    name = "coding"
    actions = [ActionType.CODE_GENERATE, ActionType.CODE_REVIEW]

    async def execute(self, action: ActionType, payload: dict[str, Any]) -> dict[str, Any]:
        nvidia_core = EXECUTORS.get("nvidia-core")
        if not nvidia_core:
            return {"error": "NVIDIA core executor not available"}

        if action == ActionType.CODE_GENERATE:
            language = payload.get("language", "python")
            description = payload.get("description", "")
            prompt = (
                f"Generate {language} code for the following:\n{description}\n\n"
                f"Provide clean, production-ready code with proper error handling."
            )
            result = await nvidia_core.execute(
                ActionType.LLM_CHAT,
                {
                    "messages": [
                        {"role": "system", "content": f"You are an expert {language} developer."},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": 4096,
                    "temperature": 0.3,
                },
            )
            return {"code": result, "language": language}

        if action == ActionType.CODE_REVIEW:
            code = payload.get("code", "")
            language = payload.get("language", "")
            prompt = f"Review this {language} code for bugs, security issues, and improvements:\n\n```{language}\n{code}\n```"
            result = await nvidia_core.execute(
                ActionType.LLM_CHAT,
                {
                    "messages": [
                        {"role": "system", "content": "You are an expert code reviewer."},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": 2048,
                },
            )
            return {"review": result, "language": language}

        return {"error": f"Coding executor does not handle {action}"}


# ─── DevOps Executor ───
class DevOpsExecutor(BaseExecutor):
    name = "devops"
    actions = [ActionType.DEVOPS_DEPLOY, ActionType.DEVOPS_MONITOR]

    async def execute(self, action: ActionType, payload: dict[str, Any]) -> dict[str, Any]:
        nvidia_core = EXECUTORS.get("nvidia-core")
        if not nvidia_core:
            return {"error": "NVIDIA core executor not available"}

        if action == ActionType.DEVOPS_DEPLOY:
            service = payload.get("service", "")
            environment = payload.get("environment", "staging")
            prompt = (
                f"Generate a deployment plan for service: {service}\n"
                f"Environment: {environment}\n\n"
                f"Include: pre-deploy checks, deployment steps, rollback plan, post-deploy verification."
            )
            result = await nvidia_core.execute(
                ActionType.LLM_CHAT,
                {
                    "messages": [
                        {"role": "system", "content": "You are an expert DevOps engineer."},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": 2048,
                },
            )
            return {"plan": result, "service": service, "environment": environment}

        if action == ActionType.DEVOPS_MONITOR:
            metrics = payload.get("metrics", "")
            prompt = f"Analyze these system metrics and identify issues:\n\n{metrics}"
            result = await nvidia_core.execute(
                ActionType.LLM_CHAT,
                {
                    "messages": [
                        {"role": "system", "content": "You are a systems monitoring expert."},
                        {"role": "user", "content": prompt},
                    ],
                    "max_tokens": 1024,
                },
            )
            return {"analysis": result}

        return {"error": f"DevOps executor does not handle {action}"}


class X402Executor(BaseExecutor):
    name = "x402"
    actions = [ActionType.X402_REQUEST_PAYMENT, ActionType.X402_VERIFY_RECEIPT]

    async def execute(self, action: ActionType, payload: dict[str, Any]) -> dict[str, Any]:
        assert http_client is not None

        if action == ActionType.X402_REQUEST_PAYMENT:
            body = {
                "consumer_id": payload.get("consumer_id"),
                "service_id": payload.get("service_id"),
                "amount_atp": payload.get("amount_atp"),
                "memo": payload.get("memo", "clawdbot execution"),
            }
            resp = await http_client.post(f"{X402_GATEWAY_URL}/v1/request-payment", json=body)
            resp.raise_for_status()
            data = resp.json()
            data["backend"] = "x402-credit-gateway"
            return data

        if action == ActionType.X402_VERIFY_RECEIPT:
            receipt_id = payload.get("receipt_id")
            if not receipt_id:
                return {"error": "receipt_id is required"}
            resp = await http_client.get(f"{X402_GATEWAY_URL}/v1/receipts/{receipt_id}")
            resp.raise_for_status()
            data = resp.json()
            data["backend"] = "x402-credit-gateway"
            return data

        return {"error": f"X402 executor does not handle {action}"}


# ─── Register all executors ───
def register_executors():
    for cls in [NVIDIACoreExecutor, MarketingExecutor, CodingExecutor, DevOpsExecutor, X402Executor]:
        inst = cls()
        EXECUTORS[inst.name] = inst
        logger.info(f"Registered executor: {inst.name} ({[a.value for a in inst.actions]})")


register_executors()


# ─── Action routing ───
def find_executor(action: ActionType, preferred: str | None = None) -> BaseExecutor | None:
    if preferred and preferred in EXECUTORS:
        ex = EXECUTORS[preferred]
        if action in ex.actions:
            return ex
    for ex in EXECUTORS.values():
        if action in ex.actions:
            return ex
    return None


# ─── Routes ───
@app.get("/health")
async def health():
    backends = {}
    assert http_client is not None
    for name, url in [
        ("inference_router", f"{INFERENCE_ROUTER_URL}/health"),
        ("speech_router", f"{SPEECH_ROUTER_URL}/health"),
        ("ollama", f"{OLLAMA_URL}/api/tags"),
        ("x402_gateway", f"{X402_GATEWAY_URL}/health"),
    ]:
        try:
            r = await http_client.get(url, timeout=3.0)
            backends[name] = "up" if r.status_code == 200 else "down"
        except Exception:
            backends[name] = "down"

    return {
        "status": "ok",
        "version": "2.0.0",
        "executors": {name: {"actions": [a.value for a in ex.actions], "status": "ready"} for name, ex in EXECUTORS.items()},
        "backends": backends,
    }


@app.get("/executors")
async def list_executors():
    return [
        ExecutorInfo(name=name, actions=[a.value for a in ex.actions])
        for name, ex in EXECUTORS.items()
    ]


# ─── Stats ───
stats: dict[str, Any] = {"total": 0, "success": 0, "failed": 0, "by_executor": {}, "by_action": {}}


@app.post("/v1/execute", response_model=ActionResult)
async def execute_action(req: ActionRequest):
    start = time.monotonic()
    request_id = req.request_id or hashlib.sha256(f"{req.action}{time.time()}".encode()).hexdigest()[:16]

    executor = find_executor(req.action, req.executor)
    if not executor:
        raise HTTPException(status_code=400, detail=f"No executor for action: {req.action}")

    stats["total"] += 1
    stats["by_action"][req.action.value] = stats["by_action"].get(req.action.value, 0) + 1
    stats["by_executor"][executor.name] = stats["by_executor"].get(executor.name, 0) + 1

    try:
        result = await executor.execute(req.action, req.payload)
        duration = (time.monotonic() - start) * 1000
        stats["success"] += 1
        return ActionResult(
            request_id=request_id,
            action=req.action.value,
            status="success",
            result=result,
            backend=result.get("backend") if isinstance(result, dict) else None,
            duration_ms=round(duration, 2),
            executor=executor.name,
        )
    except Exception as e:
        duration = (time.monotonic() - start) * 1000
        stats["failed"] += 1
        logger.error(f"Execution failed: {e}")
        return ActionResult(
            request_id=request_id,
            action=req.action.value,
            status="error",
            error=str(e),
            duration_ms=round(duration, 2),
            executor=executor.name,
        )


@app.get("/stats")
async def get_stats():
    return stats


# ─── Convenience endpoints ───
@app.post("/v1/embed")
async def embed_shortcut(body: dict[str, Any]):
    return await execute_action(ActionRequest(action=ActionType.EMBEDDING, payload=body))


@app.post("/v1/chat")
async def chat_shortcut(body: dict[str, Any]):
    return await execute_action(ActionRequest(action=ActionType.LLM_CHAT, payload=body))


@app.post("/v1/generate")
async def generate_shortcut(body: dict[str, Any]):
    return await execute_action(ActionRequest(action=ActionType.LLM_GENERATE, payload=body))


@app.post("/v1/asr")
async def asr_shortcut(body: dict[str, Any]):
    return await execute_action(ActionRequest(action=ActionType.SPEECH_TO_TEXT, payload=body))


@app.post("/v1/tts")
async def tts_shortcut(body: dict[str, Any]):
    return await execute_action(ActionRequest(action=ActionType.TEXT_TO_SPEECH, payload=body))


@app.post("/v1/x402/request-payment")
async def x402_request_payment_shortcut(body: dict[str, Any]):
    return await execute_action(ActionRequest(action=ActionType.X402_REQUEST_PAYMENT, payload=body))


@app.post("/v1/x402/verify-receipt")
async def x402_verify_receipt_shortcut(body: dict[str, Any]):
    return await execute_action(ActionRequest(action=ActionType.X402_VERIFY_RECEIPT, payload=body))


if __name__ == "__main__":
    uvicorn.run("runner:app", host="0.0.0.0", port=PORT, log_level="info", reload=False)
