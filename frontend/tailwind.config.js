/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./styles/**/*.{css}"] ,
  theme: {
    extend: {
      fontFamily: {
        display: ["Lilita One", "sans-serif"],
        body: ["Varela Round", "sans-serif"],
      },
    },
  },
  plugins: [],
};
