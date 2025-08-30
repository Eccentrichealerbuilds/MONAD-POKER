import React from 'react';
type MobileWarningProps = {
  isVisible: boolean;
  onContinue: () => void;
};
export const MobileWarning = ({
  isVisible,
  onContinue
}: MobileWarningProps) => {
  if (!isVisible) return null;
  return <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-800 p-6 rounded-xl max-w-md text-center">
        <h2 className="text-2xl font-bold text-red-400 mb-4">
          Mobile Device Detected
        </h2>
        <p className="text-gray-300 mb-4">
          This poker game is designed for desktop screens. For the best
          experience, please use a laptop or desktop computer.
        </p>
        <p className="text-gray-400 text-sm mb-6">
          You can continue on mobile, but the layout may not display correctly.
        </p>
        <button onClick={onContinue} className="bg-purple-600 hover:bg-purple-700 px-6 py-3 rounded-lg font-medium transition">
          I understand, continue anyway
        </button>
      </div>
    </div>;
};