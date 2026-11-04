using System.Diagnostics;
using System.Net;
using System.Reflection;
using System.Text;

const string origin="http://127.0.0.1:5500/";
using var listener=new HttpListener();
listener.Prefixes.Add(origin);
try { listener.Start(); }
catch(HttpListenerException) { Console.Error.WriteLine("Port 5500 is in use. Close the other Weather Record / local server and retry."); return; }
Console.WriteLine("Weather Record is running. Close this window to quit.");
Process.Start(new ProcessStartInfo(origin){UseShellExecute=true});
var assembly=Assembly.GetExecutingAssembly();
using var remote=new HttpClient(new HttpClientHandler{AllowAutoRedirect=false}){Timeout=TimeSpan.FromSeconds(15)};
remote.DefaultRequestHeaders.UserAgent.ParseAdd("WeatherRecord/0.2 (personal music app)");
while(listener.IsListening){
    var context=await listener.GetContextAsync();
    _=Serve(context);
}
async Task Serve(HttpListenerContext context){
    try{
        if(context.Request.HttpMethod!="GET"){context.Response.StatusCode=405;return;}
        if(context.Request.Headers["Host"]!="127.0.0.1:5500"){context.Response.StatusCode=403;return;}
        string path=context.Request.Url!.AbsolutePath;
        if(path is "/review-search" or "/review-translate"){
            string query=context.Request.QueryString["q"]??"";
            if(string.IsNullOrWhiteSpace(query)||query.Length>4000){context.Response.StatusCode=400;return;}
            var originHeader=context.Request.Headers["Origin"];
            if(originHeader!=null&&originHeader!=origin.TrimEnd('/')){context.Response.StatusCode=403;return;}
            string url=path=="/review-search"?"https://pitchfork.com/search/?query="+Uri.EscapeDataString(query):"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q="+Uri.EscapeDataString(query);
            using var response=await remote.GetAsync(url,HttpCompletionOption.ResponseHeadersRead);
            context.Response.StatusCode=(int)response.StatusCode;
            context.Response.ContentType=path=="/review-search"?"text/plain; charset=utf-8":"application/json; charset=utf-8";
            context.Response.Headers["Cache-Control"]="no-store";
            if(!response.IsSuccessStatusCode)return;
            using var stream=await response.Content.ReadAsStreamAsync();
            byte[] buffer=new byte[16384];int total=0,n;
            while((n=await stream.ReadAsync(buffer))>0){total+=n;if(total>8*1024*1024)break;await context.Response.OutputStream.WriteAsync(buffer.AsMemory(0,n));}
            return;
        }
        if(path=="/")path="/index.html";
        if(path.Contains("..")||path.Count(c=>c=='/')!=1){context.Response.StatusCode=404;return;}
        using var resource=assembly.GetManifestResourceStream("web"+path);
        if(resource is null){context.Response.StatusCode=404;return;}
        context.Response.ContentType=Path.GetExtension(path) switch {".html"=>"text/html; charset=utf-8",".js"=>"text/javascript; charset=utf-8",".json"=>"application/json; charset=utf-8",".css"=>"text/css; charset=utf-8",".svg"=>"image/svg+xml",_=>"application/octet-stream"};
        context.Response.Headers["Cache-Control"]="no-store";
        context.Response.Headers["X-Content-Type-Options"]="nosniff";
        await resource.CopyToAsync(context.Response.OutputStream);
    }catch(Exception e){Console.Error.WriteLine(e.Message);}
    finally{context.Response.Close();}
}
