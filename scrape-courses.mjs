// Scrapes Purdue's public course data from Purdue.io (a mirror of the public catalog and class schedule).
// UniTime itself publishes no terms to signed-out users, so it cannot be scraped anonymously.
// Usage: node scrape-courses.mjs [termCode]   (default: latest term with classes)
import {mkdir, writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const API = 'https://api.purdue.io/odata/';
const DAY = {Monday:'M', Tuesday:'T', Wednesday:'W', Thursday:'R', Friday:'F', Saturday:'S', Sunday:'U'};

export const days = text => (text || '').split(/,\s*/).map(day => DAY[day] || '').join('');

// "16:30:00.0000000" + "PT1H15M" → ['4:30p', '5:45p'], the planner's time format
export function times(start, duration) {
  const match = /^(\d\d):(\d\d)/.exec(start || '');
  if (!match) return ['', ''];
  const [, h = 0, m = 0] = /PT(?:(\d+)H)?(?:(\d+)M)?/.exec(duration || '') || [];
  const from = +match[1] * 60 + +match[2];
  const label = total => `${(Math.floor(total / 60) % 12) || 12}:${String(total % 60).padStart(2, '0')}${total % 1440 < 720 ? 'a' : 'p'}`;
  return [label(from), label(from + (+h) * 60 + (+m))];
}

export function meeting(m) {
  const [start, end] = times(m.StartTime, m.Duration);
  return {type: m.Type, days: days(m.DaysOfWeek), start, end,
    room: m.Room ? [m.Room.Building?.ShortCode, m.Room.Number].filter(part => part && part !== 'TBA').join(' ') : '',
    instructor: (m.Instructors || []).map(i => i.Name).join(', ')};
}

async function get(path, attempt = 0) {
  const res = await fetch(API + path);
  if (res.ok) return res.json();
  if (attempt < 4) {
    await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
    return get(path, attempt + 1);
  }
  throw Error(`${res.status} ${await res.text()} for ${path}`);
}

async function main() {
  const terms = (await get('Terms')).value.filter(t => /^\d{6}$/.test(t.Code) && t.Code !== '999999')
    .sort((a, b) => b.Code.localeCompare(a.Code));
  const term = terms.find(t => t.Code === (process.argv[2] || terms[0].Code));
  if (!term) throw Error('Unknown term. Known: ' + terms.map(t => t.Code + ' ' + t.Name).join(', '));
  const subjects = (await get('Subjects?$select=Abbreviation,Name')).value.sort((a, b) => a.Abbreviation.localeCompare(b.Abbreviation));
  const catalog = [];
  const sections = [];
  for (const [index, subject] of subjects.entries()) {
    const abbr = subject.Abbreviation.replace(/'/g, "''");
    const courses = (await get(`Courses?$filter=Subject/Abbreviation eq '${abbr}'&$select=Number,Title,CreditHours,Description` +
      `&$expand=Classes($filter=Term/Code eq '${term.Code}';$expand=Campus($select=Name),` +
      `Sections($expand=Meetings($expand=Instructors($select=Name),Room($expand=Building($select=ShortCode)))))`)).value;
    for (const course of courses) {
      const code = subject.Abbreviation + ' ' + course.Number;
      catalog.push({course: code, subject: subject.Name, title: course.Title, credits: course.CreditHours,
        description: course.Description || '', offered: course.Classes.length > 0});
      for (const cls of course.Classes) for (const section of cls.Sections) {
        const meetings = section.Meetings.map(meeting);
        const first = meetings[0] || {days: '', start: '', end: '', room: '', instructor: ''};
        sections.push({id: section.Crn, course: code, title: course.Title, credits: course.CreditHours, type: section.Type,
          campus: cls.Campus?.Name || '', days: first.days, start: first.start, end: first.end, room: first.room,
          instructor: [...new Set(meetings.flatMap(m => m.instructor ? m.instructor.split(', ') : []))].join(', '),
          async: meetings.every(m => !m.start), openSeats: null, startDate: section.StartDate, endDate: section.EndDate, meetings});
      }
    }
    process.stdout.write(`\r${index + 1}/${subjects.length} ${subject.Abbreviation.padEnd(6)} courses ${catalog.length} sections ${sections.length}   `);
  }
  // Purdue.io keeps a record per title variant (special-topics courses have hundreds); one entry per code,
  // preferring the record offered this term, with the other titles listed
  const byCode = new Map();
  for (const item of catalog) {
    const entry = byCode.get(item.course);
    if (!entry) byCode.set(item.course, {...item, otherTitles: []});
    else if (item.offered && !entry.offered) byCode.set(item.course, {...item,
      otherTitles: [...new Set([entry.title, ...entry.otherTitles])].filter(title => title !== item.title)});
    else if (item.title !== entry.title && !entry.otherTitles.includes(item.title)) entry.otherTitles.push(item.title);
  }
  const unique = [...byCode.values()].sort((a, b) => a.course.localeCompare(b.course, 'en', {numeric: true}));
  const out = new URL('./data/', import.meta.url);
  await mkdir(out, {recursive: true});
  const scraped = new Date().toISOString();
  await writeFile(new URL('purdue-catalog.json', out), JSON.stringify({source: 'api.purdue.io', scraped, courses: unique}, null, 1));
  await writeFile(new URL(`purdue-sections-${term.Code}.json`, out),
    JSON.stringify({source: 'api.purdue.io', scraped, term: term.Name, code: term.Code, sections}, null, 1));
  // compact deck shared by the course pack and the planner sandbox: up to four sections of EVERY type per course
  // (timed first), so lecture + lab + recitation courses keep all their parts
  const deck = new Map();
  for (const s of [...sections].sort((a, b) => Number(a.async) - Number(b.async))) {
    const entry = deck.get(s.course) ?? deck.set(s.course, {course: s.course, title: s.title, credits: s.credits,
      subject: byCode.get(s.course)?.subject || '', sections: []}).get(s.course);
    if (entry.sections.filter(item => item.type === s.type).length < 4) entry.sections.push({id: s.id, type: s.type,
      days: s.days, start: s.start, end: s.end, room: s.room, instructor: s.instructor, async: s.async});
  }
  await writeFile(new URL('./course-pack/courses.json', import.meta.url),
    JSON.stringify({term: term.Name, courses: [...deck.values()]}));
  console.log(`\n${unique.length} catalog courses (${unique.filter(c => c.offered).length} offered in ${term.Name}), ${sections.length} sections.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
