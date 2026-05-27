import { memo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"

export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div
      className={cn(
        "text-[13.5px] leading-relaxed text-foreground/95",
        "[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
        "[&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-lg [&_h1]:font-semibold",
        "[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-semibold",
        "[&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        "[&_strong]:font-semibold [&_strong]:text-foreground",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_hr]:my-4 [&_hr]:border-border",
        "[&_table]:my-2 [&_table]:w-full [&_table]:text-xs [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          code: ({ className, children, ...props }) => {
            const isBlock = (className ?? "").includes("language-") || (className ?? "").includes("hljs")
            if (isBlock) {
              return (
                <code className={cn(className, "font-mono")} {...props}>
                  {children}
                </code>
              )
            }
            return (
              <code
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
                {...props}
              >
                {children}
              </code>
            )
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
})

function CodeBlock({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  function copy() {
    const text = ref.current?.textContent ?? ""
    if (!text) return
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    })
  }
  return (
    <div className="group relative my-2.5">
      <pre
        ref={ref}
        className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-[12.5px] leading-relaxed font-mono scrollbar-thin"
      >
        {children}
      </pre>
      <button
        onClick={copy}
        className="absolute right-2 top-2 flex h-6 items-center gap-1 rounded-md border border-border bg-card px-2 text-[10px] font-medium text-muted-foreground opacity-0 transition-opacity duration-[var(--duration-fast)] ease-out hover:text-foreground group-hover:opacity-100"
      >
        {copied ? (
          <>
            <Check className="size-3 text-success" /> Copied
          </>
        ) : (
          <>
            <Copy className="size-3" /> Copy
          </>
        )}
      </button>
    </div>
  )
}
