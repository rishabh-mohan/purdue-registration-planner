// Builds firefox/ and zips it into dist/*.xpi. Run: node package.mjs
// shortcut: uses Windows' bundled bsdtar (System32\tar.exe) to write zips; on macOS/Linux use `zip -r` instead.
import {execFileSync} from 'node:child_process';
import {mkdirSync, readdirSync, readFileSync, rmSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(process.execPath, [join(root, 'build-firefox.mjs')], {stdio:'inherit'});
mkdirSync(join(root, 'dist'), {recursive:true});

const files = dir => readdirSync(dir, {recursive:true}).map(String)
  .filter(file => statSync(join(dir, file)).isFile() && !file.endsWith('.test.mjs'))
  .map(file => file.replaceAll('\\', '/'));

for (const [dir, name] of [['firefox', 'purdue-registration-planner']]) {
  const source = join(root, dir);
  const {version} = JSON.parse(readFileSync(join(source, 'manifest.json'), 'utf8'));
  const out = join(root, 'dist', `${name}-${version}.xpi`);
  rmSync(out, {force:true});
  // entries are listed explicitly so the manifest sits at the zip root with forward-slash paths
  execFileSync(tar, ['--format', 'zip', '-c', '-f', out, '-C', source, ...files(source)]);
  // .xpi isn't a suffix tar recognises, so check it really wrote a zip
  if (readFileSync(out).subarray(0, 2).toString() !== 'PK') throw Error(out + ' is not a zip file');
  console.log(relative(root, out), (statSync(out).size / 1024).toFixed(0) + ' KB');
}
