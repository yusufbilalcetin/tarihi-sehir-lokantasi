"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { useSyncExternalStore } from "react"

const mobileToastQuery = "(hover: none) and (pointer: coarse)"

function subscribeToInputMode(onChange: () => void) {
  const query = window.matchMedia(mobileToastQuery)
  query.addEventListener("change", onChange)
  return () => query.removeEventListener("change", onChange)
}

const Toaster = ({ position, ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const isTouchDevice = useSyncExternalStore(
    subscribeToInputMode,
    () => window.matchMedia(mobileToastQuery).matches,
    () => false,
  )

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position={isTouchDevice ? "bottom-center" : (position ?? "top-center")}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
