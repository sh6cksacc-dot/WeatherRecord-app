using System.Text.Json.Nodes;

// Subjective/metadata features only. No Spotify audio feature endpoint is used.
public sealed class AtmosEngine {
    readonly Dictionary<string,JsonObject> features=new();
    public JsonObject ArtistTags {get;set;}=new();
    public readonly List<JsonObject> History=new();
    public int? WeatherCode {get;set;}
    public int OffsetMinutes {get;set;}
    public bool Workout {get;set;}
    static readonly Dictionary<string,double[]> priors=new(){["motivate"]=[.8,.7,.25],["pop"]=[.65,.65,.4],["relaxed"]=[.4,.6,.8],["soft"]=[.25,.5,.9],["vivid"]=[.85,.8,.2],["night"]=[.25,.4,.8]};
    public AtmosEngine(string? json=null){if(json!=null)foreach(var f in JsonNode.Parse(json)?.AsArray()??[])if(f is JsonObject obj)features[Text(obj,"spotifyID")]=obj;}
    public static string Text(JsonNode? n,string key)=>n?[key]?.GetValue<string>()??"";
    public static double Unit(double x)=>double.IsFinite(x)?Math.Clamp(x,0,1):.5;
    static double? Number(JsonNode? n){if(n is not JsonValue v)return null;double x;if(v.TryGetValue<double>(out x))return double.IsFinite(x)?x:null;if(v.TryGetValue<int>(out var i))return i;if(v.TryGetValue<long>(out var l))return l;if(v.TryGetValue<decimal>(out var d))return (double)d;return null;}
    public static string URI(JsonNode? t)=>Text(t,"uri");
    public static string[] Artists(JsonNode? t)=>(t?["artists"]?.AsArray()??[]).Select(a=>a is JsonValue?a.GetValue<string>():Text(a,"name")).Select(a=>a.Trim().ToLowerInvariant()).Where(a=>a.Length>0).ToArray();
    string[] Tags(JsonNode t)=>ArtistTags.Where(p=>(p.Value?.AsArray()??[]).Any(a=>Artists(t).Contains(a?.GetValue<string>().ToLowerInvariant()))).Select(p=>p.Key).ToArray();
    public void Ratings(JsonObject values){foreach(var pair in values){var v=pair.Value?["values"]?.AsObject();if(v==null)continue;var f=new JsonObject{["source"]="manual",["confidence"]=1.0};foreach(var p in v)f[p.Key]=Unit((Number(p.Value)??50)/100);features[pair.Key.Split(':').Last()]=f;}}
    JsonObject? Feature(JsonNode t)=>features.GetValueOrDefault(Text(t,"id"));
    public (double[] mood,double confidence) Vector(JsonNode t){
        var f=Feature(t);if(f!=null&&Text(f,"source")!="unlabeled"){
            var values=new[]{Number(f["energy"]),Number(f["valence"]),Number(f["calmness"])};
            return (values.Select(v=>Unit(v??.5)).ToArray(),Math.Min(Text(f,"source")=="metadataEstimate"?.3:1,Unit(Number(f["confidence"])??0))*values.Count(v=>v.HasValue)/3);
        }
        var found=Tags(t).Where(priors.ContainsKey).Select(k=>priors[k]).ToArray();
        return found.Length==0?([.5,.5,.5],0):(Enumerable.Range(0,3).Select(i=>found.Average(v=>v[i])).ToArray(),.2);
    }
    public bool Eligible(JsonNode t){var f=Feature(t);if(f!=null&&Text(f,"source")!="unlabeled"&&Number(f["confidence"])>0){if(Number(f["groove"]) is double g)return g>=.65;if(Number(f["energy"])>=.72&&(Number(f["calmness"])??.5)<=.55)return true;}return Tags(t).Any(k=>k is "motivate" or "vivid");}
    public double[] Target(DateTimeOffset now){
        if(Workout)return [.85,.75,.2];
        double[] w=WeatherCode switch{0 or 1=>[.8,.8,.3],2 or 3=>[.45,.55,.7],51 or 53 or 55 or 56 or 57 or 61 or 63 or 66 or 67 or 80=>[.3,.5,.85],65 or 81 or 82 or 95 or 96 or 99=>[.25,.4,.9],71 or 73 or 75 or 77 or 85 or 86=>[.25,.65,.9],_=>[.5,.5,.5]};
        int h=now.ToOffset(TimeSpan.FromMinutes(Math.Clamp(OffsetMinutes,-840,840))).Hour;
        double[] t=h>=5&&h<11?[.7,.75,.45]:h>=11&&h<17?[.65,.7,.5]:h>=17&&h<21?[.4,.65,.75]:[.2,.5,.95];
        double a=WeatherCode.HasValue?.45:0;return Enumerable.Range(0,3).Select(i=>(w[i]*a+t[i]*.30)/(a+.30)).ToArray();
    }
    static bool Overlap(IEnumerable<string> a,IEnumerable<string> b)=>a.Intersect(b).Any();
    public double Score(JsonNode t,double[] target,double now,JsonNode? previous,double exploration){
        var (m,c)=Vector(t);double distance=Math.Sqrt(m.Select((v,i)=>Math.Pow(v-target[i],2)).Average()),match=.5+c*(.5-distance);
        var f=Feature(t);if(f!=null&&Text(f,"source")!="unlabeled"){
            double[] extraTargets=[Unit(.15+target[2]*.70-target[0]*.15),Unit(.12+target[2]*.68-target[1]*.10),Unit(target[0]*.72+target[1]*.28)];
            var extra=new[]{"acousticness","instrumentalness","groove"}.Select((k,i)=>(v:Number(f[k]),goal:extraTargets[i])).Where(p=>p.v.HasValue).ToArray();
            if(extra.Length>0)match=match*.68+(.5+c*(.5-Math.Sqrt(extra.Average(p=>Math.Pow(Unit(p.v!.Value)-p.goal,2)))))*.32;
        }
        var recent=History.Where(e=>(Number(e["timestamp"])??0)<=now&&now-(Number(e["timestamp"])??0)<604800).OrderBy(e=>Number(e["timestamp"])??0).ToArray();
        string id=Text(t,"id");var last=recent.LastOrDefault(e=>Text(e,"id")==id);double novelty=last==null?1:Unit((now-(Number(last["timestamp"])??0))/604800);
        double diversity=Overlap(recent.TakeLast(5).SelectMany(Artists),Artists(t))?.4:1;
        if(previous!=null){if(Overlap(Artists(previous),Artists(t)))diversity*=.2;var p=Vector(previous);diversity*=1-Math.Min(c,p.confidence)*Math.Abs(m[0]-p.mood[0]);}
        bool skip=recent.Any(e=>Text(e,"id")==id&&e["skipped"]?.GetValue<bool>()==true&&now-(Number(e["timestamp"])??0)<3600);
        return Unit((match*.60+novelty*.20+diversity*.10+Unit(exploration)*.10)*(skip?.35:1));
    }
    public List<JsonObject> Sample(IEnumerable<JsonObject> tracks,int count,DateTimeOffset now,JsonNode? previous=null,Random? random=null){
        random??=Random.Shared;var target=Target(now);double seconds=now.ToUnixTimeMilliseconds()/1000.0;
        var pool=tracks.Where(t=>Text(t,"id")!=""&&(!Workout||Eligible(t))).DistinctBy(URI).ToList();List<JsonObject> result=[];
        var blocked=History.Where(e=>(Number(e["timestamp"])??0)<=seconds&&seconds-(Number(e["timestamp"])??0)<(e["skipped"]?.GetValue<bool>()==true?3600:1800)).Select(e=>Text(e,"id")).ToHashSet();
        while(pool.Count>0&&result.Count<count){
            var eligible=pool.Where(t=>!blocked.Contains(Text(t,"id"))&&URI(t)!=URI(previous)).ToList();if(eligible.Count==0)eligible=pool.ToList();
            if(previous!=null){var different=eligible.Where(t=>!Overlap(Artists(t),Artists(previous))).ToList();if(different.Count>0)eligible=different;}
            var scores=eligible.Select(t=>Score(t,target,seconds,previous,random.NextDouble())).ToArray();double max=scores.Max();var weights=scores.Select(s=>Math.Exp((s-max)/.20)).ToArray();double draw=random.NextDouble()*weights.Sum();int index=weights.Length-1;
            for(int i=0;i<weights.Length;i++){draw-=weights[i];if(draw<0){index=i;break;}}
            previous=eligible[index];result.Add(eligible[index]);pool.Remove(eligible[index]);
        }
        return result;
    }
    public void Record(JsonObject track,bool skipped=false){
        double now=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()/1000.0;string id=Text(track,"id");var last=History.LastOrDefault();
        if(last!=null&&Text(last,"id")==id&&last["skipped"]?.GetValue<bool>()==skipped&&now-(Number(last["timestamp"])??0)<30)return;
        History.Add(new JsonObject{["id"]=id,["artists"]=new JsonArray(Artists(track).Select(a=>(JsonNode?)JsonValue.Create(a)).ToArray()),["timestamp"]=now,["skipped"]=skipped});if(History.Count>1000)History.RemoveRange(0,History.Count-1000);
    }
}
