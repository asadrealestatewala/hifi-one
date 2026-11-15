// Personal display settings: background colour, light or dark, and row density.
// Each person picks their own from the Appearance menu in the top bar. The choice is kept in this browser (localStorage),
// like the theme always was, and applied to <html> before the first paint by the script in src/app/layout.tsx.
// Only the light theme changes background; dark keeps its own navy palette. The colours themselves live in globals.css.

export const BACKGROUNDS = [
  { key: "cream", label: "Cream", swatch: "#f8f4ec" },
  { key: "grey", label: "Cool grey", swatch: "#f5f6f8" },
  { key: "lavender", label: "Soft lavender", swatch: "#f5f4fb" },
  { key: "slate", label: "Slate blue", swatch: "#f1f5f9" },
  { key: "sage", label: "Soft sage", swatch: "#f3f6f3" },
] as const;

export type BackgroundKey = (typeof BACKGROUNDS)[number]["key"];
export const DEFAULT_BACKGROUND: BackgroundKey = "cream";

export const STORAGE = { theme: "hifi.theme", background: "hifi.bg", density: "hifi.density" } as const;

export function isBackground(v: unknown): v is BackgroundKey {
  return typeof v === "string" && BACKGROUNDS.some((b) => b.key === v);
}

// The inline script for <head>. Kept as a string because it must run before React. Unknown values fall back to the defaults.
export const APPEARANCE_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem("${STORAGE.theme}");if(t==="dark"||t==="light")d.dataset.theme=t;else if(matchMedia("(prefers-color-scheme: dark)").matches)d.dataset.theme="dark";var b=localStorage.getItem("${STORAGE.background}");if(${JSON.stringify(BACKGROUNDS.map((x) => x.key).filter((k) => k !== DEFAULT_BACKGROUND))}.indexOf(b)>-1)d.dataset.bg=b;if(localStorage.getItem("${STORAGE.density}")==="compact")d.dataset.density="compact"}catch(e){}`;
