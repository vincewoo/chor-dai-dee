import React, { useState, useEffect, useRef } from 'react';

/**
 * Reusable Modal component for alerts and prompts
 * Mobile-friendly alternative to browser alert() and prompt()
 */
const Modal = ({ isOpen, onClose, title, message, type = 'alert', onConfirm, placeholder = '' }) => {
    const [inputValue, setInputValue] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        if (isOpen && type === 'prompt' && inputRef.current) {
            // Auto-focus input when modal opens
            setTimeout(() => inputRef.current?.focus(), 100);
        }
        if (isOpen) {
            // Reset the input each time the modal opens (sync to the isOpen prop).
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setInputValue('');
        }
    }, [isOpen, type]);

    const handleConfirm = () => {
        if (type === 'prompt') {
            onConfirm?.(inputValue);
        } else {
            onConfirm?.();
        }
        onClose();
    };

    const handleCancel = () => {
        if (type === 'prompt') {
            onConfirm?.(null);
        }
        onClose();
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && type === 'prompt') {
            handleConfirm();
        } else if (e.key === 'Escape') {
            handleCancel();
        }
    };

    if (!isOpen) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
            onClick={handleCancel}
        >
            <div
                className="bg-white rounded-lg max-w-md w-full shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6">
                    {title && (
                        <div className="flex justify-between items-start mb-4">
                            <h2 className="text-2xl font-bold text-gray-800">
                                {title}
                            </h2>
                            <button
                                onClick={handleCancel}
                                className="text-gray-500 hover:text-gray-700 text-2xl leading-none"
                                aria-label="Close"
                            >
                                ×
                            </button>
                        </div>
                    )}

                    {message && (
                        <p className="text-gray-700 text-base mb-6">
                            {message}
                        </p>
                    )}

                    {type === 'prompt' && (
                        <input
                            ref={inputRef}
                            type="text"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={placeholder}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent mb-6 text-base"
                        />
                    )}

                    <div className="flex gap-3">
                        {type === 'prompt' && (
                            <button
                                onClick={handleCancel}
                                className="flex-1 bg-gray-200 text-gray-800 py-3 px-4 rounded-lg hover:bg-gray-300 transition font-semibold text-base"
                            >
                                Cancel
                            </button>
                        )}
                        <button
                            onClick={handleConfirm}
                            className="flex-1 bg-indigo-600 text-white py-3 px-4 rounded-lg hover:bg-indigo-700 transition font-semibold text-base"
                        >
                            {type === 'prompt' ? 'OK' : 'Got it!'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Modal;
