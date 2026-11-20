export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function normalizeCode(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toUpperCase()
    .replace(/^([A-Z][A-Z0-9&]*?)\s*([0-9]{3,5}[A-Z]{0,3})$/, '$1 $2');
}

export function toMinutes(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

export function formatTime(minutes) {
  const hours = Math.floor(minutes / 60) % 24;
  const remainder = String(minutes % 60).padStart(2, '0');
  return `${hours % 12 || 12}:${remainder} ${hours < 12 ? 'AM' : 'PM'}`;
}

export function mergeCourses(saved, live, liveFormDetected = false) {
  const requests = new Map();
  for (const request of live) {
    const code = normalizeCode(request.code);
    const previous = requests.get(code);
    if (code && (!previous || request.group === 'primary' && previous.group !== 'primary')) {
      requests.set(code, request);
    }
  }

  const annotations = new Map(saved.map(course => [normalizeCode(course.code), course]));
  const courses = Array.from(requests, ([code, request]) => {
    const annotation = annotations.get(code);
    return {
      ...annotation,
      ...request,
      code,
      title: request.title || annotation?.title || '',
      meetings: annotation?.meetings ?? [],
      preferredMeetings: request.preferredMeetings ?? request.meetings ?? [],
      live: true,
    };
  });

  for (const [code, course] of annotations) {
    if (!requests.has(code) && !(liveFormDetected && course.source === 'unitime')) {
      courses.push({ ...course, code, live: false });
    }
  }
  return courses;
}

export function findConflicts(courses) {
  const conflicts = [];
  for (const day of DAYS) {
    const meetings = [];
    for (const course of courses) {
      for (const meeting of course.meetings ?? []) {
        if (!meeting.days?.includes(day)) continue;
        const start = toMinutes(meeting.start);
        const end = toMinutes(meeting.end);
        if (start !== null && end !== null && end > start) {
          meetings.push({ course, start, end });
        }
      }
    }
    meetings.sort((first, second) => first.start - second.start);
    for (const [index, first] of meetings.entries()) {
      for (let next = index + 1; next < meetings.length; next++) {
        const second = meetings[next];
        if (second.start >= first.end) break;
        conflicts.push({ day, start: second.start, end: Math.min(first.end, second.end),
          first: first.course, second: second.course });
      }
    }
  }
  return conflicts;
}
