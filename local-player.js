function localAnimateSelection(direction) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || document.hidden) return;
  const cover = document.getElementById('albumArt');
  const heading = document.querySelector('.desktop-heading');
  const options = { duration: 300, easing: 'cubic-bezier(.2,.75,.24,1)' };
  cover.animate([
    { transform: `translateX(${direction * 28}px)`, opacity: .55 },
    { transform: 'translateX(0)', opacity: 1 },
  ], options);
  heading.animate([
    { transform: `translateX(${direction * 12}px)`, opacity: .6 },
    { transform: 'translateX(0)', opacity: 1 },
  ], options);
}

(() => {
  const shell = document.getElementById('player');
  const cover = document.getElementById('albumArt');
  const info = shell.querySelector('.record-info');
  const note = document.getElementById('albumDescription');
  const noteLabel = info.querySelector('.desktop-note-label');
  const controls = info.querySelector('.controls');
  const play = document.getElementById('playBtn');
  const share = document.getElementById('shareCardOpen');
  const progress = document.getElementById('progress');
  const modes = info.querySelector('.mode-bar');
  const copy = (zh, en) => window.WEATHER_RECORD_LOCALE.english ? en : zh;

  document.documentElement.classList.add('local-player');
  progress.setAttribute('aria-label', copy('播放进度', 'Playback position'));
  document.getElementById('playIcon').setAttribute('aria-hidden', 'true');
  const previous = controls.querySelector('.desktop-previous');
  const next = controls.querySelector('.desktop-next');
  previous.remove();
  next.remove();
  document.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select, [role="slider"], [role="textbox"], [role="combobox"]'))) return;
    if (document.querySelector('dialog[open], [role="dialog"][aria-hidden="false"], .workout-overlay:not([hidden])')) return;
    const action = event.key === 'ArrowLeft' ? previous : next;
    if (action.disabled) return;
    event.preventDefault();
    if (!event.repeat) action.click();
  });
  const playText = document.getElementById('playText');
  function syncPlayLabel() {
    play.setAttribute('aria-label', playText.textContent.trim());
  }
  new MutationObserver(syncPlayLabel).observe(playText, { childList: true, characterData: true, subtree: true });
  syncPlayLabel();

  const transport = document.createElement('div');
  transport.className = 'local-transport';
  controls.before(transport);
  transport.append(modes, info.querySelector('.player-extras'), controls);
  transport.after(share);

  const details = document.createElement('div');
  details.className = 'local-note';
  transport.after(details);
  details.append(noteLabel, note);
  noteLabel.textContent = copy('为什么推荐', 'Why this pick');
  note.setAttribute('aria-label', copy('查看完整推荐理由', 'Read the full recommendation'));
  note.setAttribute('aria-haspopup', 'dialog');
  note.setAttribute('aria-controls', 'descriptionModal');

  const menu = shell.querySelector('.workout-menu-button');
  menu.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M5 7h14M5 12h14M5 17h14"/></svg>';

  cover.querySelector('.desktop-lyrics-hint')?.remove();
  function syncLyrics() {
    const open = cover.classList.contains('lyrics-open');
    cover.setAttribute('aria-pressed', String(open));
  }
  new MutationObserver(syncLyrics).observe(cover, {attributes: true, attributeFilter: ['class']});
  syncLyrics();

  function syncModes() {
    for (const button of modes.querySelectorAll('.mode-btn')) {
      button.setAttribute('aria-pressed', String(button.classList.contains('active')));
    }
  }
  new MutationObserver(syncModes).observe(modes, {subtree: true, attributes: true, attributeFilter: ['class']});
  syncModes();

  const noteDialog = document.getElementById('descriptionModal');
  let noteWasOpen = false;
  new MutationObserver(() => {
    const open = noteDialog.getAttribute('aria-hidden') === 'false';
    if (noteWasOpen && !open) {
      requestAnimationFrame(() => {
        if (!document.querySelector('.workout-overlay:not([hidden]), .rating-modal.open, .share-dialog[open]')) {
          note.focus({preventScroll: true});
        }
      });
    }
    noteWasOpen = open;
  }).observe(noteDialog, {attributes: true, attributeFilter: ['aria-hidden']});
})();
