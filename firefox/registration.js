import {ics, evaluateSchedule, instructorNames, minutes, rankOptions} from './registration-model.mjs';
import {createSandbox} from './registration-sandbox.mjs';

const sandboxMode = new URLSearchParams(location.search).get('sandbox') === '1';
const sandbox = sandboxMode ? createSandbox() : null;
let catalog = [];
let candidate = null;
const api = sandbox ? null : globalThis.browser ?? globalThis.chrome;

const el = id => document.getElementById(id);
const themeToggle = el('theme-toggle');
function setTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#0b1220' : '#111c35';
  themeToggle.setAttribute('aria-pressed', String(dark));
}
const savedTheme = localStorage.getItem('registration-theme');
setTheme(savedTheme ? savedTheme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
themeToggle.addEventListener('click', () => {
  const dark = themeToggle.getAttribute('aria-pressed') !== 'true';
  setTheme(dark);
  localStorage.setItem('registration-theme', dark ? 'dark' : 'light');
});
const criteria = ['instructor','time','days','gaps','buildings'];
let state;
let ranked = [];
let busy = false;
let previewNumber;

const message = (type, args = {}) => sandbox ? sandbox.request(type, args) :
  api.tabs.sendMessage(Number(el('source').value), {type:'PURDUE_REG_' + type, ...args});

if (sandbox) {
  el('sandbox-banner').hidden = false;
  el('wishlist').hidden = false;
  el('open-sandbox').hidden = true;
  el('builder').hidden = false;
  el('live-source').hidden = true;
  el('load').textContent = 'Load sandbox alternatives';
  el('apply').textContent = 'Apply selected to sandbox';
}

function status(text) {
  el('status').textContent = text;
  el('alternatives-status').textContent = text; // plain text: only #status is a live region
}

function showServiceIssue(issue) {
  const banner = el('service-issue');
  banner.textContent = issue || '';
  banner.hidden = !issue;
}

function option(select, label, value) {
  select.add(new Option(label, value));
}

function classCard(section, variant) {
  const preview = variant === 'preview';
  const card = document.createElement(preview ? 'article' : 'button');
  card.className = 'meeting ' + variant;
  const when = section.async ? 'asynchronous' : [section.days, section.start + '–' + section.end].filter(Boolean).join(' ');
  card.title = [section.course, section.type, when, section.room, section.instructor].filter(Boolean).join(' · ');
  if (!preview) {
    card.type = 'button';
    card.setAttribute('aria-label', [section.course, section.type, when].join(' '));
    card.disabled = busy;
    card.setAttribute('aria-pressed', String(el('target').value === section.id));
    card.addEventListener('click', () => {
      el('target').value = section.id;
      loadAlternatives().then(() => {
        el('alternatives').scrollIntoView({block:'nearest'});
        el('week').querySelector('[aria-pressed=true]')?.focus({preventScroll:true}); // week re-rendered; restore focus
      });
    });
  }
  const name = document.createElement('strong');
  name.textContent = section.course + ' ' + section.type;
  card.append(name);
  const time = section.async ? 'Asynchronous' : section.start + '–' + section.end;
  for (const line of [preview ? 'Proposed · ' + time : variant === 'dropped' ? 'Dropped · ' + time : time, section.room, section.instructor, preview ? seatCount(section) : '']) {
    if (!line) continue;
    const detail = document.createElement('span');
    detail.textContent = line;
    card.append(detail);
  }
  return card;
}

function seatCount(section) {
  return section.openSeats == null ? 'Seat count unavailable' :
    section.openSeats + (section.openSeats === 1 ? ' seat open' : ' seats open');
}

function renderWeek(current, changes, dropped = []) {
  const isDropped = section => dropped.some(drop => drop.id ? drop.id === section.id :
    drop.course === section.course && (!drop.type || drop.type === section.type));
  const timed = section => !section.async && minutes(section.start) !== null &&
    minutes(section.end) > minutes(section.start);
  const all = [...current, ...changes].filter(timed);
  const start = Math.floor(Math.min(780, ...all.map(section => minutes(section.start))) / 60) * 60;
  const end = Math.ceil(Math.max(1140, ...all.map(section => minutes(section.end))) / 60) * 60;
  const height = (end - start) * 1.5;
  const week = el('week');
  week.replaceChildren();
  const axis = document.createElement('div');
  axis.className = 'time-axis';
  for (let hour = start; hour < end; hour += 60) {
    const tick = document.createElement('span');
    tick.style.top = (hour - start) * 1.5 + 'px';
    tick.textContent = (hour / 60 % 12 || 12) + (hour < 720 ? ' AM' : ' PM');
    axis.append(tick);
  }
  week.append(axis);
  for (const [index, day] of ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].entries()) {
    const code = 'MTWRFSU'[index];
    const dayRows = all.filter(section => section.days.includes(code));
    if (index > 4 && !dayRows.length) continue;
    const column = document.createElement('div');
    const heading = document.createElement('h2');
    heading.textContent = day;
    const timeline = document.createElement('div');
    timeline.className = 'timeline';
    timeline.style.height = height + 'px';
    if (!dayRows.length) timeline.textContent = 'Free';
    for (const section of dayRows) {
      const variant = changes.includes(section) ? 'preview' : isDropped(section) ? 'dropped' : changes.some(change =>
        change.course === section.course && change.type === section.type) ? 'replaced' : 'current';
      const card = classCard(section, variant);
      card.style.top = (minutes(section.start) - start) * 1.5 + 'px';
      card.style.height = (minutes(section.end) - minutes(section.start)) * 1.5 + 'px';
      timeline.append(card);
    }
    column.append(heading, timeline);
    week.append(column);
  }
  const online = el('online');
  online.replaceChildren();
  for (const section of current.filter(section => section.async)) online.append(classCard(section, isDropped(section) ? 'dropped' : 'current'));
  for (const section of changes.filter(section => section.async)) online.append(classCard(section, 'preview'));
}

function display() {
  const selected = ranked.find(item => item.number === previewNumber);
  for (const button of el('options').children) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.number) === previewNumber));
  }
  const current = state?.current || [];
  el('save-option').disabled = !selected?.number;
  el('apply').disabled = busy || Boolean(state?.issue) || !selected?.canApply;
  el('sandbox-undo').disabled = busy || !sandbox?.canUndo;
  const removable = state?.current?.find(section => section.id === el('target').value)?.course;
  el('remove-class').disabled = busy || !removable;
  el('remove-class').textContent = removable ? 'Remove ' + removable : 'Remove selected class';
  el('sandbox-reset').disabled = busy;
  el('apply-help').textContent = selected?.number && !selected.canApply
    ? 'Preview only. ' + (selected.warnings[0] || 'This alternative cannot be applied.')
    : '';
  el('details').textContent = selected?.scores
    ? selected.scores.days + ' class days · ' + selected.scores.gaps + ' min between classes per week' +
      (el('instructor').value.trim() ? (selected.scores.instructor ? ' · instructor differs' : ' · instructor matches') : '')
    : 'Meeting-time summary unavailable.';
  const baseline = ranked.find(item => item.number === 0)?.scores;
  const comparison = el('comparison');
  comparison.hidden = !selected?.number || !selected.scores || !baseline;
  comparison.replaceChildren();
  if (!comparison.hidden) {
    for (const [key, label] of [['days','Class days'],['gaps','Gap minutes'],['buildings','Building changes']]) {
      const metric = document.createElement('span');
      metric.textContent = label + ' ' + baseline[key] + ' → ' + selected.scores[key];
      comparison.append(metric);
    }
  }
  el('preview-warnings').replaceChildren();
  const warnings = candidate ? [] : selected?.warnings || [];
  if (candidate) {
    const unreadable = [];
    evaluateSchedule([...current, ...candidate.picks], {instructor:'', earliest:0}, warnings, unreadable);
    warnings.push(...unreadable);
  }
  for (const warning of warnings) {
    const item = document.createElement('li');
    item.textContent = warning;
    el('preview-warnings').append(item);
  }
  const changes = (selected?.changes || []).filter(change => !current.some(section =>
    ['id','days','start','end','room','instructor'].every(key => section[key] === change[key])));
  renderWeek(current, candidate ? candidate.picks : changes, candidate ? [] : selected?.dropped);
}

function rerank() {
  if (!state || state.issue) return;
  const current = state.current.find(section => section.id === el('target').value);
  const instructor = el('instructor');
  const previousInstructor = instructor.value;
  const names = new Map();
  for (const section of [current, ...state.groups.flatMap(group => group.changes)]) {
    if (!section || section.course !== current?.course || section.type !== current?.type) continue;
    for (const name of instructorNames(section.instructor)) names.set(name.toLowerCase(), name);
  }
  instructor.replaceChildren();
  option(instructor, 'Any instructor', '');
  for (const name of [...names.values()].sort((a,b) => a.localeCompare(b))) {
    option(instructor, name, name.toLowerCase());
  }
  instructor.value = names.has(previousInstructor) ? previousInstructor : '';
  const [hours, mins] = el('earliest').value.split(':').map(Number);
  if (!Number.isFinite(hours * 60 + mins)) return;
  ranked = rankOptions(state, {instructor:el('instructor').value, earliest:hours * 60 + mins,
    course:current?.course, type:current?.type, order:[...new Set([el('first').value,el('second').value,...criteria])]});
  el('options').replaceChildren();
  if (!ranked.some(item => item.number === previewNumber)) previewNumber = ranked[0]?.number;
  ranked.forEach((item,index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.number = item.number;
    button.className = 'alternative-card';
    const line = (parent, className, text) => {
      const element = document.createElement('span');
      element.className = className;
      element.textContent = text;
      parent.append(element);
      return element;
    };
    const heading = line(button, 'alternative-heading', '');
    line(heading, 'alternative-title', item.number ? 'Option ' + (ranked.slice(0, index).filter(r => r.number).length + 1) : 'Current schedule');
    const indicator = line(heading, 'alternative-indicator', '✓');
    indicator.setAttribute('aria-hidden', 'true');
    const meetingTime = section => section.async ? 'Asynchronous' :
      [section.days, section.start && section.end ? section.start + '–' + section.end : section.start]
        .filter(Boolean).join(' ') || 'Time unavailable';
    for (const change of item.changes) {
      const previous = state.current.filter(section => section.course === change.course && section.type === change.type);
      const block = line(button, 'alternative-section', '');
      line(block, 'alternative-course', [change.course, change.type].filter(Boolean).join(' '));
      const after = meetingTime(change);
      const before = previous.length === 1 ? meetingTime(previous[0]) : '';
      const time = line(block, 'alternative-time', '');
      if (before && before !== after) {
        line(time, 'alternative-previous', before);
        line(time, 'alternative-arrow', '→');
      }
      line(time, 'alternative-new', after);
      line(block, 'alternative-meta', [change.instructor, seatCount(change)].filter(Boolean).join(' · '));
    }
    if (!item.number) line(button, 'alternative-meta', 'Preview your existing timetable');
    if (item.warnings.length) {
      const count = item.warnings.length;
      line(button, 'alternative-warning', '⚠ ' + count + (count === 1 ? ' warning' : ' warnings'));
      line(button, 'alternative-meta', item.warnings[0]);
    }
    button.addEventListener('click', () => {
      previewNumber = item.number;
      display();
    });
    el('options').append(button);
  });
  display();
}

const SAVED = 'registration-saved';
const changeIds = item => item.changes.map(change => change.id).sort();
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED)) || []; } catch { return []; }
}
function storeSaved(list) {
  try { localStorage.setItem(SAVED, JSON.stringify(list)); } catch {}
  renderSaved(list);
}
function renderSaved(list = loadSaved()) {
  el('saved').replaceChildren(...list.map(entry => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = entry.label;
    open.addEventListener('click', () => {
      const match = ranked.find(item => item.number && changeIds(item).join() === entry.ids.join());
      if (!match) return status('That saved option is not in the currently loaded alternatives.');
      previewNumber = match.number;
      display();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', 'Remove saved option ' + entry.label);
    remove.addEventListener('click', () => storeSaved(loadSaved().filter(item => item.savedAt !== entry.savedAt)));
    chip.append(open, remove);
    return chip;
  }));
}
el('save-option').addEventListener('click', () => {
  const selected = ranked.find(item => item.number === previewNumber);
  if (!selected?.number) return;
  const ids = changeIds(selected);
  const list = loadSaved();
  if (list.some(entry => entry.ids.join() === ids.join())) return;
  const title = el('options').querySelector('[aria-pressed=true] .alternative-title')?.textContent;
  const label = title + ': ' + selected.changes.map(change => [change.course, change.type].join(' ')).join(', ');
  storeSaved([...list, {label, ids, savedAt:Date.now()}].slice(-5));
});
el('export-ics').addEventListener('click', () => {
  const selected = ranked.find(item => item.number === previewNumber);
  const changes = candidate ? candidate.picks : selected?.changes || [];
  const dropped = candidate ? [] : selected?.dropped || [];
  const sections = [...(state?.current || []).filter(section =>
    !changes.some(change => change.course === section.course && change.type === section.type) &&
    !dropped.some(drop => drop.id ? drop.id === section.id : drop.course === section.course && (!drop.type || drop.type === section.type))),
    ...changes];
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([ics(sections, {start:'2027-01-11', end:'2027-05-01'})], {type:'text/calendar'}));
  link.download = 'schedule.ics';
  link.click();
  URL.revokeObjectURL(link.href);
});
renderSaved();

function clearAlternatives() {
  previewNumber = undefined;
  ranked = [];
  if (state) state = {...state, groups:[]};
  el('options').replaceChildren();
}

async function read() {
  candidate = null;
  el('course-browser').hidden = true;
  clearAlternatives();
  state = await message('READ');
  showServiceIssue(state?.issue);
  if (state?.issue) {
    status('Alternatives are temporarily unavailable.');
    return;
  }
  if (!state?.current.length && !sandbox) throw Error('Show List of Classes in the Scheduling Assistant, then refresh.');
  const previous = el('target').value;
  el('target').replaceChildren();
  for (const section of state.current) {
    option(el('target'), section.course + ' · ' + section.type + ' · ' + section.id, section.id);
  }
  if (state.current.some(section => section.id === previous)) el('target').value = previous;
  rerank();
  status(state.groups.length
    ? state.groups.length + (sandbox ? ' sandbox alternatives.' : ' UniTime alternatives.') + ' Options with warnings are available to preview.'
    : sandbox ? 'Click a class to load sample alternatives.'
    : 'Click a class to load its alternatives. You can also open its alternatives in UniTime and click Refresh here.');
}

async function run(task) {
  if (busy) return;
  busy = true;
  for (const id of ['load','refresh','source','apply','close-options']) el(id).disabled = true;
  try { await task(); }
  catch (error) { status(error.message); }
  finally {
    busy = false;
    for (const id of ['load','refresh','source','close-options']) el(id).disabled = false;
    display();
  }
}

el('preferences').addEventListener('submit', event => event.preventDefault());
el('preferences').addEventListener('input', event => {
  if (busy) return;
  if (event.target === el('target')) {
    el('instructor').value = '';
    clearAlternatives();
    status('Load alternatives for the newly selected class.');
  }
  rerank();
});
el('source').addEventListener('change', () => run(read));
for (const [id, action] of [['sandbox-undo','UNDO'],['sandbox-reset','RESET']]) {
  el(id).addEventListener('click', () => run(async () => {
    if (!sandbox) return;
    await message(action);
    await read();
    status(action === 'RESET' ? 'Sandbox schedule reset.' : 'Last sandbox change undone.');
  }));
}
el('remove-class').addEventListener('click', () => run(async () => {
  const id = el('target').value;
  const course = state?.current.find(section => section.id === id)?.course;
  if (!course) return status('Select a class to remove.');
  if (sandbox) {
    const result = await message('REMOVE_COURSE', {course});
    if (result.error) throw Error(result.error);
    await read();
    return status(course + ' removed from the sandbox schedule. Use Undo sandbox change to bring it back.');
  }
  if (!confirm('Drop ' + course + ' from your UniTime schedule draft? You can add it back in UniTime.')) return;
  clearAlternatives();
  const result = await message('DROP', {course, id});
  if (result.error) throw Error(result.error);
  for (let attempt = 0; attempt < 16; attempt++) {
    const latest = await message('READ');
    if (!latest.issue && !latest.current.some(section => section.course === course)) {
      await read();
      return status(course + ' dropped from your UniTime draft. Review it there before submitting.');
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  await read();
  status('Clicked Drop for ' + course + ' but could not confirm the change. Check UniTime.');
}));
el('refresh').addEventListener('click', () => run(async () => {
  if (sandbox) return read();
  state = undefined;
  clearAlternatives();
  const previous = el('source').value;
  const tabs = await api.tabs.query({url:'https://timetable.mypurdue.purdue.edu/Timetabling/sectioning*'});
  el('source').replaceChildren();
  for (const tab of tabs) option(el('source'), (tab.title || 'UniTime') + ' · tab ' + tab.id, tab.id);
  if (!tabs.length) throw Error('Open the signed-in UniTime Scheduling Assistant in this browser.');
  if (tabs.some(tab => String(tab.id) === previous)) el('source').value = previous;
  await read();
}));
function loadAlternatives() {
  return run(async () => {
    candidate = null;
    el('course-browser').hidden = true;
    clearAlternatives();
    display();
    status(sandbox ? 'Loading sandbox alternatives…' : 'Loading alternatives from UniTime…');
    const result = await message('OPEN', {id:el('target').value});
    if (result.error) throw Error(result.error);
    for (let attempt = 0; attempt < 12; attempt++) {
      const snapshot = await message('READ');
      if (snapshot.issue) return read();
      const conflicts = await message('INCLUDE_CONFLICTS');
      if (conflicts.changed) {
        await new Promise(resolve => setTimeout(resolve, 400));
        continue;
      }
      if (snapshot.groups.length) return read();
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    status(sandbox ? 'This sample section has no alternatives.' :
      'Open that section’s alternatives in UniTime, then click Refresh here.');
  });
}
el('load').addEventListener('click', loadAlternatives);
const catalogHint = 'Enter at least two characters: course code, title, instructor or CRN.';
const rowText = row => [row.course, row.title, row.credits != null && row.credits + ' cr',
  row.sections + (row.sections === 1 ? ' section' : ' sections')].filter(Boolean).join(' · ');
let wishRows = [];
async function addCourse(course) {
  const result = await message('ADD_COURSE', {course});
  if (result.error) throw Error(result.error);
  await read();
  status(course + ' added to the sandbox schedule.' + (result.warnings.length ? ' ' + result.warnings.join(' ') : ''));
}
function renderCatalog(hint = 'No matching classes.') {
  const results = el('course-results');
  results.replaceChildren();
  for (const row of wishRows) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'alternative-card';
    button.textContent = '★ Add ' + rowText(row);
    button.addEventListener('click', () => run(() => addCourse(row.course)));
    results.append(button);
  }
  for (const section of catalog) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'alternative-card';
    button.textContent = sandbox ? rowText(section) : [section.course, section.title].filter(Boolean).join(' · ');
    button.setAttribute('aria-pressed', String(candidate?.course === section.course));
    button.addEventListener('click', () => {
      if (!sandbox) return run(async () => {
        status('Loading sections for ' + section.course + '…');
        const result = await message('PREVIEW_COURSE', {course:section.course});
        if (result.error) throw Error(result.error);
        for (let attempt = 0; attempt < 20; attempt++) {
          const latest = await message('READ');
          if (latest.issue || latest.groups.some(group => group.addCourse === section.course)) return read();
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        status('UniTime did not return section options for ' + section.course + '. The course may be full or unavailable.');
      });
      run(async () => {
        const picked = await message('PICK_COURSE', {course:section.course});
        if (picked.error) throw Error(picked.error);
        candidate = {...section, picks:picked.picks};
        for (const item of results.children) item.setAttribute('aria-pressed', String(item === button));
        el('add-course').disabled = false;
      });
    });
    results.append(button);
  }
  if (!results.children.length) results.textContent = hint;
  el('add-course').disabled = !candidate;
}
el('browse-courses').addEventListener('click', () => run(async () => {
  clearAlternatives();
  candidate = null;
  catalog = [];
  el('course-browser').hidden = false;
  el('add-course').hidden = !sandbox;
  el('search-courses').hidden = Boolean(sandbox);
  if (sandbox) {
    if (!el('wish-paste').value) el('wish-paste').value = loadWishlist().join('\n');
    await refreshWishlist();
  } else {
    el('course-results').textContent = 'Enter a course code or title to search UniTime.';
  }
  el('course-filter').focus();
}));
el('search-courses').addEventListener('click', () => run(async () => {
  if (sandbox) return;
  const query = el('course-filter').value.trim();
  if (query.length < 2) return status('Enter at least two characters to search.');
  catalog = [];
  candidate = null;
  el('course-results').textContent = 'Searching UniTime…';
  const result = await message('SEARCH_COURSES', {query});
  if (result.error) {
    el('course-results').textContent = result.error;
    throw Error(result.error);
  }
  catalog = result.results.filter(item => !state?.current.some(section => section.course === item.course));
  renderCatalog();
  status(catalog.length + ' matching courses.');
}));
el('course-filter').addEventListener('keydown', event => {
  if (!sandbox && event.key === 'Enter') {
    event.preventDefault();
    el('search-courses').click();
  }
});
let searchToken = 0;
el('course-filter').addEventListener('input', async () => {
  if (!sandbox) return;
  const token = ++searchToken;
  candidate = null;
  catalog = [];
  renderCatalog(catalogHint);
  el('add-course').disabled = true;
  display();
  const query = el('course-filter').value.trim();
  if (query.length < 2) return renderCatalog(catalogHint);
  const {results, fallback} = await message('CATALOG', {query});
  if (token !== searchToken) return;
  catalog = results;
  renderCatalog();
  if (fallback) status('Could not load Spring 2027 classes; showing sample classes only.');
});
el('close-course-browser').addEventListener('click', () => {
  candidate = null;
  el('course-browser').hidden = true;
  display();
});
const parseCodes = text => [...new Set(text.split(/[\n,]+/).map(code => code.trim().toUpperCase()).filter(Boolean))];
function loadWishlist() {
  try { return JSON.parse(localStorage.getItem('registration-wishlist')) || []; } catch { return []; }
}
async function refreshWishlist() {
  const codes = loadWishlist();
  wishRows = codes.length ? (await message('CATALOG', {codes})).results : [];
  renderCatalog(catalogHint);
}
el('wish-paste').addEventListener('input', async () => {
  const codes = parseCodes(el('wish-paste').value).filter(code => /^[A-Z]{2,5} \d{5}$/.test(code));
  try { localStorage.setItem('registration-wishlist', JSON.stringify(codes)); } catch {}
  if (sandbox) await refreshWishlist();
});
el('wish-use').addEventListener('click', () => {
  el('builder-codes').value = loadWishlist().join('\n');
  el('builder').open = true;
  el('builder-codes').focus();
});
el('build-schedules').addEventListener('click', () => run(async () => {
  const [hours, mins] = el('earliest').value.split(':').map(Number);
  const result = await message('BUILD', {codes:parseCodes(el('builder-codes').value),
    prefs:{earliest:hours * 60 + mins, order:[...new Set([el('first').value, el('second').value, ...criteria])]}});
  if (result.error) throw Error(result.error);
  await read();
  status(state.groups.length + ' conflict-free schedules built. ' + result.notes.join(' '));
}));
el('add-course').addEventListener('click', () => run(async () => {
  if (!sandbox || !candidate) return;
  await addCourse(candidate.course);
}));
el('close-options').addEventListener('click', () => run(async () => {
  const result = await message('CLOSE');
  if (result.error) throw Error(result.error);
  await read();
}));
el('apply').addEventListener('click', () => run(async () => {
  const selected = ranked.find(item => item.number === previewNumber);
  if (!selected?.canApply) return;
  const signature = JSON.stringify(state);
  clearAlternatives();
  const result = await message('APPLY', {number:selected.number, signature});
  if (result.error) { try { await read(); } catch {} throw Error(result.error); } // read() restores the options cleared above
  const expected = selected.sections.map(section => section.id).sort().join(',');
  for (let attempt = 0; attempt < 16; attempt++) {
    const latest = await message('READ');
    if (!latest.groups.length && latest.current.map(section => section.id).sort().join(',') === expected) {
      await read();
      status(sandbox ? 'Selected option applied to the sandbox schedule.' :
        'Verified the selected option in your UniTime draft. Review it there before submitting.');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  status('Could not verify the draft update. Check UniTime before applying another option.');
}));
el('refresh').click();
