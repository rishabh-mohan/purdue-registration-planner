import test from 'node:test';
import assert from 'node:assert/strict';
import {createSandbox} from './registration-sandbox.mjs';
import {rankOptions, evaluateSchedule} from './registration-model.mjs';

const preferences = {instructor:'', earliest:810, course:'CS 18200', type:'Lec', order:['time']};

test('sandbox swaps one component at a time, with warnings, local apply, undo, and reset', async () => {
  const sandbox = createSandbox();
  const original = await sandbox.request('READ');
  await sandbox.request('OPEN', {id:original.current[0].id});
  const opened = await sandbox.request('READ');
  const ranked = rankOptions(opened, preferences);
  assert.equal(ranked.find(item => item.number === 1).changes.length, 1);
  assert.match(ranked.find(item => item.number === 2).warnings.join(' '), /overlaps/);
  assert.match(ranked.find(item => item.number === 3).warnings.join(' '), /Drops COM 21700/);
  assert.ok((await sandbox.request('APPLY', {number:1, signature:'stale'})).error);
  assert.ok((await sandbox.request('APPLY', {number:3, signature:JSON.stringify(opened)})).error);
  assert.equal((await sandbox.request('APPLY', {number:1, signature:JSON.stringify(opened)})).ok, true);
  const applied = await sandbox.request('READ');
  assert.equal(applied.current[0].id, '91011-B');
  assert.equal(applied.current[1].id, '91002-A');
  assert.equal(sandbox.canUndo, true);
  await sandbox.request('UNDO');
  assert.deepEqual(await sandbox.request('READ'), original);
  assert.equal(sandbox.canUndo, false);
  await sandbox.request('OPEN', {id:original.current[0].id});
  await sandbox.request('APPLY', {number:1, signature:JSON.stringify(await sandbox.request('READ'))});
  await sandbox.request('RESET');
  assert.deepEqual(await sandbox.request('READ'), original);
  assert.equal(sandbox.canUndo, false);
});

test('a meeting nested inside another meeting does not create a false gap', () => {
  const sections = [['1:00p','4:00p'],['2:00p','3:00p'],['4:00p','5:00p']].map(([start,end],i) =>
    ({start,end,days:'M',course:'TEST '+i,type:'Lec',room:'Room',instructor:''}));
  assert.equal(evaluateSchedule(sections, preferences).gaps, 0);
});

test('sandbox removes every section of a course and undo restores it', async () => {
  const sandbox = createSandbox();
  const original = await sandbox.request('READ');
  assert.equal((await sandbox.request('REMOVE_COURSE', {course:'CS 18200'})).ok, true);
  const removed = await sandbox.request('READ');
  assert.ok(removed.current.length < original.current.length);
  assert.ok(!removed.current.some(section => section.course === 'CS 18200'));
  assert.ok((await sandbox.request('REMOVE_COURSE', {course:'CS 18200'})).error);
  await sandbox.request('UNDO');
  assert.deepEqual(await sandbox.request('READ'), original);
});

test('whole-course adds include every part but not online copies', async () => {
  const {byCourse} = await import('./registration-sandbox.mjs');
  const {pickSections} = await import('./registration-model.mjs');
  const s = (id, type, days, start, end, async = false) => ({id, course:'CS 18000', type, days, start, end, async});
  const group = byCourse([s('1','Laboratory','T','3:30p','5:20p'), s('2','Laboratory','R','3:30p','5:20p'),
    s('3','Lecture','MWF','9:30a','10:20a'), s('4','Distance Learning','','','',true)]).get('CS 18000');
  const {picks} = pickSections([...group.types.values()], []);
  assert.deepEqual(picks.map(pick => pick.type).sort(), ['Laboratory','Lecture']);
});
