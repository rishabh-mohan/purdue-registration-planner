(() => {
  const api = globalThis.browser ?? chrome;
  api.runtime.onMessage.addListener((message, sender) => {
    if (message?.type !== 'PURDUE_REG_LAUNCH' || !sender.url || !sender.tab) return;
    const url = new URL(sender.url);
    if (url.origin !== 'https://timetable.mypurdue.purdue.edu' ||
        !/^\/Timetabling\/sectioning\/?$/i.test(url.pathname)) return;
    api.tabs.create({url:api.runtime.getURL('registration.html'), windowId:sender.tab.windowId});
  });
})();
