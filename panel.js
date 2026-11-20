import { DAYS, formatTime, toMinutes, normalizeCode, findConflicts, mergeCourses } from './planner.js';

const STORAGE_KEY = 'purdue-course-planner-courses';
const DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const DAY_LETTERS = { Mon: 'M', Tue: 'T', Wed: 'W', Thu: 'Th', Fri: 'F', Sat: 'Sa', Sun: 'Su' };
const PIXELS_PER_MINUTE = 50 / 60;

let savedCourses = [];
let liveCourses = [];
let liveFormDetected = false;
let activeEditCode = null;
let syncGeneration = 0;
const scenarioChoices = new Map();

const byId = (id) => document.getElementById(id);
const calendar = byId('calendar');

function safeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function courseKey(course) {
  return normalizeCode(course.code || '');
}

function readSavedCourses() {
  return new Promise((resolve) => {
    if (!globalThis.chrome?.storage?.local) {
      resolve([]);
      return;
    }
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      resolve(Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : []);
    });
  });
}

function persistSavedCourses() {
  if (!globalThis.chrome?.storage?.local) return;
  chrome.storage.local.set({ [STORAGE_KEY]: savedCourses });
}

function applyLiveSnapshot(result) {
  if (!result || !Array.isArray(result.courses)) return;
  const nextDetected = Boolean(result.detected);
  const sections = result.preferredSections ?? [];
  const nextCourses = result.courses.map(course => ({
    ...course,
    preferredMeetings: sections.filter(section => normalizeCode(section.courseCode) === courseKey(course)),
  }));
  const changed = nextDetected !== liveFormDetected || JSON.stringify(nextCourses) !== JSON.stringify(liveCourses);
  liveFormDetected = nextDetected;
  liveCourses = nextCourses;
  if (changed) render();
}

function syncFromActiveTab() {
  const generation = ++syncGeneration;
  const title = byId('connectionTitle');
  const message = byId('connectionMessage');
  if (!globalThis.chrome?.tabs?.query) {
    title.textContent = 'Planner ready';
    message.textContent = 'Add your courses and meeting times below.';
    byId('connectionDot').className = 'status-dot offline';
    return;
  }
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    if (generation !== syncGeneration) return;
    const tab = tabs?.[0];
    if (!tab?.id || !tab.url?.startsWith('https://timetable.mypurdue.purdue.edu/')) {
      clearLiveSnapshot();
      showConnection(false, false);
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'PURDUE_PLANNER_READ' }, (response) => {
      const error = chrome.runtime.lastError;
      if (generation !== syncGeneration) return;
      if (error || !response) {
        clearLiveSnapshot();
        showConnection(false, true);
        return;
      }
      applyLiveSnapshot(response);
      showConnection(Boolean(response.detected), false);
    });
  });
}

function clearLiveSnapshot() {
  if (!liveCourses.length && !liveFormDetected) return;
  liveCourses = [];
  liveFormDetected = false;
  render();
}

function showConnection(detected, cannotRead) {
  const dot = byId('connectionDot');
  const title = byId('connectionTitle');
  const message = byId('connectionMessage');
  dot.className = `status-dot ${detected ? 'connected' : 'offline'}`;
  if (detected) {
    title.textContent = 'UniTime course requests connected';
    message.textContent = 'Check sections in Course Finder → List of Classes to preview them here.';
  } else if (cannotRead) {
    title.textContent = 'Planner ready';
    message.textContent = 'Reload the UniTime tab if it was already open, then refresh here. You can also add courses manually.';
  } else {
    title.textContent = 'Course Request Form not open';
    message.textContent = 'Open UniTime on timetable.mypurdue.purdue.edu to sync selected courses, or add one manually.';
  }
}

function visibleCourses() {
  return mergeCourses(savedCourses, liveCourses, liveFormDetected);
}

function renderScenarios(courses) {
  const controls = byId('alternateScenarios');
  controls.replaceChildren();
  const replacements = new Map();
  for (const primary of liveCourses) {
    if (primary.group !== 'primary' || !primary.priority) continue;
    const alternates = liveCourses.filter(course => course.group === 'alternate' &&
      course.priority === primary.priority && course.code !== primary.code);
    if (!alternates.length) continue;
    const label = document.createElement('label');
    label.textContent = `Priority ${primary.priority}`;
    const select = document.createElement('select');
    select.add(new Option(`${primary.code} (primary)`, ''));
    for (const alternate of alternates) {
      select.add(new Option(`${alternate.code} (alternate)`, alternate.code));
    }
    select.value = scenarioChoices.get(primary.code) || '';
    if (select.value) {
      const replacement = courses.find(course => course.code === select.value);
      if (replacement) replacements.set(primary.code, replacement);
    }
    select.addEventListener('change', () => {
      scenarioChoices.set(primary.code, select.value);
      render();
    });
    label.append(select);
    controls.append(label);
  }
  controls.hidden = !controls.children.length;
  return replacements;
}

function render() {
  const courses = visibleCourses();
  const replacements = renderScenarios(courses);
  const displayed = new Map();
  for (const course of courses) {
    if (!byId('showAlternates').checked && course.group === 'alternate') continue;
    const choice = replacements.get(course.code) || course;
    displayed.set(choice.code, choice);
  }
  const calendarData = [...displayed.values()]
    .map((course) => ({ ...course, previewMeetings: course.meetingOverride ? (course.meetings || []) : (course.preferredMeetings?.length ? course.preferredMeetings : (course.meetings || [])) }));
  byId('courseCount').textContent = String(courses.length);
  byId('emptyState').hidden = courses.length > 0;
  renderCalendar(calendarData);
  renderCourseList(courses);
}

function renderCalendar(courses) {
  calendar.replaceChildren();
  const allTimes = courses.flatMap((course) => (course.previewMeetings || []).flatMap((meeting) => [toMinutes(meeting.start), toMinutes(meeting.end)]).filter((time) => time !== null));
  const startHour = Math.floor((allTimes.length ? Math.min(...allTimes) : 8 * 60) / 60);
  const endHour = Math.ceil((allTimes.length ? Math.max(...allTimes) : 20 * 60) / 60);
  const startMinute = startHour * 60;
  const endMinute = Math.max(startMinute + 60, endHour * 60);
  const calendarHeight = (endMinute - startMinute) * PIXELS_PER_MINUTE;
  const corner = document.createElement('div');
  corner.className = 'cal-head';
  calendar.append(corner);
  for (const day of DAYS) {
    const heading = document.createElement('div');
    heading.className = 'cal-head';
    heading.textContent = DAY_LETTERS[day];
    heading.title = DAY_NAMES[day];
    calendar.append(heading);
  }
  const timeAxis = document.createElement('div');
  timeAxis.className = 'time-axis';
  timeAxis.style.height = `${calendarHeight}px`;
  for (let hour = startMinute; hour <= endMinute; hour += 60) {
    const label = document.createElement('span');
    label.className = 'hour-label';
    label.style.top = `${(hour - startMinute) * PIXELS_PER_MINUTE}px`;
    label.textContent = formatTime(hour);
    timeAxis.append(label);
  }
  calendar.append(timeAxis);
  const columns = new Map();
  for (const day of DAYS) {
    const column = document.createElement('div');
    column.className = 'day-column';
    column.style.height = `${calendarHeight}px`;
    columns.set(day, column);
    calendar.append(column);
  }

  const conflictCourses = courses.map((course) => ({ ...course, meetings: course.previewMeetings }));
  const conflicts = findConflicts(conflictCourses).filter(({ first, second }) => courseKey(first) !== courseKey(second));
  for (const course of courses) {
    for (const meeting of Array.isArray(course.previewMeetings) ? course.previewMeetings : []) {
      const start = toMinutes(meeting.start);
      const end = toMinutes(meeting.end);
      if (start === null || end === null || end <= start) continue;
      const top = Math.max(0, (start - startMinute) * PIXELS_PER_MINUTE);
      const bottom = Math.min(endMinute, end);
      if (bottom <= startMinute || start >= endMinute || bottom <= start) continue;
      for (const day of (Array.isArray(meeting.days) ? meeting.days : [])) {
        const column = columns.get(day);
        if (!column) continue;
        const block = document.createElement('div');
        const isConflict = conflicts.some(item => item.day === day && item.start < end && item.end > start &&
          (item.first.code === course.code || item.second.code === course.code));
        block.className = `cal-block${course.group === 'alternate' ? ' alternate' : ''}${isConflict ? ' conflicted' : ''}`;
        block.style.top = `${top}px`;
        block.style.height = `${Math.max(28, (Math.min(bottom, endMinute) - Math.max(start, startMinute)) * PIXELS_PER_MINUTE)}px`;
        const strong = document.createElement('strong');
        strong.textContent = course.code;
        block.append(strong);
        const detail = document.createElement('span');
        detail.textContent = `${formatTime(start)}–${formatTime(end)}${meeting.section ? ` · ${meeting.section}` : ''}`;
        block.append(detail);
        block.title = `${course.code}${course.title ? ` · ${course.title}` : ''}\n${DAY_NAMES[day]} ${formatTime(start)}–${formatTime(end)}${meeting.location ? ` · ${meeting.location}` : ''}${isConflict ? '\nTime conflict' : ''}`;
        column.append(block);
      }
    }
  }
  renderConflicts(conflicts);
}

function renderConflicts(conflicts) {
  const summary = byId('conflictSummary');
  if (!conflicts.length) {
    summary.hidden = true;
    summary.textContent = '';
    return;
  }
  summary.hidden = false;
  const unique = [...new Set(conflicts.map((item) => `${item.first.code} overlaps ${item.second.code} on ${DAY_NAMES[item.day]}`))];
  summary.textContent = `${unique.join('. ')}. UniTime may assign different sections.`;
}

function renderCourseList(courses) {
  const list = byId('courseList');
  list.replaceChildren();
  for (const course of courses) {
    const card = document.createElement('article');
    card.className = `course-card${course.group === 'alternate' ? ' alternate-card' : ''}`;
    const swatch = document.createElement('span');
    swatch.className = 'course-swatch';
    card.append(swatch);
    const info = document.createElement('div');
    info.className = 'course-info';
    const topline = document.createElement('div');
    topline.className = 'course-topline';
    const code = document.createElement('strong');
    code.textContent = course.code;
    topline.append(code);
    const tag = document.createElement('span');
    tag.className = `tag${course.group === 'alternate' ? ' alternate' : ''}`;
    tag.textContent = course.draft ? 'PREVIEW' : course.group === 'alternate' ? 'ALTERNATE' : course.live ? 'PRIMARY' : 'PLANNED';
    topline.append(tag);
    info.append(topline);
    const description = document.createElement('p');
    description.textContent = scheduleSummary(course) || course.title;
    description.title = course.title || '';
    info.append(description);
    card.append(info);
    const actions = document.createElement('div');
    actions.className = 'course-actions';
    const edit = document.createElement('button');
    edit.className = 'small-action';
    edit.type = 'button';
    edit.textContent = course.meetingOverride ? 'Edit times' : (course.preferredMeetings?.length ? 'Edit times' : 'Add times');
    edit.addEventListener('click', () => openEditor(course));
    actions.append(edit);
    if (!course.live || course.meetingOverride) {
      const remove = document.createElement('button');
      remove.className = 'small-action';
      remove.type = 'button';
      remove.textContent = course.live ? 'Reset times' : 'Remove';
      remove.addEventListener('click', () => removeCourse(course.code));
      actions.append(remove);
    }
    card.append(actions);
    list.append(card);
  }
}

function scheduleSummary(course) {
  const meetings = course.meetingOverride ? course.meetings : (course.preferredMeetings?.length ? course.preferredMeetings : course.meetings);
  if (!meetings?.length) return course.live ? 'Selected in UniTime - add meeting times' : 'Meeting time not added';
  return meetings.map((meeting) => `${meeting.days.map((day) => DAY_LETTERS[day] || day).join('')} ${meeting.start}-${meeting.end}${meeting.section ? ` - ${meeting.section}` : ''}`).join(' | ');
}

function openEditor(course = null) {
  activeEditCode = course ? course.code : null;
  byId('editorTitle').textContent = course ? `Edit ${course.code}` : 'Add a course';
  byId('courseCode').value = course?.code || '';
  byId('courseCode').readOnly = Boolean(course);
  byId('courseCode').setCustomValidity('');
  byId('courseTitle').value = course?.title || '';
  byId('deleteCourse').hidden = !course || course.live;
  const meetingRows = byId('meetingRows');
  meetingRows.replaceChildren();
  const initialMeetings = course?.meetingOverride ? course.meetings : (course?.preferredMeetings?.length ? course.preferredMeetings : course?.meetings);
  const meetings = initialMeetings?.length ? initialMeetings : [null];
  meetings.forEach(addMeetingRow);
  byId('courseEditor').hidden = false;
  byId('courseCode').focus();
  byId('courseEditor').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function addMeetingRow(meeting = null) {
  const template = byId('meetingTemplate');
  const row = template.content.firstElementChild.cloneNode(true);
  const checkedDays = new Set(Array.isArray(meeting?.days) ? meeting.days : []);
  for (const input of row.querySelectorAll('.day-picker input')) input.checked = checkedDays.has(input.value);
  row.querySelector('.meeting-start').value = meeting?.start || '09:00';
  row.querySelector('.meeting-end').value = meeting?.end || '09:50';
  row.querySelector('.meeting-location').value = meeting?.location || '';
  row.querySelector('.remove-meeting').addEventListener('click', () => {
    if (byId('meetingRows').children.length > 1) row.remove();
    else row.querySelectorAll('.day-picker input').forEach((input) => { input.checked = false; });
  });
  byId('meetingRows').append(row);
}

function closeEditor() {
  byId('courseEditor').hidden = true;
  activeEditCode = null;
}

function handleSaveCourse(event) {
  event.preventDefault();
  const codeField = byId('courseCode');
  const code = normalizeCode(codeField.value);
  if (!code) return;
  if (!activeEditCode && visibleCourses().some(course => course.code === code)) {
    codeField.setCustomValidity('This course is already in your planner. Edit its times from the course list.');
    codeField.reportValidity();
    return;
  }
  const meetings = [];
  for (const row of byId('meetingRows').querySelectorAll('.meeting-row')) {
    const days = [...row.querySelectorAll('.day-picker input:checked')].map(input => input.value);
    if (!days.length) continue;
    const start = row.querySelector('.meeting-start').value;
    const endField = row.querySelector('.meeting-end');
    const end = endField.value;
    if (toMinutes(end) <= toMinutes(start)) {
      endField.setCustomValidity('End time must be after the start time.');
      endField.reportValidity();
      endField.setCustomValidity('');
      return;
    }
    meetings.push({ days, start, end, location: safeText(row.querySelector('.meeting-location').value) });
  }
  const activeKey = normalizeCode(activeEditCode || code);
  const target = savedCourses.find((course) => courseKey(course) === activeKey);
  const live = liveCourses.find((course) => courseKey(course) === normalizeCode(code));
  if (target) {
    target.code = code;
    target.title = safeText(byId('courseTitle').value) || target.title || live?.title || '';
    target.meetings = meetings;
    target.meetingOverride = true;
    target.group = live?.group || target.group || 'primary';
  } else {
    savedCourses.push({
      code,
      title: safeText(byId('courseTitle').value) || live?.title || '',
      group: live?.group || 'primary',
      source: live ? 'unitime' : 'manual',
      meetings,
      meetingOverride: true
    });
  }
  persistSavedCourses();
  closeEditor();
  render();
}

function removeCourse(code) {
  const key = normalizeCode(code);
  savedCourses = savedCourses.filter((course) => courseKey(course) !== key);
  persistSavedCourses();
  closeEditor();
  render();
}

byId('refreshButton').addEventListener('click', syncFromActiveTab);
byId('showAlternates').addEventListener('change', render);
byId('addCourseButton').addEventListener('click', () => openEditor());
byId('addMeeting').addEventListener('click', () => addMeetingRow());
byId('closeEditor').addEventListener('click', closeEditor);
byId('cancelEditor').addEventListener('click', closeEditor);
byId('deleteCourse').addEventListener('click', () => activeEditCode && removeCourse(activeEditCode));
byId('courseForm').addEventListener('submit', handleSaveCourse);
byId('courseCode').addEventListener('input', event => event.target.setCustomValidity(''));

savedCourses = await readSavedCourses();
render();
syncFromActiveTab();
window.setInterval(syncFromActiveTab, 5000);

