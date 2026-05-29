import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

/**
 * Shared layout options (logo, nav links, GitHub link) reused by the home page
 * layout and the docs layout so the chrome stays consistent.
 */
export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2 font-semibold">
          <span
            aria-hidden
            className="omni-omega font-mono text-xl leading-none"
            style={{ fontWeight: 800 }}
          >
            Ω
          </span>
          <span className="tracking-tight">Omni</span>
        </span>
      ),
    },
    githubUrl: "https://github.com/hallelx2/omni",
    links: [
      {
        text: "Docs",
        url: "/docs",
        active: "nested-url",
      },
      {
        text: "Quick start",
        url: "/docs/quick-start",
      },
      {
        text: "Architecture",
        url: "/docs/architecture",
      },
    ],
  };
}
