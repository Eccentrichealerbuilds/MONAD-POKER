import { useState } from 'react';

interface Props {
  isOpen: boolean;
  onCreate: (nickname: string, stack: number, sb: number, bb: number) => void;
}

export const TableSetupModal = ({ isOpen, onCreate }: Props) => {
  const [nickname, setNickname] = useState('');
  const [stack, setStack] = useState(2000);
  const [sb, setSb] = useState(5);
  const [bb, setBb] = useState(10);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-6 rounded-xl w-80">
        <h2 className="text-xl font-bold mb-4">Create Table</h2>
        <label className="block mb-2 text-sm">Nickname</label>
        <input value={nickname} onChange={e => setNickname(e.target.value)} className="w-full mb-4 p-2 rounded bg-gray-700" />
        <label className="block mb-2 text-sm">Starting Stack</label>
        <input type="number" value={stack} onChange={e => setStack(Number(e.target.value))} className="w-full mb-4 p-2 rounded bg-gray-700" />
        <label className="block mb-2 text-sm">Small Blind</label>
        <input type="number" value={sb} onChange={e => setSb(Number(e.target.value))} className="w-full mb-4 p-2 rounded bg-gray-700" />
        <label className="block mb-2 text-sm">Big Blind</label>
        <input type="number" value={bb} onChange={e => setBb(Number(e.target.value))} className="w-full mb-4 p-2 rounded bg-gray-700" />
        <button onClick={() => onCreate(nickname.trim() || 'Player', stack, sb, bb)} className="w-full bg-purple-600 py-2 rounded mt-2">Create</button>
      </div>
    </div>
  );
};
