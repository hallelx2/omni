import { Toaster as Sonner } from "sonner"
import { useApp } from "@/store/app"

export function Toaster() {
  const theme = useApp((s) => s.theme)
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "!rounded-lg !border-border !bg-popover !text-popover-foreground !shadow-soft !font-sans",
          description: "!text-muted-foreground",
        },
      }}
    />
  )
}
