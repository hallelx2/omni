import "./global.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import type { Metadata } from "next";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Omni — a self-improving agent harness for open LLMs",
    template: "%s · Omni Ω",
  },
  description:
    "Omni gives any language model — frontier or open — a body to act through, a memory to learn from, and a harness that measurably improves the more you use it. The harness is the agent.",
  metadataBase: new URL("https://omni-eight-ruby.vercel.app"),
  openGraph: {
    title: "Omni — the harness is the agent",
    description:
      "A self-improving agent harness for open models. Probe, adapt, evolve. Weaker models become useful when the harness is strong.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col antialiased">
        <RootProvider
          theme={{ defaultTheme: "dark", enableSystem: false }}
          search={{ enabled: true }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
