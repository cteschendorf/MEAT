const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

if (!config.resolver.assetExts.includes('sqlite')) {
  config.resolver.assetExts.push('sqlite');
}

module.exports = config;
