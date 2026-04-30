/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        gpw: {
          green: '#2ea44f',
          red:   '#d73a4a',
          blue:  '#0075ca',
          dark:  '#0d1117',
          card:  '#161b22',
          border:'#30363d',
        },
      },
    },
  },
  plugins: [],
}
