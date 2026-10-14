/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}', './lib/**/*.{js,ts}'],
  theme: {
    extend: {
      colors: {
        sand: { DEFAULT: '#F5EFE6', 50: '#FBF8F3', 100: '#F5EFE6', 200: '#EADFCF', 300: '#D9C8AF', 400: '#BFA67F' },
        terra: { DEFAULT: '#B5651D', 50: '#FBF1E6', 100: '#F4DCC1', 500: '#B5651D', 600: '#9A5416', 700: '#7F4412' },
        char: { DEFAULT: '#2B2B2B', 700: '#3F3F3F', 500: '#6B6B6B', 300: '#A8A8A8' },
        bronze: { DEFAULT: '#A08368', 50: '#F9F6F2', 100: '#F2ECE5', 200: '#E3D7CB', 300: '#D1BFAD', 400: '#B89F88', 500: '#A08368', 600: '#8A6D53', 700: '#705740', 800: '#564230' },
      },
      fontFamily: { sans: ['system-ui', 'Segoe UI', 'Noto Sans Devanagari', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
