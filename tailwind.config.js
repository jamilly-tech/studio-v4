/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        muted: "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        secondary: "hsl(var(--secondary))",
        destructive: "hsl(var(--destructive))",
        primary: "hsl(var(--primary))",
        "primary-foreground": "hsl(var(--primary-foreground))",
        "brand-soft": "hsl(var(--brand-soft))",
      },
      boxShadow: {
        glow: "0 0 0 1px rgb(229 9 20 / 0.35), 0 22px 80px rgb(0 0 0 / 0.4)",
      },
    },
  },
  plugins: [],
};
