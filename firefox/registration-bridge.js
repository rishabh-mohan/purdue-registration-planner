(() => {
  if (!/\/Timetabling\/sectioning\/?$/i.test(location.pathname)) return;
  const api = globalThis.browser ?? chrome;
  const txt = node => (node?.innerText || '').trim();
  const visible = node => node.getClientRects().length > 0;
  const signature = rows => JSON.stringify(rows);
  let catalogFinder;
  let pendingCourse;
  function findTable(required, scope = document) {
    for (const table of scope.querySelectorAll('table')) {
      if (!visible(table)) continue;
      for (const row of table.rows) {
        const keys = [...row.cells].map(cell => (cell.getAttribute('aria-label') || txt(cell)).trim().toLowerCase());
        if (!required.every(key => keys.includes(key))) continue;
        return {table, row, keys};
      }
    }
    return null;
  }
  function finderInput(dialog) {
    return dialog.querySelector('input[aria-label^="Course Finder Filter" i]') ||
      [...dialog.querySelectorAll('input[type="text"]')].find(visible);
  }
  function catalogRows() {
    if (!catalogFinder || !visible(catalogFinder)) return [];
    return readTable(findTable(['subject','course','title'], catalogFinder)).flatMap(row => {
      const course = [row.get('subject'), row.get('course')].join(' ');
      return /^[A-Z][A-Z0-9&]+ \d{5}[A-Z]*$/i.test(course)
        ? [{course, title:row.get('title'), row:row.element}] : [];
    });
  }
  function readTable(header) {
    if (!header) return [];
    const {table, row, keys} = header;
    return [...table.rows].slice(row.rowIndex + 1).filter(visible).map(element => ({
      element,
      get: key => txt(element.cells[keys.indexOf(key)]),
    }));
  }
  function alternativesTable() {
    return findTable(['current time','new time','crn-sectionid','instructor']);
  }
  function suggestionsDialog() {
    return [...document.querySelectorAll('.unitime-SuggestionsBox')].find(visible);
  }
  function serviceIssue() {
    const notices = [txt(document.body)];
    for (const frame of document.querySelectorAll('iframe')) {
      if (!visible(frame)) continue;
      try { notices.push(txt(frame.contentDocument?.body)); } catch { /* Cross-origin frame. */ }
    }
    if (notices.some(notice => /access denied for scheduling assistant\s*:\s*user is not authenticated/i.test(notice))) {
      return 'UniTime sign-in required. Sign in again in the UniTime tab, then refresh the planner.';
    }
    if (notices.some(notice => /503\s+(?:service\s+)?unavailable|system down notice|the application you requested is currently unavailable|(?:system|application) is (?:currently )?down for maintenance/i.test(notice))) {
      return 'UniTime reports a service outage or maintenance. Try again when service returns.';
    }
    if (notices.some(notice => /(?:502\s+bad gateway|504\s+gateway timeout|500\s+internal server error)/i.test(notice))) {
      return 'UniTime returned a server error. Try loading alternatives again in a moment.';
    }
    return null;
  }
  async function waitForAlternativesToClose() {
    for (let attempt = 0; attempt < 10; attempt++) {
      if (!suggestionsDialog() && !alternativesTable()) return true;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return !suggestionsDialog() && !alternativesTable();
  }
  async function closeAlternatives() {
    const open = alternativesTable();
    const dialog = suggestionsDialog() || open?.table.closest('.unitime-SuggestionsBox');
    if (!open && !dialog) return true;
    const search = dialog?.querySelector('input.gwt-SuggestBox');
    if (search) {
      search.focus({preventScroll:true});
      const options = {key:'Escape', code:'Escape', keyCode:27, which:27,
        bubbles:true, cancelable:true};
      search.dispatchEvent(new KeyboardEvent('keydown', options));
      if (suggestionsDialog() || alternativesTable()) search.dispatchEvent(new KeyboardEvent('keyup', options));
      if (await waitForAlternativesToClose()) return true;
    }
    const glass = [...document.querySelectorAll('.gwt-PopupPanelGlass')].filter(visible).at(-1);
    if (!dialog || !glass) return false;
    glass.click();
    return waitForAlternativesToClose();
  }
  function section(row, course, suggestions) {
    const get = row.get;
    const id = get('crn-sectionid');
    if (!/^\d{5}-[\w-]+$/.test(id)) return null;
    const time = get('new time').replace(/^\s*(?:→|➔)\s*/, '') || get('current time');
    const match = /^(.+?)\s+(\d{1,2}:\d\d\s*[ap](?:\.?m\.?)?)\s*[-–—]\s*(\d{1,2}:\d\d\s*[ap](?:\.?m\.?)?)$/i.exec(time);
    const dayText = suggestions ? match?.[1] || '' : get('days');
    const async = /arrang(?:e|ed) hours|async(?:hronous)?\s+online/i.test(
      [time, dayText, get('room'), get('new room'), get('current room')].join(' '));
    const names = {mon:'M',tue:'T',wed:'W',thu:'R',fri:'F',sat:'S',sun:'U'};
    const days = dayText.replace(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/gi,
      (_, day) => names[day.toLowerCase()]).replace(/[\s,/]+/g, '').toUpperCase();
    const start = suggestions ? match?.[2] || '' : get('start');
    const end = suggestions ? match?.[3] || '' : get('end');
    const availability = get('available') || get('avail') || get('open seats') || get('seats available');
    const count = /^(\d+)(?:\s*\/\s*\d+)?$/.exec(availability);
    const seatLabel = [...row.element.querySelectorAll('[aria-label], [title]')].map(element =>
      [element.getAttribute('aria-label'), element.getAttribute('title')].join(' ')).join(' ');
    const labeledCount = /\bavailable\s*[: ]\s*(\d+)\s*\/\s*\d+|\b(\d+)\s+(?:open|available) seats?\b/i.exec(seatLabel);
    const openSeats = count ? Number(count[1]) : labeledCount ? Number(labeledCount[1] || labeledCount[2]) : null;
    return { id, course, type: get('type'), days, start, end, async, openSeats,
      room: (get('new room') || get('current room') || get('room')).replace(/^\s*(?:→|➔)\s*/, ''),
      instructor: get('instructor').replace(/\s+/g, ' ') };
  }
  function snapshot() {
    let course = '';
    const current = readTable(findTable(['lock','subject','course','crn-sectionid','start','end'])).flatMap(row => {
      if (row.get('subject') && row.get('course')) course = row.get('subject') + ' ' + row.get('course');
      const value = section(row, course, false);
      return value && course ? [{...row, value}] : [];
    });
    const groups = [];
    course = '';
    for (const row of readTable(alternativesTable())) {
      const number = /^(\d+)\.$/.exec(txt(row.element.cells[0]));
      if (number) {
        groups.push({number: +number[1], element: row.element, changes: [], dropped: [], notes: [], unsafe: false});
        course = '';
      }
      const group = groups.at(-1);
      if (!group) continue;
      const code = [row.get('subject'), row.get('course')].filter(Boolean).join(' ');
      if (code) course = code;
      const value = section(row, course, true);
      const description = [txt(row.element), ...[...row.element.cells].map(cell => cell.getAttribute('aria-label') || '')].join(' ');
      if (/will be (?:dropped|removed)|\b(?:unassigned|unassignment|dropped|removed from)\b/i.test(description)) {
        group.dropped.push({course:course || 'Unidentified class', type:row.get('type'), id:value?.id || ''});
        group.unsafe = true;
      } else if (value && course) {
        value.openSeats ??= current.find(item => item.value.id === value.id)?.value.openSeats ?? null;
        group.changes.push(value);
      } else {
        group.notes.push(txt(row.element).replace(/\s+/g, ' ').slice(0, 240) || 'Unidentified schedule change');
        group.unsafe = true;
      }
    }
    return {current, groups};
  }
  function publicState({current, groups}) {
    return {issue:serviceIssue(), current: current.map(row => row.value),
      groups: groups.map(({number, changes, dropped, notes, unsafe}) => ({number, changes, dropped, notes, unsafe,
        addCourse: pendingCourse && !current.some(item => item.value.course === pendingCourse) &&
          changes.some(section => section.course === pendingCourse) ? pendingCourse : null}))};
  }
  api.runtime.onMessage.addListener((message, sender, reply) => {
    if (!message?.type?.startsWith('PURDUE_REG_') ||
        sender.url !== api.runtime.getURL('registration.html')) return;
    const state = snapshot();
    const data = publicState(state);
    if (message.type === 'PURDUE_REG_READ') return reply(data);
    if (message.type === 'PURDUE_REG_SEARCH_COURSES') {
      if (data.issue) return reply({error:data.issue});
      const query = String(message.query || '').trim().slice(0, 80);
      if (query.length < 2) return reply({results:[]});
      (async () => {
        if (!catalogFinder || !visible(catalogFinder)) {
          const closed = await closeAlternatives();
        const button = [...document.querySelectorAll('button')].find(element =>
          visible(element) && !element.disabled &&
          /^new course$/i.test(element.getAttribute('aria-label') || txt(element).replace(/\s+/g, ' ')));
        if (!closed || !button) return reply({error:'New Course is unavailable in the Scheduling Assistant.'});
        pendingCourse = null;
        button.click();
          catalogFinder = [...document.querySelectorAll('.gwt-DialogBox, [role="dialog"], .unitime-CourseFinder')]
            .find(dialog => visible(dialog) && !dialog.matches('.unitime-SuggestionsBox') && finderInput(dialog));
        }
        const input = catalogFinder && finderInput(catalogFinder);
        if (!input) return reply({error:'Could not locate the UniTime Course Finder.'});
        input.value = query;
        input.dispatchEvent(new Event('input', {bubbles:true}));
        input.dispatchEvent(new KeyboardEvent('keyup', {key:query.at(-1), bubbles:true}));
        await new Promise(resolve => setTimeout(resolve, 800));
        if (serviceIssue()) return reply({error:serviceIssue()});
        const words = query.toLowerCase().split(/\s+/);
        const results = catalogRows().filter(item => {
          const haystack = (item.course + ' ' + item.title).toLowerCase();
          return words.every(word => haystack.includes(word)) ||
            item.course.replace(/\s+/g,'').toLowerCase().includes(words.join(''));
        }).slice(0, 30).map(({course,title}) => ({course,title}));
        reply({results});
      })().catch(error => reply({error:error.message}));
      return true;
    }
    if (message.type === 'PURDUE_REG_PREVIEW_COURSE') {
      if (data.issue) return reply({error:data.issue});
      const matches = catalogRows().filter(item => item.course === message.course);
      if (matches.length !== 1 || data.current.some(section => section.course === message.course)) {
        return reply({error:'That course is already in the schedule or the search result changed.'});
      }
      pendingCourse = message.course;
      matches[0].row.cells[1]?.dispatchEvent(new MouseEvent('dblclick', {bubbles:true, cancelable:true}));
      return reply({ok:true});
    }
    if (message.type === 'PURDUE_REG_INCLUDE_CONFLICTS') {
      const dialog = suggestionsDialog();
      const label = [...(dialog?.querySelectorAll('label') || [])].find(label =>
        /^include conflicting suggestions$/i.test(txt(label)));
      const checkbox = label?.control || dialog?.querySelector('input[type="checkbox"][aria-label="Include conflicting suggestions" i]');
      if (!data.issue && checkbox && !checkbox.checked && !checkbox.disabled) {
        checkbox.click();
        return reply({changed:checkbox.checked});
      }
      return reply({changed:false});
    }
    if (message.type === 'PURDUE_REG_OPEN' || message.type === 'PURDUE_REG_CLOSE') {
      closeAlternatives().then(closed => {
        if (!closed) return reply({error:'UniTime’s alternatives dialog stayed open.'});
        if (message.type === 'PURDUE_REG_CLOSE') return reply({ok:true});
        pendingCourse = null;
        const row = snapshot().current.find(item => item.value.id === message.id);
        if (!row) return reply({error:'That section is no longer in the current schedule. Refresh the planner.'});
        row.element.cells[4]?.click();
        reply({ok:true});
      }).catch(error => reply({error:error.message}));
      return true;
    }
    if (message.type === 'PURDUE_REG_DROP') {
      if (data.issue) return reply({error:data.issue});
      const course = String(message.course || '');
      // UniTime labels it "Drop CS 18000BLK"; allow a letter suffix after the code the table shows
      const pattern = new RegExp('^drop ' + course.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[a-z]*$', 'i');
      const dropButtons = () => [...document.querySelectorAll('button')].filter(button => visible(button) &&
        !button.disabled && pattern.test((button.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()));
      (async () => {
        let buttons = dropButtons();
        if (!buttons.length) {
          const row = state.current.find(item => item.value.id === message.id && item.value.course === course);
          if (!row) return reply({error:'That class is no longer in the current schedule. Refresh the planner.'});
          if (!await closeAlternatives()) return reply({error:'UniTime’s alternatives dialog stayed open.'});
          row.element.cells[4]?.click();
          for (let attempt = 0; attempt < 20 && !(buttons = dropButtons()).length; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }
        if (buttons.length !== 1) return reply({error:'Could not find UniTime’s Drop button for ' + course + '. Drop it in UniTime instead.'});
        buttons[0].click();
        reply({ok:true});
      })().catch(error => reply({error:error.message}));
      return true;
    }
    if (message.type === 'PURDUE_REG_APPLY') {
      if (data.issue) return reply({error:data.issue});
      const group = state.groups.find(item => item.number === message.number);
      if (!group || group.unsafe || signature(data) !== message.signature) {
        return reply({error:'UniTime options changed. Refresh and rank them again.'});
      }
      group.element.cells[0]?.click();
      return reply({ok:true});
    }
  });
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Open registration planner';
  Object.assign(button.style, {position:'fixed', right:'20px', bottom:'20px', zIndex:'1000',
    padding:'10px 14px', background:'#17233a', color:'white', border:'1px solid #cfb991',
    borderRadius:'8px', cursor:'pointer'});
  button.addEventListener('click', () => api.runtime.sendMessage({type:'PURDUE_REG_LAUNCH'}));
  document.body.append(button);
})();
