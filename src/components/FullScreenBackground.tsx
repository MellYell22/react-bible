import React from 'react';

interface FullScreenBackgroundProps {
  children: React.ReactNode;
  center?: boolean;
}

export const FullScreenBackground: React.FC<FullScreenBackgroundProps> = ({ children, center = false }) => {
  return (
    <div className={`min-h-screen w-full bg-gradient-to-b from-[#0b1e3d] to-[#050c1a] flex flex-col ${center ? 'justify-center items-center' : ''} p-4 md:p-8 safe-area-inset`}>
      {children}
    </div>
  );
};
