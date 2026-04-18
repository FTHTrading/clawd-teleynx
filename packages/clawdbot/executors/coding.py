"""Coding Executor — Code generation, review, refactoring, documentation"""
import logging
from typing import Any

logger = logging.getLogger("clawdbot.coding")


class CodingExecutor:
    name = "coding"

    async def generate_code(self, llm_fn, payload: dict[str, Any]) -> dict[str, Any]:
        language = payload.get("language", "python")
        description = payload.get("description", "")
        framework = payload.get("framework", "")

        context = f" using {framework}" if framework else ""
        prompt = (
            f"Generate production-ready {language} code{context} for:\n{description}\n\n"
            f"Requirements:\n"
            f"- Clean, well-structured code\n"
            f"- Proper error handling\n"
            f"- Type hints/annotations where applicable\n"
            f"- Brief inline comments for complex logic only"
        )

        result = await llm_fn(
            messages=[
                {"role": "system", "content": f"You are an expert {language} developer. Write production-quality code."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=4096,
            temperature=0.3,
        )

        return {"code": result, "language": language, "framework": framework}

    async def review_code(self, llm_fn, payload: dict[str, Any]) -> dict[str, Any]:
        code = payload.get("code", "")
        language = payload.get("language", "")
        focus = payload.get("focus", "security,performance,correctness")

        prompt = (
            f"Review this {language} code. Focus on: {focus}\n\n"
            f"```{language}\n{code}\n```\n\n"
            f"Provide:\n"
            f"1. Critical issues (security, bugs)\n"
            f"2. Performance concerns\n"
            f"3. Code quality observations\n"
            f"4. Specific fix suggestions with code"
        )

        result = await llm_fn(
            messages=[
                {"role": "system", "content": "You are a senior code reviewer. Be thorough but practical."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=2048,
            temperature=0.2,
        )

        return {"review": result, "language": language}

    async def refactor(self, llm_fn, payload: dict[str, Any]) -> dict[str, Any]:
        code = payload.get("code", "")
        language = payload.get("language", "")
        goal = payload.get("goal", "improve readability and maintainability")

        prompt = (
            f"Refactor this {language} code to {goal}:\n\n"
            f"```{language}\n{code}\n```\n\n"
            f"Show the refactored code and explain changes."
        )

        result = await llm_fn(
            messages=[
                {"role": "system", "content": "You are an expert at refactoring code for clarity and performance."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=4096,
            temperature=0.3,
        )

        return {"refactored": result, "language": language, "goal": goal}
