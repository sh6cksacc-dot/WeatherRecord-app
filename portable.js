// Spotify Connect adapter for Android, the Windows launcher, and the hosted H5 build.
window.WEATHER_RECORD_PORTABLE=true;
const portableAStudio=window.WEATHER_RECORD_HOST==='astudio';
if(!portableAStudio&&window.WEATHER_RECORD_HOST!=='windows')document.documentElement.classList.add('native-app');
const portableRedirect=portableAStudio?new URL('./', location.href).href:'http://127.0.0.1:5500/';
// AStudio sites can share an origin. Keep Spotify sessions in this tab, keyed by project path.
const portableAuth=portableAStudio?{
  getItem:key=>sessionStorage.getItem('weather-record:'+location.pathname+':'+key),
  setItem:(key,value)=>sessionStorage.setItem('weather-record:'+location.pathname+':'+key,value),
  removeItem:key=>sessionStorage.removeItem('weather-record:'+location.pathname+':'+key),
}:localStorage;
let portableRefresh=null,portablePoll=0,portableReading=false,portableBlockedUntil=0,portableSample=0;
let portableControlTail=Promise.resolve(),portableTransportVersion=0;
function portableControl(operation){
  const task=portableControlTail.catch(()=>{}).then(async()=>{portableTransportVersion++;return operation()});
  portableControlTail=task;return task;
}
const localClientIDKey = 'weather-record:local-client-id';
function portableClientID() {
  const inUse = portableAuth.getItem('portable_client_id');
  return inUse || window.WEATHER_RECORD_LOCAL_CLIENT_ID || localStorage.getItem(localClientIDKey) || '';
}
function portableRandom(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}
async function portableConnect(){
  let id=portableClientID();
  if(portableAStudio&&location.protocol!=='https:'&&!(location.protocol==='http:'&&location.hostname==='127.0.0.1')){
    throw Error(spotifyMessage('请用发布后的 HTTPS 地址打开页面，再连接 Spotify。','Open the published HTTPS page to connect Spotify.'));
  }
  // Use the configured ID for new authorization and bind it to this tab.
  id = window.WEATHER_RECORD_LOCAL_CLIENT_ID || id;
  if(!id){
    const entered=prompt(spotifyMessage('输入 Spotify Client ID。请先在 Dashboard 登记回调地址：\n','Enter the Spotify Client ID after registering this Redirect URI:\n')+portableRedirect,id);
    if(entered===null)return;
    id=entered.trim();
    if(!/^[a-f0-9]{32}$/i.test(id))throw Error(spotifyMessage('请填写有效的 Spotify Client ID。','Enter a valid Spotify Client ID.'));
  }
  portableAuth.setItem('portable_client_id', id);
  localStorage.setItem(localClientIDKey, id);
  const verifier=portableRandom(),oauthState=portableRandom();
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
  const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  portableAuth.setItem('portable_oauth',JSON.stringify({verifier,state:oauthState,created:Date.now()}));
  const scope='streaming user-read-private user-read-email user-read-playback-state user-modify-playback-state user-read-currently-playing user-library-read'+(window.AndroidHost?' playlist-modify-private playlist-read-private':'');
  portableAuth.setItem('portable_requested_scopes',scope);
  const url='https://accounts.spotify.com/authorize?'+new URLSearchParams({client_id:id,response_type:'code',redirect_uri:portableRedirect,scope,code_challenge_method:'S256',code_challenge:challenge,state:oauthState});
  if(window.AndroidHost)AndroidHost.openAuthorization(url);else location.assign(url);
}
async function portableToken(body){
  const response=await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...body,client_id:portableClientID()})});
  if(!response.ok)throw Error('Spotify token request failed ('+response.status+')');
  const token=await response.json();portableAuth.setItem('spotify_access_token',token.access_token);
  if(token.refresh_token)portableAuth.setItem('portable_refresh_token',token.refresh_token);
  portableAuth.setItem('portable_token_expires',String(Date.now()+token.expires_in*1000));
  state.token=token.access_token;
  if(window.WEATHER_RECORD_HOST==='windows'){
    await portableHost('token',{clientID:portableClientID(),accessToken:token.access_token,refreshToken:token.refresh_token||localStorage.getItem('portable_refresh_token')||'',expires:Number(localStorage.getItem('portable_token_expires'))});localStorage.removeItem('portable_refresh_token');
  }
  return token;
}
async function portableEnsureToken(){
  if(window.WEATHER_RECORD_HOST==='windows'){
    let session=await portableHost('session');
    if(!session.connected&&portableAuth.getItem('portable_refresh_token')){
      await portableHost('token',{clientID:portableClientID(),accessToken:portableAuth.getItem('spotify_access_token')||'',refreshToken:portableAuth.getItem('portable_refresh_token'),expires:Number(portableAuth.getItem('portable_token_expires'))||0});session=await portableHost('session');
    }
    if(session.connected){
      state.token=session.accessToken;portableAuth.setItem('spotify_access_token',state.token);portableAuth.setItem('portable_token_expires',String(session.expires));portableAuth.removeItem('portable_refresh_token');
      Object.assign(portableRatings,session.ratings||{});portableStore.write('atmos.portable.ratings.v1',portableRatings);portableApplyRatings();
      const events=new Map([...portableHistory,...(session.history||[])].map(e=>[`${e.id}|${e.timestamp}|${e.skipped}`,e]));portableHistory=[...events.values()].sort((a,b)=>a.timestamp-b.timestamp).slice(-1000);portableStore.write('atmos.portable.history.v1',portableHistory);
    }return;
  }
  if(!state.token)state.token=portableAuth.getItem('spotify_access_token');
  if(Date.now()<Number(portableAuth.getItem('portable_token_expires'))-60000)return;
  const refresh=portableAuth.getItem('portable_refresh_token');if(!refresh)return;
  if(!portableRefresh)portableRefresh=portableToken({grant_type:'refresh_token',refresh_token:refresh}).finally(()=>portableRefresh=null);
  await portableRefresh;
}
async function portableCallback(){
  const q=new URLSearchParams(location.search);if(!q.has('code')&&!q.has('error')){await portableEnsureToken();return}
  const saved=JSON.parse(portableAuth.getItem('portable_oauth')||'null');
  history.replaceState({},'',portableRedirect);
  if(!saved||q.get('state')!==saved.state||Date.now()-saved.created>600000)throw Error('Spotify authorization state expired. Connect again.');
  portableAuth.removeItem('portable_oauth');
  if(q.has('error'))throw Error('Spotify authorization: '+q.get('error'));
  await portableToken({grant_type:'authorization_code',code:q.get('code'),redirect_uri:portableRedirect,code_verifier:saved.verifier});
  portableAuth.setItem('portable_scopes',portableAuth.getItem('portable_requested_scopes')||'');
  if(window.WEATHER_RECORD_HOST==='windows')await portableEnsureToken();
}
async function portableResponse(path,method='GET',body){
  if(path.split('?')[0]==='/me/player/queue')throw Error('Spotify queue is disabled in the local player');
  if(window.WEATHER_RECORD_HOST==='windows')return portableHost('api',{path,method,body});
  await portableEnsureToken();
  if(Date.now()<portableBlockedUntil)return {status:429,retryAfter:Math.ceil((portableBlockedUntil-Date.now())/1000)};
  const r=await fetch('https://api.spotify.com/v1'+path,{method,cache:'no-store',headers:{Authorization:'Bearer '+state.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
  const retryAfter=Math.max(1,Number(r.headers.get('Retry-After'))||30);
  if(r.status===429)portableBlockedUntil=Date.now()+retryAfter*1000;
  const raw=await r.text();let data=null;try{data=raw?JSON.parse(raw):null}catch{}
  return {status:r.status,body:data,retryAfter};
}
async function portableAPI(path,method='GET',body){
  const r=await portableResponse(path,method,body);
  if(r.status<200||r.status>=300)throw Object.assign(Error(r.status===429?'Spotify rate limited. Retry after '+r.retryAfter+' seconds.':(r.body?.error?.message||'Spotify request failed ('+r.status+'). Open Spotify and start a song first.')),{status:r.status,retryAfter:(r.retryAfter||0)*1000});
  return r.body;
}
async function portableRead(force=false){
  clearTimeout(portablePoll);portablePoll=0;
  if(portableReading||document.hidden||!state.token)return;
  portableReading=true;
  const version=portableTransportVersion;
  try{
    if(window.WEATHER_RECORD_HOST==='windows'){
      const snapshot=await portableHost(force?'refresh':'state'),s=snapshot.player;
      if(!s?.item){portableEmit('weatherRecordSpotifyState',{token:state.token,connected:false,playing:false});return;}
      state.deviceId=s.device?.id||null;
      portableEmit('weatherRecordSpotifyState',{token:state.token,connected:true,playing:!!s.is_playing,trackURI:s.item.uri,duration:s.item.duration_ms,position:s.progress_ms||0,sampledAt:snapshot.sampledAt,sampleVersion:snapshot.sampleVersion});return;
    }
    const s=await portableAPI('/me/player');
    if(version!==portableTransportVersion)return;
    state.deviceId=s?.device?.id||null;
    if(!s?.item){portableEmit('weatherRecordSpotifyState',{token:state.token,connected:false,playing:false});return}
    if(portableAStudio&&s.item.type==='track'&&s.item.album?.uri){
      queueTrackCache.set(s.item.uri,s.item);
      if(queueTrackCache.size>40)queueTrackCache.delete(queueTrackCache.keys().next().value);
    }
    portableEmit('weatherRecordSpotifyState',{token:state.token,connected:true,playing:!!s.is_playing,trackURI:s.item.uri,albumURI:s.item.album?.uri,duration:s.item.duration_ms,position:s.progress_ms||0,sampledAt:Date.now(),sampleVersion:++portableSample});
  }catch(error){console.warn(error.message)}
  finally{portableReading=false;if(!portablePoll&&!document.hidden)portablePoll=setTimeout(portableRead,Math.max(2500,portableBlockedUntil-Date.now()))}
}
function portableCreatePlayer(){
  if(state.player||!state.token)return;
  if(window.WEATHER_RECORD_HOST==='windows')void portableHost('context',portableContext()).catch(console.warn);
  state.player={activateElement:async()=>{},getCurrentState:async()=>({position:state.position}),pause:()=>portableAPI('/me/player/pause','PUT').then(()=>portableRead()),resume:()=>portableAPI('/me/player/play','PUT').then(()=>portableRead()),seek:p=>portableAPI('/me/player/seek?position_ms='+Math.round(p),'PUT').then(()=>portableRead())};
  portableRead(true);
}
function portableEmit(name,detail){window.dispatchEvent(new CustomEvent(name,{detail}))}
async function portablePlay(uri){
  if(window.WEATHER_RECORD_HOST==='windows')await portableHost('context',portableContext());
  const player=await portableAPI('/me/player');
  let device=player?.device;
  if(portableAStudio&&(!device?.id||device.is_restricted)){
    const {devices=[]}=await portableAPI('/me/player/devices')||{};
    const available=devices.filter(candidate=>candidate.id&&!candidate.is_restricted);
    device=available.find(candidate=>candidate.is_active)||(available.length===1?available[0]:null);
  }
  if(!device?.id||device.is_restricted)throw Error(spotifyMessage('请在要播放的设备上打开 Spotify，播放任意一首歌后重试。','Open Spotify on the device you want to use, start a song, then try again.'));
  state.deviceId=device.id;
  const deviceQuery='device_id='+encodeURIComponent(device.id);
  const body=uri.startsWith('spotify:album:')?{context_uri:uri,offset:{position:0},position_ms:0}:{uris:[uri],position_ms:0};
  if(uri.startsWith('spotify:album:'))await portableAPI('/me/player/shuffle?state=false'+(portableAStudio?'&'+deviceQuery:''),'PUT');
  await portableAPI('/me/player/play?'+deviceQuery,'PUT',body);
  acceptRemoteProgress=true;await portableRead();
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(portablePoll);portablePoll=0}else if(typeof state!=='undefined'&&state.player)portableRead(true)});
