// The SDK registers this browser as the only playback target for the local player.
let localPlaybackBusy = false;
const localPlayAfterAuthorization = 'weather-record:play-after-authorization';

function localConfirmPlayback(snapshot) {
  if (snapshot.playing && localAutoplayBlocked) {
    localAutoplayBlocked = false;
    showWebSpotifyStatus('', spotifyMessage('Spotify 已连接', 'Spotify Connected'));
  }
}

async function localCompleteAuthorization() {
  const callback = new URLSearchParams(location.search);
  const requestedAt = Number(sessionStorage.getItem(localPlayAfterAuthorization));
  sessionStorage.removeItem(localPlayAfterAuthorization);
  await handleCallback();
  if (callback.has('code') && state.token && requestedAt > Date.now() - 600000) {
    showWebSpotifyStatus(spotifyMessage('授权完成。点播放，让浏览器开始出声。', 'Authorized. Click Play to enable audio in this browser.'), spotifyMessage('Spotify 已连接', 'Spotify Connected'));
  }
}

function localPlaybackError(error) {
  const retry = spotifyMessage('重试连接 Spotify', 'Reconnect Spotify');
  const connected = spotifyMessage('Spotify 已连接', 'Spotify Connected');
  let message = error.message;
  if (error.status === 401) {
    for (const key of ['spotify_access_token', 'portable_refresh_token', 'portable_token_expires']) {
      portableAuth.removeItem(key);
    }
    state.token = null;
    state.hasPausedTrack = false;
    setPlaying(false);
    message = spotifyMessage('Spotify 授权已失效，请重新连接。', 'Spotify authorization expired. Reconnect to continue.');
  } else if (error.status === 403) {
    message = spotifyMessage('Spotify 拒绝了请求（403）。请检查 Premium 状态和开发者应用的账号权限。', 'Spotify rejected the request (403). Check Premium and your developer app’s user access.');
  } else if (error.status === 404) {
    message = spotifyMessage('Spotify 找不到网页播放设备或所选内容（404）。请刷新页面后重试。', 'Spotify could not find the device or selection (404). Refresh this page and retry.');
  }
  showWebSpotifyStatus(message, error.status === 401 ? retry : connected);

}

let localPickTask;
function localPickInitial() {
  if (!localPickTask) {
    localPickTask = (state.mode === 'single' ? chooseLiked() : chooseAlbum())
      .catch(error => { state.albumError = error.message; tags(); })
      .finally(() => { localPickTask = null; });
  }
  return localPickTask;
}

let localSdkLoading;
let localSdkReady;
let localSdkError = null;
let localAutoplayBlocked = false;
let localSampleVersion = 0;
let localStateRead = 0;
let localProgressTimer = 0;
let localLastPlayback = null;
let localSeekBusy = false;

function localCheckTrackEnd(snapshot, track) {
  const now = performance.now();
  const previous = localLastPlayback;
  localLastPlayback = null;
  if (state.mode !== 'single' || !track?.uri || localPlaybackBusy || localSeekBusy ||
      localAutoplayBlocked || coverTransitioning || coverGestureActive || modeSwitching || state.seeking) return;
  const selected = state.track?.uri;
  if (!snapshot.paused && track.uri === selected) {
    localLastPlayback = { uri: track.uri, remaining: snapshot.duration - snapshot.position, at: now };
    return;
  }
  if (!previous || previous.uri !== selected || previous.remaining < 0 || previous.remaining > 2500) return;
  const elapsed = now - previous.at;
  const ended = track.uri !== previous.uri ||
    (snapshot.paused && (snapshot.position <= 100 || snapshot.duration - snapshot.position <= 100));
  if (ended && elapsed + 250 >= previous.remaining && elapsed <= previous.remaining + 2500) {
    void localAdvanceRecommendation();
  }
}

function localHasStreamingScope() {
  return (portableAuth.getItem('portable_scopes') || '').split(/\s+/).includes('streaming');
}

function localLoadSdk() {
  if (window.Spotify?.Player) return Promise.resolve();
  if (!localSdkLoading) {
    localSdkLoading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => {
        script.remove();
        reject(Error(spotifyMessage('Spotify 网页播放器加载超时，请重试。', 'Spotify player loading timed out. Try again.')));
      }, 12000);
      window.onSpotifyWebPlaybackSDKReady = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => {
        clearTimeout(timer);
        script.remove();
        reject(Error(spotifyMessage('无法加载 Spotify 网页播放器。', 'Could not load the Spotify web player.')));
      };
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      document.head.append(script);
    }).catch(error => { localSdkLoading = null; throw error; });
  }
  return localSdkLoading;
}

function localPublishState(snapshot) {
  clearTimeout(localProgressTimer);
  const track = snapshot?.track_window?.current_track;
  if (!track?.uri || !state.deviceId) {
    localLastPlayback = null;
    portableEmit('weatherRecordSpotifyState', { connected: false, playing: false });
    return;
  }
  localCheckTrackEnd(snapshot, track);
  portableEmit('weatherRecordSpotifyState', {
    connected: true, playing: !snapshot.paused, trackURI: track.uri,
    albumURI: track.album?.uri, contextURI: snapshot.context?.uri,
    position: snapshot.position, duration: snapshot.duration,
    sampledAt: Date.now(), sampleVersion: ++localSampleVersion,
  });
  if (!snapshot.paused && state.playing) {
    // The SDK emits changes, not clock ticks. Sample its position for Safari's progress display.
    if (!state.seeking && pendingSeekPosition === null && snapshot.position > progressVisualPosition) {
      progressVisualPosition = snapshot.position;
      state.position = snapshot.position;
      paintProgress(snapshot.duration ? snapshot.position / snapshot.duration * 100 : 0);
      document.getElementById('elapsed').textContent = fmt(snapshot.position);
    }
    const interval = snapshot.duration - snapshot.position < 2500 ? 250 : 1000;
    localProgressTimer = setTimeout(() => { void localReadSdk().catch(localPlaybackError); }, interval);
  }
}

async function localReadSdk() {
  if (!state.player || !state.deviceId) return;
  const read = ++localStateRead;
  const snapshot = await state.player.getCurrentState();
  if (read === localStateRead) localPublishState(snapshot);
}

function localCreatePlayer() {
  if (!state.token || !localHasStreamingScope()) {
    if (state.token) showWebSpotifyStatus(
      spotifyMessage('请重新连接 Spotify，一次性授权网页播放。', 'Reconnect Spotify once to authorize browser playback.'),
      spotifyMessage('重新连接 Spotify', 'Reconnect Spotify')
    );
    return Promise.resolve();
  }
  if (localSdkReady) return localSdkReady;
  localSdkReady = localLoadSdk().then(() => new Promise((resolve, reject) => {
    const player = new Spotify.Player({
      name: 'Weather Record · Web Player',
      getOAuthToken: callback => {
        portableEnsureToken().then(() => callback(state.token || '')).catch(error => localPlaybackError(error));
      },
      volume: .8,
    });
    state.player = player;
    const timer = setTimeout(() => fail(Error(spotifyMessage('Spotify 网页播放设备连接超时。', 'Spotify browser device did not connect.'))), 12000);
    function fail(error) {
      if (state.player !== player) return;
      clearTimeout(timer);
      state.player = null;
      state.deviceId = null;
      localSdkReady = null;
      localSdkError = error;
      player.disconnect();
      localPublishState(null);
      reject(error);
      localPlaybackError(error);
    }
    player.addListener('ready', ({ device_id }) => {
      if (state.player !== player) return;
      clearTimeout(timer);
      localSdkError = null;
      state.deviceId = device_id;
      showWebSpotifyStatus('', spotifyMessage('Spotify 已连接', 'Spotify Connected'));
      resolve(player);
    });
    player.addListener('not_ready', () => {
      fail(Error(spotifyMessage('Spotify 网页播放设备已断开，点击播放重新连接。', 'The Spotify browser device disconnected. Click Play to reconnect.')));
    });
    player.addListener('player_state_changed', snapshot => {
      if (state.player !== player) return;
      localStateRead++;
      localPublishState(snapshot);
    });
    player.addListener('autoplay_failed', () => {
      localAutoplayBlocked = true;
      showWebSpotifyStatus(
        spotifyMessage('浏览器暂停了自动播放，请再点一次播放。', 'The browser blocked autoplay. Click Play again.'),
        spotifyMessage('Spotify 已连接', 'Spotify Connected')
      );
    });
    player.addListener('initialization_error', ({ message }) => fail(Error(message)));
    player.addListener('authentication_error', () => fail(Object.assign(Error('Spotify authorization failed'), { status: 401 })));
    player.addListener('account_error', () => fail(Error(spotifyMessage('网页版播放需要 Spotify Premium。', 'Web playback requires Spotify Premium.'))));
    player.addListener('playback_error', ({ message }) => localPlaybackError(Error(message)));
    player.connect().then(connected => {
      if (!connected) fail(Error(spotifyMessage('无法连接 Spotify 网页播放器。', 'Could not connect the Spotify web player.')));
    }, fail);
  })).catch(error => {
    localSdkReady = null;
    localSdkError = error;
    localPlaybackError(error);
    return null;
  });
  return localSdkReady;
}

async function localStartPlayback() {
  localLastPlayback = null;
  if (!(state.mode === 'single' ? state.track?.uri : state.album?.uri)) await localPickInitial();
  const uri = state.mode === 'single' ? state.track?.uri : state.album?.uri;
  if (!uri) throw Error(state.albumError || spotifyMessage('还没有可播放的推荐。', 'No playable recommendation yet.'));
  const device = state.deviceId;
  if (!device) throw localSdkError || Error(spotifyMessage('浏览器播放设备还未就绪，请稍后再试。', 'The browser playback device is not ready yet.'));
  resetProgress();
  state.hasPausedTrack = false;
  playbackTargetPending = true;
  observedTrackURI = '';
  lastConfirmedTrackURI = '';
  acceptRemoteProgress = true;
  const query = new URLSearchParams({ device_id: device });
  const album = state.mode === 'album';
  const current = await state.player.getCurrentState();
  if (album && current?.shuffle) await portableAPI('/me/player/shuffle?state=false&' + query, 'PUT');
  await portableAPI('/me/player/play?' + query, 'PUT', album
    ? { context_uri: uri, offset: { position: 0 }, position_ms: 0 }
    : { uris: [uri], position_ms: 0 });
  await localReadSdk();
}

async function localTogglePlayback() {
  if (localPlaybackBusy || coverTransitioning || modeSwitching) return;
  if (!state.token || !localHasStreamingScope()) return connectSpotify();
  localPlaybackBusy = true;
  localLastPlayback = null;
  userHasChosen = true;
  const button = document.getElementById('playBtn');
  button.disabled = true;
  try {
    // Safari requires this call to occur before any await in the click handler.
    const player = state.player;
    const activation = player?.activateElement();
    if (activation) await activation;
    if (!player || !state.deviceId) {
      await localCreatePlayer();
      if (!state.deviceId) throw localSdkError || Error('Spotify 网页播放设备还未就绪。');
      if (player !== state.player) {
        showWebSpotifyStatus(spotifyMessage('网页播放器已就绪，请再点一次播放。', 'The web player is ready. Click Play again.'), spotifyMessage('Spotify 已连接', 'Spotify Connected'));
        return;
      }
    }
    if (localPickTask) await localPickTask;
    if (state.playing) await player.pause();
    else if (state.hasPausedTrack || localAutoplayBlocked) await player.resume();
    else await localStartPlayback();
    await localReadSdk();
  } catch (error) {
    localPlaybackError(error);
  } finally {
    button.disabled = false;
    localPlaybackBusy = false;
  }
}

async function localStopPlayback() {
  localLastPlayback = null;
  try {
    if (state.playing) await state.player?.pause();
  } catch (error) {
    localPlaybackError(error);
  }
  localAutoplayBlocked = false;
  state.hasPausedTrack = false;
  resetProgress();
  setPlaying(false);
}

async function localSeekPlayback(position) {
  if (!state.player || !state.deviceId || !state.duration || !(state.playing || state.hasPausedTrack)) return;
  localLastPlayback = null;
  localSeekBusy = true;
  try {
    await state.player.seek(position);
    await localReadSdk();
  } catch (error) {
    localPlaybackError(error);
  } finally {
    localSeekBusy = false;
  }
}
