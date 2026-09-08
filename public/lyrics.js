// Timed text only: no rendering loop, HTML injection, or dependency on playback URLs.
export function parseLRC(value) {
  if (typeof value !== 'string' || value.length > 256000) return [];
  const offset = Number(value.match(/\[offset:\s*([+-]?\d+)\]/i)?.[1] || 0);
  const byTime = new Map();
  for (const line of value.split(/\r?\n/).slice(0, 4000)) {
    const tags = [...line.matchAll(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const text = line.slice(tags.at(-1).index + tags.at(-1)[0].length).trim().slice(0, 500);
    for (const tag of tags) {
      const time = Math.max(0, Number(tag[1]) * 60000 + Number(tag[2]) * 1000 + Number((tag[3] || '0').padEnd(3, '0')) - offset) / 1000;
      const texts = byTime.get(time) || [];
      if (text && !texts.includes(text)) texts.push(text);
      byTime.set(time, texts);
    }
  }
  return [...byTime].sort((a, b) => a[0] - b[0]).map(([time, texts]) => ({ time, text: texts.join('\n') }));
}

export function lyricIndex(lines, time) {
  let low = 0, high = lines.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (lines[middle].time <= time) { found = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return found;
}

export function createLyricsProjection({ audio, root, caption, fetchLyrics = fetch, isHidden = () => document.hidden, reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches }) {
  const previous = root.querySelector('[data-lyric="previous"]');
  const current = root.querySelector('[data-lyric="current"]');
  const next = root.querySelector('[data-lyric="next"]');
  const translation = root.querySelector('[data-lyric="translation"]');
  let track = null, controller = null, lines = [], index = -2, animation = null, requested = false;

  function sync() {
    if (isHidden()) return;
    const active = lyricIndex(lines, audio.currentTime || 0);
    if (active === index) return;
    index = active;
    const line = lines[active];
    const visible = Boolean(line?.text);
    root.hidden = !visible;
    previous.textContent = lines[active - 1]?.text || '';
    current.textContent = line?.text || '';
    next.textContent = lines[active + 1]?.text || '';
    translation.textContent = line?.translation || '';
    root.dataset.long = String((line?.text.length || 0) > 32);
    if (caption) caption.textContent = visible ? `当前歌词：${line.text}${line.translation ? `，${line.translation}` : ''}` : '';
    animation?.cancel(); animation = null;
    if (visible && !audio.paused && !reduced()) {
      animation = current.animate([{ opacity: .3, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 360, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }
  }

  function reset() {
    controller?.abort(); controller = null; track = null; requested = false; lines = []; index = -2;
    animation?.cancel(); animation = null;
    root.hidden = true; root.dataset.state = 'idle';
    for (const node of [previous, current, next, translation, caption]) if (node) node.textContent = '';
  }

  async function load() {
    if (!track || requested || audio.readyState < 1) return;
    requested = true;
    controller = new AbortController(); const request = controller;
    const params = new URLSearchParams({ source: track.source });
    if (track.source === 'wy') params.set('id', String(track.songmid));
    else {
      params.set('src', track.src); params.set('name', track.name); params.set('singer', track.singer || '');
      if (Number.isFinite(audio.duration)) params.set('duration', String(audio.duration));
    }
    root.dataset.state = 'loading';
    try {
      const response = await fetchLyrics(`/api/listening/lyrics?${params}`, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(12000)]) });
      if (!response.ok) throw new Error('歌词暂时不可用');
      const data = await response.json();
      if (request !== controller || request.signal.aborted) return;
      lines = parseLRC(data.lyric);
      const translations = new Map(parseLRC(data.translation).map(line => [line.time, line.text]));
      for (const line of lines) line.translation = translations.get(line.time) || '';
      root.dataset.state = lines.some(line => line.text) ? 'ready' : 'empty';
      index = -2; sync();
    } catch {
      if (request !== controller || request.signal.aborted) return;
      root.dataset.state = 'error'; root.hidden = true;
      if (caption) caption.textContent = '歌词暂时不可用，音乐继续播放';
    }
  }

  function setTrack(value) {
    if (track?.id === value.id) return;
    reset(); track = value; void load();
  }
  audio.addEventListener('loadedmetadata', load);
  audio.addEventListener('timeupdate', sync);
  audio.addEventListener('seeked', sync);
  audio.addEventListener('ended', reset);
  return { setTrack, reset, sync, dispose() {
    reset(); audio.removeEventListener('loadedmetadata', load); audio.removeEventListener('timeupdate', sync);
    audio.removeEventListener('seeked', sync); audio.removeEventListener('ended', reset);
  } };
}
