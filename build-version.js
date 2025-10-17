import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

// Read package.json for version
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

// Get current git branch
const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim();

// Append branch name if not on main
const version = branch === 'main' ? pkg.version : `${pkg.version}-${branch}`;

// Write version.js
writeFileSync('public/version.js', `window.APP_VERSION="${version}";`);

console.log(`Built version: ${version}`);
