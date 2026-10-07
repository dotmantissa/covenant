"use client";

import { useTheme } from "./theme-provider";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="p-1.5 rounded text-[var(--ink-2)] hover:text-[var(--ink)] hover:bg-[var(--paper-2)] transition-colors cursor-pointer"
      title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      aria-label="Toggle theme"
    >
      {theme === "light" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
    </button>
  );
}
