import test from 'node:test';
import assert from 'node:assert/strict';
import {days, times, meeting} from './scrape-courses.mjs';
import {minutes} from './registration-model.mjs';

test('converts Purdue.io meetings to planner sections', () => {
  assert.equal(days('Monday, Wednesday, Friday'), 'MWF');
  assert.equal(days('Tuesday, Thursday'), 'TR');
  assert.deepEqual(times('16:30:00.0000000', 'PT50M'), ['4:30p', '5:20p']);
  assert.deepEqual(times('11:30:00.0000000', 'PT1H15M'), ['11:30a', '12:45p']);
  assert.deepEqual(times('00:00:00.0000000', 'PT0S').length, 2);
  assert.deepEqual(times(null, null), ['', '']);
  const m = meeting({Type: 'Lecture', DaysOfWeek: 'Tuesday', StartTime: '13:30:00', Duration: 'PT50M',
    Instructors: [{Name: 'A'}, {Name: 'B'}], Room: {Number: '247', Building: {ShortCode: 'SL'}}});
  assert.deepEqual(m, {type: 'Lecture', days: 'T', start: '1:30p', end: '2:20p', room: 'SL 247', instructor: 'A, B'});
  assert.equal(minutes(m.end) - minutes(m.start), 50);
});
