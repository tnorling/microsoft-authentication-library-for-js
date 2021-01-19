const fs = require("fs");
const path = require("path");

const APP_DIR = path.resolve(__dirname, "app");
const sampleFolders = fs.readdirSync(APP_DIR, { withFileTypes: true }).filter(function(file) {
  return file.isDirectory() && fs.existsSync(path.resolve(APP_DIR, file.name, "jest.config.js"));
}).map(function(file) {
  return `<rootDir>/app/${file.name}`;
});

module.exports = {
  projects : sampleFolders
};