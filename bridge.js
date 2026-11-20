(() => {
  const coursePattern = /\b([A-Z][A-Z0-9&]{1,7}?)\s*(\d{5}[A-Z]{0,3})\b/i;
  const finderSelector = "[role='dialog'], .gwt-DialogBox, .unitime-Dialog, .unitime-CourseFinder";
  const requestLabel = /^(?:(\d+)\.\s*)?(priority|alternat(?:ive|e)|substitute|alt)\b/i;
  const remembered = new Map();
  let pending = null;

  const clean = (value) => value.replace(/\s+/g, " ").trim();
  const text = (element) => clean(element?.innerText ?? element?.textContent ?? "");
  const visible = (element) => Boolean(element?.getClientRects().length) &&
    getComputedStyle(element).visibility !== "hidden";

  function courseFrom(value) {
    const match = coursePattern.exec(value);
    if (!match) return null;
    return {
      code: (match[1] + " " + match[2]).toUpperCase(),
      title: clean(value.slice(match.index + match[0].length).replace(/^\s*[:–-]\s*/, "")),
    };
  }

  function readRequests() {
    const courses = new Map();
    const fields = document.querySelectorAll("input:not([type]), input[type='text'], input[type='search'], [role='combobox'][contenteditable]");
    for (const field of fields) {
      if (!visible(field) || field.closest(finderSelector)) continue;
      const course = courseFrom(field.value ?? text(field));
      if (!course) continue;
      const label = requestLabel.exec(field.getAttribute("aria-label") || field.title || "") ??
        requestLabel.exec(text(field.closest("tr, [role='row']")));
      if (!label) continue;
      const kind = label[2].toLowerCase();
      const group = kind === "priority" ? "primary" : "alternate";
      const priority = kind === "substitute" ? null : label[1] || null;
      if (!courses.has(course.code) || group === "primary") {
        courses.set(course.code, { ...course, group, priority });
      }
    }
    return [...courses.values()];
  }

  function readDays(value) {
    const longNames = value.match(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/gi);
    if (longNames) return [...new Set(longNames.map(day => day[0].toUpperCase() + day.slice(1).toLowerCase()))];
    const compact = value.toUpperCase().replace(/[\s,/-]/g, "");
    if (!/^(?:TH|SA|SU|[MTWRFSU])+$/.test(compact)) return [];
    const days = { M:"Mon", T:"Tue", W:"Wed", R:"Thu", TH:"Thu", F:"Fri", S:"Sat", SA:"Sat", U:"Sun", SU:"Sun" };
    return [...new Set(compact.match(/TH|SA|SU|[MTWRFSU]/g).map(day => days[day]))];
  }

  function readTime(value) {
    const match = /^(\d{1,2}):(\d{2})\s*(a(?:m)?|p(?:m)?)?$/i.exec(value);
    if (!match) return "";
    let hours = Number(match[1]);
    if (hours > 23 || Number(match[2]) > 59) return "";
    const meridiem = match[3]?.toLowerCase();
    if (meridiem) {
      if (hours < 1 || hours > 12) return "";
      hours = hours % 12 + (meridiem.startsWith("p") ? 12 : 0);
    }
    return String(hours).padStart(2, "0") + ":" + match[2];
  }

  function finderCourse(dialog) {
    const selected = dialog.querySelector("[aria-selected='true'], tr.selected, .unitime-SelectedRow");
    const selectedCourse = courseFrom(text(selected));
    if (selectedCourse) return selectedCourse;
    for (const field of dialog.querySelectorAll("input:not([type]), input[type='text'], input[type='search']")) {
      const value = clean(field.value);
      const course = courseFrom(value);
      if (course && visible(field)) return course;
    }
    return courseFrom(text(dialog));
  }

  function readFinder() {
    for (const dialog of document.querySelectorAll(finderSelector)) {
      if (!visible(dialog)) continue;
      for (const table of dialog.querySelectorAll("table")) {
        if (!visible(table)) continue;
        const rows = [...table.rows];
        const header = rows.find((row) => {
          const labels = [...row.cells].map(cell => text(cell).toLowerCase());
          return labels.includes("days") && labels.includes("start") && labels.includes("end") &&
            (labels.includes("id") || labels.includes("section"));
        });
        if (!header) continue;
        const course = finderCourse(dialog);
        if (!course) continue;
        const headings = [...header.cells].map(cell => text(cell).toLowerCase());
        const sections = [];
        let type = "";
        for (const row of rows.slice(rows.indexOf(header) + 1)) {
          const cell = (name) => text(row.cells[headings.indexOf(name)]);
          type = cell("type") || type;
          const checkbox = row.cells[0]?.querySelector("input[type='checkbox']:checked, [role='checkbox'][aria-checked='true']");
          if (!checkbox || !visible(row)) continue;
          const id = cell("id") || cell("section");
          const section = clean(type + " " + id);
          const days = readDays(cell("days"));
          const start = readTime(cell("start"));
          const end = readTime(cell("end"));
          if (!id || !days.length || !start || !end || start >= end) continue;
          sections.push({ courseCode: course.code, section, days, start, end, location: cell("room") });
        }
        return { dialog, course, sections };
      }
    }
    return null;
  }

  function readPage() {
    const heading = document.querySelector("h1, .unitime-PageTitle, #UniTimeGWT:has(button)");
    const detected = /course\s*requests?/i.test(document.title + " " + location.search + " " + text(heading).slice(0, 150)) ||
      [...document.querySelectorAll("button, input[type='button'], input[type='submit']")]
        .some(button => visible(button) && /^submit requests$/i.test(text(button) || button.value));
    if (!detected) {
      remembered.clear();
      pending = null;
      return { detected: false, courses: [], preferredSections: [] };
    }

    const courses = readRequests();
    const requestCodes = new Set(courses.map(course => course.code));
    const finder = readFinder();
    for (const code of remembered.keys()) {
      if (!requestCodes.has(code) && pending?.course.code !== code) remembered.delete(code);
    }
    if (pending && requestCodes.has(pending.course.code)) {
      remembered.set(pending.course.code, pending.sections);
      pending = null;
    }

    const preferred = new Map(remembered);
    if (finder) {
      preferred.set(finder.course.code, finder.sections);
      if (!requestCodes.has(finder.course.code) && finder.sections.length) {
        courses.push({ ...finder.course, group: "primary", draft: true });
      }
    }
    return { detected: true, courses, preferredSections: [...preferred.values()].flat() };
  }

  document.addEventListener("click", (event) => {
    const action = event.target.closest("button, [role='button'], input[type='button']");
    if (!action || !/^select$/i.test(text(action) || action.value)) return;
    const finder = readFinder();
    if (finder?.dialog.contains(action)) pending = finder;
  }, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PURDUE_PLANNER_READ") sendResponse(readPage());
  });
})();

