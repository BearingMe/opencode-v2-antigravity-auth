export default {
  "*.{ts,tsx,js,mjs}": ["eslint --fix --quiet", "prettier --write"],
  "*.{json,md,yml,yaml}": ["prettier --write"],
}
