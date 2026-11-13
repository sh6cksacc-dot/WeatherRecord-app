let localAdvanceRecommendation;
const $=id=>document.getElementById(id);
let workoutMode=false;
let workoutQueueReset=false;
const state={mode:localStorage.getItem('playback_mode')||'album',token:window.WEATHER_RECORD_NATIVE?null:portableAuth.getItem('spotify_access_token'),player:null,deviceId:null,album:null,albumTracks:[],track:null,playing:false,position:0,updatedAt:0,manualPosition:0,resumePosition:0,duration:0,hasPausedTrack:false,seeking:false,weather:'unknown',weatherReady:false,period:null,selectionMood:null,selectionContextKey:null,albumError:null,pitchforkReview:null};
let acceptRemoteProgress=false;
let progressVisualPosition=0,progressAnchorPosition=0,progressAnchorTime=0,progressLastFrame=0,progressDisplayedSecond=-1;
let pendingSeekPosition=null,pendingSeekUntil=0;
let lastProgressSample=-1;
function progressCorrection(drift){return Math.max(-300,Math.min(450,drift*.18))}
function paintProgress(value){const progress=$('progress');if(!progress)return;const safe=Math.max(0,Math.min(100,Number(value)||0));progress.value=safe;progress.style.setProperty('--played',`${safe}%`)}
function syncProgressAnchor(position,hard=false){
  const now=performance.now(),safe=Math.max(0,Number(position)||0),drift=safe-progressVisualPosition;
  if(hard||Math.abs(drift)>12000){progressVisualPosition=safe;progressAnchorPosition=safe}
  else{
    // Correct in both directions. A small negative correction briefly slows
    // the visual clock instead of leaving lyrics permanently ahead of audio.
    const correction=progressCorrection(drift);
    progressAnchorPosition=progressVisualPosition+correction;
  }
  progressAnchorTime=now;
}
function resetProgress(){acceptRemoteProgress=false;state.position=0;state.duration=0;state.manualPosition=0;state.resumePosition=0;state.seeking=false;pendingSeekPosition=null;pendingSeekUntil=0;progressVisualPosition=0;progressAnchorPosition=0;progressAnchorTime=performance.now();progressLastFrame=0;progressDisplayedSecond=0;paintProgress(0);if($('elapsed'))$('elapsed').textContent='0:00';if($('duration'))$('duration').textContent='0:00'}
const nativeApp=!!(window.WEATHER_RECORD_NATIVE||window.WEATHER_RECORD_PORTABLE);if(nativeApp&&!window.weatherRecordDesktop)document.documentElement.classList.add('native-app');
const nativeSend=(name,body={})=>portableSend(name,body);
let nativeCurrentTrackURI='';
function selectedContainsTrack(uri){if(!uri)return false;if(state.mode==='single')return state.track?.uri===uri;return state.albumTracks.some(track=>track.uri===uri)}
window.addEventListener('weatherRecordSpotifyState',event=>{
  if(!nativeApp)return;
  const d=event.detail;
  if(d.token&&d.token!==state.token){state.token=d.token;document.getElementById('spotifyReconnect').textContent=isEnglish?'Spotify Connected':'Spotify 已连接';maybeChooseInitial()}
  if(state.mode==='single'&&!queueRestored){scheduleQueueSync();return}
  if(queueNavigationBusy){queueNavigationState=d;return}
  const remoteTrackChanged=!!d.trackURI&&!!nativeCurrentTrackURI&&d.trackURI!==nativeCurrentTrackURI;
  if(d.trackURI)nativeCurrentTrackURI=d.trackURI;
  const selectedIsCurrent=!!d.trackURI&&(state.mode==='single'
    ? selectedContainsTrack(d.trackURI)||selectedContainsTrack(d.linkedTrackURI)
    : !!state.album?.uri&&(d.albumURI===state.album.uri||d.contextURI===state.album.uri));
  if(typeof d.playing==='boolean')setPlaying(d.connected===false?false:!!d.playing&&selectedIsCurrent);
  state.hasPausedTrack=!!d.connected&&selectedIsCurrent;
  if(state.hasPausedTrack){
    acceptRemoteProgress=true;
    localConfirmPlayback(d);
  }
  const freshSample=d.sampleVersion===undefined||d.sampleVersion>lastProgressSample;
  if(acceptRemoteProgress&&d.duration>0&&selectedIsCurrent&&freshSample){
    if(d.sampleVersion!==undefined)lastProgressSample=d.sampleVersion;
    const age=d.sampledAt?Math.max(0,Math.min(5000,Date.now()-d.sampledAt)):0;
    const now=performance.now(),remotePosition=Math.min(d.duration,Math.max(0,Number(d.position)||0)+(d.playing?age:0));
    if(pendingSeekPosition!==null&&now>pendingSeekUntil){pendingSeekPosition=null;pendingSeekUntil=0}
    const seekPending=pendingSeekPosition!==null;
    const seekConfirmed=seekPending&&Math.abs(remotePosition-pendingSeekPosition)<2200;
    state.duration=d.duration;
    if(!state.seeking&&(!seekPending||seekConfirmed))syncProgressAnchor(remotePosition,remoteTrackChanged||!d.playing||seekConfirmed);
    if(seekConfirmed){pendingSeekPosition=null;pendingSeekUntil=0}
    state.position=!d.playing||remoteTrackChanged||seekConfirmed?remotePosition:progressVisualPosition;
    state.updatedAt=now;
    if(!d.playing&&!state.seeking){paintProgress(remotePosition/d.duration*100);$('elapsed').textContent=fmt(remotePosition)}
    $('duration').textContent=fmt(d.duration)
  }
  if(d.trackURI){updateTrackRatingPlayback(d.trackURI,!!d.connected&&!!d.playing);document.querySelectorAll('#trackList li').forEach(li=>li.classList.toggle('current',li.dataset.uri===d.trackURI&&selectedIsCurrent));if(d.connected&&selectedIsCurrent)observePlaybackTrack(d.trackURI)}
  if(d.connected&&d.playing&&selectedIsCurrent)scheduleQueueSync();
});
const CLIENT_ID=portableClientID(),REDIRECT='http://127.0.0.1:5500/';
const isEnglish=!!window.WEATHER_RECORD_LOCALE?.english;
try{document.body.classList.toggle('landscape-swapped',localStorage.getItem('atmos_landscape_swapped')==='true')}catch{}
const periods=isEnglish?{morning:'Morning',noon:'Noon',afternoon:'Afternoon',evening:'Dusk',night:'Night'}:{morning:'清晨',noon:'中午',afternoon:'午后',evening:'黄昏',night:'夜晚'},weatherText=isEnglish?{unknown:'Weather pending',clear:'Clear',cloud:'Cloudy',rain:'Rainy',snow:'Snowy',storm:'Stormy'}:{unknown:'天气待定',clear:'晴朗',cloud:'多云',rain:'有雨',snow:'降雪',storm:'雷雨'};
const albumSeeds=[
  'Radiohead In Rainbows','Radiohead OK Computer','Adele 21','Frank Ocean Blonde','The Beatles Abbey Road','The Beatles Revolver','Pink Floyd The Dark Side of the Moon','Pink Floyd Wish You Were Here','Beyoncé Lemonade','Beyoncé Renaissance','Kendrick Lamar To Pimp a Butterfly','Kendrick Lamar DAMN','Amy Winehouse Back to Black','Daft Punk Discovery','Daft Punk Random Access Memories','Fleetwood Mac Rumours','Nirvana Nevermind','Taylor Swift Folklore','Taylor Swift 1989','Billie Eilish Hit Me Hard and Soft','SZA SOS','The Weeknd After Hours','Lana Del Rey Norman Fucking Rockwell','Tame Impala Currents','Arctic Monkeys AM',
  'Michael Jackson Thriller','Prince Purple Rain','Stevie Wonder Songs in the Key of Life','Marvin Gaye What’s Going On','Joni Mitchell Blue','David Bowie Hunky Dory','David Bowie Blackstar','Kate Bush Hounds of Love','The Rolling Stones Exile on Main St','Led Zeppelin IV','The Velvet Underground The Velvet Underground & Nico','Bob Dylan Blood on the Tracks','Bruce Springsteen Born to Run','The Clash London Calling','Talking Heads Remain in Light','Joy Division Unknown Pleasures','The Cure Disintegration','Depeche Mode Violator','New Order Power Corruption & Lies','U2 The Joshua Tree','R.E.M. Automatic for the People','Oasis Definitely Maybe','Blur Parklife','Pulp Different Class','The Strokes Is This It','The White Stripes Elephant','The Killers Hot Fuss','Coldplay A Rush of Blood to the Head',
  'Lauryn Hill The Miseducation of Lauryn Hill','Nas Illmatic','The Notorious B.I.G. Ready to Die','2Pac All Eyez on Me','Outkast Stankonia','Kanye West My Beautiful Dark Twisted Fantasy','Jay-Z The Blueprint','Tyler The Creator IGOR','J. Cole 2014 Forest Hills Drive','Travis Scott Astroworld','Childish Gambino Awaken My Love','A Tribe Called Quest The Low End Theory','MF DOOM Madvillainy','Little Simz Sometimes I Might Be Introvert',
  'Miles Davis Kind of Blue','John Coltrane A Love Supreme','Charles Mingus The Black Saint and the Sinner Lady','Herbie Hancock Head Hunters','Nina Simone Pastel Blues','Bill Evans Waltz for Debby','Kamasi Washington The Epic','Yussef Dayes Black Classical Music','Norah Jones Come Away with Me','Sade Love Deluxe','D’Angelo Voodoo','Erykah Badu Baduizm','Solange A Seat at the Table','Anderson Paak Malibu',
  'Massive Attack Mezzanine','Portishead Dummy','Air Moon Safari','Aphex Twin Selected Ambient Works 85-92','Boards of Canada Music Has the Right to Children','Burial Untrue','Four Tet There Is Love in You','The xx xx','James Blake James Blake','Jamie xx In Colour','Bonobo Black Sands','Nicolas Jaar Space Is Only Noise','Brian Eno Ambient 1 Music for Airports','Kraftwerk The Man-Machine','Justice Cross','Gorillaz Demon Days',
  'Björk Homogenic','Björk Vespertine','Sigur Rós Ágætis byrjun','Bon Iver For Emma Forever Ago','Sufjan Stevens Carrie & Lowell','Phoebe Bridgers Punisher','Mitski Be the Cowboy','Fiona Apple Fetch the Bolt Cutters','Lorde Melodrama','Charli XCX Brat','Caroline Polachek Desire I Want to Turn Into You','Olivia Rodrigo Sour','Dua Lipa Future Nostalgia','Harry Styles Fine Line',
  'Bad Bunny Un Verano Sin Ti','Rosalía Motomami','Karol G Mañana Será Bonito','J Balvin Vibras','Shakira Dónde Están los Ladrones','Buena Vista Social Club Buena Vista Social Club','Natalia Lafourcade De Todas las Flores','Caetano Veloso Transa','Gilberto Gil Expresso 2222','João Gilberto Chega de Saudade','Antonio Carlos Jobim Wave','Seu Jorge The Life Aquatic Studio Sessions',
  '坂本龍一 async','宇多田ヒカル Fantôme','宇多田ヒカル BADモード','椎名林檎 無罪モラトリアム','山下達郎 FOR YOU','大貫妙子 SUNSHOWER','Nujabes Modal Soul','Nujabes Metaphorical Music','Lamp For Lovers','Fishmans Long Season','YMO Solid State Survivor','Haruomi Hosono Hosono House','BTS Love Yourself Tear','NewJeans Get Up','IU Palette','BLACKPINK The Album',
  '周杰伦 范特西','周杰伦 叶惠美','王菲 天空','王菲 浮躁','陈奕迅 U87','林俊杰 江南','孙燕姿 逆光','蔡依林 呸','张惠妹 阿密特','陶喆 黑色柳丁','方大同 未来','邓紫棋 摩天动物园','五月天 人生海海','痛仰 不要停止我的音乐','万能青年旅店 万能青年旅店','草东没有派对 丑奴儿','落日飞车 Cassa Nova','告五人 运气来得若有似无'
];
const moodArtists={
  motivate:['Beyoncé','Kendrick Lamar','Michael Jackson','Prince','Outkast','Kanye West','Tyler The Creator','Travis Scott','The Strokes','The White Stripes','The Killers','Nirvana','Coldplay','BTS','BLACKPINK','周杰伦','邓紫棋','五月天','告五人','Little Simz'],
  pop:['Adele','Taylor Swift','Billie Eilish','The Weeknd','SZA','Dua Lipa','Harry Styles','Olivia Rodrigo','Lorde','Charli XCX','Bad Bunny','Karol G','J Balvin','Shakira','NewJeans','IU','宇多田ヒカル','蔡依林','林俊杰','孙燕姿','陈奕迅','Rosalía'],
  relaxed:['Radiohead','Fleetwood Mac','Tame Impala','Air','Bonobo','Four Tet','The xx','Nujabes','Lamp','Fishmans','落日飞车','方大同','Norah Jones','Sade','Erykah Badu','Anderson Paak','宇多田ヒカル','山下達郎','大貫妙子','王菲','Fiona Apple','Buena Vista Social Club'],
  soft:['Adele','Frank Ocean','Amy Winehouse','Joni Mitchell','Nina Simone','Bill Evans','Sade','Norah Jones','Brian Eno','Sigur Rós','Bon Iver','Sufjan Stevens','Phoebe Bridgers','Mitski','Lana Del Rey','王菲','陈奕迅','坂本龍一','大貫妙子','Lamp','Fishmans','Natalia Lafourcade'],
  vivid:['Daft Punk','Gorillaz','Justice','Dua Lipa','Beyoncé','The Weeknd','Michael Jackson','Prince','Kendrick Lamar','Rosalía','Bad Bunny','NewJeans','Charli XCX','蔡依林','邓紫棋','五月天','The Strokes','Coldplay','Arctic Monkeys','Taylor Swift','J Balvin'],
  night:['Massive Attack','Portishead','Burial','James Blake','Nicolas Jaar','Boards of Canada','Björk','Frank Ocean','SZA','Lana Del Rey','The Weeknd','Radiohead','Depeche Mode','Joy Division','The Cure','落日飞车','草东没有派对','王菲','宇多田ヒカル','Fishmans']
};
const periodWeights={
  morning:{motivate:65,pop:25,relaxed:10},noon:{pop:65,vivid:25,relaxed:10},
  afternoon:{relaxed:65,pop:20,soft:15},evening:{vivid:45,relaxed:30,night:25},
  night:{night:55,soft:35,relaxed:10}
};
const weatherWeights={
  clear:{vivid:40,motivate:25,pop:35},cloud:{relaxed:65,soft:35},
  rain:{soft:65,relaxed:25,night:10},snow:{soft:70,relaxed:30},
  storm:{night:45,soft:35,relaxed:20}
};
const weatherInfluence={clear:.55,cloud:.30,rain:.85,snow:.80,storm:.70,unknown:0};
const moodStyle=isEnglish?{motivate:'driven rhythm',pop:'bright pop energy',relaxed:'easygoing flow',soft:'soft textures',vivid:'high energy',night:'deep atmosphere'}:{motivate:'节奏积极',pop:'流行感鲜明',relaxed:'松弛自在',soft:'声音柔和',vivid:'能量充沛',night:'氛围深沉'};
const periodReason=isEnglish?{morning:'Morning calls for a fresh, motivating rhythm',noon:'Midday suits bright and familiar pop melodies',afternoon:'Afternoon is made for relaxed, open sounds',evening:'Dusk suits layered grooves',night:'Night calls for quiet, immersive sounds'}:{morning:'清晨适合有推动力的节奏',noon:'中午适合明亮熟悉的流行旋律',afternoon:'午后适合舒展放松的音乐',evening:'黄昏适合有层次的律动',night:'夜晚适合安静沉浸的声音'};
const weatherReason=isEnglish?{clear:'clear skies add a little extra energy',cloud:'clouds leave room for something gentler',rain:'rain softens the sound',snow:'snow favors warmth and quiet',storm:'storms favor a deeper atmosphere'}:{clear:'晴天再添一点活力',cloud:'多云时留些舒缓的空间',rain:'雨天把声音放柔和',snow:'雪天偏向温暖轻柔',storm:'雷雨天偏向沉静的氛围'};
const modeLabel=()=>state.mode==='single'?(isEnglish?'Liked Songs · Random Track':'我的喜欢 · 随机单曲'):(isEnglish?'Full Album':'整张专辑');
const randomInt=max=>{if(max<=1)return 0;const bound=0x100000000-0x100000000%max;const buffer=new Uint32Array(1);do{crypto.getRandomValues(buffer)}while(buffer[0]>=bound);return buffer[0]%max};
const moodBags={};
function nextMoodSeed(mood){
  const artists=moodArtists[mood],pool=albumSeeds.filter(seed=>artists.some(artist=>seed.startsWith(artist+' ')));
  if(!moodBags[mood]?.length){moodBags[mood]=pool.map((_,i)=>i);for(let i=moodBags[mood].length-1;i>0;i--){const j=randomInt(i+1);[moodBags[mood][i],moodBags[mood][j]]=[moodBags[mood][j],moodBags[mood][i]]}}
  return pool[moodBags[mood].pop()];
}
function recommendationKey(){return `${state.period||'afternoon'}|${state.weather}|${state.weatherCode??''}|${state.atmosSlot||''}`}
function pickMood(){
  const base=periodWeights[state.period]||periodWeights.afternoon,weather=weatherWeights[state.weather]||{},influence=weatherInfluence[state.weather]||0;
  const weighted=Object.keys(moodArtists).map(mood=>({mood,weight:(base[mood]||0)*(1-influence)+(weather[mood]||0)*influence}));
  let draw=randomInt(10000)/100;
  for(const item of weighted){draw-=item.weight;if(draw<0)return item.mood}
  return weighted[weighted.length-1].mood;
}
function weatherFromCode(code){if(code===0)return'clear';if(code>=95)return'storm';if((code>=71&&code<=77)||(code>=85&&code<=86))return'snow';if((code>=51&&code<=67)||(code>=80&&code<=82))return'rain';return'cloud'}
const recentKey='weather_record_recent_v2';
const recent=(()=>{try{return JSON.parse(localStorage.getItem(recentKey))||{album:[],single:[]}}catch{return{album:[],single:[]}}})();
const selectionCachePrefix='weather_record_selection_v1_';
const weatherCacheKey='weather_record_weather_v1';
let cachedSelectionVisible=false;
function remember(mode,uri){if(!uri)return;const list=recent[mode]||[];recent[mode]=[uri,...list.filter(item=>item!==uri)].slice(0,mode==='album'?500:300);localStorage.setItem(recentKey,JSON.stringify(recent))}
function unseen(mode,uri){return uri&&!recent[mode]?.includes(uri)}
function albumKey(album){const name=(album.name||'').replace(/\([^)]*(deluxe|remaster|anniversary|edition|expanded|bonus)[^)]*\)/gi,'').replace(/\s[-–]\s.*\b(deluxe|remaster|anniversary|edition|expanded|bonus)\b.*$/i,'').trim().toLocaleLowerCase();const artist=(album.artists?.[0]?.name||album.artist||'').trim().toLocaleLowerCase();return `${artist}|${name}`}
let seedBag=[];
function nextSeed(){if(!seedBag.length){seedBag=Array.from({length:albumSeeds.length},(_,i)=>i);for(let i=seedBag.length-1;i>0;i--){const j=randomInt(i+1);[seedBag[i],seedBag[j]]=[seedBag[j],seedBag[i]]}}return albumSeeds[seedBag.pop()]}
const likedBagKey='weather_record_liked_bag_v1';
let likedBag=null;
function nextLikedIndex(total){
  if(!likedBag){try{likedBag=JSON.parse(localStorage.getItem(likedBagKey))}catch{} }
  if(!likedBag||likedBag.total!==total||!Array.isArray(likedBag.indices)||!likedBag.indices.length){
    const indices=Array.from({length:total},(_,i)=>i);
    for(let i=indices.length-1;i>0;i--){const j=randomInt(i+1);[indices[i],indices[j]]=[indices[j],indices[i]]}
    likedBag={total,indices};
  }
  const index=likedBag.indices.pop();
  localStorage.setItem(likedBagKey,JSON.stringify(likedBag));
  return index;
}
const fmt=ms=>{const s=Math.max(0,Math.floor((ms||0)/1000));return`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`};
function setPlaying(v){const wasPlaying=state.playing,changed=wasPlaying!==v||!$('playIcon').firstElementChild;state.playing=v;window.weatherRecordDesktop?.render(state);if(v&&!wasPlaying){playbackStartedAt=Date.now();progressAnchorPosition=progressVisualPosition;progressAnchorTime=performance.now();progressLastFrame=0}if(changed){$('playIcon').innerHTML=v?'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.8c0-.8.9-1.3 1.6-.9l10 6.2a1 1 0 0 1 0 1.7l-10 6.2a1 1 0 0 1-1.6-.9z"/></svg>';$('playText').textContent=v?(isEnglish?'Pause':'暂停'):(isEnglish?'Play':'播放')}if(v&&!coverGestureActive)startProgressUpdates();else stopProgressUpdates()}
function tags(){
  if(workoutMode){const artist=state.track?.artists?.map(x=>x.name).join(', ')||'';$('moodHint').textContent=isEnglish?'WORKOUT':'健身模式';$('tags').innerHTML=[isEnglish?'Liked Songs':'我的喜欢',isEnglish?'Strong groove':'强律动'].map(x=>`<span class="tag">${x}</span>`).join('');$('albumDescription').textContent=state.albumError||(artist?(isEnglish?`${artist} · Selected from your liked songs to keep a strong, steady workout rhythm.`:`${artist} · 从你的喜欢中选出的强律动歌曲，用稳定节奏保持训练状态。`):(isEnglish?'Choosing a strong-groove track from your liked songs…':'正在从你的喜欢中挑选强律动歌曲…'));$('matchPercent').textContent='WORKOUT';return}
  const weather=weatherText[state.weather],period=periods[state.period]||(isEnglish?'Now':'此刻'),mode=modeLabel();
  $('moodHint').textContent=`${weather} · ${period}`;
  $('tags').innerHTML=[weather,period,mode,state.selectionMood?moodStyle[state.selectionMood]:null].filter(Boolean).map(x=>`<span class="tag">${x}</span>`).join('');
  const timeWhy=periodReason[state.period]||(isEnglish?'This moment suits a carefully chosen record':'此刻适合听一张唱片'),weatherWhy=weatherReason[state.weather];
  $('albumDescription').textContent=isEnglish?(state.mode==='single'?`${timeWhy}${weatherWhy?', and '+weatherWhy:''}. Randomly selected from your liked songs.`:state.selectionMood?`${timeWhy}${weatherWhy?', and '+weatherWhy:''}. This album brings ${moodStyle[state.selectionMood]}.`:`${timeWhy}${weatherWhy?', and '+weatherWhy:''}. Exploring a wider album library this time.`):(state.mode==='single'?`${timeWhy}${weatherWhy?'，'+weatherWhy:''}；从你喜欢的歌曲里随机抽取。`:state.selectionMood?`${timeWhy}${weatherWhy?'，'+weatherWhy:''}；这张专辑${moodStyle[state.selectionMood]}。`:`${timeWhy}${weatherWhy?'，'+weatherWhy:''}；这次从更广的曲库探索一张专辑。`);
  if(state.mode==='album'&&state.pitchforkReview?.albumKey===albumKey(state.album||{})){
    if(state.pitchforkReview.loading)$('albumDescription').textContent=isEnglish?'Loading the Pitchfork review…':'正在读取 Pitchfork 专辑评价…';
    else if(state.pitchforkReview.error)$('albumDescription').textContent=state.pitchforkReview.error;
    else if(state.pitchforkReview.summary){const score=state.pitchforkReview.score?` ${state.pitchforkReview.score}`:'';$('albumDescription').textContent=`Pitchfork${score}：${state.pitchforkReview.summary}`}
  }
  const stale=state.mode==='album'&&state.album?.uri&&state.selectionContextKey&&state.selectionContextKey!==recommendationKey();
  if(stale)$('albumDescription').textContent=isEnglish?'The weather or time has changed. The next pick will use the current conditions.':'天气或时段已更新，下一张会按现在的条件推荐。';
  if(state.albumError)$('albumDescription').textContent=state.albumError;
  $('matchPercent').textContent=state.mode==='single'?(isEnglish?'LIKED SONGS':'我的喜欢'):stale?(isEnglish?'UPDATE NEXT':'下次更新'):state.selectionMood?(isEnglish?'WEATHER × TIME':'天气 × 时间'):(isEnglish?'DISCOVERY':'随机探索');
}
let pitchforkRequest=0;
const pitchforkCachePrefix=`weather_record_pitchfork_v2_${isEnglish?'en':'zh'}_`;
function requestPitchforkReview(album){
  closeDescriptionModal();
  if(state.mode==='single'){pitchforkRequest++;state.pitchforkReview=null;return}
  const artist=album?.artists?.[0]?.name||album?.artist||'',name=album?.name||'',key=albumKey(album||{}),requestId=++pitchforkRequest;
  state.pitchforkReview=null;
  if(!name||!artist)return;
  try{const cached=JSON.parse(localStorage.getItem(pitchforkCachePrefix+key));if(cached?.summary){state.pitchforkReview={...cached,albumKey:key};tags(state.mode==='single'?'随机单曲':'整张专辑');return}}catch{}
  if(nativeApp&&!portableAStudio){state.pitchforkReview={albumKey:key,loading:true};tags(state.mode==='single'?'随机单曲':'整张专辑');nativeSend('pitchforkReview',{requestId,albumURI:album.uri||key,albumKey:key,albumName:name,artistName:artist})}
}
window.addEventListener('weatherRecordPitchfork',event=>{
  const result=event.detail;
  if(result.requestId!==pitchforkRequest||result.albumKey!==albumKey(state.album||{}))return;
  if(result.error){state.pitchforkReview={albumKey:result.albumKey,error:result.error};tags(state.mode==='single'?'随机单曲':'整张专辑');return}
  if(!result.summary)return;
  state.pitchforkReview=result;
  if((isEnglish&&!result.translated)||(!isEnglish&&result.translated))try{localStorage.setItem(pitchforkCachePrefix+result.albumKey,JSON.stringify(result))}catch{}
  tags(state.mode==='single'?'随机单曲':'整张专辑');
});
function openDescriptionModal(){const text=$('albumDescription').textContent.trim(),modal=$('descriptionModal');if(!text||!modal)return;$('descriptionFull').textContent=text;$('descriptionModalTitle').textContent=text.startsWith('Pitchfork')?'PITCHFORK REVIEW':'ALBUM NOTE';modal.classList.add('open');modal.setAttribute('aria-hidden','false');$('descriptionClose').focus()}
function closeDescriptionModal(){const modal=$('descriptionModal');if(!modal?.classList.contains('open'))return;modal.classList.remove('open');modal.setAttribute('aria-hidden','true');requestAnimationFrame(tryPresentTrackRating)}
function bindDescriptionModal(){const description=$('albumDescription'),modal=$('descriptionModal');description.tabIndex=0;description.setAttribute('role','button');description.setAttribute('aria-label','查看完整专辑简介');description.onclick=openDescriptionModal;description.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openDescriptionModal()}};$('descriptionClose').onclick=closeDescriptionModal;modal.onclick=event=>{if(event.target===modal)closeDescriptionModal()};document.addEventListener('keydown',event=>{if(event.key==='Escape')closeDescriptionModal()})}
function renderAlbum(a,mode){state.album=a;window.weatherRecordDesktop?.render(state);$('albumName').textContent=a.name||'';$('artTitle').textContent=a.name||'';$('artistName').textContent=a.artists?.map(x=>x.name).join(', ')||a.artist||'';$('artArtist').textContent=$('artistName').textContent;if(a.images?.[0]?.url){$('albumArt').style.backgroundImage=`url("${a.images[0].url}")`;$('albumArt').style.backgroundSize='cover';$('albumArt').style.backgroundPosition='center'}tags(mode);requestPitchforkReview(a)}
function refreshLandscapeTrack(){if(landscapeLyrics())loadLyricsForTrack(lyricsTrack())}
function renderTracks(items){
  $('trackCount').textContent=items.length?`${items.length} 首`:'';
  const rows=items.map((track,index)=>{
    const row=document.createElement('li'),number=document.createElement('span');
    row.dataset.uri=track.uri;
    number.textContent=String(index+1).padStart(2,'0');
    row.append(number,track.name||'');
    return row;
  });
  if(!rows.length){
    const empty=document.createElement('li');
    empty.className='empty-track';
    empty.textContent='暂无曲目';
    rows.push(empty);
  }
  $('trackList').replaceChildren(...rows);
  requestAnimationFrame(refreshLandscapeTrack);
}
function cacheSelection(selection){
  if(!selection?.album?.uri)return;
  try{localStorage.setItem(selectionCachePrefix+selection.mode,JSON.stringify({...selection,cachedAt:Date.now()}))}catch(error){console.warn('Selection cache unavailable',error)}
}
function restoreCachedSelection(){
  try{
    const selection=JSON.parse(localStorage.getItem(selectionCachePrefix+state.mode));
    if(!selection?.album?.uri)return false;
    cachedSelectionVisible=true;playbackTargetPending=true;state.hasPausedTrack=false;state.track=selection.track||null;state.albumTracks=selection.tracks||[];state.selectionMood=selection.mood||null;state.selectionContextKey=selection.contextKey||null;
    renderAlbum(selection.album,selection.mode==='single'?'随机单曲':'整张专辑');
    if(selection.track){$('albumName').textContent=selection.track.name;$('artistName').textContent=selection.track.artists?.map(artist=>artist.name).join(', ')||''}
    renderTracks(state.albumTracks);tags(selection.mode==='single'?'随机单曲':'整张专辑');
    return true;
  }catch(error){return false}
}
function restoreCachedWeather(){
  try{
    const cached=JSON.parse(localStorage.getItem(weatherCacheKey));
    if(!cached||Date.now()-cached.savedAt>3*60*60*1000)return false;
    state.weatherCode=cached.code??null;state.weather=cached.weather;state.weatherReady=true;$('temperature').textContent=Math.round(cached.temperature)+'°';$('weatherLabel').textContent=weatherText[cached.weather]||'天气待定';return true;
  }catch(error){return false}
}
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
const afterVisualFrame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
let spotifyRequestTail=Promise.resolve(),spotifyNextRequestAt=0,spotifyCooldownUntil=0;
function queuedSpotifyFetch(url,options){
  const run=async()=>{const delay=Math.max(0,spotifyNextRequestAt-Date.now(),spotifyCooldownUntil-Date.now());if(delay)await wait(delay);const token=nativeApp?state.token:await getWebSpotifyToken();spotifyNextRequestAt=Date.now()+240;return fetch(url,{...options,headers:{Authorization:`Bearer ${token}`,...(options.headers||{})}})};
  const request=spotifyRequestTail.then(run,run);spotifyRequestTail=request.then(()=>undefined,()=>undefined);return request;
}
async function api(url,options={}){
  const endpoint=new URL(url);if(endpoint.origin!=='https://api.spotify.com')throw Error('Unsupported Spotify endpoint');
  return portableAPI(endpoint.pathname.replace(/^\/v1/, '')+endpoint.search,options.method||'GET',options.body?JSON.parse(options.body):undefined);
}
let observedTrackURI='',lastConfirmedTrackURI='',playbackTargetPending=false,trackLookupGeneration=0,coverTransitioning=false,deferredTrackURI='',coverGestureActive=false,playbackStartedAt=0;
function displayPlayingTrack(track){
  state.track=track;
  window.weatherRecordDesktop?.render(state);
  if(track.album?.uri!==state.album?.uri){
    state.selectionMood=null;state.selectionContextKey=null;
    renderAlbum(track.album,state.mode==='single'?'随机单曲':'整张专辑');
    if(state.mode==='album')renderTracks([track]);
  }
  if(state.mode==='single'){
    $('albumName').textContent=track.name;
    $('artistName').textContent=track.artists?.map(artist=>artist.name).join(', ')||'';
    renderTracks([track]);tags('随机单曲');
  }
  document.querySelectorAll('#trackList li').forEach(li=>li.classList.toggle('current',li.dataset.uri===track.uri));
  if(lyricsVisible()){if(!landscapeLyrics())showLyricsMetadata(track);loadLyricsForTrack(track)}
  cacheSelection({mode:state.mode,album:state.album,track:state.mode==='single'?track:null,tracks:state.mode==='single'?[track]:state.albumTracks,mood:state.selectionMood,contextKey:state.selectionContextKey});
  if(nativeApp&&state.mode==='single'){prepareNext();scheduleQueueSync()}
  if(ratingPlayback.ready)requestAnimationFrame(tryPresentTrackRating);
}
async function animateAutomaticTrack(track,generation){
  if(track.album?.uri!==state.album?.uri)await preloadCover(track.album?.images?.[0]?.url);
  if(generation!==trackLookupGeneration||observedTrackURI!==track.uri)return false;
  if(coverTransitioning||coverGestureActive){deferredTrackURI=track.uri;return false}
  const cover=$('albumArt'),rect=cover.getBoundingClientRect(),outgoing=cover.cloneNode(true);
  outgoing.removeAttribute('id');outgoing.querySelectorAll('[id]').forEach(node=>node.removeAttribute('id'));
  Object.assign(outgoing.style,{position:'fixed',left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,margin:'0',transform:'none',opacity:'1',pointerEvents:'none',zIndex:'30'});
  coverTransitioning=true;
  try{
    document.body.appendChild(outgoing);
    cover.style.transition='none';cover.style.transform='none';cover.style.opacity='0';
    displayPlayingTrack(track);
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
      const exit=outgoing.animate([{transform:'translate(0,0) rotate(0deg)',opacity:1},{transform:`translate(${window.innerWidth*1.1}px,36px) rotate(14deg)`,opacity:0}],{duration:360,easing:'cubic-bezier(.18,.72,.28,1)',fill:'forwards'});
      const reveal=cover.animate([{transform:'translateY(48px) scale(.96)',opacity:0},{transform:'translateY(0) scale(1)',opacity:1}],{duration:620,easing:'cubic-bezier(.16,.72,.22,1)',fill:'forwards'});
      await Promise.all([exit.finished.catch(()=>{}),reveal.finished.catch(()=>{})]);
      exit.cancel();reveal.cancel();
    }
  }finally{
    cover.style.opacity='1';cover.style.transform='none';outgoing.remove();coverTransitioning=false;
    scheduleQueueSync();
    if(deferredTrackURI&&deferredTrackURI!==track.uri){const next=deferredTrackURI;deferredTrackURI='';observePlaybackTrack(next)}else deferredTrackURI='';
  }
  return true;
}
async function observePlaybackTrack(uri){
  if(coverTransitioning||coverGestureActive){deferredTrackURI=uri;return}
  if(!state.token||!uri?.startsWith('spotify:track:')||uri===observedTrackURI)return;
  observedTrackURI=uri;
  const generation=++trackLookupGeneration;
  try{
    const track=queueTrackCache.get(uri)||await api(`https://api.spotify.com/v1/tracks/${encodeURIComponent(uri.split(':').pop())}`);
    if(generation!==trackLookupGeneration||observedTrackURI!==uri||coverTransitioning)return;
    if(playbackTargetPending){
      const expected=state.mode==='single'?state.track?.uri===uri:state.album?.uri===track.album?.uri;
      if(!expected){observedTrackURI='';return}
      playbackTargetPending=false;
    }
    atmosRecord(track);
    const animateNext=!!lastConfirmedTrackURI&&lastConfirmedTrackURI!==uri&&Date.now()-playbackStartedAt>5000;
    if(animateNext){if(await animateAutomaticTrack(track,generation))lastConfirmedTrackURI=uri}
    else{if(track.album?.uri!==state.album?.uri)await preloadCover(track.album?.images?.[0]?.url);if(generation!==trackLookupGeneration||coverTransitioning)return;displayPlayingTrack(track);lastConfirmedTrackURI=uri}
  }catch(error){observedTrackURI=''}
}
const spotifyMessage = (zh, en) => isEnglish ? en : zh;
let webPlayerError = '';
function showWebSpotifyStatus(message, label) {
  const button = $('spotifyReconnect');
  if (button) {
    button.textContent = label;
    button.title = message;
  }
  const status = $('webSpotifyStatus');
  if (status) {
    status.textContent = message;
    status.hidden = !message;
  }
}

function clearWebSpotifySession() {
  state.token = null;
  state.deviceId = null;
  const player = state.player;
  state.player = null;
  player?.disconnect();
  localStorage.removeItem('spotify_access_token');
  localStorage.removeItem('spotify_refresh_token');
  localStorage.removeItem('spotify_token_expires_at');
}

async function requestWebSpotifyToken(fields) {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({client_id: CLIENT_ID, ...fields}),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    throw Object.assign(new Error(result.error_description || result.error || `HTTP ${response.status}`), {
      spotifyError: result.error,
    });
  }
  state.token = result.access_token;
  localStorage.setItem('spotify_access_token', state.token);
  if (result.refresh_token) localStorage.setItem('spotify_refresh_token', result.refresh_token);
  localStorage.setItem('spotify_token_expires_at', String(Date.now() + result.expires_in * 1000));
  return state.token;
}

let webSpotifyRefresh;
async function getWebSpotifyToken() {
  const expiresAt = Number(localStorage.getItem('spotify_token_expires_at'));
  const refreshToken = localStorage.getItem('spotify_refresh_token');
  if (!refreshToken || (state.token && expiresAt > Date.now() + 60000)) return state.token;
  if (!webSpotifyRefresh) {
    webSpotifyRefresh = requestWebSpotifyToken({grant_type: 'refresh_token', refresh_token: refreshToken})
      .catch(error => {
        if (error.spotifyError === 'invalid_grant') clearWebSpotifySession();
        throw error;
      })
      .finally(() => { webSpotifyRefresh = null; });
  }
  return webSpotifyRefresh;
}

async function connectSpotify(){
  try{await portableConnect()}
  catch(error){showWebSpotifyStatus(error.message,spotifyMessage('连接 Spotify','Connect Spotify'))}
}
async function handleCallback(){return portableCallback()}
function createPlayer(){return localCreatePlayer()}
function setStatus(t){$('playText').textContent=t}
let nextSelectionSlots=[],nextSelectionEpoch=0;
const queueTrackCache=new Map();
function invalidateNextSelections(){
  // Weather changes affect newly generated slots, never reorder music already
  // committed to Spotify. Mode changes still discard the old local plan.
  if(nativeApp&&state.mode==='single'&&nextSelectionSlots.length&&nextSelectionSlots.every(slot=>slot.mode==='single'))return;
  nextSelectionEpoch++;nextSelectionSlots=[];clearTimeout(prepareNextTimer);queueWriter.invalidate();clearTimeout(queueSyncTimer);queueSyncTimer=null;queueStatus('');
}
const decodedCovers=new Map();
async function preloadCover(url){
  if(!url)return;
  if(decodedCovers.has(url))return decodedCovers.get(url);
  const img=new Image();img.decoding='async';img.src=url;
  const loading=img.decode().then(()=>img).catch(()=>null);
  decodedCovers.set(url,loading);
  if(decodedCovers.size>8)decodedCovers.delete(decodedCovers.keys().next().value);
  return loading;
}
const lyricsCache=new Map();
const lyricsPending = new Map();
const nativeLyricsReplies = new Map();
let nativeLyricsRequestId = 0, pendingLyricsView = 0, lyricMeasuredAt = 0;
let lyricsRequest=0,displayedLyricsURI='',timedLyrics=[],activeLyricIndex=-1,lyricsViewportHeight=0,lyricMotionTimer=null;
function parseSyncedLyrics(source){
  const parsed=[];
  for(const row of (source||'').split(/\r?\n/)){
    const stamps=[...row.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if(!stamps.length)continue;
    const text=row.replace(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g,'').trim()||'♪';
    for(const stamp of stamps){const fraction=stamp[3]?Number(stamp[3])/10**stamp[3].length:0;parsed.push({time:Number(stamp[1])*60+Number(stamp[2])+fraction,text})}
  }
  return parsed.sort((a,b)=>a.time-b.time);
}
function lyricsTrack(){
  if(state.track?.uri)return state.track;
  if(state.mode==='album'&&state.albumTracks[0])return {...state.albumTracks[0],album:state.album};
  return null;
}
function showLyricsMetadata(track){
  if(!track?.name)return;
  $('albumName').textContent=track.name;
  $('artistName').textContent=track.artists?.map(artist=>artist.name).join(', ')||state.album?.artists?.map(artist=>artist.name).join(', ')||'';
}
function restoreAlbumMetadata(){
  if(state.mode!=='album'||!state.album)return;
  $('albumName').textContent=state.album.name||'';
  $('artistName').textContent=state.album.artists?.map(artist=>artist.name).join(', ')||state.album.artist||'';
}
function lyricsMessage(message){if(lyricMotionTimer)clearTimeout(lyricMotionTimer);lyricMotionTimer=null;timedLyrics=[];activeLyricIndex=-1;lyricsViewportHeight=0;const container=$('lyricsLines');container.style.transition='none';container.style.transform='translate3d(0,0,0)';container.replaceChildren();$('lyricsMessage').textContent=message;$('lyricsMessage').hidden=false}
function renderLyrics(record){
  const lines=parseSyncedLyrics(record.syncedLyrics);
  if(!lines.length){lyricsMessage(record.instrumental?(isEnglish?'This is an instrumental track':'这首是纯音乐，没有歌词'):(isEnglish?'Synced lyrics are not available for this song':'这首歌暂时没有同步歌词'));return}
  if(lyricMotionTimer)clearTimeout(lyricMotionTimer);lyricMotionTimer=null;
  timedLyrics=lines;activeLyricIndex=-1;lyricsViewportHeight=0;
  $('lyricsMessage').hidden=true;
  syncLyricsAt(currentLyricsPosition());
}
function landscapeLyrics(){return nativeApp&&!window.weatherRecordDesktop&&matchMedia('(orientation: landscape)').matches}
function lyricsVisible(){return landscapeLyrics()||$('albumArt').classList.contains('lyrics-open')}
function currentLyricsPosition(){return state.playing?Math.min(state.duration||Infinity,progressVisualPosition):state.position}
function loopedLyric(index){const count=timedLyrics.length;return timedLyrics[((index%count)+count)%count].text}
function focusLyricSlot(slot){
  Array.from($('lyricsLines').children).forEach((node,index)=>{node.classList.toggle('active',index===slot);node.classList.toggle('near',Math.abs(index-slot)===1)});
}
function positionLyricSlot(slot,animated){
  const container=$('lyricsLines'),current=container.children[slot],height=$('lyricsWindow').clientHeight;
  if(!current)return;
  container.style.transition=animated?'transform .68s cubic-bezier(.22,.72,.2,1)':'none';
  const shift=height*.42-current.offsetTop-current.offsetHeight/2;
  container.style.transform=`translate3d(0,${Math.round(shift)}px,0)`;
}
function renderLyricWindow(index){
  if(lyricMotionTimer)clearTimeout(lyricMotionTimer);lyricMotionTimer=null;
  const fragment=document.createDocumentFragment();
  for(let offset=-2;offset<=2;offset++){const node=document.createElement('p');node.className='lyric-line';node.textContent=loopedLyric(index+offset);fragment.appendChild(node)}
  const container=$('lyricsLines');container.replaceChildren(fragment);focusLyricSlot(2);positionLyricSlot(2,false);
  const request=lyricsRequest;
  requestAnimationFrame(()=>{if(request===lyricsRequest&&!lyricMotionTimer)container.style.transition='' });
}
function stepLyricWindow(direction,index){
  const container=$('lyricsLines'),targetSlot=2+direction,request=lyricsRequest;
  focusLyricSlot(targetSlot);positionLyricSlot(targetSlot,true);
  lyricMotionTimer=setTimeout(()=>{
    lyricMotionTimer=null;
    if(request!==lyricsRequest||activeLyricIndex!==index||!timedLyrics.length)return;
    container.style.transition='none';
    if(direction>0){const first=container.firstElementChild;first.textContent=loopedLyric(index+2);container.appendChild(first)}
    else{const last=container.lastElementChild;last.textContent=loopedLyric(index-2);container.insertBefore(last,container.firstChild)}
    focusLyricSlot(2);positionLyricSlot(2,false);
    requestAnimationFrame(()=>{if(request===lyricsRequest&&!lyricMotionTimer)container.style.transition='' });
  },700);
}
function syncLyricsAt(position){
  if(!timedLyrics.length||!lyricsVisible())return;
  const seconds=Math.max(0,position)/1000;
  let low=0,high=timedLyrics.length;
  while(low<high){const mid=(low+high)>>1;if(timedLyrics[mid].time<=seconds)low=mid+1;else high=mid}
  const index=Math.max(0,low-1);
  const now=performance.now();
  const viewportHeight=lyricsViewportHeight&&now-lyricMeasuredAt<1000?lyricsViewportHeight:$('lyricsWindow').clientHeight;
  if(viewportHeight!==lyricsViewportHeight||now-lyricMeasuredAt>=1000)lyricMeasuredAt=now;
  if(index===activeLyricIndex&&viewportHeight===lyricsViewportHeight)return;
  const previous=activeLyricIndex,viewportChanged=viewportHeight!==lyricsViewportHeight;
  activeLyricIndex=index;lyricsViewportHeight=viewportHeight;
  if(previous<0||viewportChanged||lyricMotionTimer||$('lyricsLines').children.length!==5){renderLyricWindow(index);return}
  if(index===(previous+1)%timedLyrics.length)stepLyricWindow(1,index);
  else if(index===(previous-1+timedLyrics.length)%timedLyrics.length)stepLyricWindow(-1,index);
  else renderLyricWindow(index);
}
window.addEventListener('weatherRecordLyrics', event => {
  const result = event.detail;
  const reply = nativeLyricsReplies.get(result.requestId);
  if (reply?.uri === result.trackURI) reply.finish(result);
});

async function fetchLyricsRecord(details) {
  const unavailable = isEnglish ? 'Lyrics service is temporarily unavailable' : '歌词服务暂时不可用';
  if (nativeApp) {
    const requestId = ++nativeLyricsRequestId;
    return new Promise(resolve => {
      const finish = result => {
        clearTimeout(timeout);
        nativeLyricsReplies.delete(requestId);
        resolve(result);
      };
      const timeout = setTimeout(() => finish({error: unavailable}), 24000);
      nativeLyricsReplies.set(requestId, {uri: details.trackURI, finish});
      nativeSend('lyricsFetch', {...details, requestId});
    });
  }
  try {
    const params = new URLSearchParams({track_name: details.trackName, artist_name: details.artistName});
    if (details.albumName) params.set('album_name', details.albumName);
    if (details.duration > 0 && details.duration <= 3600) params.set('duration', String(details.duration));
    const response = await fetch(`https://lrclib.net/api/get?${params}`, {signal: AbortSignal.timeout(12000)});
    if (response.status === 404) return {syncedLyrics:'', plainLyrics:''};
    if (!response.ok) return {error: unavailable};
    return await response.json();
  } catch {
    return {error: unavailable};
  }
}

function getLyricsRecord(track) {
  const uri = track?.uri;
  const artist = track?.artists?.[0]?.name || track?.album?.artists?.[0]?.name || state.album?.artists?.[0]?.name;
  if (!uri || !track.name || !artist) return Promise.resolve(null);
  if (lyricsCache.has(uri)) return Promise.resolve(lyricsCache.get(uri));
  if (lyricsPending.has(uri)) return lyricsPending.get(uri);
  const details = {
    trackURI: uri, trackName: track.name, artistName: artist,
    albumName: track.album?.name || state.album?.name || '',
    duration: Math.round((track.duration_ms || (uri === nativeCurrentTrackURI ? state.duration : 0)) / 1000),
  };
  const request = fetchLyricsRecord(details).then(result => {
    if (!result.error) {
      lyricsCache.set(uri, result);
      if (lyricsCache.size > 40) lyricsCache.delete(lyricsCache.keys().next().value);
    }
    return result;
  }).finally(() => lyricsPending.delete(uri));
  lyricsPending.set(uri, request);
  return request;
}

async function loadLyricsForTrack(track) {
  const uri = track?.uri || '';
  if (uri && uri === displayedLyricsURI && (timedLyrics.length || pendingLyricsView === lyricsRequest)) return;
  displayedLyricsURI = uri;
  const requestId = ++lyricsRequest;
  if (lyricsCache.has(uri)) {
    renderLyrics(lyricsCache.get(uri));
    return;
  }
  lyricsMessage(isEnglish ? 'Searching for synced lyrics…' : '正在寻找同步歌词…');
  pendingLyricsView = requestId;
  const record = await getLyricsRecord(track);
  if (pendingLyricsView === requestId) pendingLyricsView = 0;
  if (requestId !== lyricsRequest || !lyricsVisible()) return;
  if (!record) lyricsMessage(isEnglish ? 'Play a song to view lyrics' : '播放歌曲后显示歌词');
  else if (record.error) lyricsMessage(record.error);
  else renderLyrics(record);
}

function toggleLyrics(){
  if(landscapeLyrics()){loadLyricsForTrack(lyricsTrack());return}
  const cover=$('albumArt'),opening=!cover.classList.contains('lyrics-open');
  if(opening)cover.classList.remove('lyrics-closing');
  if(!opening)cover.classList.add('lyrics-closing');
  cover.classList.toggle('lyrics-open',opening);$('lyricsView').setAttribute('aria-hidden',String(!opening));
  cover.setAttribute('aria-label',opening?(isEnglish?'Lyrics displayed. Tap to return to the cover; swipe left for previous and right for next.':'正在显示歌词，点按返回专辑封面；左滑上一首，右滑下一首'):(isEnglish?'Album cover. Tap to view lyrics; swipe left for previous and right for next.':'唱片封面，点按查看歌词；左滑上一首，右滑下一首'));
  if(opening){const track=lyricsTrack();showLyricsMetadata(track);loadLyricsForTrack(track)}
  else{lyricsRequest++;if(lyricMotionTimer)clearTimeout(lyricMotionTimer);lyricMotionTimer=null;displayedLyricsURI='';timedLyrics=[];activeLyricIndex=-1;restoreAlbumMetadata();requestAnimationFrame(()=>requestAnimationFrame(()=>cover.classList.remove('lyrics-closing')))}
}
function closeLyrics(){
  if(landscapeLyrics()){
    lyricsRequest++;displayedLyricsURI='';
    lyricsMessage(isEnglish?'Loading lyrics for the next song…':'正在加载下一首歌词…');
    // Selection paths update the song synchronously before this frame runs.
    requestAnimationFrame(refreshLandscapeTrack);
    return;
  }
  if($('albumArt').classList.contains('lyrics-open'))toggleLyrics();
}

// Keep one lyric view and one playback clock across device rotations.
function updateLandscapeLyrics(){
  const cover=$('albumArt'),view=$('lyricsView');
  cover.setAttribute('aria-label',landscapeLyrics()?(isEnglish?'Album cover. Swipe up for next, down for previous.':'唱片封面，上滑下一首，下滑上一首'):(isEnglish?'Album cover. Tap for lyrics; swipe left for previous, right for next.':'唱片封面，点按查看歌词；左滑上一首，右滑下一首'));
  const extras=document.querySelector('.player-extras');
  let panel=$('landscapeLyrics');
  if(!panel){panel=document.createElement('aside');panel.id='landscapeLyrics';panel.setAttribute('aria-label',isEnglish?'Lyrics':'歌词');document.querySelector('.shell').append(panel)}
  if(landscapeLyrics()){
    if(extras)document.querySelector('.record-layout').append(extras);
    cover.classList.remove('lyrics-open','lyrics-closing');restoreAlbumMetadata();
    panel.append(view);view.setAttribute('aria-hidden','false');loadLyricsForTrack(lyricsTrack());
  }else{
    if(extras&&!extras.closest('.local-transport'))document.querySelector('.record-info').append(extras);
    cover.append(view);view.setAttribute('aria-hidden',String(!cover.classList.contains('lyrics-open')));
  }
  lyricsViewportHeight=0;
  requestAnimationFrame(()=>syncLyricsAt(currentLyricsPosition()));
}
if(nativeApp||window.WEATHER_RECORD_PORTABLE){matchMedia('(orientation: landscape)').addEventListener('change',updateLandscapeLyrics);requestAnimationFrame(updateLandscapeLyrics)}

// A local, subjective six-axis rating for confirmed Spotify Liked Songs.
const ratingPostponedThisSession=new Set();
const confirmedLikedURIs=new Set();
let ratingPlayback={uri:'',played:0,startedAt:0,eligible:false,ready:false,presented:false,timer:0};
let ratingModalURI='';
const ratingCopy=isEnglish?{
  kicker:'YOUR LISTENING PROFILE',title:'How does this track feel?',note:'Your subjective impression — not an audio measurement or a like score.',later:'Maybe later',save:'Save rating',never:'Don’t ask again for this track',names:{energy:'Energy',valence:'Valence',calmness:'Calmness',acousticness:'Acousticness',instrumentalness:'Instrumentalness',groove:'Groove'}
}:{
  kicker:'你的听觉档案',title:'给这首歌一点感觉',note:'这是你的主观感受，不是音频测量，也不是喜爱程度。',later:'稍后再说',save:'保存评分',never:'不再提醒这首歌',names:{energy:'活力感',valence:'愉悦度',calmness:'平静度',acousticness:'原声感',instrumentalness:'器乐程度',groove:'律动感'}
};
function resetTrackRatingPlayback(uri=''){
  clearTimeout(ratingPlayback.timer);
  if($('trackRatingModal')?.classList.contains('open'))closeTrackRatingModal();
  ratingPlayback={uri,played:0,startedAt:0,eligible:false,ready:false,presented:false,timer:0};
  if(uri?.startsWith('spotify:track:')&&!ratingPostponedThisSession.has(uri))nativeSend('trackRatingCheck',{uri,knownLiked:confirmedLikedURIs.has(uri)});
}
function pauseTrackRatingClock(){
  if(ratingPlayback.startedAt){ratingPlayback.played+=Math.max(0,performance.now()-ratingPlayback.startedAt);ratingPlayback.startedAt=0}
  clearTimeout(ratingPlayback.timer);ratingPlayback.timer=0;
}
function scheduleTrackRating(){
  clearTimeout(ratingPlayback.timer);ratingPlayback.timer=0;
  if(!ratingPlayback.startedAt||ratingPlayback.presented||ratingPostponedThisSession.has(ratingPlayback.uri))return;
  const remaining=Math.max(0,15000-ratingPlayback.played);
  ratingPlayback.timer=setTimeout(()=>{pauseTrackRatingClock();ratingPlayback.ready=true;tryPresentTrackRating();if(state.playing&&ratingPlayback.uri===nativeCurrentTrackURI){ratingPlayback.startedAt=performance.now()}},remaining);
}
function updateTrackRatingPlayback(uri,playing){
  if(!uri?.startsWith('spotify:track:'))return;
  if(uri!==ratingPlayback.uri)resetTrackRatingPlayback(uri);
  if(playing){if(!ratingPlayback.startedAt)ratingPlayback.startedAt=performance.now();scheduleTrackRating()}
  else pauseTrackRatingClock();
}
function ratingModalBlocked(){return $('shareCardDialog')?.open||document.querySelector('.workout-overlay:not([hidden])')||$('descriptionModal')?.classList.contains('open')||$('trackRatingModal')?.classList.contains('open')||modeSwitching||coverTransitioning}
function tryPresentTrackRating(){
  const uri=ratingPlayback.uri;
  if(!ratingPlayback.ready||!ratingPlayback.eligible||ratingPlayback.presented||ratingPostponedThisSession.has(uri))return;
  if(modeSwitching||coverTransitioning){setTimeout(tryPresentTrackRating,400);return}
  if(ratingModalBlocked())return;
  const track=state.track;
  if(!track||track.uri!==uri)return;
  ratingPlayback.presented=true;ratingModalURI=uri;
  $('ratingTrackName').textContent=track.name||'—';$('ratingArtistName').textContent=track.artists?.map(x=>x.name).join(', ')||'—';
  document.querySelectorAll('[data-rating]').forEach(input=>{input.value='50';paintRatingSlider(input)});
  const modal=$('trackRatingModal');modal.classList.add('open');modal.setAttribute('aria-hidden','false');$('ratingSave').focus();
}
function closeTrackRatingModal(){const modal=$('trackRatingModal');modal?.classList.remove('open');modal?.setAttribute('aria-hidden','true');ratingModalURI=''}
function paintRatingSlider(input){input.style.setProperty('--rating-value',`${input.value}%`);input.parentElement.querySelector('output').textContent=input.value}
function ratingPayload(){
  const track=state.track,values={};document.querySelectorAll('[data-rating]').forEach(input=>values[input.dataset.rating]=Number(input.value));
  return {uri:ratingModalURI,title:track?.name||'',artist:track?.artists?.map(x=>x.name).join(', ')||'',album:track?.album?.name||'',values};
}
function bindTrackRatingUI(){
  $('ratingKicker').textContent=ratingCopy.kicker;$('trackRatingTitle').textContent=ratingCopy.title;$('ratingNote').textContent=ratingCopy.note;$('ratingLater').textContent=ratingCopy.later;$('ratingSave').textContent=ratingCopy.save;$('ratingNever').textContent=ratingCopy.never;
  Object.entries(ratingCopy.names).forEach(([key,value])=>{const node=document.querySelector(`[data-rating-title="${key}"]`);if(node)node.textContent=value});
  document.querySelectorAll('[data-rating]').forEach(input=>{paintRatingSlider(input);input.addEventListener('input',()=>paintRatingSlider(input))});
  $('ratingLater').onclick=()=>{if(ratingModalURI)ratingPostponedThisSession.add(ratingModalURI);closeTrackRatingModal()};
  $('ratingNever').onclick=()=>{if(ratingModalURI){ratingPostponedThisSession.add(ratingModalURI);nativeSend('trackRatingSuppress',{uri:ratingModalURI})}closeTrackRatingModal()};
  $('ratingSave').onclick=()=>{if(!ratingModalURI)return;nativeSend('trackRatingSave',ratingPayload())};
}
window.addEventListener('atmosTrackRatingStatus',event=>{const d=event.detail;if(d?.uri!==ratingPlayback.uri)return;ratingPlayback.eligible=d.eligible===true&&d.status==='unrated';if(ratingPlayback.ready)tryPresentTrackRating()});
window.addEventListener('atmosTrackRatingSaved',event=>{if(event.detail?.uri===ratingModalURI){ratingPostponedThisSession.add(ratingModalURI);closeTrackRatingModal()}});
window.addEventListener('atmosTrackRatingSuppressed',event=>{if(event.detail?.uri===ratingModalURI)closeTrackRatingModal()});
// AtmosRank only replaces candidate choice; Spotify playback and auth stay unchanged.
let atmosRequestID=0,atmosLastCandidate=null,atmosLikedPage=null,atmosLikedUses=0;
const atmosPending=new Map(),atmosReserved=[];
const atmosIdentity=(item,mode)=>mode==='album'?'album:'+albumKey(item):item.id;
let atmosLikedPages=[],atmosLikedPageTotal=0;
function nextAtmosLikedOffset(total){
  const pages=Math.ceil(total/50);
  if(!pages)return 0;
  if(atmosLikedPageTotal!==total||!atmosLikedPages.length){
    atmosLikedPageTotal=total;atmosLikedPages=Array.from({length:pages},(_,i)=>i);
    for(let i=pages-1;i>0;i--){const j=randomInt(i+1);[atmosLikedPages[i],atmosLikedPages[j]]=[atmosLikedPages[j],atmosLikedPages[i]]}
  }
  return atmosLikedPages.pop()*50;
}
function atmosCandidate(item,mode){
  const artists=(item.artists||[]).map(a=>(a.name||a.id||'').toLocaleLowerCase()).filter(Boolean);
  const tags=Object.keys(moodArtists).filter(tag=>moodArtists[tag].some(name=>artists.includes(name.toLocaleLowerCase())));
  const featureKey=mode==='album'?'album-key:'+albumKey(item).normalize('NFKC').replace(/[^\p{L}\p{N}_]+/gu,'-').replace(/^-+|-+$/g,''):null;
  return {id:mode==='album'?'album:'+item.id:item.id,artists,tags,featureKey};
}
window.addEventListener('atmosRankResult',event=>{
  const d=event.detail,complete=atmosPending.get(d?.requestID);
  if(complete)complete(d.scores?.[0]?.id||null);
});
async function atmosChoose(items,mode){
  const workout=typeof workoutMode!=='undefined'&&workoutMode;
  if(!items.length)return null;
  const current=mode==='album'?state.album:state.track;
  const identities=new Set();
  items=items.filter(item=>{const key=atmosIdentity(item,mode);if(identities.has(key))return false;identities.add(key);return true});
  const isCurrent=item=>!!current&&atmosIdentity(item,mode)===atmosIdentity(current,mode);
  const available=items.filter(item=>!atmosReserved.includes(atmosIdentity(item,mode))&&!isCurrent(item));
  // Relax reservations only when the pool is exhausted; never spin or retry APIs.
  const pool=available.length?available:items.filter(item=>!isCurrent(item));
  const usable=pool.length?pool:items;
  const unheard=usable.filter(item=>unseen(mode,mode==='album'?albumKey(item):item.uri));
  const choices=unheard.length?unheard:usable;
  let id=null;
  if(window.WEATHER_RECORD_PORTABLE||window.webkit?.messageHandlers?.atmosRank){
    id=await new Promise(resolve=>{
      const requestID=++atmosRequestID;
      const finish=value=>{clearTimeout(timer);atmosPending.delete(requestID);resolve(value)};
      const timer=setTimeout(()=>finish(null),800);
      atmosPending.set(requestID,finish);
      try{nativeSend('atmosRank',{requestID,candidates:choices.map(item=>atmosCandidate(item,mode)),previous:atmosLastCandidate,weatherCode:state.weatherCode??null,workout})}catch(error){finish(null)}
    });
  }
  const fresh=choices.filter(item=>unseen(mode,mode==='album'?albumKey(item):item.uri));
  if(workout&&!id)return null;
  const fallback=fresh.length?fresh:choices;
  const selected=choices.find(item=>atmosCandidate(item,mode).id===id)||(workout?null:fallback[randomInt(fallback.length)]);
  if(!selected)return null;
  atmosLastCandidate=atmosCandidate(selected,mode);
  atmosReserved.push(atmosIdentity(selected,mode));if(atmosReserved.length>24)atmosReserved.shift();
  return selected;
}
function atmosRecord(track,skipped=false){
  if(!track?.id)return;
  const candidate=atmosCandidate(track,'single');
  nativeSend('atmosEvent',{...candidate,timestamp:Date.now()/1000,skipped});
  const album=track.album||(state.mode==='album'?state.album:null);
  if(album?.id)nativeSend('atmosEvent',{...atmosCandidate(album,'album'),timestamp:Date.now()/1000,skipped});
}
async function ensureAtmosLikedPage(){
  if(likedTrackTotal===null){const page=await api('https://api.spotify.com/v1/me/tracks?limit=1&offset=0');likedTrackTotal=page.total||0}
  if(!likedTrackTotal)throw Error(isEnglish?'Your liked songs library is empty':'你的喜欢歌曲列表为空');
  if(!atmosLikedPage||atmosLikedUses>=3||Date.now()-atmosLikedPage.savedAt>300000){
    const offset=nextAtmosLikedOffset(likedTrackTotal);
    const page=await api(`https://api.spotify.com/v1/me/tracks?limit=50&offset=${offset}`);
    likedTrackTotal=page.total||0;
    atmosLikedPage={items:(page.items||[]).map(x=>x.track).filter(t=>t?.id&&t.uri&&!t.is_local&&t.is_playable!==false),savedAt:Date.now()};
    atmosLikedPage.items.forEach(track=>confirmedLikedURIs.add(track.uri));
    atmosLikedUses=0;
  }
  if(!atmosLikedPage.items.length){atmosLikedPage=null;likedTrackTotal=null;throw Error('没有找到可播放的喜欢歌曲')}
  return atmosLikedPage.items;
}
async function atmosLikedSelection(mode){
  const workout=workoutMode;
  for(let attempt=0;attempt<(workout?4:1);attempt++){
    const items=await ensureAtmosLikedPage();atmosLikedUses++;
    const track=await atmosChoose(items,mode);
    if(workout!==workoutMode)throw Error(isEnglish?'Mode changed':'模式已切换');
    if(track){await preloadCover(track.album?.images?.[0]?.url);return {mode,track,album:track.album,tracks:[track],workout}}
    atmosLikedUses=3;
  }
  throw Error(isEnglish?'No rated high-groove tracks found in this batch. Rate Groove in normal mode, or try another batch.':'本批收藏中未找到律动评分 ≥65 的歌曲。请在普通模式评分，或重新进入健身模式查找下一批。');
}
let catalogYearBag=[];
function nextCatalogAlbumQuery(){
  const currentYear=new Date().getFullYear();
  if(!catalogYearBag.length){
    catalogYearBag=['1900-1949',...Array.from({length:currentYear-1950+1},(_,i)=>1950+i)];
    for(let i=catalogYearBag.length-1;i>0;i--){const j=randomInt(i+1);[catalogYearBag[i],catalogYearBag[j]]=[catalogYearBag[j],catalogYearBag[i]]}
  }
  const year=catalogYearBag.pop();
  // A few narrow title partitions reach beyond the first 1,000 popular results
  // in dense years. This remains biased catalog discovery, not uniform sampling.
  const letters='abcdefghijklmnopqrstuvwxyz0123456789';
  return `year:${year}${randomInt(4)===0?' album:'+letters[randomInt(letters.length)]:''}`;
}
async function fetchSelection(mode){
  if(workoutMode)return atmosLikedSelection('single');
  if(mode==='single'){
    if(window.WEATHER_RECORD_PORTABLE||window.webkit?.messageHandlers?.atmosRank)return atmosLikedSelection(mode);
    if(likedTrackTotal===null){const page=await api('https://api.spotify.com/v1/me/tracks?limit=1&offset=0');likedTrackTotal=page.total||0}
    if(!likedTrackTotal)throw Error('你的喜欢歌曲列表为空');
    if(recent.single.length>=likedTrackTotal)recent.single=recent.single.slice(0,Math.min(3,likedTrackTotal-1));
    let fallback=null;
    for(let attempt=0;attempt<Math.min(likedTrackTotal,4);attempt++){
      const index=nextLikedIndex(likedTrackTotal);
      const page=await api(`https://api.spotify.com/v1/me/tracks?limit=1&offset=${index}`);
      const track=page.items?.[0]?.track;
      if(!track?.uri)continue;
      confirmedLikedURIs.add(track.uri);
      fallback=track;
      if(unseen('single',track.uri)&&track.uri!==state.track?.uri){await preloadCover(track.album?.images?.[0]?.url);return {mode,track,album:track.album,tracks:[track]}}
    }
    if(!fallback)throw Error('没有找到可播放的喜欢歌曲');
    await preloadCover(fallback.album?.images?.[0]?.url);
    return {mode,track:fallback,album:fallback.album,tracks:[fallback]};
  }
  const contextKey=recommendationKey();
  let album=null,fallback=null,selectedMood=null,fallbackMood=null,albumPool=[],fallbackPool=[];
  const albumMoods=new Map();
  for(let attempt=0;attempt<3;attempt++){
    try{
      // Discover through the catalog rather than a fixed album/artist whitelist.
      // The query is a sampling partition, not evidence of musical mood.
      const query=nextCatalogAlbumQuery(),expectedArtist=null,paginate=true,queryMood=null;
      let result=await api(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=album&limit=10`);
      const total=result.albums?.total||0;
      if(paginate&&total>10){const offset=randomInt(Math.min(total-10,990)+1);result=await api(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=album&limit=10&offset=${offset}`)}
      const candidates=(result.albums?.items||[]).filter(item=>item?.id&&item.album_type==='album'&&item.total_tracks>=5&&item.images?.length&&(!expectedArtist||item.artists?.some(artist=>artist.name?.toLocaleLowerCase()===expectedArtist.toLocaleLowerCase())));
      if(!candidates.length)continue;
      fallback=candidates[randomInt(candidates.length)];fallbackPool.push(...candidates);fallbackMood=queryMood;
      candidates.forEach(item=>albumMoods.set(item.id,queryMood));
      const fresh=candidates.filter(item=>unseen('album',albumKey(item))&&albumKey(item)!==albumKey(state.album||{}));
      if(fresh.length){albumPool.push(...fresh);if(attempt>=1&&albumPool.length>=6)break}
    }catch(error){if(!state.token||error.status===403||error.status===429)throw error}
  }
  album=await atmosChoose(albumPool.length?albumPool:fallbackPool,mode)||fallback;
  if(!album)throw Error('没有找到专辑');
  selectedMood=albumMoods.get(album.id)||null;
  const [tracks]=await Promise.all([api(`https://api.spotify.com/v1/albums/${album.id}/tracks?limit=50`),preloadCover(album.images?.[0]?.url)]);
  return {mode,album,track:null,tracks:tracks.items||[],mood:selectedMood,contextKey};
}
let likedTrackTotal=null,prepareNextTimer=null;
// Queue engine: transport is injected so failures and races are testable without Spotify.
class AtmosQueueWriter {
  constructor(request,persist=()=>{},issued=[]){this.request=request;this.persist=persist;this.issued=new Set(issued);this.busy=false;this.until=0;this.generation=0;this.head=''}
  invalidate(){this.generation++;this.head=''}
  async read(path){
    const r=await this.request('GET',path);
    this.check(r);
    if(r.status!==200||!r.body)throw Error('Spotify 未返回可用的播放状态');
    return r.body;
  }
  check(r){
    if(r.status===429){this.until=Date.now()+Math.max(1,Number(r.retryAfter)||30)*1000;throw Error('Spotify 限流，稍后自动重试')}
    if(r.status<200||r.status>=300)throw Error(r.status===401?'Spotify 授权已过期，请重新连接':r.status===403?'Spotify 拒绝队列请求（403），请检查 Premium 和账号权限':r.status===404?'Spotify 没有可用的播放设备':r.status===0?'网络异常，队列写入结果待确认':`Spotify 队列请求失败（${r.status}）`);
  }
  async sync(root,desired){
    if(this.busy||Date.now()<this.until)return null;
    this.busy=true;const generation=this.generation;this.head='';
    try{
      const player=await this.read('/me/player');
      if(generation!==this.generation)return null;
      if(!player.is_playing||player.item?.uri!==root)return {message:'等待所选歌曲开始播放'};
      if(!player.device?.id||player.device.is_restricted)throw Error('当前 Spotify 设备不支持队列控制');
      let queue=await this.read('/me/player/queue');
      const unique=[...new Set(desired)].filter(uri=>uri?.startsWith('spotify:track:')&&uri!==root).slice(0,6);
      for(const uri of unique){
        if(generation!==this.generation||queue.currently_playing?.uri!==root)return null;
        if(!Array.isArray(queue.queue))throw Error('Spotify 队列状态未知，未追加歌曲');
        if(queue.queue.some(track=>track.uri===uri))continue;
        // A timeout or accepted-but-not-yet-visible write must never be resent.
        if(this.issued.has(uri))throw Error('正在确认上次队列写入，未重复追加');
        this.issued.add(uri);this.persist([...this.issued].slice(-200));
        let response;
        try { response=await this.request('POST','/me/player/queue',{uri,deviceID:player.device.id}); }
        catch(error){throw Error('网络异常，队列写入结果待确认')}
        if([401,403,404,429].includes(response.status)){this.issued.delete(uri);this.persist([...this.issued].slice(-200))}
        this.check(response);
        queue=await this.read('/me/player/queue');
        if(!queue.queue?.some(track=>track.uri===uri))throw Error('Spotify 已接收歌曲，等待队列确认');
      }
      if(generation!==this.generation)return null;
      this.head=queue.queue?.[0]?.uri||'';
      const confirmed=unique.filter(uri=>queue.queue?.some(track=>track.uri===uri)).length;
      const order=queue.queue?.slice(0,unique.length).map(track=>track.uri)||[];
      const aligned=unique.every((uri,index)=>order[index]===uri);
      return {confirmed,aligned,message:aligned?`已预加载 ${confirmed} 首`:'已有 Spotify 队列排在前面，已保留'};
    }finally{this.busy=false}
  }
}
// End queue engine.
// Read and confirm every step: never substitute play(uri) for consuming a queue.
async function advanceSpotifyQueue(snapshot,read,command,delay,readImmediately=false){
  const expected=snapshot.queue[0]?.uri,previous=snapshot.currently_playing?.uri;
  if(!expected)throw Error('没有可确认的下一首，已停止跳转');
  let commandError=null;
  try{await command('next')}catch(error){commandError=error}
  for(let attempt=0;attempt<6;attempt++){
    if(attempt>0||!readImmediately)await delay(400);
    const next=await read();
    if(!Array.isArray(next?.queue))throw Error('无法确认切歌结果，已停止继续跳转');
    if(next.currently_playing?.uri===expected&&
       (expected!==previous||JSON.stringify(next.queue.map(t=>t.uri))!==JSON.stringify(snapshot.queue.map(t=>t.uri))))return next;
    if(next.currently_playing?.uri!==previous&&next.currently_playing?.uri!==expected)throw Error('Spotify 播放位置已改变，已停止继续跳转');
  }
  throw commandError||Error('Spotify 切歌尚未确认，请稍后重试；未重复发送跳转');
}
async function ensureQueueTargetPlaying(target,command,readPlayer,delay,readImmediately=false){
  if(!readPlayer){await command('resume');return}
  let player=await readPlayer();
  if(player.item?.uri!==target)throw Error('Spotify 当前歌曲已改变，已停止恢复播放');
  if(player.is_playing)return player;
  let commandError=null;
  try{await command('resume')}catch(error){commandError=error}
  for(let attempt=0;attempt<6;attempt++){
    if(attempt>0||!readImmediately)await delay(400);
    player=await readPlayer();
    if(player.item?.uri!==target)throw Error('Spotify 当前歌曲已改变，已停止恢复播放');
    if(player.is_playing)return player;
  }
  throw commandError||Error('Spotify 尚未确认恢复播放，请稍后重试');
}
async function navigateSpotifyQueue(target,read,command,delay,owned=new Set(),consumed=()=>{},readPlayer=null,readImmediately=false){
  let snapshot=await read();
  if(!Array.isArray(snapshot?.queue))throw Error('Spotify 队列状态未知，未改变播放');
  if(snapshot.currently_playing?.uri===target){
    const player=await ensureQueueTargetPlaying(target,command,readPlayer,delay,readImmediately);
    return {...snapshot,player};
  }
  const position=snapshot.queue.findIndex(track=>track?.uri===target);
  if(position<0){
    if(snapshot.queue.length===0)return null;
    // Freeze the submitted batch. Never chase Spotify autoplay indefinitely or
    // skip someone else's queue entries to reach ours.
    const lastOwned=snapshot.queue.reduce((last,track,index)=>owned.has(track?.uri)?index:last,-1);
    // No submitted App songs remain in this snapshot: there is nothing of ours
    // left to consume. Preserve unrelated/context songs and start the new plan.
    if(lastOwned<0)return null;
    const batch=snapshot.queue.slice(0,lastOwned+1).map(track=>track.uri);
    if(batch.some(uri=>!owned.has(uri)))throw Error('其他来源的歌曲排在 App 队列前面，已停止自动跳过');
    if(batch.length>20)throw Error('旧队列超过 20 首，请先在 Spotify 清理，避免连续请求过多');
    for(const uri of batch){
      if(snapshot.queue[0]?.uri!==uri)throw Error('清理期间队列顺序已改变，已停止跳转');
      snapshot=await advanceSpotifyQueue(snapshot,read,command,delay,readImmediately);
      consumed(uri);
    }
    if(snapshot.queue.some(track=>owned.has(track?.uri)))throw Error('还有 App 歌曲未确认移出队列，请稍后重试');
    return null;
  }
  if(position>=20)throw Error('目标歌曲距离超过 20 首，请在 Spotify 中选择，避免连续请求过多');
  for(let step=0;step<=position;step++){
    if(!snapshot.queue.some(track=>track?.uri===target))throw Error('Spotify 队列已改变，请重新播放');
    snapshot=await advanceSpotifyQueue(snapshot,read,command,delay,readImmediately);
    if(snapshot.currently_playing?.uri===target){
      const player=await ensureQueueTargetPlaying(target,command,readPlayer,delay,readImmediately);
      return {...snapshot,player};
    }
  }
  throw Error('未到达目标歌曲，已停止跳转');
}
// End queue navigation.
// Restore our submitted songs in remote order; Spotify context/autoplay tracks
// must never occupy AtmosRank candidate slots or be re-submitted as recommendations.
function reconcileQueueSession(remote,saved,issued){
  if(!remote||!Array.isArray(remote.queue))throw Error('Spotify 队列状态未知，暂不生成新队列');
  const current=remote.currently_playing;
  if(current&&!current.uri?.startsWith('spotify:track:'))throw Error('当前播放内容不是歌曲，暂不接管队列');
  if(remote.queue.some(track=>!track?.uri?.startsWith('spotify:track:')||!track.album))throw Error('队列含非歌曲或缺少资料，暂不接管队列');
  const selection=track=>({mode:'single',track,album:track.album,tracks:[track],mood:null,contextKey:null});
  const upcoming=remote.queue.filter(track=>issued.has(track.uri)).map(track=>({...selection(track),origin:'atmosrank',workout:saved?.upcoming?.find(item=>item.track?.uri===track.uri)?.workout===true}));
  const seen=new Set([current?.uri,...upcoming.map(item=>item.track.uri)]);
  for(const item of saved?.upcoming||[]){
    const uri=item?.track?.uri;
    if(item.origin!=='atmosrank'||item.mode!=='single'||!uri?.startsWith('spotify:track:')||!item.album||seen.has(uri)||issued.has(uri))continue;
    upcoming.push(item);seen.add(uri);
  }
  return {current:current?.album?selection(current):null,upcoming};
}
// End restart reconciliation.
let queueRestored=true,queueRestoreTask=null,queueRestoreRetryAt=0;
function persistQueueSession(){}
async function restoreQueueSession(){return true}
let queueRequestID=0,queueSyncTimer=null,queueLastSync=0;
let queueNavigationBusy=false,queueNavigationState=null;
const queueResponses=new Map();
window.addEventListener('spotifyQueueResponse',event=>{const r=event.detail,pending=queueResponses.get(r.requestID);if(!pending)return;clearTimeout(pending.timer);queueResponses.delete(r.requestID);pending.resolve(r)});
function queueRequest(method,path,params={}){
  return new Promise(resolve=>{const requestID=++queueRequestID;
    const timer=setTimeout(()=>{queueResponses.delete(requestID);resolve({status:0})},16000);
    queueResponses.set(requestID,{resolve,timer});nativeSend('spotifyQueueRequest',{requestID,method,path,...params});
  });
}
function queueCommand(action){
  return new Promise((resolve,reject)=>{
    const requestID=++queueRequestID;
    const timer=setTimeout(()=>{queueResponses.delete(requestID);reject(Error('Spotify 操作超时，请稍后核对队列'))},action==='state'?600:12000);
    queueResponses.set(requestID,{timer,resolve:result=>{
      if(action==='state'&&result.status===200)resolve(result.body);
      else if(result.status===204)resolve();
      else reject(Error(result.message||'Spotify 队列操作失败'));
    }});
    nativeSend('spotifyQueueCommand',{requestID,action});
  });
}
async function readQueuePlayer(target){
  if(window.WEATHER_RECORD_NATIVE){
    const player=await queueCommand('state').catch(()=>null);
    if(player?.item?.uri===target)return player;
  }
  return queueWriter.read('/me/player');
}
let queueIssued=[];try{queueIssued=JSON.parse(localStorage.getItem('atmos_queue_issued')||'[]')}catch{}
const queueWriter=new AtmosQueueWriter(queueRequest,items=>{try{localStorage.setItem('atmos_queue_issued',JSON.stringify(items))}catch{}},Array.isArray(queueIssued)?queueIssued:[]);
function queueStatus(message){
  let label=$('atmosQueueStatus');
  if(!label){label=document.createElement('div');label.id='atmosQueueStatus';label.style.cssText='text-align:center;font:10px/1.4 -apple-system,sans-serif;color:var(--muted);min-height:14px;margin-top:6px';$('modeBar')?.appendChild(label);if(!label.isConnected)document.querySelector('.player-extras')?.prepend(label)}
  label.textContent=message;console.info('[AtmosQueue]',message);
}
function scheduleQueueSync(){}
async function playSelectionAfterSwipe(wasPlaying,previousURI,direction){
  // Serialize user playback after any append already in flight. Invalidation
  // prevents another append from starting while the selection changes.
  while(queueWriter.busy)await wait(50);
  if(!wasPlaying){resetProgress();return}
  
  // Playing an explicit URI replaces the current song. Sending pause first races
  // with play across Spotify's two APIs and can leave the NEW song paused.
  await startNew();
}
function prepareNext(){if(portableSessionEnabled()&&state.mode==='single'){void portableSessionPrepare();return;}
  clearTimeout(prepareNextTimer);
  if(nativeApp&&state.mode==='single'&&!queueRestored)return;
  if(!state.token)return;
  const mode=state.mode,context=recommendationKey(),epoch=nextSelectionEpoch;
  prepareNextTimer=setTimeout(()=>{
    prepareNextTimer=null;
    if(mode!==state.mode||(mode!=='single'&&context!==recommendationKey())||epoch!==nextSelectionEpoch)return;
    nextSelectionSlots=nextSelectionSlots.filter(slot=>!slot.settled||slot.selection);
    while(nextSelectionSlots.length<(nativeApp&&mode==='single'?6:3)){
      const previous=nextSelectionSlots.at(-1)?.promise||Promise.resolve();
      const slot={mode,context,epoch,selection:null,promise:null};
      slot.promise=previous.catch(()=>null).then(()=>epoch===nextSelectionEpoch&&mode===state.mode&&(mode==='single'||context===recommendationKey())?fetchSelection(mode):null).then(selection=>{slot.settled=true;slot.selection=selection?{...selection,origin:'atmosrank'}:null;if(selection?.track){queueTrackCache.set(selection.track.uri,selection.track);if(queueTrackCache.size>40)queueTrackCache.delete(queueTrackCache.keys().next().value)}if(epoch===nextSelectionEpoch){persistQueueSession();scheduleQueueSync()}return slot.selection}).catch(()=>{slot.settled=true;return null});
      nextSelectionSlots.push(slot);
    }
  },80)
}
async function takeNextSelection(){
  if(nativeApp&&state.mode==='single'&&!await restoreQueueSession())throw Error(isEnglish?'Waiting for Spotify queue verification':'正在核对 Spotify 队列，请稍后再试');
  clearTimeout(prepareNextTimer);prepareNextTimer=null;
  const mode=state.mode,context=recommendationKey();
  let slot=nextSelectionSlots.shift(),selection=null;
  if(slot&&slot.mode===mode&&(mode==='single'||slot.context===context)&&slot.epoch===nextSelectionEpoch)selection=await slot.promise;
  if(!selection||selection.mode==='album'&&selection.contextKey!==context)selection=await fetchSelection(mode);
  persistQueueSession();
  prepareNext();
  return selection
}
function showSelection(selection,deferTracks=false){closeLyrics();cachedSelectionVisible=false;lastConfirmedTrackURI='';playbackTargetPending=true;state.hasPausedTrack=false;setPlaying(false);state.track=selection.track;state.albumTracks=selection.tracks||[];state.selectionMood=selection.mood||null;state.selectionContextKey=selection.contextKey||null;state.albumError=null;renderAlbum(selection.album,selection.mode==='single'?'随机单曲':'整张专辑');if(selection.track){$('albumName').textContent=selection.track.name;$('artistName').textContent=selection.track.artists?.map(x=>x.name).join(', ')||'';$('artTitle').textContent=selection.track.name;$('artArtist').textContent=$('artistName').textContent}if(!deferTracks)renderTracks(selection.tracks);tags(selection.mode==='single'?'随机单曲':'整张专辑');cacheSelection(selection);remember(selection.mode,selection.mode==='single'?selection.track?.uri:albumKey(selection.album));prepareNext()}
async function chooseAlbum(){if(!state.token){renderAlbum({name:'In Rainbows',artist:'Radiohead'},'整张专辑');return}try{showSelection(await takeNextSelection())}catch(error){if(!state.album){renderAlbum({name:'In Rainbows',artist:'Radiohead'},'整张专辑');renderTracks([])}state.albumError=error.status===429?'Spotify 请求过于频繁，请稍后再试':`专辑搜索失败：${error.message}`;tags('整张专辑');console.error('Album selection failed',error)}}
async function chooseLiked(){if(!state.token){await connectSpotify();return}showSelection(await takeNextSelection())}
async function stopCurrent(){await localStopPlayback()}
async function startNew(){await localStartPlayback()}
async function togglePlay(){await localTogglePlayback()}
let initialPickTimer=null,initialPickStarted=false,initialPickUsedWeather=false,userHasChosen=false;
function maybeChooseInitial(force=false){
  if(nativeApp&&state.mode==='single'&&state.token&&!queueRestored){void restoreQueueSession().then(ok=>{if(ok)maybeChooseInitial(force)});return}
  if(!state.token||(state.album?.uri&&!cachedSelectionVisible)||initialPickStarted||userHasChosen)return;
  if(!state.weatherReady&&!force){if(!initialPickTimer)initialPickTimer=setTimeout(()=>maybeChooseInitial(true),900);return}
  clearTimeout(initialPickTimer);initialPickTimer=null;initialPickStarted=true;initialPickUsedWeather=state.weather!=='unknown';
  void localPickInitial();
}
function applyWeather(temperature,code){
  const previous=state.weather;
  state.weatherCode=code;state.weather=weatherFromCode(code);state.weatherReady=true;invalidateNextSelections();
  try{localStorage.setItem(weatherCacheKey,JSON.stringify({weather:state.weather,code,temperature,savedAt:Date.now()}))}catch(error){}
  $('temperature').textContent=Math.round(temperature)+'°';$('weatherLabel').textContent=weatherText[state.weather];
  tags(state.mode==='single'?'随机单曲':'整张专辑');
  if(!initialPickStarted)maybeChooseInitial();
  else if(!initialPickUsedWeather&&!userHasChosen&&!state.playing&&state.mode==='album'&&state.album?.uri&&previous!==state.weather){initialPickUsedWeather=true;chooseAlbum()}
}
function weatherUnavailable(message){state.weatherReady=true;if(state.weather==='unknown'){$('weatherLabel').textContent=message;$('temperature').textContent='--°'}tags(state.mode==='single'?'随机单曲':'整张专辑');maybeChooseInitial()}
function updateClock(){const d=new Date(),h=d.getHours(),previous=state.period;const slot=h>=5&&h<11?'morning':h>=11&&h<17?'day':h>=17&&h<21?'evening':'night';if(state.atmosSlot&&state.atmosSlot!==slot)invalidateNextSelections();state.atmosSlot=slot;state.period=h<6?'night':h<11?'morning':h<14?'noon':h<18?'afternoon':h<21?'evening':'night';if(previous&&previous!==state.period)invalidateNextSelections();$('clock').textContent=d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});$('period').textContent=periods[state.period];$('date').textContent=d.toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'});tags(state.mode==='single'?'随机单曲':'整张专辑')}
async function updateWeather(latitude,longitude){try{const response=await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`);if(!response.ok)throw Error('weather');const data=await response.json(),current=data.current;if(!current)throw Error('weather');applyWeather(current.temperature_2m,current.weather_code)}catch(error){weatherUnavailable('天气获取失败')}}
function loadWeather(){if(nativeApp){const weatherTimeout=setTimeout(()=>weatherUnavailable('定位或天气请求超时'),15000);window.addEventListener('weatherRecordWeather',event=>{clearTimeout(weatherTimeout);applyWeather(event.detail.temperature,event.detail.code)});window.addEventListener('weatherRecordLocationError',event=>{clearTimeout(weatherTimeout);weatherUnavailable(event.detail)});nativeSend('weatherLocation');return}if(!navigator.geolocation){weatherUnavailable('无法定位');return}navigator.geolocation.getCurrentPosition(position=>updateWeather(position.coords.latitude,position.coords.longitude),()=>weatherUnavailable('请允许定位'),{enableHighAccuracy:false,timeout:12000,maximumAge:300000})}
function runLaunchAnimation(){
  const splash=$('launchSplash');
  requestAnimationFrame(()=>requestAnimationFrame(()=>splash?.classList.add('splash-show')));
  setTimeout(()=>splash?.classList.add('splash-sink'),1050);
  setTimeout(()=>{document.body.classList.remove('app-booting');document.body.classList.add('app-ready')},1500);
  setTimeout(()=>{document.body.classList.remove('app-ready');splash?.remove()},2950)
}
let modeSwitching=false;
async function switchPlaybackMode(index,button){
  if(workoutMode)return;
  const nextMode=index===0?'album':'single';
  if(modeSwitching||queueNavigationBusy||nextMode===state.mode)return;
  modeSwitching=true;document.body.classList.add('mode-switch-locked');userHasChosen=!!state.token||userHasChosen;
  const oldIndex=state.mode==='single'?1:0,direction=index>oldIndex?-1:1,reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nodes=[$('albumArt'),$('albumName'),$('artistName'),$('albumDescription'),$('tags')].filter(Boolean);
  const exits=reduced?[]:nodes.map((node,i)=>node.animate([
    {transform:'translate3d(0,0,0)',opacity:1},
    {transform:`translate3d(${direction*window.innerWidth*.58}px,${i?8:18}px,0)`,opacity:0}
  ],{duration:310+i*14,easing:'cubic-bezier(.42,0,.75,.3)',fill:'forwards'}));
  try{
    const stopping=stopCurrent();
    if(exits.length)await Promise.all(exits.map(animation=>animation.finished.catch(()=>{})));
    state.mode=nextMode;invalidateNextSelections();localStorage.setItem('playback_mode',state.mode);
    button.parentElement.querySelectorAll('.mode-btn').forEach(x=>x.classList.toggle('active',x===button));
    if(state.mode==='single')await chooseLiked();else await chooseAlbum();
    exits.forEach(animation=>animation.cancel());
    const enters=reduced?[]:nodes.map((node,i)=>node.animate([
      {transform:`translate3d(${-direction*72}px,${28+i*2}px,0)`,opacity:0},
      {transform:'translate3d(0,0,0)',opacity:1}
    ],{duration:500+i*18,delay:i*22,easing:'cubic-bezier(.16,.78,.2,1)',fill:'both'}));
    if(enters.length)await Promise.all(enters.map(animation=>animation.finished.catch(()=>{})));
    enters.forEach(animation=>animation.cancel());await stopping
  }catch(error){exits.forEach(animation=>animation.cancel());alert(error.message)}finally{modeSwitching=false;document.body.classList.remove('mode-switch-locked')}
}
function bindUI(){const reconnect=document.getElementById('spotifyReconnect');if(reconnect){reconnect.textContent=state.token?(isEnglish?'Spotify Connected':'Spotify 已连接'):(isEnglish?'Connect Spotify':'连接 Spotify');reconnect.onclick=connectSpotify}$('playBtn').onclick=togglePlay;$('shuffleBtn').onclick=async()=>{try{if(state.token)userHasChosen=true;await stopCurrent();if(state.mode==='single')await chooseLiked();else await chooseAlbum()}catch(e){alert(e.message)}};document.querySelectorAll('.mode-bar .mode-btn').forEach((button,index)=>{button.classList.toggle('active',(state.mode==='album'&&index===0)||(state.mode==='single'&&index===1));button.onclick=()=>switchPlaybackMode(index,button)});const progress=$('progress');progress.step='any';progress.oninput=()=>{acceptRemoteProgress=true;state.seeking=true;paintProgress(progress.value);const p=state.duration*Number(progress.value)/100;state.position=p;state.manualPosition=p;state.updatedAt=performance.now();progressVisualPosition=p;progressAnchorPosition=p;progressAnchorTime=performance.now();$('elapsed').textContent=fmt(p)};progress.onchange=async()=>{acceptRemoteProgress=true;const p=state.duration*Number(progress.value)/100;state.position=p;state.manualPosition=p;state.updatedAt=performance.now();progressVisualPosition=p;progressAnchorPosition=p;progressAnchorTime=performance.now();pendingSeekPosition=p;pendingSeekUntil=performance.now()+5000;state.seeking=false;state.hasPausedTrack=true;if(nativeApp){void localSeekPlayback(Math.round(p));return}if(state.player)await state.player.seek(p).catch(()=>{});if(state.token&&state.deviceId)await fetch(`https://api.spotify.com/v1/me/player/seek?position_ms=${Math.round(p)}&device_id=${encodeURIComponent(state.deviceId)}`,{method:'PUT',headers:{Authorization:`Bearer ${state.token}`}}).catch(()=>{})}}
let webSpotifyStartupFinished = false;
async function main(){resetProgress();bindUI();bindDescriptionModal();bindTrackRatingUI();updateClock();restoreCachedSelection();restoreCachedWeather();tags(state.mode==='single'?'随机单曲':'整张专辑');loadWeather();setInterval(updateClock,30000);
  try{
    await localCompleteAuthorization();
    if(state.token)showWebSpotifyStatus('',spotifyMessage('Spotify 已连接','Spotify Connected'));
  }catch(error){
    showWebSpotifyStatus(error.message,spotifyMessage('重试连接 Spotify','Retry Spotify connection'));
    return;
  }
  webSpotifyStartupFinished = true;
  if(state.token){createPlayer();maybeChooseInitial()}
}
function ensureUI(){if(!document.getElementById('spotifyReconnect')){const b=document.createElement('button');b.id='spotifyReconnect';b.className='spotify-reconnect';b.textContent=isEnglish?'Connect Spotify':'连接 Spotify';document.querySelector('.topbar')?.appendChild(b)}if(!document.querySelector('.mode-bar')){const bar=document.createElement('div');bar.className='mode-bar';bar.innerHTML=isEnglish?'<button class="mode-btn">Full Album</button><button class="mode-btn">Liked Songs · Random</button>':'<button class="mode-btn">整张专辑</button><button class="mode-btn">我的喜欢 · 随机单曲</button>';document.querySelector('.record-info')?.prepend(bar)}}
if(!window.Spotify)window.onSpotifyWebPlaybackSDKReady=()=>{if(webSpotifyStartupFinished)createPlayer()};ensureUI();runLaunchAnimation();main();
let progressFrame=0,lastLyricsSync=0,lastProgressPaint=0;
function stopProgressUpdates(){if(progressFrame)cancelAnimationFrame(progressFrame);progressFrame=0;progressLastFrame=0;lastLyricsSync=0}
function startProgressUpdates(){if(progressFrame||document.hidden||!state.playing)return;progressFrame=requestAnimationFrame(animateProgress)}
function animateProgress(now){
  progressFrame=0;
  if(document.hidden||!state.playing)return;
  if(acceptRemoteProgress&&state.duration&&!state.seeking){
    const target=Math.min(state.duration,progressAnchorPosition+Math.max(0,now-progressAnchorTime));
    const dt=progressLastFrame?Math.min(64,now-progressLastFrame):16.7,delta=target-progressVisualPosition;
    progressVisualPosition=Math.abs(delta)>2200?target:Math.max(progressVisualPosition,progressVisualPosition+delta*(1-Math.exp(-dt/72)));
    // Keep clock integration at display cadence, but avoid repainting the range
    // control at 120 Hz on ProMotion devices.
    if(now-lastProgressPaint>=1000/60-1){paintProgress(progressVisualPosition/state.duration*100);lastProgressPaint=now}
    const second=Math.floor(progressVisualPosition/1000);if(second!==progressDisplayedSecond){progressDisplayedSecond=second;$('elapsed').textContent=fmt(progressVisualPosition)}
  }
  progressLastFrame=now;
  if(lyricsVisible()&&now-lastLyricsSync>=100){lastLyricsSync=now;syncLyricsAt(currentLyricsPosition())}
  progressFrame=requestAnimationFrame(animateProgress);
}
let appHiddenAt=0;
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){appHiddenAt=Date.now();stopProgressUpdates();clearTimeout(queueSyncTimer);queueSyncTimer=null;return}
  if(state.playing&&appHiddenAt&&acceptRemoteProgress&&state.duration&&!state.seeking){
    const estimated=Math.min(state.duration,progressVisualPosition+Math.max(0,Date.now()-appHiddenAt));
    state.position=estimated;state.updatedAt=performance.now();syncProgressAnchor(estimated,true);paintProgress(estimated/state.duration*100);$('elapsed').textContent=fmt(estimated)
  }
  appHiddenAt=0;
  void localReadSdk().catch(localPlaybackError);
  if(state.playing){startProgressUpdates();prepareNext();scheduleQueueSync()}
});

// Cover gestures keep a real selection history, so back restores the same song/album.
(()=>{
  const cover=$('albumArt');
  let origin=null,busy=false,cursor=-1;
  const history=[];
  window.addEventListener('workoutModeChanged',()=>{history.length=0;cursor=-1});
  const snapshot=()=>({album:state.album,albumTracks:state.albumTracks,track:state.track,mode:state.mode,mood:state.selectionMood,contextKey:state.selectionContextKey,tracks:$('trackList').innerHTML,count:$('trackCount').textContent});
  const restore=item=>{
    closeLyrics();lastConfirmedTrackURI='';playbackTargetPending=true;state.album=item.album;state.albumTracks=item.albumTracks||[];state.track=item.track;state.mode=item.mode;state.selectionMood=item.mood||null;state.selectionContextKey=item.contextKey||null;
    localStorage.setItem('playback_mode',item.mode);
    renderAlbum(item.album,item.mode==='single'?'随机单曲':'整张专辑');
    if(item.mode==='single'&&item.track){$('albumName').textContent=item.track.name;$('artistName').textContent=item.track.artists?.map(a=>a.name).join(', ')||''}
    $('trackList').innerHTML=item.tracks;$('trackCount').textContent=item.count;
    document.querySelectorAll('.mode-btn').forEach((b,i)=>b.classList.toggle('active',i===(item.mode==='single'?1:0)));
    cachedSelectionVisible=false;cacheSelection({mode:item.mode,album:item.album,track:item.mode==='single'?item.track:null,tracks:item.albumTracks||[],mood:item.mood,contextKey:item.contextKey});
  };
  const reducedMotion=true;
  const settle=()=>{cover.style.transition='transform 220ms cubic-bezier(.2,.8,.2,1), opacity 220ms';cover.style.transform='';cover.style.opacity='1';setTimeout(()=>{cover.style.transition=''},230)};
  async function navigate(direction,dragX=0,dragY=0,automatic=false){
    if(busy||queueNavigationBusy||coverTransitioning||!state.album?.uri)return;
    if(nativeApp&&state.mode==='single'&&!queueRestored){settle();await restoreQueueSession();return}
    closeLyrics();
    userHasChosen=true;
    busy=true;
    coverTransitioning=true;
    const playing=automatic||state.playing;
    const previousURI=nativeCurrentTrackURI;
    queueWriter.invalidate();
    let finished=false;
    try{
      const current=snapshot();
      if(cursor<0||history[cursor]?.album?.uri!==current.album.uri||history[cursor]?.track?.uri!==current.track?.uri||history[cursor]?.mode!==current.mode){history.splice(cursor+1);history.push(current);cursor=history.length-1}
      if(direction<0&&cursor===0){settle();return}
      if(direction>0&&playing&&!automatic)atmosRecord(state.track||state.albumTracks.find(track=>track.uri===nativeCurrentTrackURI),true);
      cover.style.transform='';
      const preparing=direction>0&&cursor+1>=history.length?takeNextSelection():Promise.resolve(null);
      const prepared=await preparing;
      let listToRender=null;
      if(direction<0){restore(history[--cursor])}
      else if(cursor+1<history.length){restore(history[++cursor])}
      else{
        showSelection(prepared,true);
        listToRender=prepared.tracks;
      }
      localAnimateSelection(direction);
      if(listToRender){renderTracks(listToRender);history.push(snapshot());cursor=history.length-1}
      deferredTrackURI='';
      await playSelectionAfterSwipe(playing,previousURI,direction);
      finished=true;
    }catch(error){alert(error.message)}finally{if(finished){cover.style.transition='none';cover.style.transform='none';cover.style.opacity='1'}else settle();busy=false;coverTransitioning=false;if(state.playing)startProgressUpdates();if(deferredTrackURI){const uri=deferredTrackURI;deferredTrackURI='';observePlaybackTrack(uri)}}
  }
  cover.tabIndex=0;
  cover.setAttribute('aria-label',isEnglish?'Album cover. Tap to view lyrics; swipe left for previous and right for next.':'唱片封面，点按查看歌词；左滑上一首，右滑下一首');
  const previous=(x=0,y=0)=>navigate(-1,x,y);
  const next=(x=0,y=0)=>navigate(1,x,y);
  localAdvanceRecommendation=()=>navigate(1,0,0,true);
  window.weatherRecordDesktop?.bindNavigation(previous,next);
  let dragFrame=0,pendingDrag=null;
  cover.addEventListener('pointerdown',e=>{if(busy||e.isPrimary===false)return;origin={x:e.clientX,y:e.clientY};coverGestureActive=true;stopProgressUpdates();cover.style.transition='none';cover.setPointerCapture?.(e.pointerId)});
  cover.addEventListener('pointermove',e=>{if(!origin||busy||reducedMotion)return;const dx=e.clientX-origin.x,dy=e.clientY-origin.y;const vertical=landscapeLyrics();if(vertical?Math.abs(dy)<Math.abs(dx)*1.3:Math.abs(dx)<Math.abs(dy)*1.3)return;pendingDrag={dx,dy};if(dragFrame)return;dragFrame=requestAnimationFrame(()=>{dragFrame=0;if(!pendingDrag)return;const {dx,dy}=pendingDrag;pendingDrag=null;cover.style.transform=vertical?`translate3d(${dx*.15}px,${dy}px,0)`:`translate3d(${dx}px,${dy*.25}px,0) rotate(${dx/22}deg)`;cover.style.opacity=String(Math.max(.55,1-Math.abs(vertical?dy:dx)/600))})},{passive:true});
  cover.addEventListener('pointercancel',()=>{origin=null;coverGestureActive=false;settle();if(state.playing)startProgressUpdates()});
  cover.addEventListener('pointerup',e=>{if(!origin)return;const dx=e.clientX-origin.x,dy=e.clientY-origin.y;origin=null;coverGestureActive=false;if(dragFrame)cancelAnimationFrame(dragFrame);dragFrame=0;pendingDrag=null;if(landscapeLyrics()&&Math.abs(dy)>50&&Math.abs(dy)>Math.abs(dx)*1.3){if(dy<0)next(dx*.15,dy);else previous(dx*.15,dy)}else if(!landscapeLyrics()&&Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5){if(dx<0)previous(dx,dy*.25);else next(dx,dy*.25)}else if(Math.abs(dx)<8&&Math.abs(dy)<8){settle();toggleLyrics();if(state.playing)startProgressUpdates()}else{settle();if(state.playing)startProgressUpdates()}});
  cover.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){e.preventDefault();previous()}else if(e.key==='ArrowRight'){e.preventDefault();next()}else if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleLyrics()}});
})();

// Local workout planner. Completion is keyed by local calendar date and stable exercise ID.
function workoutDateKey(date=new Date()){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')}
function workoutRemaining(plan,done,date=new Date()){return (plan[date.getDay()]?.exercises||[]).filter(exercise=>!done.includes(exercise.id))}
(()=>{
  const text=(zh,en)=>isEnglish?en:zh;
  const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))||fallback}catch{return fallback}};
  let plan=read('atmos_workout_plan_v1',{}),completed=read('atmos_workout_done_v1',{}),previousMode=state.mode,changing=false;
  const element=(tag,className,label)=>{const node=document.createElement(tag);node.className=className;if(label)node.textContent=label;return node};
  const button=(label,action,className='')=>{const node=element('button',className,label);node.type='button';node.onclick=action;return node};
  const menuButton=button('☰',()=>open(menu),'workout-menu-button');menuButton.setAttribute('aria-label',text('切换模式','Switch mode'));menuButton.setAttribute('aria-expanded','false');
  document.querySelector('.topbar').prepend(menuButton);
  const cards=element('section','workout-cards');cards.hidden=true;cards.setAttribute('aria-live','polite');document.querySelector('.context-grid').after(cards);
  const overlayTimers=new WeakMap();
  const overlay=title=>{const node=element('div','workout-overlay');node.hidden=true;node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-label',title);const sheet=element('div','workout-sheet');const heading=element('div','workout-heading');heading.append(element('h2','',title),button('×',()=>close(node),'workout-close'));sheet.append(heading);node.append(sheet);document.body.append(node);node.onclick=e=>{if(e.target===node)close(node)};return node};
  function open(node){closeTrackRatingModal();closeDescriptionModal();if(node===menu){everydayChoice.classList.toggle('active',!workoutMode);workoutChoice.classList.toggle('active',workoutMode)}clearTimeout(overlayTimers.get(node));node.hidden=false;node.classList.remove('closing');requestAnimationFrame(()=>requestAnimationFrame(()=>node.classList.add('open')));menuButton.setAttribute('aria-expanded','true');setTimeout(()=>node.querySelector('button')?.focus(),180)}
  function close(node,restoreFocus=true){
    if(node.hidden)return Promise.resolve();
    clearTimeout(overlayTimers.get(node));node.classList.remove('open');node.classList.add('closing');menuButton.setAttribute('aria-expanded','false');
    return new Promise(resolve=>{const timer=setTimeout(()=>{node.hidden=true;node.classList.remove('closing');overlayTimers.delete(node);if(restoreFocus)menuButton.focus();resolve()},330);overlayTimers.set(node,timer)});
  }
  const menu=overlay(text('聆听模式','Listening mode')),editor=overlay(text('每周训练计划','Weekly workout plan'));
  menu.classList.add('workout-menu-drawer');
  const menuSheet=menu.firstElementChild;
  const hasPlan=()=>Object.values(plan).some(day=>Array.isArray(day?.exercises)&&day.exercises.length);
  const everydayChoice=button(text('日常 · 天气与时间','Everyday · Weather & time'),()=>changeMode(false),'workout-choice');
  const workoutChoice=button(text('健身 · 强律动','Workout · Strong groove'),()=>{if(!hasPlan())edit(true);else changeMode(true)},'workout-choice');
  menuSheet.append(everydayChoice,workoutChoice,button(text('编辑周一至周五计划','Edit Monday–Friday plan'),()=>edit(false),'workout-choice workout-plan-choice'));
  const settings=overlay(text('设置','Settings'));
  const swapLabel=element('label','settings-row',text('横屏左右换边','Swap landscape sides'));
  const swap=element('input','');swap.type='checkbox';swap.checked=document.body.classList.contains('landscape-swapped');
  swap.onchange=()=>{document.body.classList.toggle('landscape-swapped',swap.checked);try{localStorage.setItem('atmos_landscape_swapped',String(swap.checked))}catch{}lyricsViewportHeight=0;requestAnimationFrame(()=>syncLyricsAt(currentLyricsPosition()))};
  swapLabel.append(swap);settings.firstElementChild.append(swapLabel,element('p','workout-first-note',text('开启后播放器在右、歌词在左。横屏上滑下一首，下滑上一首。','When enabled, the player is on the right and lyrics on the left. Swipe up for next, down for previous.')));
  if(!window.weatherRecordDesktop)menuSheet.append(button(text('设置','Settings'),async()=>{await close(menu,false);open(settings)},'workout-choice'));
  function render(){
    cards.replaceChildren();if(!workoutMode)return;
    const date=new Date(),day=date.getDay(),key=workoutDateKey(date),all=plan[day]?.exercises||[],remaining=workoutRemaining(plan,completed[key]||[],date);
    const toolbar=element('div','workout-cards-toolbar');toolbar.append(element('span','',text('今日训练','TODAY’S WORKOUT')),button(text('编辑计划','Edit plan'),()=>edit(false),'workout-edit-button'));cards.append(toolbar);
    if(!all.length){cards.append(button(day===0||day===6?text('今日休息 · 编辑计划','Rest day · Edit plan'):text('今日尚无训练 · 添加动作','No workout today · Add exercises'),()=>edit(false),'workout-empty'));return}
    if(!remaining.length){cards.append(element('div','workout-empty',text('✓ 今日健身已完成','✓ Today’s workout is complete')),button(text('撤销最后完成','Undo last completion'),()=>{completed[key]?.pop();localStorage.setItem('atmos_workout_done_v1',JSON.stringify(completed));render()},'workout-undo'));return}
    remaining.slice(0,3).forEach(exercise=>{
      const card=button('',async()=>{if(card.disabled)return;card.disabled=true;card.classList.add('done');card.replaceChildren(element('strong','','✓'));
        completed[key]=[...new Set([...(completed[key]||[]),exercise.id])];
        const keys=Object.keys(completed).sort().slice(-30);completed=Object.fromEntries(keys.map(k=>[k,completed[k]]));localStorage.setItem('atmos_workout_done_v1',JSON.stringify(completed));
        await new Promise(resolve=>setTimeout(resolve,280));render();
      },'workout-card');
      card.append(element('small','',plan[day]?.part||text('训练','Workout')),element('strong','',exercise.name),element('span','',text(`${exercise.sets} 组 × ${exercise.reps} 次`,`${exercise.sets} sets × ${exercise.reps} reps`)));
      card.setAttribute('aria-label',text(`完成 ${exercise.name}，${exercise.sets} 组，每组 ${exercise.reps} 次`,`Complete ${exercise.name}, ${exercise.sets} sets of ${exercise.reps}`));cards.append(card);
    });
  }
  async function changeMode(enabled){
    if(changing||queueNavigationBusy||modeSwitching||coverTransitioning)return;
    if(enabled===workoutMode){await close(menu);render();return}
    changing=true;await Promise.all([close(menu,false),close(editor,false)]);
    const transitionNodes=[cards,$('.context-grid'),$('albumArt'),$('albumName'),$('artistName'),$('albumDescription'),$('tags')].filter(node=>node&&!node.hidden&&getComputedStyle(node).display!=='none');
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const exits=reduced?[]:transitionNodes.map((node,index)=>node.animate([{opacity:1,transform:'translate3d(0,0,0)'},{opacity:0,transform:`translate3d(0,${8+index}px,0)`}],{duration:190+index*10,easing:'cubic-bezier(.4,0,.7,.3)',fill:'forwards'}));
    try{
      if(exits.length)await Promise.all(exits.map(x=>x.finished.catch(()=>{})));
      queueWriter.invalidate();clearTimeout(queueSyncTimer);queueSyncTimer=null;
      while(queueWriter.busy)await wait(50);
      await stopCurrent();
      playbackTargetPending=true;lastConfirmedTrackURI='';observedTrackURI='';
      if(enabled)previousMode=state.mode;
      workoutMode=enabled;workoutQueueReset=true;state.mode=enabled?'single':previousMode;localStorage.setItem('playback_mode',state.mode);
      nextSelectionEpoch++;nextSelectionSlots=[];clearTimeout(prepareNextTimer);queueRestored=true;atmosLikedUses=3;
      document.body.classList.toggle('workout-mode',enabled);cards.hidden=!enabled;render();tags();
      window.dispatchEvent(new Event('workoutModeChanged'));
      document.querySelectorAll('.mode-btn').forEach((b,i)=>b.classList.toggle('active',i===(state.mode==='single'?1:0)));
      // Discard the old browsed song before searching so failure cannot play it as a workout pick.
      state.track=null;state.album=null;state.albumTracks=[];resetProgress();
      $('albumName').textContent=text('正在挑选音乐…','Choosing music…');$('artistName').textContent='';
      if(state.token){const selection=await fetchSelection(state.mode);showSelection(selection)}
      else{state.albumError=text('请先连接 Spotify','Connect Spotify to choose music');tags()}
    }catch(error){state.albumError=error.message;tags()}
    finally{
      exits.forEach(x=>x.cancel());
      const enterNodes=[cards,$('.context-grid'),$('albumArt'),$('albumName'),$('artistName'),$('albumDescription'),$('tags')].filter(node=>node&&!node.hidden&&getComputedStyle(node).display!=='none');
      const enters=reduced?[]:enterNodes.map((node,index)=>node.animate([{opacity:0,transform:'translate3d(-18px,18px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],{duration:400+index*18,delay:index*18,easing:'cubic-bezier(.16,.78,.2,1)',fill:'both'}));
      if(enters.length)await Promise.all(enters.map(x=>x.finished.catch(()=>{})));enters.forEach(x=>x.cancel());changing=false;
    }
  }
  function edit(activate){
    close(menu,false);const sheet=editor.firstElementChild;while(sheet.children.length>1)sheet.lastElementChild.remove();
    const form=element('form','workout-form');
    if(activate){
      form.append(element('p','workout-first-note',text('先设置周一到周五的训练计划；也可以暂时跳过，稍后在健身模式中编辑。','Set your Monday–Friday plan now, or skip and edit it later in Workout mode.')));
      form.append(button(text('跳过，直接进入健身模式','Skip and enter Workout mode'),()=>{close(editor);void changeMode(true)},'workout-skip'));
    }
    const days=isEnglish?['Monday','Tuesday','Wednesday','Thursday','Friday']:['周一','周二','周三','周四','周五'];
    const sections=[];
    days.forEach((label,index)=>{
      const day=index+1,section=element('fieldset','workout-day');section.append(element('legend','',label));
      const partLabel=element('label','',text('健身部位','Body area'));const part=element('input','');part.maxLength=60;part.placeholder=text('例如：胸部、三头肌','e.g. Chest, triceps');part.value=plan[day]?.part||'';partLabel.append(part);section.append(partLabel);
      const rows=element('div','workout-rows');
      const add=exercise=>{
        const row=element('div','workout-row');row.dataset.id=exercise?.id||crypto.randomUUID();
        const name=element('input','');name.placeholder=text('动作','Exercise');name.setAttribute('aria-label',text('动作名称','Exercise name'));name.maxLength=80;name.required=true;name.value=exercise?.name||'';
        const number=(label,value,max)=>{const wrap=element('label','',label),input=element('input','');input.type='number';input.inputMode='numeric';input.min='1';input.max=String(max);input.required=true;input.value=value;wrap.append(input);return wrap};
        row.append(name,number(text('组','Sets'),exercise?.sets||3,99),number(text('次数','Reps'),exercise?.reps||12,999),button('×',()=>row.remove(),'workout-remove'));rows.append(row);
      };
      (plan[day]?.exercises||[]).forEach(add);section.append(rows,button(text('＋ 添加动作','＋ Add exercise'),()=>add(null),'workout-add'));form.append(section);sections.push({day,part,rows});
    });
    const save=element('button','workout-save',text('保存计划','Save plan'));save.type='submit';form.append(save);
    form.onsubmit=e=>{e.preventDefault();if(!form.reportValidity())return;
      const next={};
      for(const {day,part,rows} of sections){
        next[day]={part:part.value.trim(),exercises:Array.from(rows.children).map(row=>{
          const inputs=row.querySelectorAll('input');
          return {id:row.dataset.id,name:inputs[0].value.trim(),sets:Number(inputs[1].value),reps:Number(inputs[2].value)};
        })};
      }
      if(Object.values(next).some(day=>day.exercises.some(x=>!x.name))){alert(text('请填写动作名称','Enter exercise names'));return}
      localStorage.setItem('atmos_workout_plan_v1',JSON.stringify(next));plan=next;close(editor);if(activate)void changeMode(true);else render();
    };
    sheet.append(form);open(editor);
  }
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){close(menu);close(editor)}if(e.key==='Tab'){const modal=[menu,editor].find(x=>!x.hidden);if(!modal)return;const nodes=[...modal.querySelectorAll('button,input')].filter(x=>!x.disabled);const first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}});
  let lastDate=workoutDateKey();setInterval(()=>{const key=workoutDateKey();if(key!==lastDate){lastDate=key;render()}},30000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)render()});
})();

(function bindShareCard() {
  const trigger = $('shareCardOpen');
  const dialog = $('shareCardDialog');
  const nativeShare = window.webkit?.messageHandlers?.shareRecordCard;
  if (!trigger || !dialog || !dialog.showModal || (nativeApp && !nativeShare)) return;

  const canvas = $('shareCardCanvas');
  const status = $('shareCardStatus');
  const download = $('shareCardDownload');
  const lyricField = $('shareCardLyrics');
  const lyricList = $('shareCardLyricList');
  const lyricHint = $('shareCardLyricHint');
  const previewButton = $('shareCardPreview');
  const editButton = $('shareCardEditLyrics');
  const systemShare = $('shareCardSystem');
  const copy = (zh, en) => isEnglish ? en : zh;
  let previewURL = '';
  let generation = 0;
  let shareData = null;
  let browserShareFailed = false;
  let renderVersion = 0;
  let selection = null;
  let lyrics = [];
  let selectingLyrics = false;
  const pickedLyrics = new Set();
  const maxLyrics = 5;

  function setStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }

  function loadImage(url) {
    if (!url) return Promise.resolve(null);
    return new Promise(resolve => {
      const image = new Image();
      const finish = value => {
        clearTimeout(timeout);
        image.onload = image.onerror = null;
        resolve(value);
      };
      const timeout = setTimeout(() => finish(null), 3500);
      try {
        const resolved = new URL(url, document.baseURI);
        if (['http:', 'https:'].includes(resolved.protocol) && resolved.origin !== location.origin) {
          image.crossOrigin = 'anonymous';
        }
      } catch {
        finish(null);
        return;
      }
      image.onload = () => {
        // Check each asset on a disposable canvas before drawing the export.
        const probe = document.createElement('canvas');
        probe.width = probe.height = 1;
        try {
          const context = probe.getContext('2d');
          context.drawImage(image, 0, 0, 1, 1);
          context.getImageData(0, 0, 1, 1);
          finish(image);
        } catch {
          finish(null);
        }
      };
      image.onerror = () => finish(null);
      image.src = url;
    });
  }

  function drawCard({title, artist, context, cover, logo}, excerpt) {
    const ctx = canvas.getContext('2d');
    const ink = '#212621';
    const muted = '#526057';
    const paper = '#f7f7f0';
    function write(text, x, y, size, color = ink, weight = 500, maxWidth = 912) {
      ctx.fillStyle = color;
      do {
        ctx.font = `${weight} ${size}px system-ui, sans-serif`;
        if (ctx.measureText(text).width <= maxWidth || size <= 24) break;
        size -= 2;
      } while (true);
      if (ctx.measureText(text).width > maxWidth) {
        const characters = Array.from(text);
        while (characters.length && ctx.measureText(characters.join('') + '…').width > maxWidth) characters.pop();
        text = characters.join('') + '…';
      }
      ctx.fillText(text, x, y);
    }

    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    write(copy('气象唱片', 'Weather Record'), 84, 112, 44, ink, 650, 345);
    ctx.textAlign = 'right';
    write(context, 996, 112, 34, muted, 500, 545);
    ctx.textAlign = 'left';

    const hasLyrics = excerpt.length > 0;
    const artSize = hasLyrics ? 670 : 912;
    const artX = (canvas.width - artSize) / 2;
    const artY = 166;
    ctx.fillStyle = '#e4e9df';
    ctx.fillRect(artX, artY, artSize, artSize);
    if (cover) {
      const scale = Math.min(artSize / cover.naturalWidth, artSize / cover.naturalHeight);
      const width = cover.naturalWidth * scale;
      const height = cover.naturalHeight * scale;
      ctx.drawImage(cover, artX + (artSize - width) / 2, artY + (artSize - height) / 2, width, height);
    } else {
      const centerX = canvas.width / 2;
      const centerY = artY + artSize / 2;
      for (const radius of [255, 219, 183, 147, 95, 12]) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.strokeStyle = '#4c5c50';
        ctx.lineWidth = radius === 255 ? 4 : 2;
        ctx.stroke();
      }
    }

    write(title, 84, hasLyrics ? 935 : 1180, 78, ink, 690);
    write(artist, 84, hasLyrics ? 992 : 1244, 43, muted);
    if (hasLyrics) {
      const size = excerpt.length > 3 ? 39 : 44;
      const linesPerLyric = Math.floor(6 / excerpt.length);
      let baseline = 1060;
      for (const lyric of excerpt) {
        const segments = typeof Intl.Segmenter === 'function'
          ? Array.from(new Intl.Segmenter(undefined, {granularity:'word'}).segment(lyric), part => part.segment)
          : Array.from(lyric);
        ctx.font = `550 ${size}px system-ui, sans-serif`;
        const lines = [''];
        for (const segment of segments) {
          const last = lines.length - 1;
          if (lines[last] && ctx.measureText(lines[last] + segment).width > 912) lines.push(segment.trimStart());
          else lines[last] += segment;
        }
        const visible = lines.slice(0, linesPerLyric);
        if (lines.length > linesPerLyric) visible[visible.length - 1] = visible.at(-1).trimEnd() + '…';
        for (const line of visible) {
          write(line.trim(), 84, baseline, size, muted, 550);
          baseline += 46;
        }
      }
    }
    if (logo) ctx.drawImage(logo, 84, 1320, 150, 150 * 225.25 / 823.46);
  }

  function clearExport() {
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = '';
    shareData = null;
    download.removeAttribute('href');
    download.hidden = systemShare.hidden = true;
    systemShare.disabled = false;
  }

  function clearPreview() {
    clearExport();
    selection = null;
    lyrics = [];
    pickedLyrics.clear();
    selectingLyrics = false;
    lyricList.replaceChildren();
    lyricList.scrollTop = 0;
    lyricField.hidden = canvas.hidden = previewButton.hidden = editButton.hidden = true;
  }

  async function updatePreview() {
    if (!selection || selectingLyrics) return;
    const version = ++renderVersion;
    const request = generation;
    const excerpt = lyrics.filter((_, index) => pickedLyrics.has(index)).map(line => line.text);
    const {title, artist, context} = selection;
    clearExport();
    try {
      drawCard(selection, excerpt);
      canvas.setAttribute('aria-label', [title, artist, context, ...excerpt].filter(Boolean).join(' · '));
      canvas.hidden = false;
      if (nativeShare) {
        const image = canvas.toDataURL('image/png');
        if (!image.startsWith('data:image/png;base64,')) throw new Error('PNG export failed');
        shareData = {image};
        download.href = '#';
        download.hidden = false;
        systemShare.hidden = false;
      } else {
        const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!dialog.open || selectingLyrics || request !== generation || version !== renderVersion) return;
        if (!png) throw new Error('PNG export failed');
        previewURL = URL.createObjectURL(png);
        download.href = previewURL;
        download.hidden = false;
        if (!browserShareFailed && typeof navigator.share === 'function') {
          try {
            // Some Safari share targets reject mixed file and text payloads.
            const data = {files:[new File([png], download.download, {type:'image/png'})]};
            if (navigator.canShare?.(data)) {
              shareData = data;
              systemShare.hidden = false;
            }
          } catch (error) {
            console.debug('Browser file sharing unavailable', error);
          }
        }
      }
      setStatus('');
    } catch {
      if (dialog.open && request === generation && version === renderVersion) {
        setStatus(copy('图片生成失败，请关闭后重试。', 'Could not create the image. Close and try again.'));
      }
    }
  }

  function openLyricPicker() {
    selectingLyrics = true;
    clearExport();
    canvas.hidden = editButton.hidden = true;
    lyricField.hidden = previewButton.hidden = false;
    setStatus('');
  }

  function showPreview() {
    selectingLyrics = false;
    lyricField.hidden = previewButton.hidden = true;
    editButton.hidden = !lyrics.length;
    if (!selection) setStatus(copy('正在生成图片…', 'Preparing image…'));
    void updatePreview();
  }

  function updateLyricHint() {
    const count = `${pickedLyrics.size}/${maxLyrics}`;
    lyricHint.textContent = copy(`点按歌词选择 · ${count}`, `Tap lyrics to select · ${count}`);
    previewButton.textContent = pickedLyrics.size
      ? copy('预览卡片', 'Preview card')
      : copy('继续，不加歌词', 'Continue without lyrics');
  }

  async function offerLyrics(track, position, request) {
    const record = await getLyricsRecord(track).catch(() => null);
    if (!dialog.open || request !== generation) return;
    if (record && !record.error && !record.instrumental) {
      const timed = parseSyncedLyrics(record.syncedLyrics).filter(line => line.text !== '♪');
      lyrics = timed.length ? timed : (record.plainLyrics || '').split(/\r?\n/)
        .map(text => ({text:text.trim()})).filter(line => line.text);
    }
    if (!lyrics.length) {
      if (selectingLyrics) showPreview();
      return;
    }

    let current = -1;
    if (position !== null) {
      for (let index = 0; index < lyrics.length && lyrics[index].time <= position; index++) current = index;
    }
    let currentRow;
    lyricList.replaceChildren(...lyrics.map((line, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = line.text;
      button.setAttribute('aria-pressed', 'false');
      if (index === current) {
        button.setAttribute('aria-current', 'true');
        currentRow = button;
      }
      button.onclick = () => {
        if (pickedLyrics.has(index)) pickedLyrics.delete(index);
        else if (pickedLyrics.size < maxLyrics) pickedLyrics.add(index);
        else {
          lyricHint.textContent = copy('最多选 5 句，取消一句后可以继续选。', 'Choose up to 5 lines. Deselect one to choose another.');
          return;
        }
        button.setAttribute('aria-pressed', String(pickedLyrics.has(index)));
        updateLyricHint();
      };
      return button;
    }));
    updateLyricHint();
    if (selectingLyrics) {
      if (currentRow) {
        lyricList.scrollTop = currentRow.offsetTop - lyricList.firstElementChild.offsetTop;
      }
    } else editButton.hidden = false;
  }

  trigger.hidden = false;
  trigger.setAttribute('aria-haspopup', 'dialog');
  if (nativeShare) document.querySelector('.topbar').append(trigger);
  $('shareCardLabel').textContent = $('shareCardTitle').textContent = copy('分享唱片', 'Share record');
  trigger.setAttribute('aria-label', $('shareCardLabel').textContent);
  $('shareCardClose').setAttribute('aria-label', copy('关闭', 'Close'));
  download.textContent = copy('保存 PNG', 'Save PNG');
  lyricList.setAttribute('aria-label', copy('选择歌词', 'Select lyrics'));
  previewButton.onclick = showPreview;
  editButton.textContent = copy('编辑歌词', 'Edit lyrics');
  editButton.onclick = openLyricPicker;
  systemShare.textContent = copy('分享图片', 'Share image');

  trigger.onclick = async () => {
    const track = state.mode === 'single' ? lyricsTrack() : null;
    const position = track?.uri && track.uri === nativeCurrentTrackURI
      ? currentLyricsPosition() / 1000
      : null;
    const album = track?.album || state.album;
    const item = track || album;
    const request = ++generation;
    clearPreview();
    dialog.showModal();
    if (!item?.uri) {
      setStatus(copy('选好一首歌或一张专辑后就能分享。', 'Pick a track or album to share.'));
      return;
    }
    const now = new Date();
    const title = item.name;
    const artist = item.artists?.map(entry => entry.name).join(', ') || album?.artist || '';
    const temperature = $('temperature').textContent.trim();
    const weather = state.weather === 'unknown'
      ? ''
      : [temperature !== '--°' ? temperature : '', weatherText[state.weather]].filter(Boolean).join(' ');
    const time = new Intl.DateTimeFormat('en-GB', {hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(now);
    const date = new Intl.DateTimeFormat(copy('zh-CN', 'en-GB'), {day:'numeric', month:'short'}).format(now);
    const context = [weather, date, time].filter(Boolean).join(' · ');
    if (track) {
      openLyricPicker();
      lyricHint.textContent = copy('正在找歌词…', 'Looking for lyrics…');
      previewButton.textContent = copy('继续，不加歌词', 'Continue without lyrics');
      void offerLyrics(track, position, request);
    } else setStatus(copy('正在生成图片…', 'Preparing image…'));
    const [cover, logo] = await Promise.all([
      loadImage(album?.images?.[0]?.url),
      loadImage(nativeShare ? window.WEATHER_RECORD_SHARE_LOGO : 'spotify-share-logo.svg'),
    ]);
    if (!dialog.open || request !== generation) return;
    selection = {title, artist, context, cover, logo};
    void updatePreview();
  };

  systemShare.onclick = async () => {
    if (!shareData || systemShare.disabled) return;
    const data = shareData;
    try {
      if (nativeShare) {
        setStatus('');
        nativeShare.postMessage(data);
        return;
      }
      systemShare.disabled = true;
      await navigator.share(data);
    } catch (error) {
      if (!dialog.open || data !== shareData || error.name === 'AbortError') return;
      if (nativeShare) {
        setStatus(copy('无法打开分享菜单，可以点「保存 PNG」。', 'Could not open the share sheet. You can save the PNG.'));
        return;
      }
      console.debug('Browser rejected file sharing', error);
      browserShareFailed = true;
      shareData = null;
      systemShare.hidden = true;
      setStatus(copy('图片已生成。点「保存 PNG」，即可用保存的图片分享。', 'Your image is ready. Save the PNG to share it.'));
      download.focus();
    } finally {
      if (data === shareData || !shareData) systemShare.disabled = false;
    }
  };

  if (nativeShare) {
    download.onclick = event => {
      event.preventDefault();
      if (!shareData) return;
      setStatus('');
      try {
        nativeShare.postMessage({action:'save', image:shareData.image});
      } catch {
        setStatus(copy('无法保存 PNG，请重试。', 'Could not save the PNG. Try again.'));
      }
    };
    window.addEventListener('weatherRecordShareError', event => {
      if (!dialog.open || !shareData) return;
      setStatus(event.detail === 'save'
        ? copy('无法保存 PNG，请重试。', 'Could not save the PNG. Try again.')
        : copy('无法打开分享菜单，可以点「保存 PNG」。', 'Could not open the share sheet. You can save the PNG.'));
    });
    window.addEventListener('weatherRecordShareSaved', () => {
      if (dialog.open && shareData) setStatus(copy('已保存到「文件」。', 'Saved to Files.'));
    });
  }

  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    generation++;
    clearPreview();
    trigger.focus();
    tryPresentTrackRating();
  });
})();
