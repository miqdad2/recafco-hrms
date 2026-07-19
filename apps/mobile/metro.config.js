// Metro config for a pnpm workspace: pnpm keeps dependencies in a per-package
// node_modules that symlinks into the workspace root's virtual store, which Metro
// does not resolve correctly by default. This teaches Metro to watch the whole
// monorepo and look in both this package's and the workspace root's node_modules.
// See: https://docs.expo.dev/guides/monorepos/
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
// apps/web/.next and apps/api/dist are build output that other apps' dev servers
// rewrite continuously. Metro's FallbackWatcher (no Watchman on this machine) crashes
// the whole process with ENOENT when a directory it's mid-scanning gets deleted by
// another process's build step — reproduced live against apps/web/.next/export.
// Neither directory is source Metro needs to bundle, so excluding them is correct,
// not just a workaround for the crash.
config.resolver.blockList = [/apps[\\/]web[\\/]\.next[\\/].*/, /apps[\\/]api[\\/]dist[\\/].*/];
// Deliberately NOT setting disableHierarchicalLookup: true (the setting Expo's generic
// monorepo guide suggests). pnpm's per-package node_modules symlink into a nested
// `.pnpm` virtual store, so a package's own transitive dependencies (e.g.
// @expo/metro-runtime's own dependency on @expo/log-box) only resolve correctly via
// Metro's normal hierarchical walk-up. Disabling it broke exactly that case, reproduced
// live: `@expo/log-box` failed to resolve from inside @expo/metro-runtime until this
// was reverted.

module.exports = config;
