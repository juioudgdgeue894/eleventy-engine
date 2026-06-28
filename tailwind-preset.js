const flowbite = require("flowbite/plugin");

// Shared Tailwind preset. A consuming site's tailwind.config.js is just:
//   module.exports = { presets: [require("@jacklamond/eleventy-engine/tailwind-preset")] };
module.exports = {
  // Scan every template Eleventy will render, plus Flowbite's own JS
  // (it injects classes at runtime that Tailwind needs to know about).
  content: [
    "./src/**/*.{njk,html,md,js}",
    "./node_modules/flowbite/**/*.js",
  ],
  theme: {
    extend: {},
  },
  plugins: [flowbite],
};
