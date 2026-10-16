import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

export default {
  // Light theme only for v1: "class" means dark: styles apply only if a .dark class is ever added.
  darkMode: ["class"],
    content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-league-spartan)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        brand: {
          bg: "hsl(var(--brand-bg) / <alpha-value>)",
          primary: "hsl(var(--brand-primary) / <alpha-value>)",
          "primary-deep": "hsl(var(--brand-primary-deep) / <alpha-value>)",
          accent: "hsl(var(--brand-accent) / <alpha-value>)",
          muted: "hsl(var(--brand-muted) / <alpha-value>)",
          panel: "hsl(var(--brand-panel) / <alpha-value>)",
          surface: "hsl(var(--brand-surface) / <alpha-value>)",
        },
        danger: "hsl(var(--danger) / <alpha-value>)",
        canvas: "hsl(var(--canvas) / <alpha-value>)",
        line: "hsl(var(--line) / <alpha-value>)",
        subtle: "hsl(var(--subtle) / <alpha-value>)",
        ink: {
          DEFAULT: "hsl(var(--ink) / <alpha-value>)",
          muted: "hsl(var(--ink-muted) / <alpha-value>)",
        },
        success: "hsl(var(--success) / <alpha-value>)",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
