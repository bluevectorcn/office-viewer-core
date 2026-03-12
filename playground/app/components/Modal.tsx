import React, { useState, useEffect } from 'react';
import './Modal.css';
import { t } from '../i18n';

export type ModalType = 'alert' | 'confirm' | 'prompt';

interface ModalProps {
  isOpen: boolean;
  type: ModalType;
  title?: string;
  message: string;
  defaultValue?: string;
  onConfirm: (value?: string) => void;
  onCancel: () => void;
}

const Modal: React.FC<ModalProps> = ({
  isOpen,
  type,
  title,
  message,
  defaultValue = '',
  onConfirm,
  onCancel,
}) => {
  const [inputValue, setInputValue] = useState(defaultValue);

  useEffect(() => {
    if (isOpen) {
      setInputValue(defaultValue);
    }
  }, [isOpen, defaultValue]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm(type === 'prompt' ? inputValue : undefined);
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-container" onClick={(e) => e.stopPropagation()}>
        {title && <div className="modal-title">{title}</div>}
        <div className="modal-message">{message}</div>
        
        {type === 'prompt' && (
          <div className="modal-input-container">
            <input
              type="text"
              autoFocus
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
            />
          </div>
        )}
        
        <div className="modal-actions">
          {(type === 'confirm' || type === 'prompt') && (
            <button className="secondary" onClick={onCancel}>
              {t('cancel')}
            </button>
          )}
          <button onClick={handleConfirm}>
            {t('confirm')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Modal;
