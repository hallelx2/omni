import type { ProfilesRepo } from "@omni/storage"
import type { ModelProfile, ProfileCache } from "./probe.ts"

/**
 * SQLite-backed cache for `probeModelCached`. Profiles persist across CLI
 * sessions so we only probe once per model (within `maxAgeMs`).
 *
 * @example
 * ```ts
 * const store = new Storage(omniDbPath())
 * const cache = new SqliteProfileCache(new ProfilesRepo(store))
 * const profile = await probeModelCached(model, cache)
 * ```
 */
export class SqliteProfileCache implements ProfileCache {
  constructor(private readonly repo: ProfilesRepo) {}

  get(modelId: string): ModelProfile | null {
    const row = this.repo.get<ModelProfile>(modelId)
    return row?.profile ?? null
  }

  set(profile: ModelProfile): void {
    this.repo.upsert(profile.modelId, profile, profile.probedAt)
  }
}
