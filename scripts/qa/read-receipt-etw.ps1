param([string]$Trace, [int]$MysqlPid, [string]$Output, [int]$MysqlThread = 0)
$ErrorActionPreference = 'Stop'
$lib = Join-Path $PWD 'artifacts/receipt-trace-tools/package/lib/netstandard2.0'
Add-Type -Path (Join-Path $lib 'Microsoft.Diagnostics.FastSerialization.dll')
Add-Type -Path (Join-Path $lib 'Microsoft.Diagnostics.Tracing.TraceEvent.dll')
$refs = @((Get-ChildItem (Join-Path $PSHOME 'ref/*.dll')).FullName) + @(
    (Join-Path $lib 'Microsoft.Diagnostics.FastSerialization.dll'),
    (Join-Path $lib 'Microsoft.Diagnostics.Tracing.TraceEvent.dll'))
Add-Type -ReferencedAssemblies $refs -TypeDefinition @'
using System;
using System.IO;
using System.Collections.Generic;
using Microsoft.Diagnostics.Tracing;
using Microsoft.Diagnostics.Tracing.Parsers.Kernel;
public static class ReceiptEtl {
    public static object Read(string path, int pid, int tid) {
        var rows = new List<object>();
        var cpu = new Dictionary<string,int>();
        var files = new List<object>();
        var pending = new Dictionary<ulong,Tuple<double,string,int,int,string>>();
        var providers = new Dictionary<string,string[]>();
        var scans = new List<object>();
        var switches = new List<object>();
        using (var source = new ETWTraceEventSource(path)) {
            source.Kernel.ThreadCSwitch += e => {
                if(e.OldProcessID==pid || e.NewProcessID==pid || e.OldThreadID==tid || e.NewThreadID==tid)
                    switches.Add(new {t=e.TimeStampRelativeMSec,oldThread=e.OldThreadID,newThread=e.NewThreadID,oldProcess=e.OldProcessID,newProcess=e.NewProcessID,reason=e.OldThreadWaitReason.ToString(),state=e.OldThreadState.ToString()});
            };
            Action<FileIOReadWriteTraceData> fileOp = e => {
                if(e.ProcessID == pid || (e.FileName ?? "").IndexOf("MySQL-8.0-Win10",StringComparison.OrdinalIgnoreCase)>=0)
                    pending[e.IrpPtr]=Tuple.Create(e.TimeStampRelativeMSec,e.EventName,e.ProcessID,e.ThreadID,Path.GetFileName(e.FileName ?? ""));
            };
            source.Kernel.FileIORead += fileOp;
            source.Kernel.FileIOWrite += fileOp;
            source.Kernel.FileIOFlush += e => {
                if(e.ProcessID == pid || (e.FileName ?? "").IndexOf("MySQL-8.0-Win10",StringComparison.OrdinalIgnoreCase)>=0)
                    pending[e.IrpPtr]=Tuple.Create(e.TimeStampRelativeMSec,e.EventName,e.ProcessID,e.ThreadID,Path.GetFileName(e.FileName ?? ""));
            };
            source.Kernel.FileIOOperationEnd += e => {
                if(pending.TryGetValue(e.IrpPtr, out var op)) {
                    double duration=e.TimeStampRelativeMSec-op.Item1;
                    if(duration>20) files.Add(new {t=op.Item1,elapsedMs=duration,operation=op.Item2,process=op.Item3,thread=op.Item4,file=op.Item5});
                    pending.Remove(e.IrpPtr);
                }
            };
            source.Dynamic.All += e => {
                if(e.ProviderName.Contains("Filter") || e.ProviderName.Contains("Kernel-File")) providers[e.ProviderName+":"+e.EventName]=e.PayloadNames;
                if(e.ProviderName.Contains("AMFilter") && (e.EventName=="AMFilter_FileScan" || e.EventName=="AMFilter_FileScanResult")) {
                    string file=Convert.ToString(e.PayloadByName("FileName"));
                    if(scans.Count<5 && e.ProcessID==pid) scans.Add(new {t=e.TimeStampRelativeMSec,process=e.ProcessID,operation=e.EventName,file=Path.GetFileName(file),type=e.PayloadByName("FileName").GetType().FullName});
                    if(file.IndexOf("MySQL-8.0-Win10",StringComparison.OrdinalIgnoreCase)>=0) scans.Add(new {t=e.TimeStampRelativeMSec,process=e.ProcessID,thread=e.ThreadID,operation=e.EventName,file=Path.GetFileName(file)});
                }
            };
            Action<DiskIOTraceData> collect = e => {
                if (e.DiskNumber == 1)
                    rows.Add(new { t=e.TimeStampRelativeMSec, process=e.ProcessID, thread=e.ThreadID,
                        operation=e.EventName, elapsedMs=e.ElapsedTimeMSec, disk=e.DiskNumber,
                        bytes=e.TransferSize, file=(e.FileName ?? "").IndexOf("MySQL-8.0-Win10",StringComparison.OrdinalIgnoreCase)>=0 ? Path.GetFileName(e.FileName) : "" });
            };
            source.Kernel.DiskIORead += collect;
            source.Kernel.DiskIOWrite += collect;
            source.Kernel.DiskIOFlushBuffers += e => {
                if(e.DiskNumber == 1) rows.Add(new { t=e.TimeStampRelativeMSec, process=e.ProcessID,
                    thread=e.ThreadID, operation=e.EventName, elapsedMs=e.ElapsedTimeMSec, disk=e.DiskNumber });
            };
            source.Kernel.PerfInfoSample += e => {
                if(e.ProcessID == pid) { string bin=((int)(e.TimeStampRelativeMSec/100)).ToString(); cpu.TryGetValue(bin, out int n); cpu[bin]=n+1; }
            };
            source.Process();
            return new { disk=rows, files=files, switches=switches, scans=scans, providers=providers, cpuSamplesPer100ms=cpu, lostEvents=source.EventsLost, startUtc=source.SessionStartTime.ToUniversalTime() };
        }
    }
}
'@
[ReceiptEtl]::Read((Resolve-Path -LiteralPath $Trace).Path, $MysqlPid, $MysqlThread) |
    ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Output
