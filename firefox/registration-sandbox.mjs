const section = (id, course, type, days, start, end, room, instructor, openSeats) =>
  ({id, course, type, days, start, end, room, instructor, openSeats});

const lecture = section('91001-A', 'CS 18200', 'Lec', 'MWF', '2:30p', '3:20p', 'BHEE 129', 'A. Patel', 3);
const lab = section('91002-A', 'CS 18200', 'Pso', 'R', '4:30p', '5:20p', 'HAAS 111', 'T. Reed', 5);
const communication = section('91003-A', 'COM 21700', 'Lec', 'MWF', '3:30p', '4:20p', 'BRNG 1232', 'J. Chen', 8);
const online = {...section('91004-A', 'EAPS 10600', 'Online', '', '', '', 'Async online', 'S. Park', 12), async:true};
const initial = [lecture, lab, communication, online];
const catalog = [
  section('92001-A', 'MA 26100', 'Lec', 'MWF', '3:30p', '4:20p', 'MATH 175', 'M. Rivera', 8),
  section('92002-B', 'MA 26100', 'Lec', 'MWF', '1:30p', '2:20p', 'MATH 175', 'K. Lee', 4),
  section('92003-A', 'PHIL 11000', 'Lec', 'TR', '1:30p', '2:45p', 'BRNG 1232', 'P. Davis', 12),
];
const courses = {
  'CS 18200|Lec': [
    {...lecture, id:'91011-B', start:'1:30p', end:'2:20p', openSeats:6},
    {...lecture, id:'91012-C', start:'3:30p', end:'4:20p', openSeats:2},
  ],
  'CS 18200|Pso': [{...lab, id:'91013-B', days:'T', start:'2:30p', end:'3:20p', openSeats:4}],
  'COM 21700|Lec': [{...communication, id:'91014-B', days:'TR', start:'2:30p', end:'3:45p', openSeats:9}],
  'EAPS 10600|Online': [{...online, id:'91015-B', instructor:'R. Diaz', openSeats:1}],
};
// Real Spring 2027 sections, loaded once; the hard-coded catalog is the fallback when the fetch fails.
let pool;
const loadPool = () => pool ||= fetch(new URL('course-pack/courses.json', import.meta.url))
  .then(response => response.ok ? response.json() : Promise.reject(Error(response.status)))
  .then(data => ({fallback:false, sections:data.courses.flatMap(({course, title, credits, sections}) =>
    sections.map(item => ({...item, course, title, credits, room:item.room || '', openSeats:null})))}))
  .then(pool => ({...pool, courses:byCourse(pool.sections)}))
  .catch(() => ({fallback:true, sections:catalog, courses:byCourse(catalog)}));
export const byCourse = sections => {
  const courses = new Map();
  for (const item of sections) {
    if (!courses.has(item.course)) courses.set(item.course, {course:item.course, title:item.title, credits:item.credits, all:[], types:new Map()});
    const group = courses.get(item.course);
    group.all.push(item);
    group.types.set(item.type, [...group.types.get(item.type) || [], item]);
  }
  // Purdue.io lists online copies as a "Distance Learning" type; it is an alternative delivery, not a required part
  for (const group of courses.values()) if (group.types.size > 1) group.types.delete('Distance Learning');
  return courses;
};
const key = item => item.course + '|' + item.type;

import {buildSchedules, pickSections} from './registration-model.mjs';

export function createSandbox() {
  let current = initial;
  let groups = [];
  const history = [];
  const snapshot = () => ({issue:null, current, groups});

  return {
    get canUndo() { return history.length > 0; },
    async request(type, args = {}) {
      if (type === 'READ') return structuredClone(snapshot());
      if (type === 'CATALOG') {
        const query = (args.query || '').trim().toLowerCase();
        const {fallback, courses: pooled} = await loadPool();
        if (!args.codes && query.length < 2) return {results:[], fallback};
        const results = [];
        for (const group of pooled.values()) {
          if (current.some(existing => existing.course === group.course)) continue;
          const text = [group.course, group.title, ...group.all.flatMap(item => [item.instructor, item.id])].join(' ').toLowerCase();
          if (args.codes ? !args.codes.includes(group.course) : !text.includes(query)) continue;
          results.push({course:group.course, title:group.title, credits:group.credits, sections:group.all.length, types:[...group.types.keys()]});
          if (results.length >= 50) break;
        }
        return {results, fallback};
      }
      if (type === 'ADD_COURSE') {
        const group = (await loadPool()).courses.get(args.course);
        if (!group || current.some(item => item.course === group.course)) {
          return {error:'That class is already scheduled or unavailable.'};
        }
        const {picks, conflicts} = pickSections([...group.types.values()], current);
        history.push(current);
        current = [...current, ...structuredClone(picks)];
        groups = [];
        return {ok:true, warnings:conflicts};
      }
      if (type === 'REMOVE_COURSE') {
        if (!current.some(item => item.course === args.course)) return {error:'That class is not in the sandbox schedule.'};
        history.push(current);
        current = current.filter(item => item.course !== args.course);
        groups = [];
        return {ok:true};
      }
      if (type === 'PICK_COURSE') {
        const group = (await loadPool()).courses.get(args.course);
        return group ? structuredClone(pickSections([...group.types.values()], current)) : {error:'That class is unavailable.'};
      }
      if (type === 'BUILD') {
        const pooled = (await loadPool()).courses;
        const added = [], notes = [];
        for (const code of args.codes) {
          if (pooled.has(code) && !current.some(item => item.course === code) && !added.includes(code)) added.push(code);
          else notes.push(code + ' skipped.');
        }
        if (!added.length) return {error:'None of those courses can be added.'};
        const found = buildSchedules(added.map(code => [...pooled.get(code).types.values()]), current, args.prefs);
        if (!found.length) return {error:'No conflict-free schedule found for those courses.'};
        groups = found.map((picks, index) => ({number:index + 1, changes:structuredClone(picks), dropped:[], notes:[], unsafe:false, addCourse:added}));
        return {ok:true, notes};
      }
      if (type === 'RESET' || type === 'UNDO') {
        current = type === 'RESET' ? initial : history.pop() || current;
        if (type === 'RESET') history.length = 0;
        groups = [];
        return {ok:true};
      }
      if (type === 'OPEN') {
        const target = current.find(item => item.id === args.id);
        if (!target) return {error:'Select a class in the sandbox schedule first.'};
        // alternatives swap only this component (lecture OR lab OR recitation); the rest of the course stays put
        const real = (await loadPool()).courses.get(target.course)?.types.get(target.type) || [];
        const options = [initial.find(item => key(item) === key(target)), ...(courses[key(target)] || []), ...real]
          .filter((item, index, all) => item && item.id !== target.id && all.findIndex(other => other?.id === item.id) === index);
        groups = options.map((item, index) => ({number:index + 1, changes:[structuredClone(item)], dropped:[], notes:[], unsafe:false}));
        if (target.id === lecture.id) {
          groups.push({number:groups.length + 1, changes:[courses[key(lecture)][1]],
            dropped:[current.find(item => key(item) === key(communication))], notes:[], unsafe:true});
        }
        return {ok:true};
      }
      if (type === 'CLOSE') {
        groups = [];
        return {ok:true};
      }
      if (type === 'INCLUDE_CONFLICTS') return {changed:false};
      if (type === 'APPLY') {
        const group = groups.find(item => item.number === args.number);
        if (!group || group.unsafe || args.signature !== JSON.stringify(snapshot())) {
          return {error:'The sandbox options changed. Load alternatives again.'};
        }
        history.push(current);
        current = group.addCourse ? [...current, ...group.changes] :
          current.map(item => group.changes.find(change => key(change) === key(item)) || item);
        groups = [];
        return {ok:true};
      }
      return {error:'Unknown sandbox action.'};
    },
  };
}
