import React, { useEffect, useState } from 'react'
import { useStore } from '../store/appStore'
import '../styles/pages.css'

export default function Revisions() {
  const { revisions, loading, error, fetchRevisions } = useStore()
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    fetchRevisions()
  }, [fetchRevisions])

  return (
    <div className="revisions-page">
      <div className="page-header">
        <h1>Inventory Revisions</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : 'New Revision'}
        </button>
      </div>

      {showForm && (
        <div className="form-container">
          <h2>Create Revision</h2>
          <form>
            <input type="text" placeholder="Product" required />
            <input type="number" placeholder="Expected Quantity" min="0" required />
            <input type="number" placeholder="Actual Quantity" min="0" required />
            <textarea placeholder="Notes"></textarea>
            <button type="submit" className="btn btn-primary">Save Revision</button>
          </form>
        </div>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Product</th>
            <th>Expected</th>
            <th>Actual</th>
            <th>Difference</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {revisions.length === 0 ? (
            <tr>
              <td colSpan="6" className="empty-state">No revisions recorded</td>
            </tr>
          ) : (
            revisions.map(revision => (
              <tr key={revision.id}>
                <td>{new Date(revision.created_at).toLocaleDateString()}</td>
                <td>{revision.product_id || 'Unknown'}</td>
                <td>{revision.expected_quantity}</td>
                <td>{revision.actual_quantity}</td>
                <td className={revision.actual_quantity !== revision.expected_quantity ? 'highlight-diff' : ''}>
                  {revision.actual_quantity - revision.expected_quantity}
                </td>
                <td>{revision.notes || '-'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {error && <div className="error-message">{error}</div>}
    </div>
  )
}
