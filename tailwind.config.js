/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background:           "hsl(var(--background))",
        foreground:           "hsl(var(--foreground))",
        card:                 "hsl(var(--card))",
        "card-foreground":    "hsl(var(--card-foreground))",
        muted:                "hsl(var(--muted))",
        "muted-foreground":   "hsl(var(--muted-foreground))",
        secondary:            "hsl(var(--secondary))",
        border:               "hsl(var(--border))",
        primary:              "hsl(var(--primary))",
        "primary-foreground": "hsl(var(--primary-foreground))",
        "brand-soft":         "hsl(var(--brand-soft))",
        destructive:          "hsl(var(--destructive))",
        "destructive-foreground": "hsl(var(--destructive-foreground))",
      },
      boxShadow: {
        glow: "0 0 0 1px hsl(var(--primary) / 0.35), 0 22px 80px rgb(0 0 0 / 0.4)",
      },
    },
  },
  plugins: [],
};
