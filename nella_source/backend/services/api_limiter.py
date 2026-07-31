"""
Global LLM API rate limiter.
Shared across chat.py (agent) and llm_service.py (data generation)
to prevent concurrent API calls from exceeding rate limits.
"""
import asyncio

# Allows only 1 concurrent LLM API call across the entire backend.
# When the agent is mid-turn, data generation waits; vice versa.
llm_api_lock = asyncio.Semaphore(1)
