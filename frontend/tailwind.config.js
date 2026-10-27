/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#681417",
          hover: "#521013",
        },
        gold: {
          DEFAULT: "#B08D57",
          hover: "#C5A059",
          muted: "#8C6D3B",
        },
        paper: {
          bg: "#F7F4EE",
          surface: "#FFFFFF",
          muted: "#EFEAE0",
          border: "#E0D8CB",
          text: "#1F1C18",
          subtext: "#5E574E",
        },
        charcoal: {
          bg: "#111113",
          surface: "#17171B",
          muted: "#202026",
          border: "#2B2B34",
          text: "#F5F3EF",
          subtext: "#9F9B94",
        },
        status: {
          winning: "#15803D",
          outbid: "#B91C1C",
          warning: "#B45309",
        },
      },
      fontFamily: {
        serif: ["'Cormorant Garamond'", "Georgia", "Cambria", "serif"],
        display: ["'Cinzel'", "'Cormorant Garamond'", "Georgia", "serif"],
        sans: ["'Inter'", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        frame: "0 10px 25px -4px rgba(31, 28, 24, 0.12), 0 4px 8px -2px rgba(31, 28, 24, 0.06)",
        card: "0 2px 8px -2px rgba(31, 28, 24, 0.05), 0 1px 3px 0 rgba(31, 28, 24, 0.04)",
      },
      borderRadius: {
        none: "0px",
        sm: "2px",
        DEFAULT: "3px",
        md: "4px",
      },
    },
  },
  plugins: [],
};
