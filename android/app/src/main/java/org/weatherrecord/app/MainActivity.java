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
    private GeolocationPermissions.Callback locationCallback;
    private String locationOrigin;
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
                if(!origin.equals(ORIGIN.substring(0,ORIGIN.length()-1))){callback.invoke(origin,false,false);return;}
                boolean allowed=checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED;
                if(allowed)callback.invoke(origin,true,false);
                else{if(locationCallback!=null)locationCallback.invoke(locationOrigin,false,false);locationCallback=callback;locationOrigin=origin;requestPermissions(new String[]{Manifest.permission.ACCESS_COARSE_LOCATION},10);}
            }
            @Override public boolean onJsAlert(WebView view,String url,String message,JsResult result){
                new android.app.AlertDialog.Builder(MainActivity.this).setMessage(message).setPositiveButton("OK",(d,w)->result.confirm()).setOnCancelListener(d->result.cancel()).show();return true;
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
            if("/review-search".equals(uri.getPath())||"/review-translate".equals(uri.getPath())){
                proxyReview(client,uri);return;
            }
            if(!inside&&(uri.getQueryParameter("code")!=null||uri.getQueryParameter("error")!=null)){
                runOnUiThread(()->web.loadUrl(ORIGIN+"?"+uri.getEncodedQuery()));
                respond(client,"text/html","<p>Authorization received. Return to Weather Record.</p>".getBytes(StandardCharsets.UTF_8));return;
            }
            String path=uri.getPath();if(path==null||path.equals("/"))path="/index.html";
            if(path.contains("..")||path.substring(1).contains("/"))return;
            try(InputStream asset=getAssets().open(path.substring(1));ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
                byte[] buffer=new byte[8192];int n;while((n=asset.read(buffer))!=-1)bytes.write(buffer,0,n);
                String type=path.endsWith(".js")?"text/javascript":path.endsWith(".json")?"application/json":path.endsWith(".css")?"text/css":path.endsWith(".svg")?"image/svg+xml":"text/html";
                respond(client,type,bytes.toByteArray());
            }
        }catch(IOException ignored){}
    }
    private void proxyReview(Socket client,Uri uri)throws IOException{
        String q=uri.getQueryParameter("q");if(q==null||q.isEmpty()||q.length()>4000){respond(client,400,"text/plain",new byte[0]);return;}
        boolean search="/review-search".equals(uri.getPath());
        String url=search?"https://pitchfork.com/search/?query=":"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=";
        HttpURLConnection connection=(HttpURLConnection)new URL(url+URLEncoder.encode(q,"UTF-8")).openConnection();
        connection.setConnectTimeout(10000);connection.setReadTimeout(12000);connection.setInstanceFollowRedirects(false);connection.setRequestProperty("User-Agent","WeatherRecord/0.2 (personal music app)");
        try{
            int status=connection.getResponseCode();if(status!=200){respond(client,status,"text/plain",new byte[0]);return;}
            try(InputStream input=connection.getInputStream();ByteArrayOutputStream bytes=new ByteArrayOutputStream()){
                byte[] buffer=new byte[8192];int n;while((n=input.read(buffer))!=-1){if(bytes.size()+n>8*1024*1024)throw new IOException("Review too large");bytes.write(buffer,0,n);}
                respond(client,search?"text/plain":"application/json",bytes.toByteArray());
            }
        }finally{connection.disconnect();}
    }
    private void respond(Socket client,String type,byte[] bytes)throws IOException{
        respond(client,200,type,bytes);
    }
    private void respond(Socket client,int status,String type,byte[] bytes)throws IOException{
        OutputStream out=client.getOutputStream();out.write(("HTTP/1.1 "+status+" Response\r\nContent-Type: "+type+"; charset=utf-8\r\nContent-Length: "+bytes.length+"\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));out.write(bytes);out.flush();
    }
    @Override public void onRequestPermissionsResult(int requestCode,String[] permissions,int[] results){
        super.onRequestPermissionsResult(requestCode,permissions,results);
        if(requestCode==10&&locationCallback!=null){locationCallback.invoke(locationOrigin,results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED,false);locationCallback=null;}
    }
    @Override protected void onResume(){super.onResume();if(web!=null)web.onResume();}
    @Override protected void onPause(){if(web!=null)web.onPause();super.onPause();}
    @Override protected void onDestroy(){try{if(server!=null)server.close();}catch(IOException ignored){}worker.shutdownNow();web.destroy();super.onDestroy();}
}
