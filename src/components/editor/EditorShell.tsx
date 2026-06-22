import type { ReactNode } from "react";
import type { ThemeMode } from "@/types/editor";

export function EditorShell({ theme, children }: { theme: ThemeMode; children: ReactNode }) {
  return (
    <div className={theme === "dark" ? "theme-dark" : "theme-light"} data-theme={theme}>
      {children}
    </div>
  );
}
