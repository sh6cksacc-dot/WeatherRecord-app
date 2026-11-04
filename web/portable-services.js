// Native-compatible service contracts; only included in Android/Windows exports.
const portableStore={
  read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}},
  write(key,value){localStorage.setItem(key,JSON.stringify(value))}
};
const portableRanker=new AtmosPortableRanker();
const portableFeaturesReady=fetch('track-features.json').then(r=>{if(!r.ok)throw Error('Feature file unavailable');return r.json()}).then(r=>portableRanker.load(r)).catch(console.warn);
const portableRatings=portableStore.read('atmos.portable.ratings.v1',{});
const portableSuppressed=new Set(portableStore.read('atmos.portable.suppressed.v1',[]));
let portableHistory=portableStore.read('atmos.portable.history.v1',[]);
function portableRatingFeature(uri,rating){return {spotifyID:uri.split(':').pop(),...Object.fromEntries(Object.entries(rating.values).map(([k,v])=>[k,v/100])),confidence:1,source:'manual',provenance:'userSubjective'}}
function portableApplyRatings(){for(const [uri,rating] of Object.entries(portableRatings))portableRanker.load([portableRatingFeature(uri,rating)])}
portableFeaturesReady.then(portableApplyRatings);
async function portableSend(name,body={}){
  try{
    switch(name){
      case 'spotifyConnect':return await portableConnect();
      case 'spotifyPlay':return await portableControl(()=>portablePlay(body.uri));
      case 'spotifyPause':return await portableControl(async()=>{await portableAPI('/me/player/pause','PUT');await portableRead()});
      case 'spotifyResume':return await portableControl(async()=>{await portableAPI('/me/player/play','PUT');acceptRemoteProgress=true;await portableRead()});
      case 'spotifySeek':return await portableControl(async()=>{await portableAPI('/me/player/seek?position_ms='+Math.max(0,Math.round(body.position)),'PUT');await portableRead()});
      case 'spotifyStateRefresh':return await portableRead(true);
      case 'spotifyQueueRequest':{
        if(!((body.method==='GET'&&['/me/player','/me/player/queue'].includes(body.path))||(body.method==='POST'&&body.path==='/me/player/queue'&&body.uri?.startsWith('spotify:track:')&&body.deviceID)))throw Error('Unsupported queue request');
        const path=body.path+(body.method==='POST'?'?'+new URLSearchParams({uri:body.uri,device_id:body.deviceID}):'');
        const response=await portableResponse(path,body.method);
        portableEmit('spotifyQueueResponse',{requestID:body.requestID,...response});return;
      }
      case 'spotifyQueueCommand':{
        const paths={next:['/me/player/next','POST'],resume:['/me/player/play','PUT'],pause:['/me/player/pause','PUT']},command=paths[body.action];
        if(!command)throw Error('Unsupported queue command');
        const response=await portableControl(()=>portableResponse(...command));portableEmit('spotifyQueueResponse',{requestID:body.requestID,...response});return;
      }
      case 'atmosRank':{
        await portableFeaturesReady;portableApplyRatings();
        const candidates=(body.candidates||[]).slice(0,150).filter(c=>!body.workout||portableRanker.workoutEligible(c));
        const target=body.workout?[.85,.75,.2]:portableRanker.target(body.weatherCode,new Date().getHours());
        portableEmit('atmosRankResult',{requestID:body.requestID,scores:portableRanker.sample(candidates,1,target,portableHistory,Date.now()/1000,body.previous)});return;
      }
      case 'atmosEvent':{
        const previous=portableHistory.at(-1);
        if(previous?.id===body.id&&previous.skipped===body.skipped&&body.timestamp-previous.timestamp<30)return;
        portableHistory=[...portableHistory,body].slice(-1000);portableStore.write('atmos.portable.history.v1',portableHistory);return;
      }
      case 'trackRatingCheck':{
        if(body.uri!==nativeCurrentTrackURI)return;
        const status=portableRatings[body.uri]?'rated':portableSuppressed.has(body.uri)?'suppressed':'unrated';
        // Only the existing GET /me/tracks cache confirms membership; uncertainty
        // never triggers a prompt or an extra API request.
        const eligible=status==='unrated'&&confirmedLikedURIs.has(body.uri);
        portableEmit('atmosTrackRatingStatus',{uri:body.uri,status,eligible});return;
      }
      case 'trackRatingSave':{
        if(!body.uri?.startsWith('spotify:track:')||body.uri!==nativeCurrentTrackURI||!confirmedLikedURIs.has(body.uri))throw Error('Cannot confirm this liked track');
        const values={};for(const key of ['energy','valence','calmness','acousticness','instrumentalness','groove']){if(!Number.isFinite(body.values?.[key]))throw Error('Invalid rating');values[key]=Math.max(0,Math.min(100,Math.round(body.values[key])))}
        portableRatings[body.uri]={title:body.title,artist:body.artist,album:body.album,values,ratedAt:Date.now()};
        portableStore.write('atmos.portable.ratings.v1',portableRatings);portableApplyRatings();
        if(window.WEATHER_RECORD_HOST==='windows')await portableHost('context',portableContext());
        portableEmit('atmosTrackRatingSaved',{uri:body.uri});return;
      }
      case 'trackRatingSuppress':portableSuppressed.add(body.uri);portableStore.write('atmos.portable.suppressed.v1',[...portableSuppressed]);portableEmit('atmosTrackRatingSuppressed',{uri:body.uri});return;
      case 'weatherLocation':return portableWeather();
      case 'lyricsFetch':return await portableLyrics(body);
      case 'pitchforkReview':return await portableReview(body);
    }
  }catch(error){
    if(name.startsWith('spotifyQueue'))portableEmit('spotifyQueueResponse',{requestID:body.requestID,status:0,message:error.message});
    else if(name==='lyricsFetch')portableEmit('weatherRecordLyrics',{...body,error:error.message});
    else if(name==='pitchforkReview')portableEmit('weatherRecordPitchfork',{...body,error:error.message});
    else{console.warn(name,error);if(name.startsWith('spotify')){setStatus(error.message);await portableRead()}}
  }
}
function portableWeather(){
  if(!navigator.geolocation){portableEmit('weatherRecordLocationError','Location is unavailable');return}
  navigator.geolocation.getCurrentPosition(async position=>{
    try{
      const q=new URLSearchParams({latitude:position.coords.latitude,longitude:position.coords.longitude,current:'temperature_2m,weather_code'});
      const r=await fetch('https://api.open-meteo.com/v1/forecast?'+q,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Weather request failed ('+r.status+')');
      const data=(await r.json()).current;
      if(!Number.isFinite(data?.temperature_2m)||!Number.isFinite(data?.weather_code))throw Error('Weather data is incomplete');
      portableEmit('weatherRecordWeather',{temperature:data.temperature_2m,code:data.weather_code});
    }catch(e){portableEmit('weatherRecordLocationError',e.message)}
  },e=>portableEmit('weatherRecordLocationError',e.message),{enableHighAccuracy:false,maximumAge:300000,timeout:12000});
}
function portableNormalize(s){return String(s||'').normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')}
function portableLyricsMatch(record,lookup){
  return portableNormalize(record.trackName)===portableNormalize(lookup.trackName)&&portableNormalize(record.artistName)===portableNormalize(lookup.artistName)&&(!lookup.duration||Number.isFinite(record.duration)&&Math.abs(record.duration-lookup.duration)<=3);
}
async function portableLyrics(lookup){
  for(let stage=0;stage<3;stage++){
    const q=new URLSearchParams({track_name:lookup.trackName,artist_name:lookup.artistName});
    if(stage===0){if(lookup.albumName)q.set('album_name',lookup.albumName);if(lookup.duration)q.set('duration',lookup.duration)}
    const url='https://lrclib.net/api/'+(stage===2?'search':'get')+'?'+q;
    for(let attempt=0;attempt<3;attempt++){
      let response;
      try{response=await fetch(url,{signal:AbortSignal.timeout(10000)})}catch(e){if(attempt===2)throw e;await new Promise(r=>setTimeout(r,550*(attempt+1)));continue}
      if([408,429,500,502,503,504].includes(response.status)&&attempt<2){await new Promise(r=>setTimeout(r,Math.min(3000,Math.max(550,Number(response.headers.get('Retry-After'))*1000||0))));continue}
      if(response.status===404)break;
      if(!response.ok)throw Error(isEnglish?'Lyrics service is temporarily unavailable':'歌词服务暂时不可用');
      const data=await response.json(),records=Array.isArray(data)?data:[data];
      const match=records.find(r=>portableLyricsMatch(r,lookup)&&(r.syncedLyrics||r.instrumental));
      if(match){portableEmit('weatherRecordLyrics',{...lookup,syncedLyrics:match.syncedLyrics||'',instrumental:!!match.instrumental});return}
      break;
    }
  }
  throw Error(isEnglish?'Synced lyrics are not available for this recording':'此录音版本暂无同步歌词');
}
function portableParseReview(html,album,artist){
  const pattern=/"source":\{"hed":"((?:\\.|[^"\\])*)","dek":"((?:\\.|[^"\\])*)"\},"subHed":\{"name":"((?:\\.|[^"\\])*)"[^}]*\}.*?"ratingValue":\{.*?"score":([0-9.]+).*?"url":"((?:\\.|[^"\\])*)"/gs;
  let best=null;
  for(const m of html.matchAll(pattern)){
    try{
      const title=portableNormalize(JSON.parse('"'+m[1]+'"')),foundArtist=portableNormalize(JSON.parse('"'+m[3]+'"')),wanted=portableNormalize(album),who=portableNormalize(artist);
      if(!wanted||!who||!foundArtist||!(foundArtist===who||foundArtist.includes(who)||who.includes(foundArtist)))continue;
      const rank=(foundArtist===who?40:20)+(title===wanted?100:title.includes(wanted)||wanted.includes(title)?45:-1000);
      const path=JSON.parse('"'+m[5]+'"');if(!/^\/reviews\/albums\/[a-z0-9_-]+\/?$/i.test(path))continue;
      if(rank>0&&(!best||rank>best.rank))best={rank,summary:JSON.parse('"'+m[2]+'"').replace(/\*/g,''),score:Number(m[4]),url:'https://pitchfork.com'+path};
    }catch{}
  }
  return best;
}
async function portableReview(body){
  const r=await fetch('/review-search?'+new URLSearchParams({q:body.artistName+' '+body.albumName}),{signal:AbortSignal.timeout(18000)});
  if(!r.ok)throw Error(isEnglish?'Pitchfork is temporarily unavailable':'Pitchfork 暂时无法连接');
  const review=portableParseReview(await r.text(),body.albumName,body.artistName);
  if(!review)throw Error(isEnglish?'Pitchfork has not reviewed this album':'Pitchfork 暂未收录这张专辑');
  portableEmit('weatherRecordPitchfork',{...body,...review,translated:false});
  if(!isEnglish){
    try{const response=await fetch('/review-translate?'+new URLSearchParams({q:review.summary}),{signal:AbortSignal.timeout(14000)});if(!response.ok)return;
      const translated=(await response.json())[0].map(s=>s[0]||'').join('');if(translated)portableEmit('weatherRecordPitchfork',{...body,...review,summary:translated,translated:true});
    }catch{/* Keep the original review if translation is unavailable. */}
  }
}
