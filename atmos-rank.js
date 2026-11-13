// SDK-independent counterpart of ios/Recommendation/AtmosRanker.swift.
// Metadata estimates are priors, never measurements of Spotify audio.
(function(root){
  const unit=x=>Number.isFinite(x)?Math.max(0,Math.min(1,x)):0.5;
  const vector=(e,v,c)=>[e,v,c].map(unit);
  const priors={motivate:[.8,.7,.25],pop:[.65,.65,.4],relaxed:[.4,.6,.8],soft:[.25,.5,.9],vivid:[.85,.8,.2],night:[.25,.4,.8]};
  const keys=a=>new Set((a||[]).map(x=>x.trim().toLowerCase()).filter(Boolean));
  const overlap=(a,b)=>[...keys(a)].some(x=>keys(b).has(x));
  const distance=(a,b)=>Math.sqrt(a.reduce((s,x,i)=>s+(x-b[i])**2,0)/a.length);
  class AtmosPortableRanker{
    constructor(records=[],config={}){
      this.config={weatherWeight:.45,timeWeight:.30,moodWeight:.60,noveltyWeight:.20,diversityWeight:.10,explorationWeight:.10,temperature:.20,recentWindow:604800,skipWindow:3600,repeatCooldown:1800,...config};
      this.features=new Map();this.load(records);
    }
    load(records){for(const r of records||[])if(r?.spotifyID)this.features.set(r.spotifyID,r)}
    feature(item){return this.features.get(item.id)||this.features.get(item.featureKey)}
    weather(code){
      if([0,1].includes(code))return [.8,.8,.3];
      if([2,3].includes(code))return [.45,.55,.7];
      if([51,53,55,56,57,61,63,66,67,80].includes(code))return [.3,.5,.85];
      if([65,81,82,95,96,99].includes(code))return [.25,.4,.9];
      if([71,73,75,77,85,86].includes(code))return [.25,.65,.9];
      return [.5,.5,.5];
    }
    target(code,hour){
      const t=hour>=5&&hour<11?[.7,.75,.45]:hour>=11&&hour<17?[.65,.7,.5]:hour>=17&&hour<21?[.4,.65,.75]:[.2,.5,.95];
      const a=code==null?0:this.config.weatherWeight,b=this.config.timeWeight;
      return t.map((x,i)=>unit((this.weather(code)[i]*a+x*b)/Math.max(.001,a+b)));
    }
    vector(item){
      const f=this.feature(item);
      if(f&&f.source!=='unlabeled'){
        const values=[f.energy,f.valence,f.calmness],known=values.filter(Number.isFinite).length;
        return {mood:values.map(unit),confidence:Math.min(f.source==='metadataEstimate'?.3:1,unit(f.confidence))*known/3};
      }
      const found=(item.tags||[]).map(t=>priors[t]).filter(Boolean);
      return found.length?{mood:[0,1,2].map(i=>found.reduce((s,v)=>s+v[i],0)/found.length),confidence:.2}:{mood:[.5,.5,.5],confidence:0};
    }
    workoutEligible(item){
      const f=this.feature(item);
      if(f&&f.source!=='unlabeled'&&Number.isFinite(f.confidence)&&f.confidence>0){
        if(Number.isFinite(f.groove))return f.groove>=.65;
        if(f.energy>=.72&&(f.calmness??.5)<=.55)return true;
      }
      return (item.tags||[]).some(t=>t==='motivate'||t==='vivid');
    }
    score(item,target,history,now,previous,random){
      const {mood,confidence}=this.vector(item),f=this.feature(item),c=this.config;
      let match=.5+confidence*(.5-distance(mood,target));
      if(f&&f.source!=='unlabeled'){
        const targets=[unit(.15+target[2]*.70-target[0]*.15),unit(.12+target[2]*.68-target[1]*.10),unit(target[0]*.72+target[1]*.28)];
        const pairs=[f.acousticness,f.instrumentalness,f.groove].map((v,i)=>[v,targets[i]]).filter(p=>Number.isFinite(p[0]));
        if(pairs.length)match=match*.68+(.5+confidence*(.5-distance(pairs.map(p=>unit(p[0])),pairs.map(p=>p[1]))))*.32;
      }
      const recent=history.filter(e=>e.timestamp<=now&&now-e.timestamp<c.recentWindow).sort((a,b)=>a.timestamp-b.timestamp);
      const last=recent.filter(e=>e.id===item.id).at(-1);
      const novelty=last?unit((now-last.timestamp)/c.recentWindow):1;
      let diversity=overlap(recent.slice(-5).flatMap(e=>e.artists),item.artists)?.4:1;
      if(previous){if(overlap(previous.artists,item.artists))diversity*=.2;const p=this.vector(previous);diversity*=1-Math.min(confidence,p.confidence)*Math.abs(mood[0]-p.mood[0])}
      const skipped=recent.some(e=>e.id===item.id&&e.skipped&&now-e.timestamp<c.skipWindow),exploration=unit(random());
      const total=unit((match*c.moodWeight+novelty*c.noveltyWeight+diversity*c.diversityWeight+exploration*c.explorationWeight)*(skipped?.35:1));
      return {id:item.id,moodMatch:match,novelty,diversity,exploration,confidence,total};
    }
    sample(candidates,count,target,history=[],now=Date.now()/1000,previous=null,random=Math.random){
      const seen=new Set();let pool=candidates.filter(c=>c?.id&&!seen.has(c.id)&&seen.add(c.id)),result=[];
      while(pool.length&&result.length<count){
        const blocked=new Set(history.filter(e=>e.timestamp<=now&&now-e.timestamp<(e.skipped?this.config.skipWindow:this.config.repeatCooldown)).map(e=>e.id));
        let eligible=pool.filter(c=>!blocked.has(c.id)&&c.id!==previous?.id);if(!eligible.length)eligible=pool;
        if(previous){const different=eligible.filter(c=>!overlap(c.artists,previous.artists));if(different.length)eligible=different}
        const scores=eligible.map(c=>this.score(c,target,history,now,previous,random)),max=Math.max(...scores.map(s=>s.total));
        const temp=Number.isFinite(this.config.temperature)?Math.max(.001,this.config.temperature):.2;
        const weights=scores.map(s=>Math.exp((s.total-max)/temp));let draw=unit(random())*weights.reduce((a,b)=>a+b,0),i=weights.length-1;
        for(let j=0;j<weights.length;j++){draw-=weights[j];if(draw<0){i=j;break}}
        result.push(scores[i]);previous=eligible[i];pool=pool.filter(c=>c.id!==previous.id);
      }
      return result;
    }
  }
  root.AtmosPortableRanker=AtmosPortableRanker;
})(globalThis);
