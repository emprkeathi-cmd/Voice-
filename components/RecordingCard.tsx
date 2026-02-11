
import React from 'react';
import { Recording } from '../types';

interface RecordingCardProps {
  recording: Recording;
  onDelete: (id: string) => void;
  onUpdate: (recording: Recording) => void;
}

export const RecordingCard: React.FC<RecordingCardProps> = ({ recording, onDelete }) => {
  const formatDate = (ts: number) => {
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      month: 'short',
      day: 'numeric'
    }).format(ts);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="bg-[#1a1a1a] border border-white/5 rounded-2xl p-5 transition-all hover:border-white/20 shadow-lg">
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-sm font-bold text-white/90">{formatDate(recording.timestamp)}</h3>
          <p className="text-[10px] text-white/30 uppercase tracking-widest font-bold mt-1">
            {recording.duration.toFixed(1)}s • {formatFileSize(recording.blob.size)} • Audio Log
          </p>
        </div>
        <div className="flex gap-2">
          <a 
            href={recording.url} 
            download={`recording-${recording.id}.webm`}
            className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-white/60 transition-colors"
            title="Download"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </a>
          <button 
            onClick={() => onDelete(recording.id)}
            className="p-2 bg-red-500/10 hover:bg-red-500/20 rounded-xl text-red-400 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </div>
      </div>

      <div className="mt-4">
        <audio src={recording.url} controls className="w-full h-10 opacity-80 filter invert grayscale" />
      </div>
    </div>
  );
};
