import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

/**
 * Default Fumadocs static search endpoint, backed by the same content source.
 * The search dialog (Ctrl/Cmd-K) in RootProvider queries this route.
 */
export const { GET } = createFromSource(source);
