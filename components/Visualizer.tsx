
import React, { useEffect, useRef } from 'react';

interface VisualizerProps {
  volume: number;
  isActive: boolean;
  sensitivity: number;
}

export const Visualizer: React.FC<VisualizerProps> = ({ volume, isActive, sensitivity }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    const threshold = sensitivity * 2.5;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;
      const baseRadius = 60;
      const maxRadius = 140;
      
      // Draw sensitivity ring
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius + (threshold / 255) * (maxRadius - baseRadius), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw volume circle
      const normalizedVolume = (volume / 255);
      const targetRadius = baseRadius + normalizedVolume * (maxRadius - baseRadius);
      
      const gradient = ctx.createRadialGradient(centerX, centerY, baseRadius, centerX, centerY, targetRadius);
      if (volume > threshold) {
        gradient.addColorStop(0, 'rgba(34, 197, 94, 0.8)');
        gradient.addColorStop(1, 'rgba(34, 197, 94, 0)');
      } else {
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.6)');
        gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
      }

      ctx.beginPath();
      ctx.arc(centerX, centerY, targetRadius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Pulse core
      ctx.beginPath();
      ctx.arc(centerX, centerY, baseRadius, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? (volume > threshold ? '#22c55e' : '#3b82f6') : '#374151';
      ctx.fill();
      
      animationFrameId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animationFrameId);
  }, [volume, isActive, sensitivity]);

  return (
    <div className="relative flex justify-center items-center h-64 w-full">
      <canvas 
        ref={canvasRef} 
        width={400} 
        height={400} 
        className="w-full h-full max-w-[300px]"
      />
      <div className="absolute flex flex-col items-center pointer-events-none">
        <span className="text-xs font-bold tracking-widest uppercase opacity-60">
          {isActive ? (volume > sensitivity * 2.5 ? 'Talking' : 'Listening') : 'Standby'}
        </span>
      </div>
    </div>
  );
};
