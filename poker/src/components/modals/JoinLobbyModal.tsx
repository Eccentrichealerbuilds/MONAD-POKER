import { useEffect, useRef, useState, type KeyboardEventHandler } from 'react';

interface Props {
  isOpen: boolean;
  onJoin: (roomInput: string) => void;
  onClose: () => void;
}

export const JoinLobbyModal = ({ isOpen, onJoin, onClose }: Props) => {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setInput('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    const value = input.trim();
    if (!value) return;
    onJoin(value);
  };

  const handleKeyDown: KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-6 rounded-xl w-96 max-w-[92vw]">
        <h2 className="text-xl font-bold mb-4">Join Table</h2>
        <label className="block mb-2 text-sm">Room link or code</label>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste link or enter code"
          className="w-full mb-4 p-2 rounded bg-gray-700 placeholder-gray-400"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600">Cancel</button>
          <button onClick={handleSubmit} className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-700">Join</button>
        </div>
      </div>
    </div>
  );
};
