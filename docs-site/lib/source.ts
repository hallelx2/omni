import { docs } from "@/.source/server";
import { loader } from "fumadocs-core/source";

/**
 * The single content source for the Omni documentation. `docs` is the generated
 * collection from `fumadocs-mdx` (see `source.config.ts`); `toFumadocsSource()`
 * adapts it to the shape `loader` expects, and `loader` builds the page tree,
 * URL map, and per-page accessors used throughout the app.
 */
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});
