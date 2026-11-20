const DAY_CODES = 'MTWRFSU';
export function instructorNames(value) {
  return (value || '').split(/[,;\n]+/).map(name => name.trim()).filter(Boolean);
}
export function minutes(value) {
  const match = /^(\d{1,2}):(\d\d)\s*([ap])(?:\.?m\.?)?$/i.exec(value?.trim());
  if (!match || +match[1] < 1 || +match[1] > 12 || +match[2] > 59) return null;
  return (+match[1] % 12) * 60 + +match[2] + (match[3].toLowerCase() === 'p' ? 720 : 0);
}

export function evaluateSchedule(sections, preferences, warnings = [], unreadable = []) {
  const instructor = preferences.instructor.toLowerCase().trim();
  const focus = sections.find(section => section.course === preferences.course && section.type === preferences.type);
  const scores = {instructor: instructor && !instructorNames(focus?.instructor).some(name => name.toLowerCase() === instructor) ? 1 : 0,
    time: 0, days: 0, gaps: 0, buildings: 0};
  const timed = [];
  for (const section of sections) {
    if (section.async) continue;
    if (!/^[MTWRFSU]+$/.test(section.days) || minutes(section.start) === null ||
        minutes(section.end) === null || minutes(section.end) <= minutes(section.start)) {
      unreadable.push(`Meeting time unavailable for ${section.course} ${section.type} (${section.id})`);
      continue;
    }
    timed.push(section);
    if (section === focus) scores.time = Math.max(0, preferences.earliest - minutes(section.start));
  }
  for (const day of DAY_CODES) {
    const meetings = timed.filter(section => section.days.includes(day))
      .sort((a,b) => minutes(a.start) - minutes(b.start));
    if (meetings.length) scores.days++;
    let occupiedUntil = meetings.length ? minutes(meetings[0].end) : 0;
    for (let i = 1; i < meetings.length; i++) {
      const previous = meetings[i - 1];
      const next = meetings[i];
      const gap = minutes(next.start) - occupiedUntil;
      scores.gaps += Math.max(0, gap);
      occupiedUntil = Math.max(occupiedUntil, minutes(next.end));
      if (previous.room.split(' ')[0] !== next.room.split(' ')[0]) scores.buildings++;
    }
    for (const [i, first] of meetings.entries()) {
      for (const second of meetings.slice(i + 1)) {
        if (minutes(second.start) >= minutes(first.end)) break;
        warnings.push(`${day}: ${first.course} ${first.type} overlaps ${second.course} ${second.type} (${first.start}–${first.end} and ${second.start}–${second.end})`);
      }
    }
  }
  return unreadable.length ? null : scores;
}

export function rankOptions(state, preferences) {
  const key = section => section.course + '|' + section.type;
  const options = [{number:0, changes:[], unsafe:false}, ...state.groups];
  return options.map(option => {
    const sections = state.current.slice();
    const changed = new Set();
    const warnings = [...(option.notes || [])];
    const dropped = option.dropped || [];
    for (const drop of dropped) {
      warnings.push(`Drops ${drop.course}${drop.type ? ' ' + drop.type : ''}${drop.id ? ' (' + drop.id + ')' : ''}`);
    }
    for (const change of option.changes) {
      const matches = sections.map((section,i) => key(section) === key(change) ? i : -1).filter(i => i >= 0);
      if ([option.addCourse].flat().includes(change.course) && !state.current.some(section => section.course === change.course)) {
        if (!sections.some(section => section.id === change.id)) sections.push(change);
        continue;
      }
      if (matches.length !== 1 || changed.has(matches[0])) {
        warnings.push(`Could not match ${change.course} ${change.type} to a unique current section`);
        continue;
      }
      changed.add(matches[0]);
      sections[matches[0]] = change;
    }
    const remaining = sections.filter(section => !dropped.some(drop => drop.id
      ? section.id === drop.id : section.course === drop.course && (!drop.type || section.type === drop.type)));
    const overlaps = [];
    const warningsForTimes = [];
    const scores = evaluateSchedule(remaining, preferences, overlaps, warningsForTimes);
    warnings.push(...warningsForTimes);
    if (option.unsafe && !warnings.length) warnings.push('UniTime reported a change that could not be verified');
    if (option.number && !option.changes.length && !warnings.length) warnings.push('No readable section changes');
    const movesTarget = option.changes.some(section => section.course === preferences.course && section.type === preferences.type);
    const previewOnly = Boolean(warnings.length || option.unsafe ||
      (overlaps.length && (!movesTarget || scores?.instructor !== 0 || scores?.time !== 0)));
    return {...option, sections:remaining, scores, warnings:[...warnings,...overlaps], dropped, previewOnly,
      canApply:Boolean(option.number && scores && !previewOnly)};
  }).sort((a,b) => {
    if (a.previewOnly !== b.previewOnly) return a.previewOnly ? 1 : -1;
    if (!a.scores || !b.scores) return Number(!a.scores) - Number(!b.scores) || a.number - b.number;
    for (const criterion of preferences.order) {
      const delta = a.scores[criterion] - b.scores[criterion];
      if (delta) return delta;
    }
    return a.warnings.length - b.warnings.length || a.number - b.number;
  });
}

const ICS_DAYS = {M:'MO', T:'TU', W:'WE', R:'TH', F:'FR', S:'SA', U:'SU'};
const icsText = value => String(value ?? '').replace(/[\\,;]/g, '\\$&');
// Weekly VEVENTs in floating local time; async or unparseable sections are skipped.
export function ics(sections, {start, end}) {
  const at = (date, min) => date.replace(/-/g, '') + 'T' + String(Math.floor(min / 60)).padStart(2, '0') + String(min % 60).padStart(2, '0') + '00';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Purdue Registration Planner//EN'];
  for (const section of sections) {
    const from = minutes(section.start), to = minutes(section.end);
    if (section.async || !/^[MTWRFSU]+$/.test(section.days || '') || from === null || to === null || to <= from) continue;
    const first = new Date(start + 'T00:00:00Z');
    while (!section.days.includes('UMTWRFS'[first.getUTCDay()])) first.setUTCDate(first.getUTCDate() + 1);
    const date = first.toISOString().slice(0, 10);
    lines.push('BEGIN:VEVENT', `UID:${section.id}@purdue-registration-planner`, `DTSTAMP:${at(start, 0)}`,
      `DTSTART:${at(date, from)}`, `DTEND:${at(date, to)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${[...section.days].map(day => ICS_DAYS[day]).join(',')};UNTIL=${at(end, 1439)}`,
      `SUMMARY:${icsText([section.course, section.type].filter(Boolean).join(' '))}`,
      ...(section.room ? [`LOCATION:${icsText(section.room)}`] : []), 'END:VEVENT');
  }
  return [...lines, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

// Shared day and overlapping time range; async or unreadable times never overlap.
export function sectionsOverlap(a, b) {
  if (a.async || b.async || ![...a.days || ''].some(day => (b.days || '').includes(day))) return false;
  const [a1, a2, b1, b2] = [minutes(a.start), minutes(a.end), minutes(b.start), minutes(b.end)];
  return [a1, a2, b1, b2].every(value => value !== null) && a1 < b2 && b1 < a2;
}

// types: one array of candidate sections per section type. Picks the least-overlapping section of each type.
export function pickSections(types, current) {
  const picks = [], conflicts = [];
  for (const options of types) {
    const clashes = section => [...current, ...picks].filter(other => sectionsOverlap(section, other)).length;
    const best = options.reduce((a, b) => clashes(b) < clashes(a) ? b : a);
    if (clashes(best)) conflicts.push(best.course + ' ' + best.type + ' overlaps your schedule.');
    picks.push(best);
  }
  return {picks, conflicts};
}

// courses: per course, one array of candidate sections per type. DFS over one section per type with overlap
// pruning; shortcut: stops after 5000 nodes, so a huge search space may miss the best schedule.
export function buildSchedules(courses, current, prefs, limit = 5000) {
  const slots = courses.flat();
  const found = [];
  let nodes = 0;
  const walk = (index, picks) => {
    if (nodes++ >= limit) return;
    if (index === slots.length) return found.push(picks);
    for (const section of slots[index]) {
      if (![...current, ...picks].some(other => sectionsOverlap(section, other))) walk(index + 1, [...picks, section]);
    }
  };
  walk(0, []);
  return found.map(picks => ({picks, scores:evaluateSchedule([...current, ...picks], {instructor:'', earliest:prefs.earliest})}))
    .filter(item => item.scores)
    .sort((a, b) => {
      for (const criterion of prefs.order) if (a.scores[criterion] !== b.scores[criterion]) return a.scores[criterion] - b.scores[criterion];
      return 0;
    }).slice(0, 3).map(item => item.picks);
}
