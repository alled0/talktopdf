/** @type {import('tailwindcss').Config} */

// Colors are defined as RGB channels in src/index.css so opacity modifiers work (e.g. bg-accent/10).
const token = name => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        raised: token('raised'),
        elevated: token('elevated'),
        line: token('line'),
        'line-strong': token('line-strong'),
        ink: token('ink'),
        muted: token('muted'),
        subtle: token('subtle'),
        faint: token('faint'),
        accent: token('accent'),
        mint: token('mint'),
        violet: token('violet'),
        danger: token('danger'),
      },
      fontFamily: {
        mono: ['"DM Mono"', 'monospace'],
        serif: ['Lora', 'serif'],
      }
    },
  },
  plugins: [],
}
