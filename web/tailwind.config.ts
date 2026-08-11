import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // TrackNaija design system — "Trust & Authority"
        primary: {
          DEFAULT: "#2563EB",
          dark: "#1D4ED8",
          light: "#3B82F6",
        },
        accent: {
          DEFAULT: "#F97316",
          dark: "#EA580C",
          light: "#FB923C",
        },
        surface: "#F8FAFC",
        ink: {
          DEFAULT: "#1E293B",
          muted: "#475569",
          faint: "#64748B",
        },
      },
      fontFamily: {
        sans: ["Fira Sans", "system-ui", "sans-serif"],
        mono: ["Fira Code", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 3px 0 rgb(30 41 59 / 0.08), 0 1px 2px -1px rgb(30 41 59 / 0.08)",
        lift: "0 10px 25px -5px rgb(30 41 59 / 0.12), 0 4px 10px -6px rgb(30 41 59 / 0.08)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.3s ease-out both",
        "pulse-soft": "pulseSoft 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
