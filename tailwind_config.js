/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Archivo Black', 'sans-serif'],
      },
      colors: {
        brand: {
          50:  '#f0f4ff',
          100: '#e0eaff',
          500: '#3b5bdb',
          600: '#2f4ac4',
          700: '#233aa0',
        },
        surface: '#0f1117',
        card:    '#1a1d27',
        border:  '#2a2d3e',
        muted:   '#6b7280',
      }
    },
  },
  plugins: [],
}
