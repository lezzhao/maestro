import React from 'react';
import { motion } from 'framer-motion';

interface WaveformProps {
  isListening: boolean;
  color?: string;
}

export const Waveform: React.FC<WaveformProps> = ({ isListening, color = "#60A5FA" }) => {
  const bars = Array.from({ length: 20 });

  return (
    <div className="flex items-center justify-center gap-[3px] h-12 w-full max-w-[200px]">
      {bars.map((_, i) => (
        <motion.div
          key={i}
          animate={{
            height: isListening 
              ? [8, Math.random() * 32 + 8, 8] 
              : 4,
            opacity: isListening ? 1 : 0.2
          }}
          transition={{
            repeat: Infinity,
            duration: isListening ? 0.5 + Math.random() * 0.5 : 1.5,
            ease: "easeInOut",
            delay: i * 0.05
          }}
          className="w-[3px] rounded-full"
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
};
