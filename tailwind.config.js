/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}', './lib/**/*.{js,ts}'],
  // Badge builds its class name from the tone (badge-red ...), so Tailwind cannot see it in the source
  safelist: ['badge-red', 'badge-green', 'badge-amber', 'badge-gray', 'badge-blue'],
  theme: {
    extend: {
      colors: {
        sand: { DEFAULT: '#F7F6F3', 50: '#FAF9F7', 100: '#F2EFEB', 200: '#E5E0D6', 300: '#D2C9BB', 400: '#AFA392' },
        terra: { DEFAULT: '#C25E1A', 50: '#FDF6EE', 100: '#FAECD8', 200: '#F2D4AE', 500: '#C25E1A', 600: '#A74D12', 700: '#8B3D0D' },
        char: { DEFAULT: '#1E293B', 700: '#334155', 600: '#475569', 500: '#64748B', 400: '#94A3B8', 300: '#94A3B8' },
        bronze: { DEFAULT: '#A08368', 50: '#F9F6F2', 100: '#F2ECE5', 200: '#E3D7CB', 300: '#D1BFAD', 400: '#B89F88', 500: '#A08368', 600: '#8A6D53', 700: '#705740', 800: '#564230' },
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
