import { useState } from 'react';

interface Props {
  isOpen: boolean;
  onJoin: (nickname: string) => void;
}

export const PlayerJoinModal = ({ isOpen, onJoin }: Props) => {
  const [nickname, setNickname] = useState('');
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-6 rounded-xl w-80">
        <h2 className="text-xl font-bold mb-4">Join Table</h2>
        <label className="block mb-2 text-sm">Nickname</label>
        <input value={nickname} onChange={e => setNickname(e.target.value)} className="w-full mb-4 p-2 rounded bg-gray-700" />
        <button onClick={() => onJoin(nickname.trim() || 'Player')} className="w-full bg-purple-600 py-2 rounded mt-2">Join</button>
      </div>
    </div>
  );
};
