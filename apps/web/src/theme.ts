// The app's theme (Aryan, 26 Nov), picked in the account menu: Light (the default), Dark (the whole
// app dark) or Midnight (the pages light, only the sidebar near-black). It is this browser's choice,
// kept in localStorage, and it is set on <html data-theme> only while the app's frame is shown
// (shell.tsx), so the public site and the sign-in pages keep their own look. The colours are in
// styles.css ([data-theme=...]).

import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "midnight";
export const THEMES: { key: Theme; label: string }[] = [
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
  { key: "midnight", label: "Midnight" },
];

const KEY = "crm:theme";

function stored(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "dark" || value === "midnight" ? value : "light";
  } catch {
    return "light";
  }
}

const listeners = new Set<(theme: Theme) => void>();

/** The theme, and a way to change it; every user of the hook follows a change. */
export function useTheme(): [Theme, (next: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(stored);
  useEffect(() => {
    listeners.add(setTheme);
    return () => {
      listeners.delete(setTheme);
    };
  }, []);
  const change = (next: Theme) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // A private window doesn't keep it; it still applies until the page is left.
    }
    for (const one of listeners) one(next);
  };
  return [theme, change];
}

/** Puts the theme on <html> while the app's frame is on screen, and takes it off after. */
export function useAppliedTheme(theme: Theme) {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") delete root.dataset.theme;
    else root.dataset.theme = theme;
    return () => {
      delete root.dataset.theme;
    };
  }, [theme]);
}
