import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class", // ← THIS LINE IS CRITICAL
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
