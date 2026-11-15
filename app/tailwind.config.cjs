const plugin = require('tailwindcss/plugin')

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Map-sheet palette: cool bond paper, green-black ink, one hue for the traverse.
        ground: '#E2E5DF',
        panel: '#F4F5F1',
        'panel-2': '#E6E9E3',
        rule: '#C2C8C0',
        ink: '#141C1A',
        'ink-2': '#3E4945',
        'ink-3': '#66716C',
        rust: '#B8431B',
        route: '#0B6E8A',
        safe: '#1B7A4B',
        caution: '#96590A',
        danger: '#B4232C',
      },
      fontFamily: {
        sans: ['"Archivo Variable"', 'system-ui', 'sans-serif'],
        num: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { DEFAULT: '2px', sm: '1px', md: '2px', lg: '2px', xl: '2px' },
    },
  },
  plugins: [
    // The route strip lays out by its own width: panels dock and undock on either side of it.
    plugin(({ addVariant }) => addVariant('wide', '@container (min-width: 1000px)')),
  ],
}
