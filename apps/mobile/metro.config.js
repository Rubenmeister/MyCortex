// Metro config para el monorepo. Con pnpm en modo aislado (symlinks), Metro
// necesita saber dónde buscar deps: el node_modules de la app y el del root.
// (En EAS, apps/mobile se compila standalone con npm y usa su propio
// node_modules plano; esta config es para el dev local contra el monorepo.)
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Evita que Metro suba la jerarquía y agarre copias erróneas por los symlinks.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
