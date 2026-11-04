// Spotify Connect adapter for Android WebView and the Windows browser launcher.
window.WEATHER_RECORD_PORTABLE=true;
document.documentElement.classList.add('native-app');
const portableRedirect='http://127.0.0.1:5500/';
let portableRefresh=null,portablePoll=0,portableReading=false;
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
  if(!state.token||Date.now()<Number(localStorage.getItem('portable_token_expires'))-60000)return;
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
async function portableAPI(path,method='GET',body){
  await portableEnsureToken();
  const r=await fetch('https://api.spotify.com/v1'+path,{method,headers:{Authorization:'Bearer '+state.token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  if(r.status===429){const seconds=Math.max(5,Number(r.headers.get('Retry-After'))||30);clearTimeout(portablePoll);portablePoll=setTimeout(portableRead,seconds*1000);throw Error('Spotify rate limited. Retry after '+seconds+' seconds.')}
  if(!r.ok)throw Error('Spotify request failed ('+r.status+'). Open Spotify and start a song first.');
  return r.status===204?null:r.json();
}
async function portableRead(){
  clearTimeout(portablePoll);
  if(portableReading||document.hidden||!state.token)return;
  portableReading=true;
  try{
    const s=await portableAPI('/me/player');
    if(!s?.item)return;
    state.deviceId=s.device?.id||null;
    const changed=!!nativeCurrentTrackURI&&nativeCurrentTrackURI!==s.item.uri;
    nativeCurrentTrackURI=s.item.uri;
    const selected=selectedContainsTrack(s.item.uri);
    if(selected||!playbackTargetPending){
      state.duration=s.item.duration_ms;state.position=s.progress_ms||0;state.updatedAt=performance.now();state.hasPausedTrack=true;
      if(acceptRemoteProgress&&!state.seeking)syncProgressAnchor(state.position,changed||!s.is_playing);
      $('duration').textContent=fmt(state.duration);setPlaying(!!s.is_playing);
      if(!s.is_playing&&!state.seeking){paintProgress(state.duration?state.position/state.duration*100:0);$('elapsed').textContent=fmt(state.position)}
      if(s.is_playing)observePlaybackTrack(s.item.uri);
    }
  }catch(error){console.warn(error.message)}
  finally{portableReading=false;if(!portablePoll&&!document.hidden)portablePoll=setTimeout(portableRead,2500)}
}
function portableCreatePlayer(){
  if(state.player||!state.token)return;
  state.player={activateElement:async()=>{},getCurrentState:async()=>({position:state.position}),pause:()=>portableAPI('/me/player/pause','PUT').then(()=>portableRead()),resume:()=>portableAPI('/me/player/play','PUT').then(()=>portableRead()),seek:p=>portableAPI('/me/player/seek?position_ms='+Math.round(p),'PUT').then(()=>portableRead())};
  portableRead();
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(portablePoll);portablePoll=0}else if(typeof state!=='undefined'&&state.player)portableRead()});
