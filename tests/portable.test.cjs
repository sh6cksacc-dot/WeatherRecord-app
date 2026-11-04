// Run with Node 20+: node --test tests/portable.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const web=path.join(__dirname,'../web');
function context(){
  const storage=new Map(),events=[],requests=[];
  const c=vm.createContext({console,URL,URLSearchParams,AbortSignal,TextEncoder,setTimeout,clearTimeout,Date,Math,events,requests,
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    document:{documentElement:{classList:{add(){}}},addEventListener(){},hidden:false},
    CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail}},
    fetch:async()=>({ok:true,json:async()=>[]})
  });
  vm.runInContext('var window=globalThis;window.dispatchEvent=e=>events.push(e);var state={token:"token"};var nativeCurrentTrackURI="spotify:track:a";var confirmedLikedURIs=new Set([nativeCurrentTrackURI]);var isEnglish=true;',c);
  vm.runInContext(fs.readFileSync(path.join(web,'atmos-rank.js'),'utf8'),c);
  vm.runInContext(fs.readFileSync(path.join(web,'portable.js'),'utf8'),c);
  vm.runInContext('portableAPI=async(...args)=>{requests.push(args);return null};portableResponse=async(...args)=>{requests.push(args);return {status:204}};portableRead=async()=>{};',c);
  vm.runInContext(fs.readFileSync(path.join(web,'portable-services.js'),'utf8'),c);
  return c;
}
const run=(c,source)=>vm.runInContext(source,c);
function androidContext(){
  const c=context();c.crypto=require('node:crypto').webcrypto;
  run(c,`window.AndroidHost={};var workoutMode=false,workoutQueueReset=false,nextSelectionEpoch=0,nextSelectionSlots=[],queueTrackCache=new Map(),queueRestored=false;var queueWriter={issued:new Set(),persist(){}};var acceptRemoteProgress=false;var moodArtists={};function recommendationKey(){return 'sunny|morning'}function preloadCover(){return Promise.resolve()}function queueStatus(){};state.mode='single';
  var track=id=>({id,uri:'spotify:track:'+id,name:id,artists:[{name:'Artist '+id}],album:{id:'album'+id,uri:'spotify:album:'+id,images:[]}});
  state.track=track('a');var playing=false,position=64000,playerTrack=state.track,playerContext=null,playlistTracks=[],creates=0,replaceLost=false,appendLost=false;
  localStorage.setItem('portable_scopes','playlist-modify-private playlist-read-private');
  portableAPI=async(path,method='GET',body)=>{
    requests.push([path,method,body]);
    if(path==='/me')return {id:'user'};
    if(path==='/me/playlists'&&method==='POST'){creates++;return {id:'session'}};
    if(path==='/playlists/session')return {owner:{id:'user'},public:false};
    if(path==='/me/player'&&method==='GET')return {item:playerTrack,device:{id:'device'},context:playerContext?{uri:playerContext}:null,is_playing:playing,progress_ms:position};
    if(path==='/me/player/queue')return {queue:[]};
    if(path==='/playlists/session/items'&&method==='PUT'){playlistTracks=body.uris.slice();if(replaceLost){replaceLost=false;throw Error('Simulated response loss')}return null;}
    if(path==='/playlists/session/items'&&method==='POST'){playlistTracks.push(...body.uris);if(appendLost){appendLost=false;throw Error('Simulated response loss')}return null;}
    if(path.startsWith('/playlists/session/items?')){const q=new URLSearchParams(path.split('?')[1]),offset=Number(q.get('offset'))||0;return {items:playlistTracks.slice(offset).map(uri=>({item:{uri}}))};}
    if(path.startsWith('/me/player/play')&&method==='PUT'){playing=true;if(body){playerContext=body.context_uri;playerTrack=track(playlistTracks[body.offset.position].split(':').pop());position=body.position_ms;}return null;}
    if(path.startsWith('/me/player/shuffle')||path.startsWith('/me/player/repeat'))return null;
    throw Error('Unexpected test API '+method+' '+path);
  };`);
  vm.runInContext(fs.readFileSync(path.join(web,'portable-session.js'),'utf8'),c);
  run(c,"portableBuildSession=async root=>root?[root,track('b'),track('c')]:[track('d'),track('e')]");
  return c;
}
test('contexts, missing weather and Swift-equivalent vectors',()=>{
  const c=context();run(c,'var r=new AtmosPortableRanker()');
  assert.ok(Math.abs(run(c,'r.target(0,8)[0]')-.76)<1e-9);
  assert.ok(run(c,'r.target(65,2)[2]')>.9);
  assert.ok(Math.abs(run(c,'r.target(3,18)[0]')-.43)<1e-9);
  assert.equal(run(c,'r.target(null,2)[0]'),.2);
});
test('sampling: no duplicate, finite exhaustion, cooldown and artist separation',()=>{
  const c=context();run(c,"var r=new AtmosPortableRanker(),pool=[{id:'a',artists:['A'],tags:[]},{id:'b',artists:['A'],tags:[]},{id:'c',artists:['B'],tags:[]}]");
  assert.equal(run(c,"r.sample(pool,1,[.5,.5,.5],[],100,pool[0],()=>.1)[0].id"),'c');
  assert.equal(run(c,'r.sample([...pool,pool[0]],20,[.5,.5,.5],pool.map(p=>({...p,timestamp:99})),100).length'),3);
  assert.equal(run(c,'r.sample([],6,[.5,.5,.5]).length'),0);
  assert.equal(run(c,'r.vector(pool[0]).confidence'),0);
});
test('six-axis subjective rating persists and changes workout eligibility',async()=>{
  const c=context();await run(c,'portableFeaturesReady');
  await run(c,"portableSend('trackRatingSave',{uri:nativeCurrentTrackURI,title:'A',artist:'B',album:'C',values:{energy:80,valence:70,calmness:20,acousticness:10,instrumentalness:10,groove:90}})");
  assert.equal(run(c,"portableRanker.workoutEligible({id:'a',tags:[]})"),true);
  assert.equal(run(c,"JSON.parse(localStorage.getItem('atmos.portable.ratings.v1'))['spotify:track:a'].values.groove"),90);
  await run(c,"portableSend('trackRatingCheck',{uri:nativeCurrentTrackURI})");
  assert.equal(c.events.at(-1).detail.status,'rated');
  run(c,'confirmedLikedURIs.clear()');
  await run(c,"portableSend('trackRatingCheck',{uri:nativeCurrentTrackURI,knownLiked:true})");
  assert.equal(c.events.at(-1).detail.eligible,false);
});
test('queue read/write preserves HTTP status; append never sends playback commands',async()=>{
  const c=context();
  await run(c,"portableSend('spotifyQueueRequest',{requestID:1,method:'POST',path:'/me/player/queue',uri:'spotify:track:b',deviceID:'device'})");
  assert.equal(c.requests.length,1);
  assert.equal(c.requests[0][0],'/me/player/queue?uri=spotify%3Atrack%3Ab&device_id=device');
  assert.equal(c.requests[0][1],'POST');
  run(c,'portableResponse=async()=>({status:429,retryAfter:30})');
  await run(c,"portableSend('spotifyQueueRequest',{requestID:2,method:'GET',path:'/me/player/queue'})");
  assert.equal(c.events.at(-1).detail.status,429);
  assert.equal(c.events.at(-1).detail.retryAfter,30);
});
test('pause/resume uses context-free resume, never restarts the selected URI',async()=>{
  const c=context();
  await run(c,"Promise.all([portableSend('spotifyPause'),portableSend('spotifyResume')])");
  assert.equal(c.requests[0][0],'/me/player/pause');
  assert.equal(c.requests[1][0],'/me/player/play');
  assert.equal(c.requests[1].length,2);
});
test('lyrics reject other recording or duration; review rejects wrong album',()=>{
  const c=context();
  assert.equal(run(c,"portableLyricsMatch({trackName:'Song (Live)',artistName:'A',duration:200},{trackName:'Song',artistName:'A',duration:200})"),false);
  assert.equal(run(c,"portableLyricsMatch({trackName:'Song',artistName:'A',duration:220},{trackName:'Song',artistName:'A',duration:200})"),false);
  assert.equal(run(c,"portableParseReview('', 'Album', 'Artist')"),null);
});
test('seed injection reproduces output',()=>{
  const c=context();
  run(c,"function seeded(){let seed=42;return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296}};var r=new AtmosPortableRanker(),pool=Array.from({length:30},(_,i)=>({id:String(i),artists:[String(i%4)],tags:[]}));function sample(){return JSON.stringify(r.sample(pool,6,[.5,.5,.5],[],100,null,seeded()))}");
  assert.equal(run(c,'sample()'),run(c,'sample()'));
});
test('Android private playlist uses current items endpoints, not manual queue appends',async()=>{
  const c=androidContext();await run(c,'portableSessionPlay()');
  assert.equal(run(c,'creates'),1);
  assert.equal(run(c,"portableAndroidPlan.tracks.map(t=>t.id).join(',')"),'a,b,c');
  assert.equal(c.requests.find(r=>r[0]==='/me/playlists'&&r[1]==='POST')[2].public,false);
  assert.equal(c.requests.find(r=>r[0].startsWith('/me/player/play?'))[2].context_uri,'spotify:playlist:session');
  assert.equal(c.requests.some(r=>r[0]==='/me/player/queue'&&r[1]==='POST'),false);
});
test('Android pause/resume retains 64 second position without rebuilding or restarting',async()=>{
  const c=androidContext();await run(c,'portableSessionPlay()');
  c.requests.length=0;run(c,'playing=false;position=64000');await run(c,'portableSessionPlay()');
  assert.equal(run(c,'position'),64000);
  const plays=c.requests.filter(r=>r[0].startsWith('/me/player/play'));assert.equal(plays.length,1);assert.equal(plays[0][2],undefined);
  assert.equal(c.requests.some(r=>r[1]==='PUT'&&r[0].includes('/items')),false);
});
test('Android next swipe plays the same stored playlist position',async()=>{
  const c=androidContext();await run(c,'portableSessionPlay()');c.requests.length=0;run(c,"state.track=track('b')");await run(c,'portableSessionPlay()');
  assert.equal(c.requests.find(r=>r[0].startsWith('/me/player/play?'))[2].offset.position,1);
  assert.equal(run(c,'creates'),1);assert.equal(c.requests.some(r=>r[0].includes('/items')&&r[1]==='PUT'),false);
});
test('Android accepted playlist replace with lost response is verified before play',async()=>{
  const c=androidContext();run(c,'replaceLost=true');await run(c,'portableSessionPlay()');
  assert.equal(run(c,'playing'),true);assert.equal(c.requests.filter(r=>r[0]==='/playlists/session/items'&&r[1]==='PUT').length,1);
});
test('Android append with lost response is reconciled once without replacing the active playlist',async()=>{
  const c=androidContext();await run(c,'portableSessionPlay()');c.requests.length=0;run(c,'appendLost=true');await run(c,'portableAndroidExtend()');
  assert.equal(run(c,'portableAndroidPlan.pending'),false);assert.equal(run(c,'playlistTracks.join(",")'),'spotify:track:a,spotify:track:b,spotify:track:c,spotify:track:d,spotify:track:e');
  assert.equal(c.requests.filter(r=>r[0]==='/playlists/session/items'&&r[1]==='POST').length,1);assert.equal(c.requests.some(r=>r[1]==='PUT'),false);
});
test('Android missing private playlist scope does not create or overwrite playlists',async()=>{
  const c=androidContext();run(c,"localStorage.setItem('portable_scopes','user-library-read')");
  await assert.rejects(run(c,'portableSessionPlay()'),/Connect Spotify again/);assert.equal(run(c,'creates'),0);
});
test('Android double play shares one session creation and one start request',async()=>{
  const c=androidContext();await run(c,'Promise.all([portableSessionPlay(),portableSessionPlay()])');
  assert.equal(run(c,'creates'),1);assert.equal(c.requests.filter(r=>r[0].startsWith('/me/player/play?')).length,1);
});
