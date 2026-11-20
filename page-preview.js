(() => {
  if (!/^\/Timetabling\/requests\/?$/i.test(location.pathname)) return;

  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    button { cursor: pointer; font: 600 14px system-ui; padding: 10px 15px; border-radius: 8px;
      background: #17233a; border: 1px solid #cfb991; color: white; }
    #launch { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; }
    dialog { padding: 0; border: 0; max-width: none; max-height: none; width: 100vw;
      height: 100dvh; margin: 0; background: #f5f7fa; }
    header { display: flex; justify-content: flex-end; padding: 8px 16px; background: #111c35; }
    iframe { display: block; width: 100%; height: calc(100% - 56px); border: 0; }
  `;

  const launch = document.createElement('button');
  launch.id = 'launch';
  launch.type = 'button';
  launch.textContent = 'Preview alternate schedules';

  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', 'Alternate schedule preview');
  const header = document.createElement('header');
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = 'Back to Course Requests';
  header.append(close);
  const frame = document.createElement('iframe');
  frame.title = 'Alternate schedule planner';
  dialog.append(header, frame);

  launch.addEventListener('click', () => {
    if (!frame.hasAttribute('src')) frame.src = chrome.runtime.getURL('panel.html');
    dialog.showModal();
  });
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => launch.focus());
  root.append(style, launch, dialog);
  document.body.append(host);
})();
