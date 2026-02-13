/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'void': '#0a0a0f',
        'surface': '#12121a',
        'elevated': '#1a1a24',
        'cyan': {
          500: '#00d4aa',
        },
        'amber': {
          500: '#ff9f1c',
        },
        'red': {
          500: '#ff3864',
        },
      },
    },
  },
  plugins: [],
}
