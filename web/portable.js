// Spotify Connect adapter for Android WebView and the Windows browser launcher.
window.WEATHER_RECORD_PORTABLE=true;
document.documentElement.classList.add('native-app');
const portableRedirect='http://127.0.0.1:5500/';
let portableRefresh=null,portablePoll=0,portableReading=false,portableBlockedUntil=0,portableSample=0;
let portableControlTail=Promise.resolve(),portableTransportVersion=0;
function portableControl(operation){
  const task=portableControlTail.catch(()=>{}).then(async()=>{portableTransportVersion++;return operation()});
  portableControlTail=task;return task;
}
function portableClientID(){return localStorage.getItem('portable_client_id')||''}
function portableRandom(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}
async function portableConnect(){
  let id=portableClientID();
  if(!id){id=prompt('Spotify Client ID（请在 Dashboard 登记回调 http://127.0.0.1:5500/）');if(!id)return;if(!/^[a-f0-9]{32}$/i.test(id))throw Error('Invalid Spotify Client ID');localStorage.setItem('portable_client_id',id)}
  const verifier=portableRandom(),oauthState=portableRandom();
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
  const challenge=btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  localStorage.setItem('portable_oauth',JSON.stringify({verifier,state:oauthState,created:Date.now()}));
  const url='https://accounts.spotify.com/authorize?'+new URLSearchParams({client_id:id,response_type:'code',redirect_uri:portableRedirect,scope:'user-read-playback-state user-modify-playback-state user-read-currently-playing user-library-read',code_challenge_method:'S256',code_challenge:challenge,state:oauthState});
  if(window.AndroidHost)AndroidHost.openAuthorization(url);else location.assign(url);
}
async function portableToken(body){
  const response=await fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...body,client_id:portableClientID()})});
  if(!response.ok)throw Error('Spotify token request failed ('+response.status+')');
  const token=await response.json();localStorage.setItem('spotify_access_token',token.access_token);
  if(token.refresh_token)localStorage.setItem('portable_refresh_token',token.refresh_token);
  localStorage.setItem('portable_token_expires',String(Date.now()+token.expires_in*1000));
  state.token=token.access_token;return token;
}
async function portableEnsureToken(){
  if(!state.token)state.token=localStorage.getItem('spotify_access_token');
  if(Date.now()<Number(localStorage.getItem('portable_token_expires'))-60000)return;
  const refresh=localStorage.getItem('portable_refresh_token');if(!refresh)return;
  if(!portableRefresh)portableRefresh=portableToken({grant_type:'refresh_token',refresh_token:refresh}).finally(()=>portableRefresh=null);
  await portableRefresh;
}
async function portableCallback(){
  const q=new URLSearchParams(location.search);if(!q.has('code')&&!q.has('error')){await portableEnsureToken();return}
  const saved=JSON.parse(localStorage.getItem('portable_oauth')||'null');
  history.replaceState({},'',portableRedirect);
  if(!saved||q.get('state')!==saved.state||Date.now()-saved.created>600000)throw Error('Spotify authorization state expired. Connect again.');
  localStorage.removeItem('portable_oauth');
  if(q.has('error'))throw Error('Spotify authorization: '+q.get('error'));
  await portableToken({grant_type:'authorization_code',code:q.get('code'),redirect_uri:portableRedirect,code_verifier:saved.verifier});
}
async function portableResponse(path,method='GET',body){
  await portableEnsureToken();
  if(Date.now()<portableBlockedUntil)return {status:429,retryAfter:Math.ceil((portableBlockedUntil-Date.now())/1000)};
  const r=await fetch('https://api.spotify.com/v1'+path,{method,headers:{Authorization:'Bearer '+state.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
  const retryAfter=Math.max(1,Number(r.headers.get('Retry-After'))||30);
  if(r.status===429)portableBlockedUntil=Date.now()+retryAfter*1000;
  const raw=await r.text();let data=null;try{data=raw?JSON.parse(raw):null}catch{}
  return {status:r.status,body:data,retryAfter};
}
async function portableAPI(path,method='GET',body){
  const r=await portableResponse(path,method,body);
  if(r.status<200||r.status>=300)throw Error(r.status===429?'Spotify rate limited. Retry after '+r.retryAfter+' seconds.':(r.body?.error?.message||'Spotify request failed ('+r.status+'). Open Spotify and start a song first.'));
  return r.body;
}
async function portableRead(){
  clearTimeout(portablePoll);portablePoll=0;
  if(portableReading||document.hidden||!state.token)return;
  portableReading=true;
  const version=portableTransportVersion;
  try{
    const s=await portableAPI('/me/player');
    if(version!==portableTransportVersion)return;
    if(!s?.item){portableEmit('weatherRecordSpotifyState',{token:state.token,connected:false,playing:false});return}
    state.deviceId=s.device?.id||null;
    portableEmit('weatherRecordSpotifyState',{token:state.token,connected:true,playing:!!s.is_playing,trackURI:s.item.uri,duration:s.item.duration_ms,position:s.progress_ms||0,sampledAt:Date.now(),sampleVersion:++portableSample});
  }catch(error){console.warn(error.message)}
  finally{portableReading=false;if(!portablePoll&&!document.hidden)portablePoll=setTimeout(portableRead,Math.max(2500,portableBlockedUntil-Date.now()))}
}
function portableCreatePlayer(){
  if(state.player||!state.token)return;
  state.player={activateElement:async()=>{},getCurrentState:async()=>({position:state.position}),pause:()=>portableAPI('/me/player/pause','PUT').then(()=>portableRead()),resume:()=>portableAPI('/me/player/play','PUT').then(()=>portableRead()),seek:p=>portableAPI('/me/player/seek?position_ms='+Math.round(p),'PUT').then(()=>portableRead())};
  portableRead();
}
function portableEmit(name,detail){window.dispatchEvent(new CustomEvent(name,{detail}))}
async function portablePlay(uri){
  const player=await portableAPI('/me/player');
  if(!player?.device?.id||player.device.is_restricted)throw Error('Open Spotify and start a song to activate a playback device.');
  state.deviceId=player.device.id;
  const body=uri.startsWith('spotify:album:')?{context_uri:uri,offset:{position:0},position_ms:0}:{uris:[uri],position_ms:0};
  if(uri.startsWith('spotify:album:'))await portableAPI('/me/player/shuffle?state=false','PUT');
  await portableAPI('/me/player/play?device_id='+encodeURIComponent(state.deviceId),'PUT',body);
  acceptRemoteProgress=true;await portableRead();
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(portablePoll);portablePoll=0}else if(typeof state!=='undefined'&&state.player)portableRead()});
