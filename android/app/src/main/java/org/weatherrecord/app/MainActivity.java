package org.weatherrecord.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.*;
import android.widget.Toast;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

public class MainActivity extends Activity {
    private WebView web;
    private ServerSocket server;
    private final ExecutorService worker=Executors.newFixedThreadPool(3);
    private static final String ORIGIN="http://127.0.0.1:5500/";
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        web=new WebView(this);setContentView(web);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setUserAgentString(web.getSettings().getUserAgentString()+" WeatherRecordWebView");
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.addJavascriptInterface(new Host(),"AndroidHost");
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                Uri u=request.getUrl();
                if("http".equals(u.getScheme())&&"127.0.0.1".equals(u.getHost())&&u.getPort()==5500)return false;
                if("https".equals(u.getScheme()))startActivity(new Intent(Intent.ACTION_VIEW,u));
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onJsPrompt(WebView view,String url,String message,String value,JsPromptResult result){
                android.widget.EditText input=new android.widget.EditText(MainActivity.this);input.setSingleLine(true);
                new android.app.AlertDialog.Builder(MainActivity.this).setMessage(message).setView(input).setPositiveButton("OK",(d,w)->result.confirm(input.getText().toString())).setNegativeButton("Cancel",(d,w)->result.cancel()).setOnCancelListener(d->result.cancel()).show();return true;
            }
            @Override public void onGeolocationPermissionsShowPrompt(String origin,GeolocationPermissions.Callback callback){
                boolean allowed=checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;
                callback.invoke(origin,allowed&&origin.startsWith(ORIGIN.substring(0,ORIGIN.length()-1)),false);
                if(!allowed)requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION},10);
            }
        });
        try{
            server=new ServerSocket();server.bind(new InetSocketAddress("127.0.0.1",5500));
            worker.execute(()->{while(!server.isClosed())try{Socket client=server.accept();worker.execute(()->serve(client));}catch(IOException ignored){}});
            web.loadUrl(ORIGIN);
        }catch(IOException e){Toast.makeText(this,"Port 5500 is busy. Close the other local server.",Toast.LENGTH_LONG).show();}
    }
    public class Host {
        @JavascriptInterface public void openAuthorization(String url){
            Uri uri=Uri.parse(url);
            if("https".equals(uri.getScheme())&&"accounts.spotify.com".equals(uri.getHost()))runOnUiThread(()->startActivity(new Intent(Intent.ACTION_VIEW,uri)));
        }
    }
    private void serve(Socket socket){
        try(Socket client=socket){
            client.setSoTimeout(5000);
            BufferedReader reader=new BufferedReader(new InputStreamReader(client.getInputStream(),StandardCharsets.UTF_8));
            String first=reader.readLine();if(first==null||!first.startsWith("GET "))return;
            String target=first.split(" ")[1];
            String host="",header;boolean inside=false;
            while((header=reader.readLine())!=null&&!header.isEmpty()){
                if(header.toLowerCase().startsWith("host:"))host=header.substring(5).trim();
                if(header.toLowerCase().startsWith("user-agent:"))inside=header.contains("WeatherRecordWebView");
            }
            if(!"127.0.0.1:5500".equals(host))return;
            Uri uri=Uri.parse(ORIGIN.substring(0,ORIGIN.length()-1)+target);
            if(!inside&&(uri.getQueryParameter("code")!=null||uri.getQueryParameter("error")!=null)){
                runOnUiThread(()->web.loadUrl(ORIGIN+"?"+uri.getEncodedQuery()));
                respond(client,"text/html","<p>Authorization received. Return to Weather Record.</p>".getBytes(StandardCharsets.UTF_8));return;
            }
            String path=uri.getPath();if(path==null||path.equals("/"))path="/index.html";
            if(path.contains("..")||path.substring(1).contains("/"))return;
            try(InputStream asset=getAssets().open(path.substring(1));ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
                byte[] buffer=new byte[8192];int n;while((n=asset.read(buffer))!=-1)bytes.write(buffer,0,n);
                String type=path.endsWith(".js")?"text/javascript":path.endsWith(".css")?"text/css":path.endsWith(".svg")?"image/svg+xml":"text/html";
                respond(client,type,bytes.toByteArray());
            }
        }catch(IOException ignored){}
    }
    private void respond(Socket client,String type,byte[] bytes)throws IOException{
        OutputStream out=client.getOutputStream();out.write(("HTTP/1.1 200 OK\r\nContent-Type: "+type+"; charset=utf-8\r\nContent-Length: "+bytes.length+"\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));out.write(bytes);out.flush();
    }
    @Override protected void onDestroy(){try{if(server!=null)server.close();}catch(IOException ignored){}worker.shutdownNow();web.destroy();super.onDestroy();}
}
