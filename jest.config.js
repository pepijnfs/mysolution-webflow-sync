export default {
  testEnvironment: "node",
  verbose: true,
  transform: {},
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  testMatch: [
    "**/test/**/*.test.js"
  ]
}; 