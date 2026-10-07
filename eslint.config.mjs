import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "artifacts/**",
      ".venv/**",
      "drizzle/**",
      "next-env.d.ts",
    ],
  },
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];

export default config;
