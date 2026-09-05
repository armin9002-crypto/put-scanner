import defaultTheme from 'tailwindcss/defaultTheme.js';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    // Font utilities scale independently from Tailwind's rem-based geometry.
    fontSize: Object.fromEntries(Object.entries(defaultTheme.fontSize).map(([name, [size, options]]) => [
      name,
      [`calc(${size} * var(--ui-text-scale, 1))`, {
        ...options,
        lineHeight: options.lineHeight === '1' ? '1' : `calc(${options.lineHeight} * var(--ui-text-scale, 1))`,
      }],
    ])),
    extend: {
      fontFamily: {
        sans: ["'Arial Narrow'", "'Barlow Condensed'", 'sans-serif'],
      },
    },
  },
  plugins: [],
};
