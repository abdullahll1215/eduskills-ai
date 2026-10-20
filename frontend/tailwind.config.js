/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "IBM Plex Sans Arabic", "system-ui", "sans-serif"] },
      colors: {
        brand: {
          50: "#eef6f1", 100: "#d8eadd", 200: "#b6d6c3", 300: "#86bba3", 400: "#55a182",
          500: "#2c876b", 600: "#176b55", 700: "#135743", 800: "#144638", 900: "#143b31",
        },
        slate: {
          50: "#f7f8f4", 100: "#edf0e9", 200: "#dce2d8", 300: "#c4cec2", 400: "#829084",
          500: "#637368", 600: "#4e6055", 700: "#384d41", 800: "#263c30", 900: "#182c22",
        },
        canvas: "#f5f5ef",
      },
    },
  },
  plugins: [],
};
