import React, { useEffect, useState } from 'react'
import { useStore } from '../store/appStore'
import '../styles/pages.css'

export default function Reserves() {
  const { reserves, loading, error, fetchReserves } = useStore()
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    fetchReserves()
  }, [fetchReserves])

  return (
    <div className="reserves-page">
      <div className="page-header">
        <h1>Reserves</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Cancel' : 'Add Reserve'}
        </button>
      </div>

      {showForm && (
        <div className="form-container">
          <h2>Reserve Product</h2>
          <form>
            <input type="text" placeholder="Product" required />
            <input type="number" placeholder="Quantity" min="1" required />
            <input type="text" placeholder="Customer Name" />
            <input type="date" placeholder="Expires At" />
            <button type="submit" className="btn btn-primary">Reserve</button>
          </form>
        </div>
      )}

      <table className="data-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Quantity</th>
            <th>Customer</th>
            <th>Status</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {reserves.length === 0 ? (
            <tr>
              <td colSpan="6" className="empty-state">No reserves</td>
            </tr>
          ) : (
            reserves.map(reserve => (
              <tr key={reserve.id}>
                <td>{reserve.product_id || 'Unknown'}</td>
                <td>{reserve.quantity}</td>
                <td>{reserve.customer_name || '-'}</td>
                <td><span className="badge badge-pending">Pending</span></td>
                <td>{new Date(reserve.created_at).toLocaleDateString()}</td>
                <td>
                  <button className="btn btn-small btn-danger">Cancel</button>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {error && <div className="error-message">{error}</div>}
    </div>
  )
}
