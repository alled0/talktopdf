/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: '#0e0f11',
        surface: '#16181c',
        amber: {
          custom: '#c8a96e',
        },
        teal: {
          custom: '#5dbaa0',
        }
      },
      fontFamily: {
        mono: ['"DM Mono"', 'monospace'],
        serif: ['Lora', 'serif'],
      }
    },
  },
  plugins: [],
}
