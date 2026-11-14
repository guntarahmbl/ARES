/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0b0d10', surface: '#15181c', 'surface-raised': '#1c2025', border: '#30353b',
        muted: '#9aa2aa', mars: '#e18a55', route: '#62c7e8', safe: '#57c998', caution: '#e9bd67', danger: '#ef6a78',
      },
    },
  },
  plugins: [],
}
