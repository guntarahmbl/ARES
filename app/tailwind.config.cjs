/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: '#101312',
        panel: '#181b1a',
        'panel-2': '#202423',
        rule: '#343a38',
        ink: '#e9e8e3',
        'ink-2': '#b3b8b4',
        'ink-3': '#838a86',
        rust: '#e2784a',
        route: '#62c7e8',
        safe: '#6fbf9a',
        caution: '#e3b45f',
        danger: '#e5707a',
      },
      fontFamily: {
        sans: ['"Hanken Grotesk Variable"', 'system-ui', 'sans-serif'],
        num: ['"Martian Mono Variable"', 'ui-monospace', 'monospace'],
      },
      borderRadius: { DEFAULT: '3px', md: '3px', lg: '4px', xl: '4px' },
    },
  },
  plugins: [],
}
