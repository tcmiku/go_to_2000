const win = document.querySelector('.browser-window');
const task = document.querySelector('#browser-task') || document.querySelector('.taskbar .task');
if (win) {
  if (task) { task.id = 'browser-task'; task.removeAttribute('href'); task.setAttribute('role', 'button'); }
  const desktop = document.createElement('div');
  desktop.className = 'desktop-surface';
  desktop.innerHTML = '<div class="desktop-icon"><img src="/assets/icons/my-computer.svg" width="32" height="32" alt=""><span>我的电脑</span></div><div class="desktop-icon"><img src="/assets/icons/recycle-bin.svg" width="32" height="32" alt=""><span>回收站</span></div>';
  document.body.prepend(desktop);
  const glyphs = win.querySelector('.window-glyphs');
  const oldButtons = [...(glyphs?.querySelectorAll('span') || [])];
  ['最小化', '最大化', '关闭'].forEach((label, index) => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = oldButtons[index]?.textContent || '';
    button.setAttribute('aria-label', label);
    button.dataset.windowAction = ['minimize', 'maximize', 'close'][index];
    oldButtons[index]?.replaceWith(button);
  });
  const show = visible => { win.hidden = !visible; desktop.hidden = visible; task?.classList.toggle('active', visible); };
  desktop.hidden = true;
  glyphs?.addEventListener('click', event => {
    const action = event.target.closest('[data-window-action]')?.dataset.windowAction;
    if (action === 'minimize' || action === 'close') show(false);
    if (action === 'maximize') win.classList.toggle('window-maximized');
  });
  task?.addEventListener('click', () => show(true));
}
