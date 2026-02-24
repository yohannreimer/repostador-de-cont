import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Manrope", "system-ui", "sans-serif"]
      },
      colors: {
        brand: {
          50: "#f3f7ff",
          500: "#2b6ef2",
          700: "#1f4ea8"
        }
      }
    }
  },
  plugins: []
};

export default config;
