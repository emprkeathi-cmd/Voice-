import React, { useState, useEffect, useRef } from 'react';
import { useVADRecorder } from './hooks/useVADRecorder';
import { Visualizer } from './components/Visualizer';
import { RecordingCard } from './components/RecordingCard';
import { AudioSettings, RecorderStatus, Recording, AutomationSettings } from './types';

interface TriggerLog {
  timestamp: number;
  url: string;
  status: 'received' | 'playing' | 'error' | 'done';
  errorDetails?: string;
}

const App: React.FC = () => {
  const [settings, setSettings] = useState<AudioSettings>({
    sensitivity: 25,
    silenceTimeout: 1500,
    autoStart: true
  });

  const [automation, setAutomation] = useState<AutomationSettings>({
    remoteTriggerId: `vf-${Math.random().toString(36).substring(2, 11)}`,
    webhookUrl: 'Webhook slot'
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAutomationRunning, setIsAutomationRunning] = useState(false);
  const [lastLog, setLastLog] = useState<string>('');
  const [triggerLogs, setTriggerLogs] = useState<TriggerLog[]>([]);

  const {
    status,
    recordings,
    currentVolume,
    silenceProgress,
    recordingDuration,
    isContinuous,
    toggleListen,
    deleteRecording,
    setRecordings,
    shutdown
  } = useVADRecorder(settings);

  const lastProcessedId = useRef<string | null>(null);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setLastLog("Copied to clipboard");
      setTimeout(() => setLastLog(""), 3000);
    });
  };

  const testWebhook = async () => {
    if (!automation.webhookUrl) return;
    setLastLog(`Pinging...`);
    try {
      const res = await fetch(automation.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true, timestamp: Date.now(), source: 'VoiceFlow Signal Processor' }),
        mode: 'cors'
      });
      if (res.ok) {
        setLastLog(`Ping Success`);
      } else {
        setLastLog(`Ping Error: ${res.status}`);
      }
    } catch (err) {
      setLastLog(`Ping Failed`);
      console.error("Webhook test failed:", err);
    }
  };

  const sendToWebhook = async (recording: Partial<Recording> & { blob: Blob }) => {
    if (!automation.webhookUrl) return;
    
    setLastLog(`Forwarding...`);
    const formData = new FormData();
    formData.append('file', recording.blob, `voice-${Date.now()}.webm`);
    formData.append('id', recording.id || 'test');
    
    try {
      const res = await fetch(automation.webhookUrl, {
        method: 'POST',
        body: formData,
        mode: 'cors',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!res.ok) {
        setLastLog(`Target Error: ${res.status}`);
        return;
      }
      setLastLog(`Forward Complete`);
    } catch (err: any) {
      setLastLog(`Forward Failed`);
      console.error("Webhook fetch failed:", err);
    }
  };

  useEffect(() => {
    const latest = recordings[0];
    if (latest && latest.id !== lastProcessedId.current) {
      lastProcessedId.current = latest.id;
      sendToWebhook(latest);
    }
  }, [recordings]);

  useEffect(() => {
    const eventSource = new EventSource(`https://ntfy.sh/${automation.remoteTriggerId}/sse`);
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const attachmentUrl = data.attachment?.url;
        const messagePayload = data.message?.trim();
        const finalPayload = attachmentUrl || messagePayload;

        if (finalPayload) {
          setTriggerLogs(prev => [{ 
            timestamp: Date.now(), 
            url: finalPayload.substring(0, 40) + (finalPayload.length > 40 ? '...' : ''), 
            status: 'received' 
          }, ...prev].slice(0, 10));

          handleAutomationWorkflow(finalPayload);
        }
      } catch (e) {
        console.error("Trigger detection error", e);
      }
    };

    return () => eventSource.close();
  }, [automation.remoteTriggerId]);

  const handleAutomationWorkflow = async (payload: string) => {
    if (isAutomationRunning) return;

    const cmd = payload.toLowerCase();
    
    if (cmd === 'start') {
      setLastLog(`Signal: START (One-shot)`);
      setTriggerLogs(prev => prev.map((log, i) => i === 0 ? { ...log, status: 'done' } : log));
      if (status === RecorderStatus.IDLE || status === RecorderStatus.ERROR) {
        await toggleListen(false);
      }
      return;
    }

    if (cmd === 'call') {
      setLastLog(`Signal: CALL (Continuous)`);
      setTriggerLogs(prev => prev.map((log, i) => i === 0 ? { ...log, status: 'done' } : log));
      if (status === RecorderStatus.IDLE || status === RecorderStatus.ERROR) {
        await toggleListen(true);
      }
      return;
    }

    if (cmd === 'stop') {
      setLastLog(`Signal: STOP (Shutdown)`);
      setTriggerLogs(prev => prev.map((log, i) => i === 0 ? { ...log, status: 'done' } : log));
      shutdown();
      return;
    }

    // Handle as potential Audio play-through (legacy support)
    setIsAutomationRunning(true);
    setLastLog(`Signal Playing...`);
    
    const source = payload.startsWith('http') ? payload : `data:audio/mpeg;base64,${payload}`;
    const audio = new Audio(source);
    audio.crossOrigin = "anonymous";
    
    audio.onplay = () => {
       setTriggerLogs(prev => prev.map((log, i) => i === 0 ? { ...log, status: 'playing' } : log));
    };
    
    audio.onended = () => {
      setIsAutomationRunning(false);
      setTriggerLogs(prev => prev.map((log, i) => i === 0 ? { ...log, status: 'done' } : log));
      setLastLog(`Audio end. Listening...`);
      if (status === RecorderStatus.IDLE || status === RecorderStatus.ERROR) {
        toggleListen(false);
      }
    };

    audio.onerror = () => {
      setIsAutomationRunning(false);
      setLastLog(`Signal err: listening...`);
      setTriggerLogs(prev => prev.map((log, i) => i === 0 ? { ...log, status: 'error', errorDetails: 'Format/CORS' } : log));
      if (status === RecorderStatus.IDLE || status === RecorderStatus.ERROR) {
        toggleListen(false);
      }
    };

    audio.play().catch(err => {
      setIsAutomationRunning(false);
      setLastLog(`Blocked: Click UI`);
      if (status === RecorderStatus.IDLE || status === RecorderStatus.ERROR) {
        toggleListen(false);
      }
    });
  };

  const handleUpdateRecording = (updated: Recording) => {
    setRecordings(prev => prev.map(r => r.id === updated.id ? updated : r));
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white p-4 md:p-10 selection:bg-blue-500/20">
      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/95 backdrop-blur-2xl">
          <div className="bg-[#111111] border border-white/10 w-full max-w-lg rounded-[3.5rem] p-12 shadow-2xl space-y-10 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-4xl font-black uppercase italic tracking-tighter">Topology</h2>
                <p className="text-white/20 text-[10px] mt-1 uppercase tracking-[0.4em] font-black">Automation Gateway</p>
              </div>
              <button onClick={() => setIsSettingsOpen(false)} className="p-4 bg-white/5 rounded-full hover:bg-white/10 border border-white/5 transition-all">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <div className="space-y-10">
              <div className="space-y-4">
                <label className="text-[12px] font-black uppercase tracking-widest text-blue-400 italic block px-2">Signal Feed</label>
                <div className="bg-black/60 rounded-[2.5rem] border border-white/5 p-6 min-h-[160px] max-h-[240px] overflow-y-auto space-y-3">
                  {triggerLogs.length === 0 ? (
                    <p className="text-[11px] text-white/10 uppercase font-black text-center py-12 italic">Awaiting external signals...</p>
                  ) : (
                    triggerLogs.map((log, i) => (
                      <div key={i} className="flex items-center justify-between p-4 bg-white/[0.02] rounded-2xl border border-white/5">
                        <div className="flex flex-col gap-1 overflow-hidden">
                          <span className="text-[11px] text-white/50 font-mono truncate max-w-[180px]">{log.url}</span>
                          <span className="text-[9px] text-white/20 font-black">{new Date(log.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <span className={`text-[10px] font-black uppercase px-3 py-1 rounded-full ${log.status === 'done' ? 'text-green-500' : 'text-blue-500'}`}>{log.status}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-[12px] font-black uppercase tracking-widest text-blue-400 italic block px-2">ntfy Address</label>
                <div className="bg-black/80 p-6 rounded-[2rem] border border-white/5 font-mono text-[12px] text-blue-400/70 break-all select-all shadow-inner">
                  https://ntfy.sh/{automation.remoteTriggerId}
                </div>
                <button onClick={() => copyToClipboard(`https://ntfy.sh/${automation.remoteTriggerId}`)} className="w-full py-5 bg-white/5 hover:bg-white/10 rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all text-white/30 border border-white/5">Copy Endpoint</button>
              </div>

              <div className="space-y-4 pt-8 border-t border-white/5">
                <div className="flex justify-between items-center px-2">
                  <label className="text-[12px] font-black uppercase tracking-widest text-emerald-400 italic">n8n Webhook</label>
                  <button onClick={testWebhook} className="text-[11px] font-black uppercase tracking-widest text-white/40 hover:text-white transition-colors">Test Ping</button>
                </div>
                <input 
                  type="text" 
                  value={automation.webhookUrl}
                  onChange={(e) => setAutomation({...automation, webhookUrl: e.target.value})}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-5 text-sm focus:outline-none focus:border-emerald-500 transition-all font-mono text-[12px] text-white/70 shadow-inner"
                  placeholder="Target Webhook URL"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* LEFT COLUMN: CONTROLS & VISUALIZER */}
        <div className="lg:col-span-5 space-y-10 lg:sticky lg:top-10 lg:h-fit">
          <header className="flex justify-between items-center px-4">
            <div className="space-y-1">
              <h1 className="text-6xl font-black tracking-tighter uppercase italic leading-none">VoiceFlow</h1>
              <p className="text-white/20 text-[12px] font-black uppercase tracking-[0.5em] mt-1 ml-1">Logic System</p>
            </div>
            <button onClick={() => setIsSettingsOpen(true)} className="p-5 bg-white/5 hover:bg-white/10 rounded-[2.5rem] text-white/40 border border-white/5 shadow-2xl transition-all active:scale-95">
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
          </header>

          <div className="bg-[#111111] border border-white/5 rounded-[4.5rem] p-12 shadow-[0_40px_100px_-20px_rgba(0,0,0,0.8)] flex flex-col items-center relative overflow-hidden group">
             {/* Status Badge */}
             <div className="absolute top-10 right-14 flex items-center gap-3 bg-black/40 px-6 py-2 rounded-full border border-white/5">
                <span className={`w-2.5 h-2.5 rounded-full ${status === RecorderStatus.RECORDING ? 'bg-red-500 animate-pulse shadow-[0_0_15px_#ef4444]' : status === RecorderStatus.LISTENING ? 'bg-green-500 shadow-[0_0_15px_#22c55e]' : 'bg-white/10'}`}></span>
                <span className="text-[11px] font-black uppercase tracking-widest text-white/40 italic">{isContinuous ? 'CALL' : status}</span>
             </div>

             <div className="w-full max-w-[320px] aspect-square flex items-center justify-center relative my-4">
                <Visualizer 
                  volume={isAutomationRunning ? (Math.random() * 80 + 120) : currentVolume} 
                  isActive={status !== RecorderStatus.IDLE || isAutomationRunning}
                  sensitivity={settings.sensitivity}
                />
                {/* Visual Silence Progress Ring */}
                {status === RecorderStatus.RECORDING && silenceProgress > 0 && (
                  <div className="absolute inset-0 pointer-events-none p-2">
                    <svg className="w-full h-full -rotate-90 drop-shadow-2xl">
                      <circle
                        cx="50%" cy="50%" r="48%"
                        fill="none" stroke="#ef4444" strokeWidth="6"
                        strokeDasharray="100%"
                        strokeDashoffset={`${(1 - silenceProgress) * 100}%`}
                        className="transition-all duration-150 ease-linear opacity-40"
                      />
                    </svg>
                  </div>
                )}
             </div>

             {/* Precision Timer Display */}
             <div className="text-center h-28 flex flex-col justify-center mb-8">
                {(status === RecorderStatus.RECORDING || (status === RecorderStatus.LISTENING && recordingDuration > 0)) ? (
                  <>
                    <p className="text-6xl font-black text-white tracking-tighter tabular-nums drop-shadow-2xl">
                      {formatDuration(recordingDuration)}
                    </p>
                    {silenceProgress > 0 && (
                       <p className="text-[12px] font-black uppercase tracking-[0.4em] text-red-500 mt-3 animate-pulse italic">Silence Sequence</p>
                    )}
                  </>
                ) : (
                  <p className="text-lg font-black uppercase tracking-[0.4em] text-white/10 italic">System Standby</p>
                )}
             </div>

             <button
               onClick={() => toggleListen(false)}
               disabled={isAutomationRunning}
               className={`relative flex items-center justify-center w-32 h-32 rounded-full transition-all transform active:scale-90 z-10 ${
                 status === RecorderStatus.IDLE 
                 ? 'bg-white text-black hover:scale-105 shadow-[0_20px_50px_rgba(255,255,255,0.1)]' 
                 : 'bg-red-500 text-white shadow-[0_0_80px_rgba(239,68,68,0.4)] hover:shadow-[0_0_100px_rgba(239,68,68,0.6)]'
               } disabled:opacity-10`}
             >
               {status === RecorderStatus.IDLE ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>
               ) : (
                 <svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/></svg>
               )}
             </button>
          </div>

          {/* Config Panel */}
          <div className="bg-[#111111] border border-white/5 rounded-[4rem] p-12 space-y-12 shadow-2xl">
            <h2 className="text-2xl font-black uppercase tracking-tighter italic text-white/70 px-4">Threshold Logic</h2>
            <div className="space-y-12">
              <div className="space-y-6">
                <div className="flex justify-between text-[11px] font-black uppercase tracking-[0.3em] text-white/30 px-4">
                  <span>Input Gain Threshold</span>
                  <span className="text-white/60">{settings.sensitivity}%</span>
                </div>
                <div className="relative h-16 flex items-center">
                  <div className="absolute inset-0 bg-white/[0.03] rounded-[2rem] overflow-hidden border border-white/5">
                    <div className="h-full bg-blue-500/20 transition-all duration-75" style={{ width: `${(currentVolume / 255) * 100}%` }} />
                    <div className="absolute top-0 h-full w-2.5 bg-red-500/50 shadow-[0_0_15px_#ef4444]" style={{ left: `${settings.sensitivity}%` }} />
                  </div>
                  <input 
                    type="range" min="0" max="100" value={settings.sensitivity}
                    onChange={(e) => setSettings({...settings, sensitivity: parseInt(e.target.value)})}
                    className="w-full h-full appearance-none bg-transparent cursor-pointer z-10"
                  />
                </div>
              </div>

              <div className="space-y-6">
                <div className="flex justify-between text-[11px] font-black uppercase tracking-[0.3em] text-white/30 px-4">
                  <span>Silence Timeout</span>
                  <span className="text-white/60">{(settings.silenceTimeout / 1000).toFixed(1)}s</span>
                </div>
                <input 
                  type="range" min="500" max="5000" step="100" value={settings.silenceTimeout}
                  onChange={(e) => setSettings({...settings, silenceTimeout: parseInt(e.target.value)})}
                  className="w-full h-4 bg-white/5 rounded-full appearance-none cursor-pointer accent-blue-600 shadow-inner"
                />
              </div>

              {lastLog && (
                <div className="bg-white/[0.02] border border-white/5 rounded-3xl p-5 flex items-center gap-5 animate-in fade-in slide-in-from-bottom-2">
                  <div className={`w-3 h-3 rounded-full ${lastLog.toLowerCase().includes('fail') || lastLog.toLowerCase().includes('error') ? 'bg-red-500 shadow-[0_0_10px_#ef4444]' : 'bg-blue-500 shadow-[0_0_10px_#3b82f6]'} animate-pulse`} />
                  <span className="text-[12px] font-black uppercase tracking-widest text-white/60 italic">{lastLog}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: ARCHIVES */}
        <div className="lg:col-span-7 space-y-10 pb-40">
          <div className="flex items-center justify-between sticky top-0 bg-[#0a0a0a]/90 backdrop-blur-3xl z-[50] py-6 px-4">
            <h2 className="text-4xl font-black tracking-tighter uppercase italic flex items-center gap-6">
              Archive Vault
              <span className="bg-white/5 text-white/30 text-[12px] px-6 py-2 rounded-full font-black uppercase tracking-widest border border-white/5">{recordings.length}</span>
            </h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 px-2">
            {recordings.length === 0 ? (
              <div className="col-span-full py-60 flex flex-col items-center justify-center text-white/5 border-4 border-dashed border-white/5 rounded-[5rem] transition-all hover:border-white/10 group">
                <svg className="mb-6 opacity-20 group-hover:scale-110 transition-transform" xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
                <p className="text-lg font-black uppercase tracking-[0.5em] opacity-10 italic text-center">Awaiting Signal Streams</p>
              </div>
            ) : (
              recordings.map(recording => (
                <RecordingCard key={recording.id} recording={recording} onDelete={deleteRecording} onUpdate={handleUpdateRecording} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
