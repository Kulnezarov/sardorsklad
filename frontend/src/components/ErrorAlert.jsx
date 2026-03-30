import React from 'react'

export default function ErrorAlert({ message, onClose }) {
  return (
    <div className="error-alert">
      <div className="error-content">
        <strong>Error:</strong> {message}
        <button onClick={onClose} className="close-btn">&times;</button>
      </div>
    </div>
  )
}
