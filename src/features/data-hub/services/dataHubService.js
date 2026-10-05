import { supabase, isSupabaseConfigured } from "../../../shared/lib/supabase.js";
import { JadwaSession } from "../../../shared/lib/session.js";
import { toDataHubFileDTO } from "../../../shared/types/dto.js";
import { authService } from "../../auth/services/authService.js";
import { invalidateFactsCache } from "../../ai/usePeriodFacts.js";

export const dataHubService = {
  /**
   * Get all prepared data files, synchronizing remote Supabase storage with tab session
   */
  async getFiles(period, explicitIsGuest = null) {
    let isGuest = explicitIsGuest;
    if (isGuest === null) {
      const user = await authService.getCurrentUser();
      isGuest = Boolean(user && user.isGuest);
    }

    if (!isGuest && isSupabaseConfigured && supabase) {
      try {
        let query = supabase.from("data_hub_files").select("*");
        if (period) {
          query = query.eq("period_key", period);
        }
        const { data, error } = await query;

        if (!error && data && data.length > 0) {
          const remoteFiles = data.map(toDataHubFileDTO);
          const matched = period ? remoteFiles.filter((f) => f.result?.period === period) : remoteFiles;
          if (matched.length > 0) return matched;
        }
      } catch (err) {
        console.warn("[Data Hub Service] Error reading remote files:", err);
      }
    }

    // Always fallback to session files if no remote files found
    const sessionFiles = JadwaSession.files();
    return period ? JadwaSession.forPeriod(period) : sessionFiles;
  },

  /**
   * Save a prepared file into the tab session and, for signed-in users, Supabase.
   * Returns { saved: true } when stored in Supabase, { saved: false, reason } otherwise.
   */
  async saveFile(file) {
    // 1. Session storage first for a responsive UI
    const existing = JadwaSession.files();
    const filtered = existing.filter((f) => f.id !== file.replaces && f.id !== file.id);
    filtered.push(file);
    JadwaSession.save(filtered);

    if (!isSupabaseConfigured || !supabase) return { saved: false, reason: "offline" };
    try {
      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (!userId) return { saved: false, reason: "no_user" };
      const payload = {
        id: isUuid(file.id) ? file.id : undefined,
        user_id: userId,
        file_name: file.name,
        file_type: file.type,
        file_size: file.size || 0,
        period_key: file.result.period,
        origin: file.origin || "upload",
        headers: file.parsed?.headers || [],
        mapping: file.mapping || {},
        valid_count: file.result?.valid?.length || 0,
        invalid_count: file.result?.invalid?.length || 0,
        issues: file.result?.issues || [],
        valid_rows: file.result?.valid || [],
        invalid_rows: file.result?.invalid || [],
        prepared_at: new Date(file.preparedAt || Date.now()).toISOString(),
      };
      // Replace: remove the previous file of the same source and month
      if (isUuid(file.replaces)) {
        await supabase.from("data_hub_files").delete().eq("id", file.replaces);
      }
      await supabase
        .from("data_hub_files")
        .delete()
        .eq("file_type", file.type)
        .eq("period_key", file.result.period);
      const { error } = await supabase.from("data_hub_files").insert([payload]);
      if (error) {
        console.warn("[Data Hub Service] Supabase insert failed:", error.message);
        return { saved: false, reason: error.message };
      }
      invalidateFactsCache(file.result?.period);
      return { saved: true };
    } catch (err) {
      console.warn("[Data Hub Service] Error persisting to Supabase:", err);
      invalidateFactsCache(file.result?.period);
      return { saved: false, reason: err.message };
    }
  },

  /**
   * Delete a prepared file from the tab session and Supabase
   */
  async deleteFile(fileId) {
    const updated = JadwaSession.files().filter((f) => f.id !== fileId);
    JadwaSession.save(updated);
    if (isSupabaseConfigured && supabase && isUuid(fileId)) {
      const { error } = await supabase.from("data_hub_files").delete().eq("id", fileId);
      if (error) console.warn("[Data Hub Service] Error deleting remote file:", error.message);
    }
    invalidateFactsCache();
  },
};

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function newFileId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ ((Math.random() * 16) >> (c / 4))).toString(16),
  );
}
