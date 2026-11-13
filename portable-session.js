// Platform-owned playback plans. UI candidates and the playback context share a list.
const portableWindows=window.WEATHER_RECORD_HOST==='windows';
const portableAndroid=!!window.AndroidHost;
let portablePlanTask=null,portablePlanSync=0;
let portableSessionPlayTask=null;
let portableAndroidLastExtend=0;
let portableAndroidPlan=portableStore.read('atmos.android.session.v2',null);
const portableSessionEnabled=()=>portableWindows||portableAndroid;
async function portableHost(path,body){
  const response=await fetch('/native/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-WeatherRecord-Key':window.WEATHER_RECORD_HOST_KEY},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
  const data=await response.json();if(!response.ok)throw Error(data.error||'Native playback service failed');return data;
}
function portableContext(){return {mode:state.mode,workout:workoutMode,weatherCode:state.weatherCode??null,utcOffsetMinutes:-new Date().getTimezoneOffset(),ratings:portableRatings,history:portableHistory,artistTags:moodArtists,selected:state.track}}
function portableAdoptPlan(tracks){
  const selected=state.track?.uri,index=tracks.findIndex(t=>t.uri===selected),remaining=index>=0?tracks.slice(index+1):tracks;
  nextSelectionSlots=remaining.filter(t=>t?.id&&t.album&&t.uri!==selected).map(track=>{
    queueTrackCache.set(track.uri,track);confirmedLikedURIs.add(track.uri);
    const selection={mode:'single',track,album:track.album,tracks:[track],origin:'atmosrank',workout:workoutMode};
    return {mode:'single',context:recommendationKey(),epoch:nextSelectionEpoch,settled:true,selection,promise:Promise.resolve(selection)};
  });
  // Preload only the next covers, not every image in a 30-song session.
  remaining.slice(0,3).forEach(t=>void preloadCover(t.album?.images?.[0]?.url));
}
async function portableBuildSession(root,count=30){
  await portableFeaturesReady;portableApplyRatings();
  const tracks=new Map();if(root?.uri)tracks.set(root.uri,root);
  const first=await ensureAtmosLikedPage();first.forEach(t=>tracks.set(t.uri,t));
  const total=likedTrackTotal||first.length;
  const pages=Math.min(4,Math.ceil(total/50));
  for(let i=1;i<pages;i++){
    const offset=nextAtmosLikedOffset(total),page=await api('https://api.spotify.com/v1/me/tracks?limit=50&offset='+offset);
    for(const entry of page.items||[]){const t=entry.track;if(t?.id&&t.uri&&!t.is_local&&t.is_playable!==false){tracks.set(t.uri,t);confirmedLikedURIs.add(t.uri)}}
  }
  const pool=[...tracks.values()].filter(t=>t.uri!==root?.uri&&(!workoutMode||portableRanker.workoutEligible(atmosCandidate(t,'single'))));
  const ranked=portableRanker.sample(pool.map(t=>atmosCandidate(t,'single')),Math.max(0,count-(root?1:0)),workoutMode?[.85,.75,.2]:portableRanker.target(state.weatherCode,new Date().getHours()),portableHistory,Date.now()/1000,root?atmosCandidate(root,'single'):null);
  return [...(root?[root]:[]),...ranked.map(s=>pool.find(t=>t.id===s.id)).filter(Boolean)];
}
function portableSaveAndroid(){portableStore.write('atmos.android.session.v2',portableAndroidPlan)}
async function portableAndroidPlaylist(){
  const scopes=(localStorage.getItem('portable_scopes')||'').split(' ');
  if(!scopes.includes('playlist-modify-private')||!scopes.includes('playlist-read-private'))throw Error(isEnglish?'Connect Spotify again to allow the private Atmos playlist.':'请重新连接 Spotify，允许创建和读取 Atmos 私人歌单。');
  const me=await portableAPI('/me');
  if(portableAndroidPlan?.owner===me.id&&portableAndroidPlan.playlistID){
    const existing=await portableAPI('/playlists/'+portableAndroidPlan.playlistID);
    if(existing.owner?.id!==me.id||existing.public!==false)throw Error('Atmos playlist ownership/privacy changed; refusing to overwrite it.');
    return portableAndroidPlan.playlistID;
  }
  if(portableAndroidPlan?.owner===me.id&&portableAndroidPlan.creationNonce&&!portableAndroidPlan.playlistID){
    for(let offset=0;offset<500;offset+=50){
      const page=await portableAPI('/me/playlists?limit=50&offset='+offset);
      const found=(page.items||[]).find(p=>p.owner?.id===me.id&&p.public===false&&p.description?.includes(portableAndroidPlan.creationNonce));
      if(found){portableAndroidPlan.playlistID=found.id;portableSaveAndroid();return found.id;}
      if(!page.next)break;
    }
    throw Error(isEnglish?'The previous playlist creation is still unconfirmed; no duplicate playlist was created.':'上次创建歌单的结果尚未确认，未重复创建。');
  }
  const creationNonce=crypto.randomUUID();
  portableAndroidPlan={owner:me.id,playlistID:null,creationNonce,tracks:[],context:'',workout:workoutMode,pending:true};portableSaveAndroid();
  // Save the receipt before writing songs. A failed/ambiguous write is reconciled
  // against this ID, never retried by creating another playlist.
  const playlist=await portableAPI('/me/playlists','POST',{name:'Weather Record · Atmos Session',public:false,description:'Weather Record managed listening session. Ordered by AtmosRank. '+creationNonce});
  portableAndroidPlan={...portableAndroidPlan,playlistID:playlist.id,pending:false};portableSaveAndroid();return playlist.id;
}
async function portableVerifyPlaylist(id,expected){
  const page=await portableAPI('/playlists/'+id+'/items?limit=100');
  const actual=(page.items||[]).map(e=>(e.item||e.track)?.uri);
  return actual.length===expected.length&&actual.every((uri,i)=>uri===expected[i]);
}
async function portableAndroidCommit(tracks){
  const id=await portableAndroidPlaylist(),uris=tracks.map(t=>t.uri);
  portableAndroidPlan={...portableAndroidPlan,tracks,context:recommendationKey(),workout:workoutMode,pending:true,pendingAppend:null};portableSaveAndroid();
  let error=null;
  try{await portableAPI('/playlists/'+id+'/items','PUT',{uris})}catch(e){error=e}
  // A network error can still mean Spotify accepted the write; inspect first.
  if(!await portableVerifyPlaylist(id,uris))throw error||Error('Spotify playlist order has not been confirmed; playback was not restarted.');
  portableAndroidPlan.pending=false;portableSaveAndroid();return id;
}
async function portableSessionPrepare(){
  if(state.mode!=='single'||!state.token||document.hidden)return;
  if(portablePlanTask)return portablePlanTask;
  portablePlanTask=(async()=>{
    if(portableWindows){
      const plan=await portableHost('plan',portableContext());if(state.mode!=='single')return;
      portableAdoptPlan(plan.tracks||[]);queueStatus(plan.message||'');return;
    }
    if(portableAndroidPlan?.tracks?.length&&portableAndroidPlan.workout===workoutMode){
      if(portableAndroidPlan.pendingAppend)await portableAndroidConfirmAppend();
      portableAdoptPlan(portableAndroidPlan.tracks);
      // Refilling an active playlist is append-only, preserving current offsets.
      const index=portableAndroidPlan.tracks.findIndex(t=>t.uri===nativeCurrentTrackURI);
      if(index>=0&&portableAndroidPlan.tracks.length-index<=8&&state.playing)await portableAndroidExtend();
    }
  })().catch(e=>queueStatus(e.message)).finally(()=>portablePlanTask=null);
  return portablePlanTask;
}
async function portableAndroidExtend(){
  if(!portableAndroidPlan||portableAndroidPlan.pending||Date.now()-portableAndroidLastExtend<60000)return;
  portableAndroidLastExtend=Date.now();
  const session=portableAndroidPlan,generated=await portableBuildSession(null),known=new Set(session.tracks.map(t=>t.uri));
  const extra=generated.filter(t=>!known.has(t.uri)).slice(0,30);
  if(!extra.length)return;
  // Bound a session to 300 items; a new session is created on explicit playback.
  if(session.tracks.length+extra.length>300)return;
  const id=session.playlistID;
  session.pending=true;session.pendingAppend=extra;portableSaveAndroid();
  try{
    // On ambiguous append never send it a second time. Re-read and reconcile.
    await portableAPI('/playlists/'+id+'/items','POST',{uris:extra.map(t=>t.uri)});
  }catch(e){queueStatus(e.message)}
  await portableAndroidConfirmAppend();
}
async function portableAndroidConfirmAppend(){
  const session=portableAndroidPlan,extra=session?.pendingAppend;if(!extra?.length)return;
  const page=await portableAPI('/playlists/'+session.playlistID+'/items?offset='+session.tracks.length+'&limit=50');
  const actual=(page.items||[]).map(e=>(e.item||e.track)?.uri);
  if(extra.every((t,i)=>actual[i]===t.uri)){session.tracks=[...session.tracks,...extra];session.pending=false;session.pendingAppend=null;portableSaveAndroid();portableAdoptPlan(session.tracks)}
  else queueStatus(isEnglish?'Playlist append is uncertain; it will not be duplicated.':'歌单追加结果尚未确认，不会重复追加。');
}
async function portableSessionPlay(){
  if(portableSessionPlayTask)return portableSessionPlayTask;
  portableSessionPlayTask=portableSessionPlayNow().finally(()=>portableSessionPlayTask=null);return portableSessionPlayTask;
}
async function portableSessionPlayNow(){
  if(portablePlanTask)await portablePlanTask;
  if(portableWindows){
    const result=await portableHost('play',portableContext());portableAdoptPlan(result.tracks||[]);acceptRemoteProgress=true;await portableRead();return;
  }
  const target=state.track,workout=workoutMode;if(!target?.uri)throw Error('No track selected');
  const player=await portableAPI('/me/player');
  if(!player?.device?.id||player.device.is_restricted)throw Error(isEnglish?'Open Spotify and start a song first.':'请先打开 Spotify 播放一首歌以激活设备。');
  const session=portableAndroidPlan,contextURI=session?.playlistID?'spotify:playlist:'+session.playlistID:null;
  let tracks=session?.tracks||[],index=tracks.findIndex(t=>t.uri===target.uri);
  const same=session&&session.workout===workoutMode&&!session.pending&&index>=0;
  if(player.item?.uri===target.uri&&same&&player.context?.uri===contextURI){
    if(!player.is_playing)await portableAPI('/me/player/play','PUT');
    acceptRemoteProgress=true;await portableRead();return;
  }
  const remote=await portableAPI('/me/player/queue');
  if(!Array.isArray(remote?.queue))throw Error('Spotify queue is unknown; playback was not changed.');
  const oldOwned=new Set(queueWriter.issued);
  // A context change cannot reliably remove another source's manually-added queue.
  // Detect it and ask the user to clear it in Spotify instead of silently skipping.
  if(remote.queue.some(t=>oldOwned.has(t?.uri))){
    await navigateSpotifyQueue('atmos:android:playlist-migration',()=>portableAPI('/me/player/queue'),async action=>{if(action==='next')await portableAPI('/me/player/next','POST');else await portableAPI('/me/player/play','PUT')},ms=>new Promise(r=>setTimeout(r,ms)),oldOwned,uri=>{queueWriter.issued.delete(uri);queueWriter.persist([...queueWriter.issued])});
  }
  if(!same||session.context!==recommendationKey()||workoutQueueReset){tracks=await portableBuildSession(target);if(state.mode!=='single'||workout!==workoutMode)throw Error('Listening mode changed.');index=0;await portableAndroidCommit(tracks);}
  if(state.mode!=='single'||workout!==workoutMode)throw Error('Listening mode changed.');
  await portableAPI('/me/player/shuffle?state=false','PUT');await portableAPI('/me/player/repeat?state=off','PUT');
  await portableAPI('/me/player/play?device_id='+encodeURIComponent(player.device.id),'PUT',{context_uri:'spotify:playlist:'+portableAndroidPlan.playlistID,offset:{position:index},position_ms:0});
  workoutQueueReset=false;portableAdoptPlan(tracks);acceptRemoteProgress=true;await portableRead();
  const confirmed=await portableAPI('/me/player/queue'),expected=tracks[index+1]?.uri;
  queueStatus(expected&&confirmed?.queue?.[0]?.uri!==expected?(isEnglish?'Another Spotify queue takes priority. Clear it in Spotify to follow the Atmos playlist.':'其他 Spotify 队列优先，请在 Spotify 中清理后按 Atmos 歌单播放。'):(isEnglish?'Spotify is playing your Atmos session':'Spotify 正按 Atmos 歌单顺序播放'));
}
async function portableSessionRestore(){
  if(portableWindows){await portableSessionPrepare();queueRestored=true;return true}
  queueRestored=true;
  if(portableAndroidPlan?.tracks?.length)portableAdoptPlan(portableAndroidPlan.tracks);
  return true;
}
function portableSessionWake(){
  if(document.hidden||Date.now()-portablePlanSync<10000)return;
  portablePlanSync=Date.now();
  if(portableWindows&&state.mode!=='single'){void portableHost('context',portableContext()).catch(console.warn);return;}
  void portableSessionPrepare();
}
