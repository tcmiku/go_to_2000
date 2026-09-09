const win = document.querySelector('.browser-window');
const task = document.querySelector('#browser-task') || document.querySelector('.taskbar .task');
if (win) {
  if (task) { task.id = 'browser-task'; task.removeAttribute('href'); task.setAttribute('role', 'button'); }
  const desktop = document.createElement('div');
  desktop.className = 'desktop-surface';
  desktop.innerHTML = '<div class="desktop-icon"><img src="/assets/icons/my-computer.svg" width="32" height="32" alt=""><span>我的电脑</span></div><div class="desktop-icon"><img src="/assets/icons/recycle-bin.svg" width="32" height="32" alt=""><span>回收站</span></div>';
  document.body.prepend(desktop);
  const cdDrive = document.createElement('button');
  cdDrive.type = 'button';
  cdDrive.className = 'desktop-icon desktop-shortcut';
  cdDrive.id = 'desktop-cd-rom';
  cdDrive.title = '双击打开 CD 收藏墙，或按 Enter';
  cdDrive.setAttribute('aria-label', 'CD-ROM · CD 收藏墙');
  cdDrive.innerHTML = '<img src="/assets/icons/cd-rom.svg" width="32" height="32" alt=""><span>CD-ROM<br>CD 收藏墙</span>';
  desktop.append(cdDrive);
  const openCDWall = () => { window.location.href = '/cd-wall.html'; };
  cdDrive.addEventListener('dblclick', openCDWall);
  cdDrive.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); openCDWall(); }
  });
  const recordPlayer = document.createElement('button');
  recordPlayer.type = 'button';
  recordPlayer.className = 'desktop-icon desktop-shortcut';
  recordPlayer.id = 'desktop-record-player';
  recordPlayer.setAttribute('aria-label', '唱片机');
  recordPlayer.innerHTML = '<img src="/assets/icons/record-player.svg" width="32" height="32" alt=""><span>唱片机</span>';
  desktop.append(recordPlayer);
  const openRecordPlayer = () => { window.location.href = '/listening-room.html'; };
  recordPlayer.addEventListener('dblclick', openRecordPlayer);
  recordPlayer.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); openRecordPlayer(); }
  });
  const cassettePlayer = document.createElement('button');
  cassettePlayer.type = 'button';
  cassettePlayer.className = 'desktop-icon desktop-shortcut';
  cassettePlayer.id = 'desktop-cassette-player';
  cassettePlayer.title = '双击打开随身听 · 磁带室，或按 Enter';
  cassettePlayer.setAttribute('aria-label', '随身听 · 磁带室');
  cassettePlayer.innerHTML = '<img src="/assets/favicons/cassette.svg" width="32" height="32" alt=""><span>随身听<br>磁带室</span>';
  desktop.append(cassettePlayer);
  const openCassetteRoom = () => { window.location.href = '/cassette-room.html'; };
  cassettePlayer.addEventListener('dblclick', openCassetteRoom);
  cassettePlayer.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); openCassetteRoom(); }
  });
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
