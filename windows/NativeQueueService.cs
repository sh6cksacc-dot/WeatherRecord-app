using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;

public sealed record SpotifyResult(int status,JsonNode? body=null,int retryAfter=0);
public sealed class NativeQueueService : IDisposable {
    readonly HttpClient http;
    readonly SemaphoreSlim gate=new(1,1);
    readonly AtmosEngine engine;
    readonly string directory;
    readonly Func<DateTimeOffset> clock;
    string clientID="",accessToken="",refreshToken="",root="",mode="album",message="";
    DateTimeOffset expires,blockedUntil,lastQueueCheck;
    JsonObject? player;
    long sampledAt,sampleVersion;
    readonly List<JsonObject> plan=[];
    readonly HashSet<string> issued=[];
    bool active;
    CancellationTokenSource stopping=new();
    public NativeQueueService(HttpClient http,string directory,string features="[]",Func<DateTimeOffset>? clock=null){
        this.http=http;this.directory=directory;this.clock=clock??(()=>DateTimeOffset.UtcNow);engine=new(features);
        var token=TokenVault.Load(Path.Combine(directory,"spotify-token.dat"));if(token!=null)ImportToken(JsonNode.Parse(token)!.AsObject());
        try{var saved=JsonNode.Parse(File.ReadAllText(Path.Combine(directory,"queue.json")))!;root=AtmosEngine.Text(saved,"root");active=saved["active"]?.GetValue<bool>()==true;mode=AtmosEngine.Text(saved,"mode");
            foreach(var t in saved["plan"]?.AsArray()??[])if(t is JsonObject obj)plan.Add(obj.DeepClone().AsObject());
            foreach(var u in saved["issued"]?.AsArray()??[])if(u!=null)issued.Add(u.GetValue<string>());
            engine.Workout=saved["context"]?["workout"]?.GetValue<bool>()==true;Context(saved["context"]?.AsObject()??new());
        }catch{/* A missing/corrupt session never becomes proof of an empty Spotify queue. */}
    }
    public Task RunAsync()=>Task.Run(async()=>{
        while(!stopping.IsCancellationRequested){try{await TickAsync();}catch(OperationCanceledException){break;}catch(Exception e){message=e.Message;}
            try{await Task.Delay(TimeSpan.FromSeconds(player?["is_playing"]?.GetValue<bool>()==true?5:15),stopping.Token);}catch(OperationCanceledException){break;}}
    });
    public void Dispose(){stopping.Cancel();}
    void SaveToken()=>TokenVault.Save(Path.Combine(directory,"spotify-token.dat"),new JsonObject{["clientID"]=clientID,["accessToken"]=accessToken,["refreshToken"]=refreshToken,["expires"]=expires.ToUnixTimeMilliseconds()}.ToJsonString());
    void ImportToken(JsonObject b){clientID=AtmosEngine.Text(b,"clientID");accessToken=AtmosEngine.Text(b,"accessToken");refreshToken=AtmosEngine.Text(b,"refreshToken");expires=DateTimeOffset.FromUnixTimeMilliseconds(b["expires"]?.GetValue<long>()??0);}
    void Persist(){
        Directory.CreateDirectory(directory);
        var context=new JsonObject{["mode"]=mode,["workout"]=engine.Workout,["weatherCode"]=engine.WeatherCode,["utcOffsetMinutes"]=engine.OffsetMinutes,["artistTags"]=engine.ArtistTags.DeepClone(),["ratings"]=ratings.DeepClone(),["history"]=new JsonArray(engine.History.Select(e=>(JsonNode?)e.DeepClone()).ToArray())};
        var value=new JsonObject{["root"]=root,["mode"]=mode,["active"]=active,["plan"]=Tracks(plan),["issued"]=new JsonArray(issued.Select(u=>(JsonNode?)JsonValue.Create(u)).ToArray()),["context"]=context};
        string path=Path.Combine(directory,"queue.json");File.WriteAllText(path+".tmp",value.ToJsonString());File.Move(path+".tmp",path,true);
    }
    JsonObject ratings=new();
    void Context(JsonObject b){
        mode=AtmosEngine.Text(b,"mode") is "single"?"single":"album";
        bool workout=b["workout"]?.GetValue<bool>()==true;
        // A changed workout filter cannot silently keep issuing the previous plan.
        if(engine.Workout!=workout){active=false;plan.Clear();}
        engine.Workout=workout;engine.WeatherCode=b["weatherCode"]?.GetValue<int>();engine.OffsetMinutes=b["utcOffsetMinutes"]?.GetValue<int>()??engine.OffsetMinutes;
        if(b["artistTags"] is JsonObject tags)engine.ArtistTags=tags.DeepClone().AsObject();
        if(b["ratings"] is JsonObject r){foreach(var entry in r)ratings[entry.Key]=entry.Value?.DeepClone();engine.Ratings(ratings);}
        foreach(var e in b["history"]?.AsArray()??[])if(e is JsonObject ev&&!engine.History.Any(old=>old.ToJsonString()==ev.ToJsonString()))engine.History.Add(ev.DeepClone().AsObject());
        if(engine.History.Count>1000)engine.History.RemoveRange(0,engine.History.Count-1000);
        if(mode!="single")active=false;
        if(b["suspend"]?.GetValue<bool>()==true)active=false;
    }
    async Task EnsureToken(){
        if(accessToken.Length>0&&expires>clock().AddSeconds(60))return;
        if(clientID.Length==0||refreshToken.Length==0)throw new InvalidOperationException("Connect Spotify to enable the Windows background queue.");
        using var request=new HttpRequestMessage(HttpMethod.Post,"https://accounts.spotify.com/api/token"){Content=new FormUrlEncodedContent(new Dictionary<string,string>{{"grant_type","refresh_token"},{"refresh_token",refreshToken},{"client_id",clientID}})};
        using var response=await http.SendAsync(request);var json=JsonNode.Parse(await response.Content.ReadAsStringAsync());
        if(!response.IsSuccessStatusCode)throw new InvalidOperationException("Spotify authorization refresh failed ("+(int)response.StatusCode+"). Reconnect Spotify.");
        accessToken=AtmosEngine.Text(json,"access_token");if(json?["refresh_token"]!=null)refreshToken=AtmosEngine.Text(json,"refresh_token");expires=clock().AddSeconds(json?["expires_in"]?.GetValue<int>()??3600);SaveToken();
    }
    async Task<SpotifyResult> Request(string path,string method="GET",JsonNode? body=null){
        if(clock()<blockedUntil)return new(429,null,Math.Max(1,(int)(blockedUntil-clock()).TotalSeconds));
        await EnsureToken();
        using var request=new HttpRequestMessage(new HttpMethod(method),"https://api.spotify.com/v1"+path);request.Headers.Authorization=new AuthenticationHeaderValue("Bearer",accessToken);
        if(body!=null)request.Content=new StringContent(body.ToJsonString(),Encoding.UTF8,"application/json");
        using var response=await http.SendAsync(request);string text=await response.Content.ReadAsStringAsync();JsonNode? data=null;try{if(text.Length>0)data=JsonNode.Parse(text);}catch{}
        int retry=30;if(response.Headers.RetryAfter?.Delta is TimeSpan delta)retry=Math.Max(1,(int)Math.Ceiling(delta.TotalSeconds));else if(response.Headers.RetryAfter?.Date is DateTimeOffset date)retry=Math.Max(1,(int)Math.Ceiling((date-clock()).TotalSeconds));
        if(response.StatusCode==HttpStatusCode.TooManyRequests)blockedUntil=clock().AddSeconds(retry);
        return new((int)response.StatusCode,data,retry);
    }
    async Task<JsonNode?> API(string path,string method="GET",JsonNode? body=null){var r=await Request(path,method,body);if(r.status<200||r.status>=300)throw new InvalidOperationException(r.status==429?"Spotify rate limited; retrying after "+r.retryAfter+" seconds.":"Spotify request failed ("+r.status+"): "+(r.body?["error"]?["message"]?.GetValue<string>()??path));return r.body;}
    async Task ReadPlayer(){var p=await API("/me/player");player=p as JsonObject;sampledAt=clock().ToUnixTimeMilliseconds();sampleVersion++;}
    static JsonArray Tracks(IEnumerable<JsonObject> tracks)=>new(tracks.Select(t=>(JsonNode?)t.DeepClone()).ToArray());
    JsonObject Snapshot()=>new(){["player"]=player?.DeepClone(),["sampledAt"]=sampledAt,["sampleVersion"]=sampleVersion,["message"]=message,["active"]=active};
    JsonObject Plan(JsonNode? selected){var uri=AtmosEngine.URI(selected);int index=plan.FindIndex(t=>AtmosEngine.URI(t)==uri);return new(){["tracks"]=Tracks(index>=0?plan.Skip(index+1):plan.Where(t=>AtmosEngine.URI(t)!=uri)),["message"]=message,["root"]=root,["active"]=active};}
    async Task Fill(JsonObject? selected=null){
        if(plan.Count>=12)return;
        if(candidateCache.Count==0||clock()-candidatesAt>TimeSpan.FromMinutes(5)){
            var first=await API("/me/tracks?limit=50&offset=0");int total=first?["total"]?.GetValue<int>()??0;candidateCache.Clear();
            void Add(JsonNode? page){foreach(var e in page?["items"]?.AsArray()??[]){if(e?["track"] is JsonObject t&&t["is_local"]?.GetValue<bool>()!=true&&t["is_playable"]?.GetValue<bool>()!=false&&AtmosEngine.URI(t).StartsWith("spotify:track:"))candidateCache.Add(t);}}
            Add(first);int pages=(total+49)/50;if(pages>1)Add(await API("/me/tracks?limit=50&offset="+Random.Shared.Next(1,pages)*50));candidatesAt=clock();
        }
        var seen=plan.Select(AtmosEngine.URI).Append(root).Append(AtmosEngine.URI(selected)).ToHashSet();
        var ranked=engine.Sample(candidateCache.Where(t=>!seen.Contains(AtmosEngine.URI(t))),30-plan.Count,clock(),plan.LastOrDefault()??selected??player?["item"]);
        plan.AddRange(ranked.Select(t=>t.DeepClone().AsObject()));
        if(plan.Count==0)message=engine.Workout?"No known strong-groove liked songs found in this batch.":"No playable liked songs found.";
        Persist();
    }
    readonly List<JsonObject> candidateCache=[];
    DateTimeOffset candidatesAt;
    async Task Maintain(){
        if(!active||mode!="single"||player?["is_playing"]?.GetValue<bool>()!=true)return;
        string current=AtmosEngine.URI(player["item"]);
        if(current!=root){int index=plan.FindIndex(t=>AtmosEngine.URI(t)==current);
            if(index<0||!issued.Contains(current)){active=false;message="Playback changed outside the Atmos plan; background writes stopped.";Persist();return;}
            root=current;engine.Record(plan[index]);plan.RemoveRange(0,index+1);issued.Remove(current);Persist();
        }
        if(clock()-lastQueueCheck<TimeSpan.FromSeconds(15))return;lastQueueCheck=clock();
        await Fill();var queue=await API("/me/player/queue");if(queue?["queue"] is not JsonArray items)throw new InvalidOperationException("Spotify queue is unknown; no songs appended.");
        if(AtmosEngine.URI(queue["currently_playing"])!=root)return;
        string device=AtmosEngine.Text(player["device"],"id");if(device.Length==0||player["device"]?["is_restricted"]?.GetValue<bool>()==true)throw new InvalidOperationException("No controllable Spotify device.");
        foreach(var track in plan.Take(6)){
            string uri=AtmosEngine.URI(track);if(items.Any(t=>AtmosEngine.URI(t)==uri))continue;
            if(issued.Contains(uri)){message="Waiting to verify an earlier queue write; not resending.";return;}
            issued.Add(uri);Persist(); // Persist before POST: an uncertain result is never duplicated.
            SpotifyResult result;
            try{result=await Request("/me/player/queue?uri="+Uri.EscapeDataString(uri)+"&device_id="+Uri.EscapeDataString(device),"POST");}catch{message="Queue write is uncertain; waiting for confirmation.";return;}
            if(result.status is 401 or 403 or 404 or 429){issued.Remove(uri);Persist();}
            if(result.status<200||result.status>=300)throw new InvalidOperationException("Spotify queue append failed ("+result.status+").");
            queue=await API("/me/player/queue");if(queue?["queue"] is not JsonArray fresh)throw new InvalidOperationException("Queue result unknown; append not retried.");items=fresh;
            if(AtmosEngine.URI(queue["currently_playing"])!=root)return;
            if(!items.Any(t=>AtmosEngine.URI(t)==uri)){message="Spotify accepted a song; waiting for queue confirmation.";return;}
        }
        var order=items.Take(6).Select(AtmosEngine.URI).ToArray();var desired=plan.Take(6).Select(AtmosEngine.URI).ToArray();
        message=order.SequenceEqual(desired)?"Windows background queue ready · "+desired.Length+" songs":"Other Spotify queue entries are ahead; preserved without reordering.";
    }
    public async Task TickAsync(){await gate.WaitAsync(stopping.Token);try{if(accessToken.Length==0||clock()<blockedUntil)return;await ReadPlayer();await Maintain();}finally{gate.Release();}}
    async Task<JsonNode> Advance(JsonNode snapshot){
        var queue=snapshot["queue"]?.AsArray()??throw new InvalidOperationException("Unknown queue.");string expected=AtmosEngine.URI(queue.FirstOrDefault()),previous=AtmosEngine.URI(snapshot["currently_playing"]);
        if(expected.Length==0)throw new InvalidOperationException("No confirmed next song.");Exception? commandError=null;
        try{await API("/me/player/next","POST");}catch(Exception e){commandError=e;}
        for(int i=0;i<6;i++){await Task.Delay(400,stopping.Token);var next=await API("/me/player/queue")??throw new InvalidOperationException("Queue changed.");string current=AtmosEngine.URI(next["currently_playing"]);
            if(current==expected&&(current!=previous||next["queue"]?.ToJsonString()!=snapshot["queue"]?.ToJsonString())){issued.Remove(expected);return next;}
            if(current!=previous&&current!=expected)throw new InvalidOperationException("Spotify playback changed outside this operation.");}
        throw commandError??new InvalidOperationException("Skip is not confirmed; it was not resent.");
    }
    async Task Play(JsonObject selected){
        string target=AtmosEngine.URI(selected);if(!target.StartsWith("spotify:track:"))throw new InvalidOperationException("No track selected.");
        await ReadPlayer();if(player==null)throw new InvalidOperationException("Open Spotify and start a song to activate a device.");
        if(AtmosEngine.URI(player["item"])==target){
            if(player["is_playing"]?.GetValue<bool>()!=true)await API("/me/player/play","PUT");
            int consumed=plan.FindIndex(t=>AtmosEngine.URI(t)==target);if(consumed>=0)plan.RemoveRange(0,consumed+1);else if(root!=target)plan.Clear();
            root=target;issued.Remove(target);active=true;engine.Record(selected);lastQueueCheck=default;Persist();await ReadPlayer();await Fill(selected);await Maintain();return;
        }
        var queue=await API("/me/player/queue")??throw new InvalidOperationException("Spotify queue unknown.");var items=queue["queue"]?.AsArray()??throw new InvalidOperationException("Spotify queue unknown.");
        int position=items.ToList().FindIndex(t=>AtmosEngine.URI(t)==target);
        if(position>=20)throw new InvalidOperationException("Target is more than 20 queue steps away; select it in Spotify.");
        if(position>=0){for(int i=0;i<=position;i++){queue=await Advance(queue);if(AtmosEngine.URI(queue["currently_playing"])==target)break;}}
        else{
            int last=items.ToList().FindLastIndex(t=>issued.Contains(AtmosEngine.URI(t)));
            if(last>=20)throw new InvalidOperationException("Old app queue exceeds 20 songs; clear it in Spotify.");
            var batch=items.Take(last+1).Select(AtmosEngine.URI).ToArray();if(batch.Any(u=>!issued.Contains(u)))throw new InvalidOperationException("Other songs precede the old App queue. Clear it in Spotify before replacing this session.");
            foreach(string uri in batch){if(AtmosEngine.URI(queue["queue"]?[0])!=uri)throw new InvalidOperationException("Queue order changed; navigation stopped.");queue=await Advance(queue);}
            await API("/me/player/play","PUT",new JsonObject{["uris"]=new JsonArray(target),["position_ms"]=0});
        }
        for(int attempt=0;attempt<6;attempt++){await ReadPlayer();if(AtmosEngine.URI(player?["item"])==target)break;await Task.Delay(400,stopping.Token);}
        if(AtmosEngine.URI(player?["item"])!=target)throw new InvalidOperationException("Playback target not yet confirmed. No play request was repeated.");
        if(player?["is_playing"]?.GetValue<bool>()!=true){await API("/me/player/play","PUT");await ReadPlayer();}
        int at=plan.FindIndex(t=>AtmosEngine.URI(t)==target);if(at>=0)plan.RemoveRange(0,at+1);else plan.Clear();
        root=target;active=true;engine.Record(selected);lastQueueCheck=default;Persist();await Fill(selected);await Maintain();
    }
    public async Task<JsonNode?> Handle(string action,JsonObject body){
        // Cached player snapshots must stay responsive while Spotify requests
        // or candidate discovery hold the mutation gate.
        if(action=="state")return Snapshot();
        await gate.WaitAsync(stopping.Token);try{
            switch(action){
                case "token":ImportToken(body);SaveToken();try{await ReadPlayer();}catch(Exception e){message=e.Message;}return new JsonObject{["ok"]=true};
                case "session":if(accessToken.Length==0)return new JsonObject{["connected"]=false};await EnsureToken();return new JsonObject{["connected"]=true,["accessToken"]=accessToken,["expires"]=expires.ToUnixTimeMilliseconds(),["ratings"]=ratings.DeepClone(),["history"]=new JsonArray(engine.History.Select(e=>(JsonNode?)e.DeepClone()).ToArray())};
                case "state":return Snapshot();
                case "refresh":await ReadPlayer();return Snapshot();
                case "context":Context(body);Persist();return new JsonObject{["ok"]=true};
                case "plan":Context(body);await Fill(body["selected"] as JsonObject);return Plan(body["selected"]);
                case "play":Context(body);await Play(body["selected"]?.AsObject()??throw new InvalidOperationException("No selected track"));return Plan(body["selected"]);
                case "api":{
                    string path=AtmosEngine.Text(body,"path"),method=AtmosEngine.Text(body,"method");
                    if(!Allowed(path,method))throw new InvalidOperationException("Unsupported Spotify native request.");
                    var response=await Request(path,method,body["body"]);if(method!="GET"&&path.StartsWith("/me/player/")){try{await ReadPlayer();}catch(Exception e){message=e.Message;}}
                    return new JsonObject{["status"]=response.status,["body"]=response.body?.DeepClone(),["retryAfter"]=response.retryAfter};
                }
                default:throw new InvalidOperationException("Unknown native route");
            }
        }finally{gate.Release();}
    }
    static bool Allowed(string path,string method){
        if(!path.StartsWith('/')||path.Contains("..")||path.Contains('\\')||path.Contains('#'))return false;
        var route=path.Split('?')[0];
        if(method=="GET")return route is "/me/player" or "/me/player/queue" or "/me/tracks"||System.Text.RegularExpressions.Regex.IsMatch(route,@"^/(tracks|albums|artists)/[a-zA-Z0-9]+(/tracks|/albums)?$")||route=="/search";
        return (method=="PUT"&&route is "/me/player/play" or "/me/player/pause" or "/me/player/seek" or "/me/player/shuffle" or "/me/player/repeat")||(method=="POST"&&route is "/me/player/next" or "/me/player/queue");
    }
}
