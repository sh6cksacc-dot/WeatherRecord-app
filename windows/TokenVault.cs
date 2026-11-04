using System.Runtime.InteropServices;
using System.Text;

// Windows current-user DPAPI, without an additional NuGet dependency.
public static class TokenVault {
    [StructLayout(LayoutKind.Sequential)] struct Blob {public int Length;public IntPtr Data;}
    [DllImport("crypt32.dll",SetLastError=true)] static extern bool CryptProtectData(ref Blob input,string? description,IntPtr entropy,IntPtr reserved,IntPtr prompt,int flags,out Blob output);
    [DllImport("crypt32.dll",SetLastError=true)] static extern bool CryptUnprotectData(ref Blob input,IntPtr description,IntPtr entropy,IntPtr reserved,IntPtr prompt,int flags,out Blob output);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
    static byte[] Transform(byte[] bytes,bool protect){
        var input=new Blob{Length=bytes.Length,Data=Marshal.AllocHGlobal(bytes.Length)};Blob output=default;
        try{Marshal.Copy(bytes,0,input.Data,bytes.Length);bool ok=protect?CryptProtectData(ref input,null,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,1,out output):CryptUnprotectData(ref input,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,1,out output);if(!ok)throw new InvalidOperationException("Cannot access Windows token vault");byte[] result=new byte[output.Length];Marshal.Copy(output.Data,result,0,result.Length);return result;}
        finally{Marshal.FreeHGlobal(input.Data);if(output.Data!=IntPtr.Zero)LocalFree(output.Data);}
    }
    public static string? Load(string path){if(!OperatingSystem.IsWindows()||!File.Exists(path))return null;try{return Encoding.UTF8.GetString(Transform(File.ReadAllBytes(path),false));}catch{return null;}}
    public static void Save(string path,string value){if(!OperatingSystem.IsWindows())return;Directory.CreateDirectory(Path.GetDirectoryName(path)!);string temp=path+".tmp";File.WriteAllBytes(temp,Transform(Encoding.UTF8.GetBytes(value),true));File.Move(temp,path,true);}
}
