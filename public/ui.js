export const $ = selector => document.querySelector(selector);
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function readStorage(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
export function saveStorage(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } }
let toastTimer;
export function showToast(message, action) {
  const box = $('#toast'); box.textContent = message; box.hidden = false; clearTimeout(toastTimer);
  if (action) {
    const button = document.createElement('button'); button.textContent = action.label;
    button.onclick = () => { clearTimeout(toastTimer); box.hidden = true; action.action(); };
    box.append(button);
  }
  const dismiss = () => { if (box.matches(':hover') || box.contains(document.activeElement)) { toastTimer=setTimeout(dismiss,1000); return; } box.hidden=true; };
  toastTimer = setTimeout(dismiss, action ? 8000 : 4200);
}
export async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || '请求失败，请重试'); error.status = response.status; throw error; }
  return result;
}
export function external(site, content = escapeHTML(site.name)) { return `<a href="${escapeHTML(site.url)}" target="_blank" rel="noopener noreferrer">${content}</a>`; }
export function startClock() { const tick = () => { for (const el of document.querySelectorAll('[data-clock]')) el.textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }; tick(); setInterval(tick, 30000); }

// Re-rendered controls keep their keyboard position instead of falling back to <body>.
export function preserveFocus(root = document) {
  const active = document.activeElement;
  if (!active || !root.contains(active)) return () => {};
  const keys = ['data-favorite', 'data-view', 'data-select', 'data-action', 'data-section', 'data-toggle-category'];
  let selector = active.id ? `#${CSS.escape(active.id)}` : '';
  if (!selector) {
    const key = keys.find(name => active.hasAttribute(name));
    if (key) selector = `[${key}="${CSS.escape(active.getAttribute(key))}"]`;
    if (selector && active.hasAttribute('data-id')) selector += `[data-id="${CSS.escape(active.getAttribute('data-id'))}"]`;
  }
  return (fallback) => {
    if (active.isConnected) return;
    const next = selector && root.querySelector(selector);
    if (next && !next.disabled) next.focus({ preventScroll: true });
    else fallback?.focus({ preventScroll: true });
  };
}
