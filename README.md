# Purdue Course Request Planner

A Chrome side panel for previewing a weekly timetable while you fill out Purdue’s UniTime Course Request Form. The preview shows preferred sections and flags meeting-time overlaps. UniTime uses your preferences when building your schedule, and your assigned sections may differ.

## Install in Chrome

1. Open `chrome://extensions` in Chrome 114 or newer.
2. Turn on **Developer mode** and click **Load unpacked**.
3. Select this repository's folder (the one containing `manifest.json`).
4. Sign in to myPurdue as usual and open **Registration** → **Register for Classes** → **Course Request Form**. Reload the UniTime tab if it was already open when you installed the extension.
5. Open **Purdue Course Request Planner** from Chrome’s Extensions menu. You can pin it for quick access.

## Preview your requests

On the Course Requests page, click **Preview alternate schedules** to open the planner across the tab. Use each **Priority** selector to swap the primary course for one of its alternates on the calendar. **Back to Course Requests** closes the preview and returns to the form with your entries intact. If you already installed the extension, reload it on `chrome://extensions` and refresh the UniTime tab to get the new button.

- Use **Course Finder → List of Classes** and check the sections you prefer. Published meeting times the extension can read appear in the weekly preview. For preferences you selected before opening the planner, reopen **List of Classes** so it can read their times. The form may list multiple preferences for the same course, so treat overlapping preferences as options to compare.
- Use **Show alternates** to include alternative courses in the preview. Add meeting times in the panel for a course or section whose times are unavailable. You can add multiple meetings, such as a lecture and a lab.
- Use UniTime’s **Submit Requests** button to submit your choices. The extension reads the displayed form and keeps your manually entered meetings in the browser. It sends no requests to Purdue or any other service.

The live adapter depends on the rendered UniTime interface and published section times. [Purdue's Course Request Form instructions](https://www.purdue.edu/registrar/records/registration/) and the [UniTime Purdue manual](https://help.unitime.org/manuals/course-requests-purdue) describe the official workflow.

## Open registration

Reload the extension and refresh the signed-in **Student Scheduling Assistant**. Click **Open registration planner** in the lower-right corner. It opens a separate extension tab in the same browser, so UniTime can stay open next to it. Check the term in UniTime before loading alternatives.

Choose an assigned component and load its alternatives. Enter an instructor and a preferred earliest start, then set which criterion ranks first and second. The planner compares the suggestions UniTime returns for that component, including linked changes to other classes. It ranks conflict-free options and uses fewer class days, shorter gaps, and fewer building changes as available criteria. Building changes are a proxy for proximity, with no walking-distance estimate.

**Remove CS …** (under the section picker) drops the selected course from your UniTime draft after a confirmation, using UniTime's own Drop button; in the sandbox it removes the course and Undo brings it back. **Apply selected to UniTime draft** applies the eligible alternative you are previewing. Review the resulting draft and use UniTime to submit. Seat availability is determined by UniTime. To optimize another component, load its alternatives after reviewing the previous draft change.

## Offline sandbox

From the registration planner, click **Open sandbox** to practice on a synthetic timetable. Load alternatives, compare warnings and seat counts, and apply a selection to the sandbox schedule. Use **Undo sandbox change** or **Reset sandbox** to try another path. Changes are held in memory for that tab.

To run without the extension, serve this folder with any local static file server and open `registration.html?sandbox=1`. Sandbox mode uses bundled data and does not connect to UniTime or require a sign-in.

## Course data

The sandbox reads real Spring 2027 sections from `course-pack/courses.json`, a compact deck that `scrape-courses.mjs` writes. If that file is missing, it falls back to a small synthetic catalog.

Run `node scrape-courses.mjs [termCode]` to download Purdue's public course data from Purdue.io into `data/` (not committed): `purdue-catalog.json` (every catalog course with title, credits and description) and `purdue-sections-<term>.json` (every section for the term in the planner's section format, with all meetings). Seat counts are not published there, so `openSeats` is `null`. UniTime publishes no terms to signed-out users, so it cannot be scraped without a sign-in.

## Firefox


Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `firefox/manifest.json`. Reload the signed-in Scheduling Assistant, then click **Open registration planner**. The temporary add-on is removed when Firefox restarts. To rebuild after a source change, run `node build-firefox.mjs` and reload the add-on and UniTime tab.

## Packaging

Run `node package.mjs` to rebuild `firefox/` and write `dist/purdue-registration-planner-<version>.xpi`. Release Firefox only installs signed add-ons permanently; unsigned packages load through `about:debugging` (until restart) or permanently in Firefox Developer Edition or Nightly with `xpinstall.signatures.required` set to `false` in `about:config`.

## Test commands

Run `node --test planner.test.mjs registration-model.test.mjs registration-sandbox.test.mjs scrape-courses.test.mjs` from this folder with Node.js 22 or newer.
