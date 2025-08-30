import React, { useState } from 'react';
import { useGame } from '../context/GameContext';
export const Chat = ({
  isOpen,
  onClose
}: {
  isOpen: boolean;
  onClose: () => void;
}) => {
  const [message, setMessage] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{
    sender: string;
    text: string;
  }>>([{
    sender: 'System',
    text: 'Welcome to the poker table!'
  }, {
    sender: 'System',
    text: 'Chat with other players here.'
  }]);
  const {
    gameState
  } = useGame();
  const handleSendMessage = () => {
    if (message.trim() === '') return;
    // Add the user's message to the chat
    setChatMessages([...chatMessages, {
      sender: 'You',
      text: message
    }]);
    // Clear the input
    setMessage('');
    // Simulate a response after a short delay
    setTimeout(() => {
      setChatMessages(prev => [...prev, {
        sender: 'Dealer',
        text: 'Good luck at the table!'
      }]);
    }, 1000);
  };
  if (!isOpen) return null;
  return <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-md mx-4 shadow-lg">
        <div className="flex justify-between items-center p-4 border-b border-gray-700">
          <h3 className="text-xl font-bold text-purple-400">Table Chat</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            ✕
          </button>
        </div>
        <div className="h-64 overflow-y-auto p-4 space-y-2">
          {chatMessages.map((msg, idx) => <div key={idx} className="flex flex-col">
              <span className={`font-bold ${msg.sender === 'You' ? 'text-green-400' : 'text-purple-400'}`}>
                {msg.sender}:
              </span>
              <span className="text-white ml-2">{msg.text}</span>
            </div>)}
        </div>
        <div className="p-4 border-t border-gray-700 flex">
          <input type="text" value={message} onChange={e => setMessage(e.target.value)} placeholder="Type your message..." className="flex-1 bg-gray-700 text-white px-3 py-2 rounded-l-lg focus:outline-none" onKeyPress={e => e.key === 'Enter' && handleSendMessage()} />
          <button onClick={handleSendMessage} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-r-lg">
            Send
          </button>
        </div>
      </div>
    </div>;
};