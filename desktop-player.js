(() => {
  if (window.WEATHER_RECORD_HOST !== 'windows' && window.WEATHER_RECORD_HOST !== 'astudio') return;

  const root = document.documentElement;
  root.classList.add('desktop-player');
  root.dataset.type = 'software';
  const english = window.WEATHER_RECORD_LOCALE.english;
  const label = (zh, en) => english ? en : zh;
  const appName = label('气象唱片', 'Weather Record');
  const intro = label('按天气与时间选一张唱片。', 'Find an album for the weather and the hour.');
  const description = document.createElement('meta');
  description.name = 'description';
  description.content = intro;
  document.head.append(description);
  for (const name of ['page-type', 'site-kind']) {
    const meta = document.createElement('meta');
    meta.name = name;
    meta.content = 'software';
    document.head.append(meta);
  }
  for (const [property, content] of [['og:title', appName], ['og:description', intro], ['og:image', 'icon.svg']]) {
    const meta = document.createElement('meta');
    meta.setAttribute('property', property);
    meta.content = content;
    document.head.append(meta);
  }
  const styles = document.createElement('link');
  styles.rel = 'stylesheet';
  styles.href = 'desktop-player.css';
  document.head.append(styles);

  const shell = document.querySelector('.shell');
  const header = shell.querySelector('.topbar');
  const cover = document.getElementById('albumArt');
  const info = shell.querySelector('.record-info');
  shell.id = 'player';
  shell.tabIndex = -1;
  const skip = document.createElement('a');
  skip.className = 'desktop-skip';
  skip.href = '#player';
  skip.textContent = label('跳到播放器', 'Skip to player');
  shell.before(skip);

  const brand = document.createElement('div');
  brand.className = 'desktop-brand';
  brand.innerHTML = '<img src="icon.svg" width="30" height="30" alt=""><span></span>';
  brand.lastElementChild.textContent = appName;
  header.prepend(brand);
  cover.setAttribute('role', 'button');
  const lyricsHint = document.createElement('span');
  lyricsHint.className = 'desktop-lyrics-hint';
  lyricsHint.setAttribute('aria-hidden', 'true');
  lyricsHint.textContent = label('歌词', 'Lyrics');
  cover.append(lyricsHint);

  const heading = document.createElement('div');
  heading.className = 'desktop-heading';
  heading.setAttribute('aria-live', 'polite');
  heading.innerHTML = '<p class="desktop-status"></p><h1></h1><p class="desktop-artist"></p><p class="desktop-album"></p>';
  info.prepend(heading);
  info.prepend(document.getElementById('webSpotifyStatus'));
  const [status, title, artist, albumName] = heading.children;
  const note = document.getElementById('albumDescription');
  const noteLabel = document.createElement('span');
  noteLabel.className = 'desktop-note-label';
  noteLabel.textContent = label('简介', 'Album note');
  note.before(noteLabel);
  document.querySelector('.result-section').setAttribute('aria-labelledby', 'desktop-title');
  title.id = 'desktop-title';

  const controls = info.querySelector('.controls');
  const play = document.getElementById('playBtn');
  function navigationButton(className, name, path) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'desktop-skip-track ' + className;
    button.title = name;
    button.setAttribute('aria-label', name);
    button.disabled = true;
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + path + '"/></svg>';
    return button;
  }
  const previous = navigationButton('desktop-previous', label('上一条推荐', 'Previous recommendation'), 'M17 5 7 12l10 7V5ZM6 5v14');
  const next = navigationButton('desktop-next', label('换一条推荐', 'Next recommendation'), 'm7 5 10 7-10 7V5Zm11 0v14');
  play.before(previous);
  controls.append(next);

  let artwork = '';
  function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }
  function render({album, albumTracks = [], track, playing, token}) {
    const song = track || (playing ? albumTracks[0] : null);
    const name = song?.name || album?.name || label('让天气挑一张唱片', 'Let the weather pick a record');
    const credit = song?.artists?.map(({name}) => name).join(', ')
      || album?.artists?.map(({name}) => name).join(', ') || album?.artist || '';
    const collection = song && album?.name && album.name !== song.name ? album.name : '';
    setText(title, name);
    setText(artist, credit);
    setText(albumName, collection);
    title.title = name;
    artist.title = credit;
    albumName.title = collection;
    artist.hidden = !credit;
    albumName.hidden = !collection;
    setText(status, playing ? label('正在播放', 'Now playing')
      : album ? label('待播放', 'Ready to play') : label('天气选曲', 'Weather selection'));
    heading.classList.toggle('is-playing', playing);
    previous.disabled = next.disabled = !token;

    const image = song?.album?.images?.[0]?.url || album?.images?.[0]?.url || '';
    if (image === artwork) return;
    artwork = image;
    if (image) {
      shell.style.setProperty('--desktop-art', 'url(' + JSON.stringify(image) + ')');
    } else {
      shell.style.removeProperty('--desktop-art');
      cover.style.removeProperty('background-image');
    }
  }

  window.weatherRecordDesktop = {
    render,
    bindNavigation(goBack, goNext) {
      previous.onclick = () => goBack();
      next.onclick = () => goNext();
    }
  };
  render({});
})();
