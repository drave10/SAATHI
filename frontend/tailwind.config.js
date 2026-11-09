/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', 'system-ui', 'sans-serif'] },
      colors: {
        navy: { 50: '#eef2f8', 100: '#d9e2ef', 200: '#b3c5de', 300: '#7f9bc4', 400: '#4d6fa3', 500: '#2d4f84', 600: '#1c3a68', 700: '#142c52', 800: '#0e2142', 900: '#0a1a35' },
        teal: { 50: '#eefaf8', 100: '#d3f2ee', 200: '#a8e5dd', 300: '#74d1c7', 400: '#43b8ac', 500: '#259d93', 600: '#1b7f78', 700: '#19665f', 800: '#18514d', 900: '#164440' },
      },
      boxShadow: { card: '0 1px 2px rgba(10,26,53,0.05), 0 1px 3px rgba(10,26,53,0.06)' },
    },
  },
  plugins: [],
}
