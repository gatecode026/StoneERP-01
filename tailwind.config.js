/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}', './lib/**/*.{js,ts}'],
  // Badge builds its class name from the tone (badge-red ...), so Tailwind cannot see it in the source
  safelist: ['badge-red', 'badge-green', 'badge-amber', 'badge-gray', 'badge-blue'],
  theme: {
    extend: {
      colors: {
        sand: {
          DEFAULT: '#FAF7F2',
          50: '#FAF8F5',
          100: '#F5ECE3',
          200: '#E8DFCF',
          300: '#D4C2AB',
          400: '#B8A58D',
          500: '#8A5C38',
        },
        terra: {
          DEFAULT: '#8A5C38',
          50: '#FAF7F2',
          100: '#F5ECE3',
          200: '#E8D8C8',
          300: '#D4C2AB',
          400: '#B08B67',
          500: '#8A5C38',
          600: '#7A4F2E',
          700: '#684124',
          800: '#54331A',
          900: '#3D2411',
          950: '#281609',
        },
        char: {
          DEFAULT: '#2B2B2B',
          700: '#334155',
          600: '#475569',
          500: '#64748B',
          400: '#94A3B8',
          300: '#94A3B8',
        },
        bronze: {
          DEFAULT: '#8A5C38',
          50: '#FAF7F2',
          100: '#F5ECE3',
          200: '#E8D8C8',
          300: '#D4C2AB',
          400: '#B08B67',
          500: '#8A5C38',
          600: '#7A4F2E',
          700: '#684124',
          800: '#54331A',
        },
      },
      fontFamily: { sans: ['var(--font-sans)', 'system-ui', 'Segoe UI', 'Noto Sans Devanagari', 'Roboto', 'sans-serif'] },
      boxShadow: {
        '2xs': '0 1px 2px 0 rgba(0, 0, 0, 0.03)',
        'xs': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
      },
    },
  },
  plugins: [],
};
