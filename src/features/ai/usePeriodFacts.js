import { useState, useEffect, useCallback } from "react";
import { loadFacts } from "./dataset.js";
import { authService } from "../auth/services/authService.js";

// Cache per period for the page lifetime
const factsCache = new Map();

/**
 * Converts month key ("sep", "aug") or period string ("2026-09") to ISO period YYYY-MM
 */
export function toPeriodKey(monthOrPeriod) {
  if (typeof monthOrPeriod === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthOrPeriod.trim())) {
    return monthOrPeriod.trim();
  }
  return monthOrPeriod === "aug" ? "2026-08" : "2026-09";
}

/**
 * Returns human-readable label in Arabic indicating the data origin.
 */
export function getSourceLabel(source) {
  if (source === "files") return "من ملفاتك المرفوعة";
  if (source === "database") return "بيانات حسابك";
  return "بيانات توضيحية";
}

/**
 * Invalidate the cached facts across components and trigger reload.
 */
export function invalidateFactsCache(period) {
  if (period) {
    const key = toPeriodKey(period);
    factsCache.delete(key);
  } else {
    factsCache.clear();
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("jadwa:facts-invalidated", { detail: { period: period ? toPeriodKey(period) : null } }),
    );
  }
}

/**
 * Shared hook: given period ("2026-09"/"2026-08" or month param "sep"/"aug"),
 * calls loadFacts(period) once, caches it per period for page lifetime,
 * and returns { facts, source, loading, refresh }.
 * source = "files" | "database" | "demo"
 */
export function usePeriodFacts(monthOrPeriod) {
  const period = toPeriodKey(monthOrPeriod);

  const [state, setState] = useState(() => {
    const cached = factsCache.get(period);
    return {
      facts: cached || null,
      source: cached?.source || null,
      loading: !cached,
    };
  });

  const fetchFacts = useCallback(
    async (force = false) => {
      if (!force && factsCache.has(period)) {
        const cached = factsCache.get(period);
        setState({
          facts: cached,
          source: cached?.source || "demo",
          loading: false,
        });
        return;
      }

      setState((prev) => ({ ...prev, loading: true }));
      try {
        const user = await authService.getCurrentUser().catch(() => null);
        const isGuest = !user || Boolean(user.isGuest);
        const facts = await loadFacts(period);

        if (facts && facts.period === period) {
          factsCache.set(period, facts);
          setState({
            facts,
            source: facts.source || (isGuest ? "demo" : "database"),
            loading: false,
          });
        } else {
          // If no facts or facts returned for a different fallback period
          const fallbackSource = isGuest ? "demo" : "database";
          setState({
            facts: null,
            source: fallbackSource,
            loading: false,
          });
        }
      } catch (err) {
        console.warn("[usePeriodFacts] Error loading facts:", err);
        setState({
          facts: null,
          source: "demo",
          loading: false,
        });
      }
    },
    [period],
  );

  useEffect(() => {
    fetchFacts();
  }, [fetchFacts]);

  useEffect(() => {
    function handleInvalidate(e) {
      const targetPeriod = e.detail?.period;
      if (!targetPeriod || targetPeriod === period) {
        fetchFacts(true);
      }
    }
    if (typeof window !== "undefined") {
      window.addEventListener("jadwa:facts-invalidated", handleInvalidate);
      return () => window.removeEventListener("jadwa:facts-invalidated", handleInvalidate);
    }
  }, [period, fetchFacts]);

  return {
    facts: state.facts,
    source: state.source || "demo",
    loading: state.loading,
    refresh: () => fetchFacts(true),
  };
}
