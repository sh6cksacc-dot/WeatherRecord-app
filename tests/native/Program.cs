using System.Net;
using System.Text;
using System.Text.Json.Nodes;

int passed=0;
void Check(bool value,string name){if(!value)throw new Exception("FAIL: "+name);Console.WriteLine("PASS: "+name);passed++;}
JsonObject Context(FakeSpotify fake)=>new(){["mode"]="single",["workout"]=false,["weatherCode"]=0,["utcOffsetMinutes"]=480,["selected"]=fake.Current.DeepClone(),["artistTags"]=new JsonObject{["vivid"]=new JsonArray("artist0","artist1")}};
async Task<NativeQueueService> Service(FakeSpotify fake,string path,Func<DateTimeOffset>? clock=null){var service=new NativeQueueService(new HttpClient(fake){Timeout=TimeSpan.FromSeconds(5)},path,"[]",clock);await service.Handle("token",new JsonObject{["clientID"]="fake",["accessToken"]="token",["refreshToken"]="refresh",["expires"]=DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeMilliseconds()});return service;}
string root=Path.Combine(Path.GetTempPath(),"WeatherRecordNativeTests-"+Guid.NewGuid());
try{
    var engine=new AtmosEngine();engine.WeatherCode=0;engine.OffsetMinutes=0;var target=engine.Target(DateTimeOffset.Parse("2026-11-05T08:00:00Z"));
    Check(Math.Abs(target[0]-.76)<1e-9,"C# sunny morning vector matches Swift/JS");
    engine.WeatherCode=65;Check(engine.Target(DateTimeOffset.Parse("2026-11-05T02:00:00Z"))[2]>.9,"C# rainy night calmness");
    var fake=new FakeSpotify();Check(engine.Vector(fake.Current).confidence==0,"Unknown track is not assigned precise features");
    engine.Ratings(new JsonObject{[AtmosEngine.URI(fake.Current)]=new JsonObject{["values"]=new JsonObject{["energy"]=80,["valence"]=70,["calmness"]=20,["groove"]=90,["acousticness"]=10,["instrumentalness"]=30}}});
    Check(engine.Eligible(fake.Current),"Subjective groove rating enables workout eligibility");
    var one=engine.Sample(fake.Library,50,DateTimeOffset.UtcNow,null,new Random(42));var two=engine.Sample(fake.Library,50,DateTimeOffset.UtcNow,null,new Random(42));
    Check(one.Select(AtmosEngine.URI).SequenceEqual(two.Select(AtmosEngine.URI)),"Seeded native sample is stable");Check(one.Count==20&&one.DistinctBy(AtmosEngine.URI).Count()==20,"Small library exhausts without duplicates");
    DateTimeOffset now=DateTimeOffset.UtcNow;
    using(var service=await Service(fake,Path.Combine(root,"main"),()=>now)){
        await service.Handle("plan",Context(fake));await service.TickAsync();
        Check(fake.Appends==0,"Opening a preview does not take over Spotify playback");
        var plan=await service.Handle("play",Context(fake));
        Check(fake.Appends==6,"Explicit playback preloads six songs from native plan");
        Check(fake.Queue.Select(AtmosEngine.URI).SequenceEqual(plan!["tracks"]!.AsArray().Take(6).Select(AtmosEngine.URI)),"UI candidates match actual submitted queue order");
        Check(fake.Plays==0&&fake.Pauses==0,"Background append never restarts or pauses playback");
        int calls=fake.Appends;now=now.AddSeconds(16);await service.TickAsync();Check(fake.Appends==calls,"Repeated native tick does not duplicate queue entries");
        fake.Advance();now=now.AddSeconds(16);await service.TickAsync();Check(fake.Appends==calls+1,"Native process refills after automatic next without any browser request");
        fake.Advance();await service.Handle("play",Context(fake));Check(!fake.Queue.Any(t=>AtmosEngine.URI(t)==AtmosEngine.URI(fake.Current)),"Resume reconciles an automatic advance before the background poll without requeuing the current track");
        fake.Playing=false;fake.Position=93000;var context=Context(fake);await service.Handle("play",context);
        Check(fake.Playing&&fake.Position==93000,"Pause/resume preserves the actual Spotify position");
        fake.Current=FakeSpotify.Track("outside", "external");fake.Playing=true;now=now.AddSeconds(16);calls=fake.Appends;await service.TickAsync();
        Check(fake.Appends==calls,"External playback change stops native queue ownership");
    }
    var uncertain=new FakeSpotify{LoseAppendResponse=true};
    using(var service=await Service(uncertain,Path.Combine(root,"uncertain"),()=>now)){
        await service.Handle("play",Context(uncertain));int count=uncertain.Appends;now=now.AddSeconds(16);await service.TickAsync();
        Check(uncertain.Queue.DistinctBy(AtmosEngine.URI).Count()==uncertain.Queue.Count,"Accepted append with lost response is reconciled, not duplicated");
    }
    var suspended=new FakeSpotify();using(var service=await Service(suspended,Path.Combine(root,"suspended"),()=>now)){
        await service.Handle("play",Context(suspended));int count=suspended.Appends;var context=Context(suspended);context["suspend"]=true;await service.Handle("context",context);suspended.Advance();now=now.AddSeconds(16);await service.TickAsync();
        Check(suspended.Appends==count,"Mode/browsing suspension prevents the previous background plan from refilling");
    }
    var refresh=new FakeSpotify();using(var service=new NativeQueueService(new HttpClient(refresh),Path.Combine(root,"refresh"),clock:()=>now)){
        await service.Handle("token",new JsonObject{["clientID"]="fake",["accessToken"]="expired",["refreshToken"]="refresh",["expires"]=now.AddHours(-1).ToUnixTimeMilliseconds()});
        Check(refresh.Refreshes==1,"Native service refreshes an expired token without browser OAuth requests");
    }
    var limited=new FakeSpotify{RateLimitAppend=true};
    using(var service=await Service(limited,Path.Combine(root,"limited"),()=>now)){
        try{await service.Handle("play",Context(limited));}catch{}
        int requests=limited.Requests;now=now.AddSeconds(5);await service.TickAsync();Check(limited.Requests==requests,"429 Retry-After blocks all immediate background retries");
    }
    var stale=new FakeSpotify();using(var s=await Service(stale,Path.Combine(root,"restart"),()=>now))await s.Handle("play",Context(stale));
    int appended=stale.Appends;using(var s=await Service(stale,Path.Combine(root,"restart"),()=>now)){await s.TickAsync();Check(stale.Appends==appended,"Restart restores receipts and does not duplicate already queued tracks");}
    Console.WriteLine("Native tests passed: "+passed);
}finally{if(Directory.Exists(root))Directory.Delete(root,true);}

sealed class FakeSpotify:HttpMessageHandler{
    public List<JsonObject> Library=Enumerable.Range(0,20).Select(i=>Track("t"+i,"artist"+(i%4))).ToList();
    public JsonObject Current=Track("t0","artist0");public List<JsonObject> Queue=[];
    public bool Playing=true,LoseAppendResponse,RateLimitAppend;public int Position=1000,Appends,Plays,Pauses,Requests,Refreshes;
    public static JsonObject Track(string id,string artist)=>new(){["id"]=id,["uri"]="spotify:track:"+id,["name"]="Track "+id,["duration_ms"]=180000,["artists"]=new JsonArray(new JsonObject{["name"]=artist}),["album"]=new JsonObject{["id"]="album"+id,["uri"]="spotify:album:album"+id,["name"]="Album "+id,["images"]=new JsonArray()}};
    public void Advance(){if(Queue.Count>0){Current=Queue[0];Queue.RemoveAt(0);Position=0;}}
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request,CancellationToken cancellationToken){
        Requests++;string path=request.RequestUri!.AbsolutePath;string method=request.Method.Method;
        HttpResponseMessage Reply(int status,JsonNode? data=null)=>new((HttpStatusCode)status){Content=new StringContent(data?.ToJsonString()??"",Encoding.UTF8,"application/json")};
        if(path=="/api/token"){Refreshes++;return Reply(200,new JsonObject{["access_token"]="refreshed",["expires_in"]=3600});}
        JsonNode? body=request.Content==null?null:JsonNode.Parse(await request.Content.ReadAsStringAsync(cancellationToken));
        if(path=="/v1/me/player"&&method=="GET")return Reply(200,new JsonObject{["item"]=Current.DeepClone(),["is_playing"]=Playing,["progress_ms"]=Position,["device"]=new JsonObject{["id"]="device",["is_restricted"]=false}});
        if(path=="/v1/me/tracks")return Reply(200,new JsonObject{["total"]=Library.Count,["items"]=new JsonArray(Library.Select(t=>(JsonNode?)new JsonObject{["track"]=t.DeepClone()}).ToArray())});
        if(path=="/v1/me/player/queue"&&method=="GET")return Reply(200,new JsonObject{["currently_playing"]=Current.DeepClone(),["queue"]=new JsonArray(Queue.Select(t=>(JsonNode?)t.DeepClone()).ToArray())});
        if(path=="/v1/me/player/queue"&&method=="POST"){
            Appends++;if(RateLimitAppend){var limited=Reply(429);limited.Headers.RetryAfter=new System.Net.Http.Headers.RetryConditionHeaderValue(TimeSpan.FromSeconds(30));return limited;}
            string uri=Uri.UnescapeDataString(request.RequestUri.Query.Split('&').First(p=>p.TrimStart('?').StartsWith("uri=")).TrimStart('?')[4..]);Queue.Add(Library.First(t=>AtmosEngine.URI(t)==uri).DeepClone().AsObject());
            if(LoseAppendResponse){LoseAppendResponse=false;throw new HttpRequestException("Simulated response loss");}return Reply(204);
        }
        if(path=="/v1/me/player/next"){Advance();return Reply(204);}
        if(path=="/v1/me/player/play"){
            Plays++;Playing=true;if(body?["uris"]?[0] is JsonNode uri){Current=Library.First(t=>AtmosEngine.URI(t)==uri.GetValue<string>()).DeepClone().AsObject();Position=0;}return Reply(204);
        }
        if(path=="/v1/me/player/pause"){Pauses++;Playing=false;return Reply(204);}
        return Reply(404);
    }
}
