/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#9E2A2B",
          hover: "#7D1E1F",
        },
        gold: "#B08D57",
        paper: {
          bg: "#FAF9F6",
          surface: "#FFFFFF",
          muted: "#F3F1EC",
          border: "#E2DFD7",
          text: "#18181B",
          subtext: "#52525B",
        },
        charcoal: {
          bg: "#121214",
          surface: "#1A1A1E",
          muted: "#222227",
          border: "#2E2E36",
          text: "#F4F4F0",
          subtext: "#A1A1AA",
        },
        status: {
          winning: "#15803D",
          outbid: "#B91C1C",
          warning: "#B45309",
        },
      },
      fontFamily: {
        serif: ["'Cormorant Garamond'", "Georgia", "serif"],
        sans: ["'Inter'", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: {
        none: "0px",
        sm: "2px",
        DEFAULT: "2px",
        md: "4px",
      },
    },
  },
  plugins: [],
};
