import { useState, useEffect, useRef, useCallback } from 'react';
import { RecorderStatus, AudioSettings, Recording } from '../types';

export function useVADRecorder(settings: AudioSettings) {
  const [status, setStatus] = useState<RecorderStatus>(RecorderStatus.IDLE);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [currentVolume, setCurrentVolume] = useState(0);
  const [silenceProgress, setSilenceProgress] = useState(0); 
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isContinuous, setIsContinuous] = useState(false);
  
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  const isContinuousRef = useRef(isContinuous);
  useEffect(() => { isContinuousRef.current = isContinuous; }, [isContinuous]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  
  const silenceTimerRef = useRef<number | null>(null);
  const silenceTimerStartRef = useRef<number | null>(null);
  const recordingStartTimeRef = useRef<number | null>(null);
  const isVoiceActiveRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);

  const shutdown = useCallback(() => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch(e) {}
    }

    streamRef.current?.getTracks().forEach(t => t.stop());
    audioContextRef.current?.close().catch(() => {});
    
    setStatus(RecorderStatus.IDLE);
    setCurrentVolume(0);
    setSilenceProgress(0);
    setRecordingDuration(0);
    isVoiceActiveRef.current = false;
    silenceTimerStartRef.current = null;
    recordingStartTimeRef.current = null;
    silenceTimerRef.current = null;
    analyserRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
    chunksRef.current = [];
  }, []);

  const stopMediaRecorder = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
        if (isContinuousRef.current) {
          setStatus(RecorderStatus.LISTENING);
          setSilenceProgress(0);
          silenceTimerStartRef.current = null;
          isVoiceActiveRef.current = false;
          if (silenceTimerRef.current) {
            window.clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else {
          shutdown();
        }
      } catch (e) {
        shutdown();
      }
    } else {
      shutdown();
    }
  }, [shutdown]);

  const startMediaRecorder = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'inactive') {
      try {
        chunksRef.current = [];
        mediaRecorderRef.current.start();
        recordingStartTimeRef.current = Date.now();
        setRecordingDuration(0);
        setStatus(RecorderStatus.RECORDING);
      } catch (e) {
        console.error("VAD: Failed to start", e);
      }
    }
  }, []);

  const analyze = useCallback(() => {
    if (!analyserRef.current) return;
    
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) { sum += dataArray[i]; }
    const average = sum / dataArray.length;
    setCurrentVolume(average);

    const threshold = settingsRef.current.sensitivity * 2.5;
    
    if (recordingStartTimeRef.current && statusRef.current === RecorderStatus.RECORDING) {
      setRecordingDuration((Date.now() - recordingStartTimeRef.current) / 1000);
    }

    if (average > threshold) {
      if (!isVoiceActiveRef.current) {
        isVoiceActiveRef.current = true;
        if (statusRef.current === RecorderStatus.LISTENING) {
          startMediaRecorder();
        }
      }
      
      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      silenceTimerStartRef.current = null;
      setSilenceProgress(0);
    } else {
      if (isVoiceActiveRef.current && statusRef.current === RecorderStatus.RECORDING) {
        if (!silenceTimerRef.current) {
          silenceTimerStartRef.current = Date.now();
          silenceTimerRef.current = window.setTimeout(() => {
            stopMediaRecorder();
          }, settingsRef.current.silenceTimeout);
        }
      }

      if (silenceTimerStartRef.current && statusRef.current === RecorderStatus.RECORDING) {
        const elapsed = Date.now() - silenceTimerStartRef.current;
        const progress = Math.min(elapsed / settingsRef.current.silenceTimeout, 1);
        setSilenceProgress(progress);
      } else {
        setSilenceProgress(0);
      }
    }

    animationFrameRef.current = requestAnimationFrame(analyze);
  }, [startMediaRecorder, stopMediaRecorder]);

  const initAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioContext.state === 'suspended') await audioContext.resume();
      
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      
      mediaRecorder.onstop = () => {
        if (chunksRef.current.length > 0) {
          const finalDuration = recordingStartTimeRef.current 
            ? (Date.now() - recordingStartTimeRef.current) / 1000 
            : 0;
            
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          const url = URL.createObjectURL(blob);
          const newRecording: Recording = {
            id: crypto.randomUUID(),
            blob,
            url,
            timestamp: Date.now(),
            duration: finalDuration
          };
          setRecordings(prev => [newRecording, ...prev]);
        }
        chunksRef.current = [];
        recordingStartTimeRef.current = null;
      };

      mediaRecorderRef.current = mediaRecorder;
      setStatus(RecorderStatus.LISTENING);
      
      animationFrameRef.current = requestAnimationFrame(analyze);
      return true;
    } catch (err) {
      setStatus(RecorderStatus.ERROR);
      return false;
    }
  };

  const toggleListen = async (continuousMode?: boolean) => {
    if (typeof continuousMode === 'boolean') setIsContinuous(continuousMode);
    if (statusRef.current === RecorderStatus.IDLE || statusRef.current === RecorderStatus.ERROR) {
      return await initAudio();
    } else {
      shutdown();
      return false;
    }
  };

  const deleteRecording = (id: string) => {
    setRecordings(prev => prev.filter(r => r.id !== id));
  };

  useEffect(() => { return () => shutdown(); }, [shutdown]);

  return {
    status,
    recordings,
    currentVolume,
    silenceProgress,
    recordingDuration,
    isContinuous,
    setIsContinuous,
    toggleListen,
    deleteRecording,
    setRecordings,
    startMediaRecorder,
    stopMediaRecorder,
    shutdown
  };
}