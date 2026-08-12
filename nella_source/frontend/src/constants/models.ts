/**
 * Single source of truth for LLM model choices in the UI.
 *
 * These lists are only a fallback for first paint and for when no API key has
 * been entered yet — the real list comes from GET /settings/provider-models,
 * which asks the provider what it actually serves (see useProviderModels).
 *
 * Model IDs used to be hardcoded separately in five components, and the copies
 * drifted apart until some held IDs the provider had already retired. Picking
 * one returned a 404 that read as "my API key doesn't work". Keep this file as
 * the only place a model ID is written down.
 */

export type LLMProvider = "openai" | "anthropic" | "ollama";

/** Kept in sync with FALLBACK_PROVIDER_MODELS in backend/api/settings.py. */
export const FALLBACK_MODELS: Record<string, string[]> = {
  anthropic: [
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-haiku-4-5",
    "claude-opus-4-8",
    "claude-sonnet-4-6",
  ],
  openai: ["gpt-4o", "gpt-4o-mini"],
  // Ollama models are whatever the local server has pulled; fetched separately
  // via /settings/ollama-models, so there is nothing sensible to hardcode.
  ollama: [],
};

/** Used when a provider has no configured model yet. */
export const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-4o-mini",
  ollama: "llama3.2",
};

export const OLLAMA_MODEL_PLACEHOLDER = "예: llama3.2, qwen2.5:7b";
