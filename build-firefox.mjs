import {copyFile, mkdir, writeFile} from 'node:fs/promises';

const output = new URL('./firefox/', import.meta.url);
const host = 'https://timetable.mypurdue.purdue.edu/*';
const manifest = {
  manifest_version: 3,
  name: 'Purdue Registration Planner',
  version: '1.0.0',
  description: 'Compare Scheduling Assistant alternatives in a separate Firefox tab.',
  browser_specific_settings: {
    gecko: {id:'purdue-registration-planner@local', strict_min_version:'127.0',
      data_collection_permissions:{required:['none']}},
  },
  host_permissions: [host],
  background: {scripts:['registration-background.js']},
  content_scripts: [{matches:[host], js:['registration-bridge.js'], run_at:'document_idle'}],
};

await mkdir(output, {recursive:true});
const files = ['registration-background.js', 'registration-bridge.js', 'registration-model.mjs', 'registration-sandbox.mjs',
  'registration.html', 'registration.css', 'registration.js'];
await Promise.all(files.map(file => copyFile(new URL(file, import.meta.url), new URL(file, output))));
await mkdir(new URL('course-pack/', output), {recursive:true});
await copyFile(new URL('course-pack/courses.json', import.meta.url), new URL('course-pack/courses.json', output));
await writeFile(new URL('manifest.json', output), JSON.stringify(manifest, null, 2) + '\n');
