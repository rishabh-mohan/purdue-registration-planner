import assert from 'node:assert/strict';
import test from 'node:test';
import { findConflicts, formatTime, mergeCourses, normalizeCode, toMinutes } from './planner.js';

test('normalizes Purdue course codes and validates 24-hour times', () => {
  assert.equal(normalizeCode(' cs18000 '), 'CS 18000');
  assert.equal(normalizeCode('ece  2k1'), 'ECE 2K1');
  assert.equal(toMinutes('09:30'), 570);
  assert.equal(toMinutes('00:00'), 0);
  assert.equal(toMinutes('24:00'), null);
  assert.equal(toMinutes('10:60'), null);
  assert.equal(formatTime(0), '12:00 AM');
  assert.equal(formatTime(780), '1:00 PM');
});

test('retains saved meetings across live refreshes and course removal', () => {
  const meetings = [{ days: ['Mon'], start: '09:00', end: '09:50' }];
  const saved = [
    { code: 'cs18000', title: 'Saved title', source: 'unitime', meetings },
    { code: 'MA 26100', source: 'manual', meetings: [] },
  ];
  const live = [
    { code: 'CS 18000', title: 'Problem Solving and Object-Oriented Programming', group: 'primary' },
    { code: 'CS 18000', group: 'alternate' },
    { code: 'STAT 35000', group: 'alternate' },
  ];
  const merged = mergeCourses(saved, live, true);
  assert.deepEqual(merged.map(course => [course.code, course.live]), [
    ['CS 18000', true], ['STAT 35000', true], ['MA 26100', false],
  ]);
  assert.deepEqual(merged[0].meetings, meetings);
  assert.equal(merged[0].group, 'primary');
  assert.deepEqual(mergeCourses(saved, [], true).map(course => course.code), ['MA 26100']);
  assert.deepEqual(mergeCourses(saved, [], false)[0].meetings, meetings);
});

test('reports partial and nested overlaps without flagging adjacent meetings', () => {
  const course = (code, days, start, end) => ({ code, meetings: [{ days, start, end }] });
  const first = course('CS 18000', ['Mon', 'Wed'], '09:00', '10:30');
  const second = course('MA 26100', ['Mon', 'Fri'], '09:30', '10:00');
  const third = course('STAT 35000', ['Mon'], '10:00', '11:00');
  const fourth = course('PHYS 17200', ['Wed'], '10:30', '11:30');
  assert.deepEqual(findConflicts([first, second, third, fourth]), [
    { day: 'Mon', start: 570, end: 600, first, second },
    { day: 'Mon', start: 600, end: 630, first, second: third },
  ]);
});
