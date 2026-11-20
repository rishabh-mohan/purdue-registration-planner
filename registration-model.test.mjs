import test from 'node:test';
import assert from 'node:assert/strict';
import { rankOptions, ics, pickSections, buildSchedules, sectionsOverlap } from './registration-model.mjs';

test('new course proposals preview all linked sections and flag overlaps', () => {
  const current = {course:'COM 21700',type:'Lec',id:'10001-A',days:'M',start:'2:00p',end:'2:50p',room:'BRNG',instructor:'A'};
  const lecture = {...current,course:'MA 26100',id:'10002-A',days:'T'};
  const lab = {...lecture,type:'Lab',id:'10003-A',days:'R'};
  const preferences = {course:lecture.course,type:lecture.type,instructor:'',earliest:810,order:['time']};
  const rank = changes => rankOptions({current:[current],groups:[{number:1,addCourse:'MA 26100',changes}]},
    preferences).find(option => option.number === 1);
  assert.deepEqual(rank([lecture,lab]).sections,[current,lecture,lab]);
  assert.equal(rank([lecture,lab]).canApply,true);
  assert.match(rank([{...lecture,days:'M'},lab]).warnings[0], /overlaps/);
});

test('ranks eligible options first and preserves warnings for other previews', () => {
  const lecture = {course:'CS 18200', type:'Lec', id:'11111-A', days:'MWF', start:'2:30p', end:'3:20p', instructor:'A', room:'BHEE 129'};
  const lab = {course:'CS 18200', type:'Pso', id:'11112-B', days:'T', start:'3:30p', end:'4:20p', instructor:'C', room:'HAAS 1'};
  const existing = {course:'COM 21700', type:'Lec', id:'22222-A', days:'MWF', start:'3:30p', end:'4:20p', instructor:'D', room:'BRNG 1232'};
  const state = {current:[lecture,lab,existing], groups:[
    {number:1, changes:[{...lecture,id:'11113-C',start:'12:30 p.m.',end:'1:20 p.m.',instructor:'B'}, {...lab,id:'11114-D',days:'R',instructor:'Different lab instructor'}]},
    {number:2, changes:[{...lecture,id:'11115-E',start:'3:30p',end:'4:20p',instructor:'B'}]},
    {number:3, unsafe:true, changes:[lecture]},
    {number:4, unsafe:true, changes:[], dropped:[existing]},
  ]};
  const preferences = {course:lecture.course, type:lecture.type, instructor:'B', earliest:810};
  const instructorFirst = rankOptions(state, {...preferences, order:['instructor','time']});
  assert.deepEqual(instructorFirst.map(option => option.number).slice(0,3), [2,1,0]);
  assert.equal(instructorFirst.length, 5);
  assert.equal(instructorFirst[1].sections[1].days, 'R');
  assert.equal(instructorFirst[1].scores.instructor, 0);
  assert.deepEqual(rankOptions(state, {...preferences, order:['time','instructor']}).map(option => option.number).slice(0,3), [2,0,1]);
  const overlap = instructorFirst.find(option => option.number === 2);
  assert.match(overlap.warnings[0], /CS 18200.*overlaps.*COM 21700/);
  assert.equal(overlap.canApply, true);
  const wrongInstructor = rankOptions(state, {...preferences, instructor:'A', order:['time','instructor']});
  assert.equal(wrongInstructor.find(option => option.number === 2).canApply, false);
  const tooEarly = rankOptions(state, {...preferences, earliest:960, order:['time','instructor']});
  assert.equal(tooEarly.find(option => option.number === 2).canApply, false);
  const drop = instructorFirst.find(option => option.number === 4);
  assert.match(drop.warnings[0], /Drops COM 21700/);
  assert.equal(drop.sections.includes(existing), false);
  assert.equal(drop.canApply, false);
});

test('ics emits a weekly floating-time event per timed section', () => {
  const out = ics([
    {id:'1', course:'CS 18200', type:'Lec', days:'MWF', start:'4:30p', end:'5:20p', room:'BHEE 129, West'},
    {id:'2', course:'EAPS 10600', type:'Online', days:'', start:'', end:'', async:true},
  ], {start:'2027-01-12', end:'2027-05-01'});
  assert.equal(out.split('BEGIN:VEVENT').length, 2);
  assert.ok(out.includes('DTSTART:20270113T163000\r\n')); // first Wed on/after Tue Jan 12
  assert.ok(out.includes('DTEND:20270113T172000\r\n'));
  assert.ok(out.includes('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20270501T235900\r\n'));
  assert.ok(out.includes('SUMMARY:CS 18200 Lec\r\n') && out.includes('LOCATION:BHEE 129\\, West\r\n'));
});

const sec = (id, course, type, days, start, end) => ({id, course, type, days, start, end, room:'A 1'});

test('pickSections chooses a non-overlapping pair for a two-type course', () => {
  const current = [sec('c', 'MA 16100', 'Lec', 'MWF', '9:30a', '10:20a')];
  const {picks, conflicts} = pickSections([
    [sec('1', 'CS 1', 'Lec', 'MWF', '9:30a', '10:20a'), sec('2', 'CS 1', 'Lec', 'MWF', '11:30a', '12:20p')],
    [sec('3', 'CS 1', 'Lab', 'T', '9:30a', '10:20a'), sec('4', 'CS 1', 'Lab', 'W', '11:30a', '12:20p')],
  ], current);
  assert.deepEqual(picks.map(pick => pick.id), ['2', '3']);
  assert.deepEqual(conflicts, []);
  assert.equal(sectionsOverlap(current[0], sec('x', 'X', 'Lec', 'MWF', '10:20a', '11:00a')), false);
});

test('buildSchedules returns conflict-free schedules quickly', () => {
  const course = (name, offset) => [[0, 1, 2, 3, 4, 5].map(i => sec(name + i, name, 'Lec', i % 2 ? 'MWF' : 'TR', (8 + (i + offset) % 8) + ':00a'.replace('a', i + offset > 3 ? 'p' : 'a'), (8 + (i + offset) % 8) + ':50' + (i + offset > 3 ? 'p' : 'a')))];
  const started = Date.now();
  const found = buildSchedules([course('A', 0), course('B', 1), course('C', 2), course('D', 3)], [],
    {earliest:0, order:['days', 'gaps', 'time', 'buildings', 'instructor']});
  assert.ok(Date.now() - started < 2000);
  assert.ok(found.length > 0 && found.length <= 3);
  for (const picks of found) for (const [i, a] of picks.entries()) for (const b of picks.slice(i + 1)) assert.equal(sectionsOverlap(a, b), false);
});
