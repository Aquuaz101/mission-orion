/**
 * Publish the playable website to GitHub Pages:  npm run deploy
 *
 * Builds the game for https://<user>.github.io/<repo>/ with the internet phone link (PeerJS),
 * then force-pushes the built files to the `gh-pages` branch, which GitHub Pages serves.
 * Your source code on `main` is not touched.
 */
import { execSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'dist-pages');
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
const read = (cmd) => execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();

const remote = read('git remote get-url origin'); // e.g. https://github.com/Aquuaz101/mission-orion.git
const repo = remote.replace(/\.git$/, '').split('/').pop();
const base = `/${repo}/`;

console.log(`\nBuilding the website for ${base} …\n`);
rmSync(OUT, { recursive: true, force: true });
run('npx tsc --noEmit');
run(`npx vite build --base ${base} --outDir dist-pages --emptyOutDir`, { env: { ...process.env, VITE_LINK: 'peer' } });
writeFileSync(path.join(OUT, '.nojekyll'), ''); // serve files as-is

console.log('\nUploading to the gh-pages branch …\n');
const name = read('git config user.name');
const email = read('git config user.email');
const git = (args) => run(`git -c user.name="${name}" -c user.email="${email}" ${args}`, { cwd: OUT });
git('init -q -b gh-pages');
git('add -A');
git(`commit -q -m "Publish website"`);
git(`push -f "${remote}" gh-pages`);
rmSync(path.join(OUT, '.git'), { recursive: true, force: true });

const owner = remote.replace(/\.git$/, '').split('/').slice(-2)[0].toLowerCase();
console.log(`\nDone. The game will be live in about a minute at: https://${owner}.github.io${base}\n`);
