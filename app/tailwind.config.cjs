const plugin = require('tailwindcss/plugin')

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Map-sheet palette: cool bond paper, green-black ink, one hue for the traverse.
        ground: 'rgb(var(--c-ground) / <alpha-value>)',
        panel: 'rgb(var(--c-panel) / <alpha-value>)',
        'panel-2': 'rgb(var(--c-panel-2) / <alpha-value>)',
        rule: 'rgb(var(--c-rule) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        'ink-2': 'rgb(var(--c-ink-2) / <alpha-value>)',
        'ink-3': 'rgb(var(--c-ink-3) / <alpha-value>)',
        rust: 'rgb(var(--c-rust) / <alpha-value>)',
        route: 'rgb(var(--c-route) / <alpha-value>)',
        safe: 'rgb(var(--c-safe) / <alpha-value>)',
        caution: 'rgb(var(--c-caution) / <alpha-value>)',
        danger: 'rgb(var(--c-danger) / <alpha-value>)',
        field: 'rgb(var(--c-field) / <alpha-value>)',
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
