import { useEffect, useState } from "react";
import { settingsApi } from "../services/api";
import { FALLBACK_MODELS } from "../constants/models";

/**
 * Model choices for a provider, fetched from the provider itself.
 *
 * Starts from the local fallback list so the picker renders immediately, then
 * swaps in the live list once it arrives. The backend never errors here, so a
 * failed lookup just leaves the fallback in place with `detail` set.
 *
 * `apiKey` is for the settings page, where the user may be testing a key they
 * have typed but not saved yet. Elsewhere, omit it and the server uses the
 * saved one. Change `reloadToken` to refetch — e.g. after saving a new key,
 * when the provider will start returning a real list instead of the fallback.
 */
/**
 * Last live list per provider, shared by every caller.
 *
 * The settings page passes a `reloadToken` that flips once the saved key loads,
 * so its effect runs more than once. Re-seeding the fallback on each run wiped
 * an already-good list and left the 2-entry fallback on screen for the seconds
 * the live lookup takes — while the assistant panel, which passes no token and
 * runs once, kept showing all of them. Caching keeps the two in step and makes
 * a revisit instant.
 */
const modelCache: Record<string, string[]> = {};

/** Providers whose list comes from GET /settings/provider-models. */
const REMOTE_LIST_PROVIDERS = ["openai", "anthropic"];

export function useProviderModels(
  provider: string | undefined,
  apiKey?: string,
  reloadToken?: string | number | boolean
) {
  const [models, setModels] = useState<string[]>(
    () => modelCache[provider ?? ""] ?? FALLBACK_MODELS[provider ?? ""] ?? []
  );
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<string | undefined>();

  useEffect(() => {
    // Ollama has its own endpoint (the local server's pulled models); "local"
    // has no remote list at all and used to 400 on every mount.
    if (!provider || !REMOTE_LIST_PROVIDERS.includes(provider)) {
      setModels(modelCache[provider ?? ""] ?? FALLBACK_MODELS[provider ?? ""] ?? []);
      setDetail(undefined);
      return;
    }

    let cancelled = false;
    setLoading(true);
    // Show the last known list while refetching — never fall back to the stub
    // once we have something real.
    setModels((prev) =>
      prev.length > 0 ? prev : modelCache[provider] ?? FALLBACK_MODELS[provider] ?? []
    );

    settingsApi
      .getProviderModels(provider, apiKey)
      .then(({ data }) => {
        if (cancelled) return;
        const isLive = data.source === "live";
        if (data.models?.length) {
          if (isLive) modelCache[provider] = data.models;
          // A fallback response must not overwrite a live list we already have.
          setModels((prev) => (isLive || prev.length === 0 ? data.models : prev));
        }
        setDetail(isLive ? undefined : data.detail);
      })
      .catch((err) => {
        if (cancelled) return;
        setDetail(`모델 목록을 가져오지 못했습니다: ${err?.message ?? err}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [provider, apiKey, reloadToken]);

  return { models, loading, detail };
}
